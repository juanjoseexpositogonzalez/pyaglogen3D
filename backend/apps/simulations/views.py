"""Simulation views."""
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
            "azimuth": 45.0,      // degrees (default: 0)
            "elevation": 30.0,   // degrees (default: 0)
            "format": "png"      // "png" or "svg" (default: "png")
        }
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse parameters
        azimuth = float(request.data.get("azimuth", 0.0))
        elevation = float(request.data.get("elevation", 0.0))
        img_format = request.data.get("format", "png").lower()

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
            "azimuth_start": 0,     // degrees (default: 0)
            "azimuth_end": 150,     // degrees (default: 150)
            "azimuth_step": 30,     // degrees (default: 30)
            "elevation_start": 0,   // degrees (default: 0)
            "elevation_end": 150,   // degrees (default: 150)
            "elevation_step": 30,   // degrees (default: 30)
            "format": "png"         // "png" or "svg" (default: "png")
        }
        """
        simulation = self.get_object()

        if simulation.geometry is None:
            return Response(
                {"error": "Geometry not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Parse parameters
        az_start = float(request.data.get("azimuth_start", 0.0))
        az_end = float(request.data.get("azimuth_end", 150.0))
        az_step = float(request.data.get("azimuth_step", 30.0))
        el_start = float(request.data.get("elevation_start", 0.0))
        el_end = float(request.data.get("elevation_end", 150.0))
        el_step = float(request.data.get("elevation_step", 30.0))
        img_format = request.data.get("format", "png").lower()

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

    @action(detail=True, methods=["get"])
    def results(self, request: Request, pk=None, **kwargs) -> Response:
        """Get aggregated results table for study."""
        study = self.get_object()
        simulations = study.simulations.filter(status="completed")

        results = []
        for sim in simulations:
            if sim.metrics:
                results.append({
                    "parameters": sim.parameters,
                    "fractal_dimension": sim.metrics.get("fractal_dimension"),
                    "prefactor": sim.metrics.get("prefactor"),
                    "radius_of_gyration": sim.metrics.get("radius_of_gyration"),
                    "simulation_id": str(sim.id),
                })

        return Response({
            "study_id": str(study.id),
            "name": study.name,
            "status": study.status,
            "results": results,
        })
