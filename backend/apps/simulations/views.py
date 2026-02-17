"""Simulation views."""
import io

from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .models import ParametricStudy, Simulation
from .serializers import (
    ParametricStudySerializer,
    SimulationDetailSerializer,
    SimulationSerializer,
)
from .tasks import run_simulation_task


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
            run_simulation_task.delay(str(simulation.id))
        except Exception as e:
            if settings.DEBUG:
                # Run synchronously in development if Celery unavailable
                run_simulation_task(str(simulation.id))
            else:
                raise

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
