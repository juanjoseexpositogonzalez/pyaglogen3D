"""Simulation views."""
import io
import logging

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
