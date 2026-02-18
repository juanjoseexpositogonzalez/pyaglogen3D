"""Simulation views."""
import csv
import io
import logging
import zipfile

import numpy as np
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .models import ParametricStudy, Simulation, SimulationStatus
from .serializers import (
    ParametricStudySerializer,
    SimulationDetailSerializer,
    SimulationSerializer,
)
from .services.projection import (
    render_projection_png,
    render_projection_svg,
    create_projection_filename,
)
from .tasks import run_simulation_task

logger = logging.getLogger(__name__)


class SimulationViewSet(viewsets.ModelViewSet):
    """ViewSet for Simulation CRUD operations."""

    queryset = Simulation.objects.select_related("project")

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == "retrieve":
            return SimulationDetailSerializer
        return SimulationSerializer

    def get_queryset(self):
        """Filter simulations by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create simulation and enqueue task."""
        from django.conf import settings

        project_id = self.kwargs.get("project_pk")
        simulation = serializer.save(project_id=project_id)

        # Try Celery, fall back to sync execution in development
        try:
            result = run_simulation_task.delay(str(simulation.id))
            # Store task ID for cancellation
            simulation.task_id = result.id
            simulation.save(update_fields=["task_id"])
        except Exception as e:
            if settings.DEBUG:
                # Run synchronously in development if Celery unavailable
                run_simulation_task(str(simulation.id))
            else:
                raise

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """Delete a simulation."""
        simulation = self.get_object()

        # If running, cancel the task first
        if simulation.status in [SimulationStatus.QUEUED, SimulationStatus.RUNNING]:
            self._cancel_task(simulation)

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, pk=None, **kwargs) -> Response:
        """Cancel a running or queued simulation."""
        simulation = self.get_object()

        if simulation.status not in [SimulationStatus.QUEUED, SimulationStatus.RUNNING]:
            return Response(
                {"error": f"Cannot cancel simulation with status '{simulation.status}'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        self._cancel_task(simulation)

        # Update simulation status
        simulation.status = SimulationStatus.CANCELLED
        simulation.completed_at = timezone.now()
        simulation.error_message = "Cancelled by user"
        simulation.save(update_fields=["status", "completed_at", "error_message"])

        logger.info(f"Simulation {simulation.id} cancelled by user")

        return Response({"status": "cancelled", "simulation_id": str(simulation.id)})

    def _cancel_task(self, simulation: Simulation) -> None:
        """Revoke the Celery task if it exists."""
        if simulation.task_id:
            try:
                from celery.result import AsyncResult
                result = AsyncResult(simulation.task_id)
                result.revoke(terminate=True)
                logger.info(f"Revoked Celery task {simulation.task_id}")
            except Exception as e:
                logger.warning(f"Failed to revoke task {simulation.task_id}: {e}")

    @action(detail=True, methods=["get"])
    def geometry(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download geometry as binary NumPy array."""
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        response = HttpResponse(
            simulation.geometry,
            content_type="application/octet-stream",
        )
        response["Content-Disposition"] = f'attachment; filename="{simulation.id}.npy"'
        return response

    @action(detail=True, methods=["post"])
    def projection(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Generate a 2D projection of the agglomerate.

        POST body:
        {
            "azimuth": 45.0,      // degrees (default: 0, range: 0-360)
            "elevation": 30.0,   // degrees (default: 0, range: -90 to 90)
            "format": "png"      // "png" or "svg" (default: "png")
        }
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse and validate parameters (Issue #7, #9, #10 fixes)
        try:
            azimuth = float(request.data.get("azimuth", 0.0))
            elevation = float(request.data.get("elevation", 0.0))
        except (ValueError, TypeError) as e:
            return Response(
                {"error": f"Invalid numeric parameter: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate angle ranges (Issue #9)
        if not (0 <= azimuth <= 360):
            return Response(
                {"error": "Azimuth must be between 0 and 360 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (-90 <= elevation <= 90):
            return Response(
                {"error": "Elevation must be between -90 and 90 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate format strictly (Issue #10)
        img_format = request.data.get("format", "png")
        if not isinstance(img_format, str):
            return Response(
                {"error": "Format must be a string"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        img_format = img_format.lower().strip()

        if img_format not in ("png", "svg"):
            return Response(
                {"error": "Format must be 'png' or 'svg'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)

        # Project using Rust
        import aglogen_core
        proj = aglogen_core.project_to_2d(coords, radii, azimuth, elevation)

        # Render image
        bounds = (proj.bounds[0], proj.bounds[1], proj.bounds[2], proj.bounds[3])

        if img_format == "png":
            image_data = render_projection_png(proj.x, proj.y, proj.radii, bounds)
            content_type = "image/png"
        else:
            image_data = render_projection_svg(proj.x, proj.y, proj.radii, bounds)
            content_type = "image/svg+xml"

        filename = create_projection_filename(
            str(simulation.id)[:8], azimuth, elevation, img_format
        )

        response = HttpResponse(image_data, content_type=content_type)
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"], url_path="projection/batch")
    def projection_batch(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Generate batch 2D projections as a ZIP file.

        POST body:
        {
            "azimuth_start": 0,     // degrees (default: 0, range: 0-360)
            "azimuth_end": 150,     // degrees (default: 150, range: 0-360)
            "azimuth_step": 30,     // degrees (default: 30, must be > 0)
            "elevation_start": 0,   // degrees (default: 0, range: -90 to 90)
            "elevation_end": 150,   // degrees (default: 150, range: -90 to 90)
            "elevation_step": 30,   // degrees (default: 30, must be > 0)
            "format": "png"         // "png" or "svg" (default: "png")
        }
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse and validate parameters (Issue #8, #9, #10 fixes)
        try:
            az_start = float(request.data.get("azimuth_start", 0.0))
            az_end = float(request.data.get("azimuth_end", 150.0))
            az_step = float(request.data.get("azimuth_step", 30.0))
            el_start = float(request.data.get("elevation_start", 0.0))
            el_end = float(request.data.get("elevation_end", 150.0))
            el_step = float(request.data.get("elevation_step", 30.0))
        except (ValueError, TypeError) as e:
            return Response(
                {"error": f"Invalid numeric parameter: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate angle ranges (Issue #9)
        if not (0 <= az_start <= 360) or not (0 <= az_end <= 360):
            return Response(
                {"error": "Azimuth values must be between 0 and 360 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (-90 <= el_start <= 90) or not (-90 <= el_end <= 90):
            return Response(
                {"error": "Elevation values must be between -90 and 90 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate format strictly (Issue #10)
        img_format = request.data.get("format", "png")
        if not isinstance(img_format, str):
            return Response(
                {"error": "Format must be a string"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        img_format = img_format.lower().strip()

        if img_format not in ("png", "svg"):
            return Response(
                {"error": "Format must be 'png' or 'svg'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if az_step <= 0 or el_step <= 0:
            return Response(
                {"error": "Step values must be positive"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)

        # Generate batch projections using Rust
        import aglogen_core
        projections = aglogen_core.project_batch(
            coords, radii,
            azimuth_start=az_start,
            azimuth_end=az_end,
            azimuth_step=az_step,
            elevation_start=el_start,
            elevation_end=el_end,
            elevation_step=el_step,
        )

        # Create ZIP file with all projections
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for proj in projections:
                bounds = (proj.bounds[0], proj.bounds[1], proj.bounds[2], proj.bounds[3])

                if img_format == "png":
                    image_data = render_projection_png(proj.x, proj.y, proj.radii, bounds)
                else:
                    image_data = render_projection_svg(proj.x, proj.y, proj.radii, bounds)

                filename = create_projection_filename(
                    str(simulation.id)[:8], proj.azimuth, proj.elevation, img_format
                )
                zf.writestr(filename, image_data)

        zip_buffer.seek(0)
        response = HttpResponse(zip_buffer.read(), content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="{simulation.id}_projections.zip"'
        return response

    def _load_geometry(self, simulation: Simulation) -> tuple[np.ndarray, np.ndarray]:
        """Load geometry from simulation and return coordinates and radii."""
        buf = io.BytesIO(simulation.geometry)
        geometry_array = np.load(buf)
        coords = geometry_array[:, :3]
        radii = geometry_array[:, 3]
        return coords, radii

    @action(detail=True, methods=["get"], url_path="export")
    def export_csv(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Export agglomerate properties and particle data as CSV.

        Returns a CSV file with:
        - Agglomerate properties (Df, kf, Rg, porosity, shape analysis, etc.)
        - Per-particle data (coordinates, radius, coordination, distance from CDG)
        """
        simulation = self.get_object()

        if simulation.geometry is None or simulation.metrics is None:
            return Response(
                {"error": "Simulation data not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)
        n_particles = len(coords)

        # Calculate centers
        center_of_gravity = coords.mean(axis=0)
        geom_min = coords.min(axis=0)
        geom_max = coords.max(axis=0)
        geometrical_center = (geom_min + geom_max) / 2

        # Calculate distances from center of gravity
        distances_from_cdg = np.linalg.norm(coords - center_of_gravity, axis=2 if coords.ndim > 2 else 1)
        distance_order = np.argsort(distances_from_cdg) + 1  # 1-based ranking

        # Calculate per-particle coordination numbers
        coordination_numbers = self._calculate_coordination_numbers(coords, radii)

        # Create CSV
        output = io.StringIO()
        writer = csv.writer(output)

        # Section 1: Agglomerate Properties
        writer.writerow(["# AGGLOMERATE PROPERTIES"])
        writer.writerow(["Property", "Value", "Unit"])
        writer.writerow(["Simulation ID", str(simulation.id), ""])
        writer.writerow(["Algorithm", simulation.algorithm, ""])
        writer.writerow(["Number of Particles", n_particles, ""])
        writer.writerow(["Fractal Dimension (Df)", f"{simulation.metrics.get('fractal_dimension', 0):.4f}", ""])
        writer.writerow(["Df Std. Dev.", f"{simulation.metrics.get('fractal_dimension_std', 0):.4f}", ""])
        writer.writerow(["Prefactor (kf)", f"{simulation.metrics.get('prefactor', 0):.4f}", ""])
        writer.writerow(["Radius of Gyration (Rg)", f"{simulation.metrics.get('radius_of_gyration', 0):.4f}", "particle radii"])
        writer.writerow(["Porosity", f"{simulation.metrics.get('porosity', 0):.4f}", ""])
        writer.writerow(["Coordination Mean", f"{simulation.metrics.get('coordination', {}).get('mean', 0):.4f}", ""])
        writer.writerow(["Coordination Std. Dev.", f"{simulation.metrics.get('coordination', {}).get('std', 0):.4f}", ""])
        writer.writerow([])

        # Shape Analysis
        writer.writerow(["# SHAPE ANALYSIS (Inertia Tensor)"])
        writer.writerow(["Property", "Value", "Unit"])
        writer.writerow(["Anisotropy (Imax/Imin)", f"{simulation.metrics.get('anisotropy', 0):.4f}", ""])
        writer.writerow(["Asphericity", f"{simulation.metrics.get('asphericity', 0):.6f}", ""])
        writer.writerow(["Acylindricity", f"{simulation.metrics.get('acylindricity', 0):.6f}", ""])
        moments = simulation.metrics.get('principal_moments', [0, 0, 0])
        writer.writerow(["Principal Moment I1 (min)", f"{moments[0]:.4f}", ""])
        writer.writerow(["Principal Moment I2", f"{moments[1]:.4f}", ""])
        writer.writerow(["Principal Moment I3 (max)", f"{moments[2]:.4f}", ""])
        writer.writerow([])

        # Centers
        writer.writerow(["# GEOMETRIC CENTERS"])
        writer.writerow(["Property", "X", "Y", "Z"])
        writer.writerow(["Center of Gravity", f"{center_of_gravity[0]:.6f}", f"{center_of_gravity[1]:.6f}", f"{center_of_gravity[2]:.6f}"])
        writer.writerow(["Geometrical Center", f"{geometrical_center[0]:.6f}", f"{geometrical_center[1]:.6f}", f"{geometrical_center[2]:.6f}"])
        writer.writerow([])

        # Section 2: Particle Data
        writer.writerow(["# PARTICLE DATA"])
        writer.writerow([
            "Particle #",
            "X",
            "Y",
            "Z",
            "Radius",
            "Coordination #",
            "Distance from CDG",
            "Distance Rank"
        ])

        for i in range(n_particles):
            dist = distances_from_cdg[i]
            rank = np.where(distance_order == i + 1)[0][0] + 1  # Find rank for this particle
            writer.writerow([
                i + 1,  # 1-based particle number (depositional order)
                f"{coords[i, 0]:.6f}",
                f"{coords[i, 1]:.6f}",
                f"{coords[i, 2]:.6f}",
                f"{radii[i]:.6f}",
                coordination_numbers[i],
                f"{dist:.6f}",
                rank
            ])

        # Return CSV response
        output.seek(0)
        response = HttpResponse(output.read(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{simulation.id}_export.csv"'
        return response

    def _calculate_coordination_numbers(
        self, coords: np.ndarray, radii: np.ndarray, tolerance: float = 0.01
    ) -> np.ndarray:
        """Calculate coordination number (number of touching neighbors) for each particle.

        Two particles are considered neighbors if their surfaces are within `tolerance`
        of touching (distance <= r1 + r2 + tolerance * min_radius).
        """
        n = len(coords)
        coordination = np.zeros(n, dtype=int)

        for i in range(n):
            for j in range(i + 1, n):
                dist = np.linalg.norm(coords[i] - coords[j])
                touch_dist = radii[i] + radii[j]
                # Allow small tolerance for numerical precision
                if dist <= touch_dist * (1 + tolerance):
                    coordination[i] += 1
                    coordination[j] += 1

        return coordination

    def _calculate_adjacency_graph(
        self, coords: np.ndarray, radii: np.ndarray, tolerance: float = 0.01
    ) -> list[list[int]]:
        """Calculate adjacency list for particle neighbor graph.

        Returns a list where each index i contains a list of neighbor indices for particle i.
        Neighbors are particles whose surfaces touch (within tolerance).
        """
        n = len(coords)
        adjacency = [[] for _ in range(n)]

        for i in range(n):
            for j in range(i + 1, n):
                dist = np.linalg.norm(coords[i] - coords[j])
                touch_dist = radii[i] + radii[j]
                if dist <= touch_dist * (1 + tolerance):
                    adjacency[i].append(j)
                    adjacency[j].append(i)

        return adjacency

    @action(detail=True, methods=["get"], url_path="neighbor-graph")
    def neighbor_graph(self, request: Request, pk=None, **kwargs) -> Response:
        """Get particle neighbor/adjacency graph.

        Returns the graph structure showing which particles are connected (touching).
        Useful for topological analysis and fingerprinting.
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Load geometry
        coords, radii = self._load_geometry(simulation)
        n_particles = len(coords)

        # Calculate adjacency graph
        adjacency = self._calculate_adjacency_graph(coords, radii)

        # Build graph data structure for visualization
        # Nodes: particles with their properties
        # Edges: connections between touching particles
        nodes = []
        edges = []
        edge_set = set()  # To avoid duplicate edges

        # Calculate center of gravity for distance metrics
        center_of_gravity = coords.mean(axis=0)

        for i in range(n_particles):
            dist_from_cdg = float(np.linalg.norm(coords[i] - center_of_gravity))
            nodes.append({
                "id": i + 1,  # 1-based ID (depositional order)
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]),
                "z": float(coords[i, 2]),
                "radius": float(radii[i]),
                "coordination": len(adjacency[i]),
                "distance_from_cdg": dist_from_cdg,
            })

            # Add edges (avoiding duplicates)
            for j in adjacency[i]:
                edge_key = tuple(sorted([i, j]))
                if edge_key not in edge_set:
                    edge_set.add(edge_key)
                    edges.append({
                        "source": i + 1,  # 1-based
                        "target": j + 1,  # 1-based
                    })

        # Calculate graph statistics
        coordination_numbers = [len(adj) for adj in adjacency]
        stats = {
            "n_particles": n_particles,
            "n_edges": len(edges),
            "avg_coordination": float(np.mean(coordination_numbers)) if coordination_numbers else 0,
            "max_coordination": max(coordination_numbers) if coordination_numbers else 0,
            "min_coordination": min(coordination_numbers) if coordination_numbers else 0,
            # Graph connectivity metrics
            "is_connected": self._is_graph_connected(adjacency),
        }

        return Response({
            "nodes": nodes,
            "edges": edges,
            "stats": stats,
        })

    def _is_graph_connected(self, adjacency: list[list[int]]) -> bool:
        """Check if the graph is fully connected using BFS."""
        if not adjacency:
            return True

        n = len(adjacency)
        visited = [False] * n
        queue = [0]
        visited[0] = True
        count = 1

        while queue:
            node = queue.pop(0)
            for neighbor in adjacency[node]:
                if not visited[neighbor]:
                    visited[neighbor] = True
                    queue.append(neighbor)
                    count += 1

        return count == n


class ParametricStudyViewSet(viewsets.ModelViewSet):
    """ViewSet for ParametricStudy CRUD operations."""

    queryset = ParametricStudy.objects.select_related("project").prefetch_related(
        "simulations"
    )
    serializer_class = ParametricStudySerializer

    def get_queryset(self):
        """Filter studies by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create study and generate all simulations from parameter grid."""
        import itertools
        import random

        project_id = self.kwargs.get("project_pk")
        study = serializer.save(project_id=project_id, status=SimulationStatus.RUNNING)

        # Generate parameter combinations from grid
        param_names = list(study.parameter_grid.keys())
        param_values = [study.parameter_grid[name] for name in param_names]

        # Create all combinations
        combinations = list(itertools.product(*param_values))

        # Parameters that must be integers
        integer_params = {"n_particles"}

        simulations_created = []
        for combo in combinations:
            # Build parameters for this simulation
            params = dict(study.base_parameters)
            for i, name in enumerate(param_names):
                params[name] = combo[i]

            # Ensure integer parameters are properly typed
            for param_name in integer_params:
                if param_name in params:
                    params[param_name] = int(params[param_name])

            # Create simulations with different seeds
            for seed_idx in range(study.seeds_per_combination):
                seed = random.randint(0, 2**31 - 1)
                sim = Simulation.objects.create(
                    project_id=project_id,
                    algorithm=study.base_algorithm,
                    parameters=params,
                    seed=seed,
                    status=SimulationStatus.QUEUED,
                )
                simulations_created.append(sim)
                study.simulations.add(sim)

                # Queue the task
                try:
                    result = run_simulation_task.delay(str(sim.id))
                    sim.task_id = result.id
                    sim.save(update_fields=["task_id"])
                except Exception as e:
                    logger.warning(f"Failed to queue simulation {sim.id}: {e}")

        logger.info(
            f"Created parametric study {study.id} with {len(simulations_created)} simulations"
        )

    def perform_destroy(self, instance):
        """Delete study and all associated simulations."""
        # Delete all simulations associated with this study
        simulations = instance.simulations.all()
        count = simulations.count()
        simulations.delete()
        logger.info(f"Deleted parametric study {instance.id} and {count} associated simulations")
        instance.delete()

    @action(detail=True, methods=["get"])
    def results(self, request: Request, pk=None, **kwargs) -> Response:
        """Get aggregated results table for study."""
        study = self.get_object()
        simulations = study.simulations.all().order_by("created_at")

        results = []
        for sim in simulations:
            result_data = {
                "simulation_id": str(sim.id),
                "status": sim.status,
                "parameters": sim.parameters,
                "seed": sim.seed,
                "execution_time_ms": sim.execution_time_ms,
            }
            if sim.metrics:
                result_data.update({
                    "fractal_dimension": sim.metrics.get("fractal_dimension"),
                    "fractal_dimension_std": sim.metrics.get("fractal_dimension_std"),
                    "prefactor": sim.metrics.get("prefactor"),
                    "radius_of_gyration": sim.metrics.get("radius_of_gyration"),
                    "porosity": sim.metrics.get("porosity"),
                    "coordination_mean": sim.metrics.get("coordination", {}).get("mean"),
                    "coordination_std": sim.metrics.get("coordination", {}).get("std"),
                    "anisotropy": sim.metrics.get("anisotropy"),
                    "asphericity": sim.metrics.get("asphericity"),
                    "acylindricity": sim.metrics.get("acylindricity"),
                })
            results.append(result_data)

        # Calculate study status based on simulations
        total = study.simulations.count()
        completed = study.simulations.filter(status="completed").count()
        failed = study.simulations.filter(status="failed").count()
        running = study.simulations.filter(status__in=["queued", "running"]).count()

        return Response({
            "study_id": str(study.id),
            "name": study.name,
            "description": study.description,
            "base_algorithm": study.base_algorithm,
            "base_parameters": study.base_parameters,
            "parameter_grid": study.parameter_grid,
            "status": "completed" if running == 0 else "running",
            "progress": {
                "total": total,
                "completed": completed,
                "failed": failed,
                "running": running,
            },
            "results": results,
        })

    @action(detail=True, methods=["get"], url_path="export")
    def export_csv(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Export batch study results as CSV."""
        study = self.get_object()
        simulations = study.simulations.filter(status="completed").order_by("created_at")

        output = io.StringIO()
        writer = csv.writer(output)

        # Determine all parameter keys from the grid
        param_keys = list(study.parameter_grid.keys())

        # Header row
        header = ["Simulation ID", "Seed"] + param_keys + [
            "Df", "Df_std", "kf", "Rg", "Porosity",
            "Coord_Mean", "Coord_Std",
            "Anisotropy", "Asphericity", "Acylindricity",
            "Execution_ms"
        ]
        writer.writerow(header)

        # Data rows
        for sim in simulations:
            if sim.metrics:
                row = [
                    str(sim.id),
                    sim.seed,
                ] + [sim.parameters.get(key, "") for key in param_keys] + [
                    f"{sim.metrics.get('fractal_dimension', 0):.4f}",
                    f"{sim.metrics.get('fractal_dimension_std', 0):.4f}",
                    f"{sim.metrics.get('prefactor', 0):.4f}",
                    f"{sim.metrics.get('radius_of_gyration', 0):.4f}",
                    f"{sim.metrics.get('porosity', 0):.4f}",
                    f"{sim.metrics.get('coordination', {}).get('mean', 0):.4f}",
                    f"{sim.metrics.get('coordination', {}).get('std', 0):.4f}",
                    f"{sim.metrics.get('anisotropy', 0):.4f}",
                    f"{sim.metrics.get('asphericity', 0):.6f}",
                    f"{sim.metrics.get('acylindricity', 0):.6f}",
                    sim.execution_time_ms or 0,
                ]
                writer.writerow(row)

        output.seek(0)
        response = HttpResponse(output.read(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{study.id}_results.csv"'
        return response
