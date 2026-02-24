"""Fractal Analysis views."""
import logging

from django.conf import settings
from django.http import HttpResponse
from kombu.exceptions import OperationalError
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.permissions import IsProjectOwnerOrShared

from .models import ComparisonSet, FraktalAnalysis, ImageAnalysis

logger = logging.getLogger(__name__)
from .serializers import (
    ComparisonSetCreateSerializer,
    ComparisonSetSerializer,
    FraktalAnalysisCreateSerializer,
    FraktalAnalysisSerializer,
    ImageAnalysisCreateSerializer,
    ImageAnalysisSerializer,
)
from .tasks import run_fractal_analysis_task, run_fraktal_analysis_task, run_fraktal_auto_calibrate_task


class ImageAnalysisViewSet(viewsets.ModelViewSet):
    """ViewSet for ImageAnalysis CRUD operations."""

    queryset = ImageAnalysis.objects.select_related("project")
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == "create":
            return ImageAnalysisCreateSerializer
        return ImageAnalysisSerializer

    def get_queryset(self):
        """Filter analyses by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create analysis and enqueue task."""
        project_id = self.kwargs.get("project_pk")
        analysis = serializer.save(project_id=project_id)
        # Enqueue Celery task, fallback to sync execution if broker unavailable
        try:
            run_fractal_analysis_task.delay(str(analysis.id))
        except OperationalError:
            logger.warning("Celery broker unavailable, running fractal task synchronously")
            run_fractal_analysis_task(str(analysis.id))

    @action(detail=True, methods=["get"])
    def original_image(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download original image."""
        analysis = self.get_object()
        response = HttpResponse(
            analysis.original_image,
            content_type=analysis.original_content_type,
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{analysis.original_filename}"'
        )
        return response

    @action(detail=True, methods=["get"])
    def processed_image(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download processed/binarized image."""
        analysis = self.get_object()

        if analysis.processed_image is None:
            return Response(
                {"error": "Processed image not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        response = HttpResponse(
            analysis.processed_image,
            content_type="image/png",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{analysis.id}_processed.png"'
        )
        return response


class FraktalAnalysisViewSet(viewsets.ModelViewSet):
    """ViewSet for FraktalAnalysis CRUD operations."""

    queryset = FraktalAnalysis.objects.select_related("project", "simulation")
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action == "create":
            return FraktalAnalysisCreateSerializer
        return FraktalAnalysisSerializer

    def get_queryset(self):
        """Filter analyses by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def perform_create(self, serializer):
        """Create analysis and enqueue task."""
        project_id = self.kwargs.get("project_pk")
        analysis = serializer.save(project_id=project_id)

        # Choose task based on auto_calibrate flag
        if analysis.auto_calibrate:
            task = run_fraktal_auto_calibrate_task
            task_name = "FRAKTAL auto-calibrate"
        else:
            task = run_fraktal_analysis_task
            task_name = "FRAKTAL"

        # Enqueue Celery task, fallback to sync execution if broker unavailable
        try:
            task.delay(str(analysis.id))
        except OperationalError:
            logger.warning(f"Celery broker unavailable, running {task_name} task synchronously")
            task(str(analysis.id))

    @action(detail=True, methods=["get"])
    def original_image(self, request: Request, pk=None, **kwargs) -> HttpResponse:
        """Download original image (only for uploaded_image source)."""
        analysis = self.get_object()

        if analysis.original_image is None:
            return Response(
                {"error": "No original image available (source is simulation projection)"},
                status=status.HTTP_404_NOT_FOUND,
            )

        response = HttpResponse(
            analysis.original_image,
            content_type=analysis.original_content_type or "image/png",
        )
        filename = analysis.original_filename or f"{analysis.id}_original.png"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=["post"])
    def rerun(self, request: Request, pk=None, **kwargs) -> Response:
        """Re-run the FRAKTAL analysis."""
        from .models import AnalysisStatus

        analysis = self.get_object()

        # Only allow re-running completed or failed analyses
        if analysis.status not in [AnalysisStatus.COMPLETED, AnalysisStatus.FAILED]:
            return Response(
                {"error": f"Cannot re-run analysis in {analysis.status} status"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reset status and enqueue task
        analysis.status = AnalysisStatus.QUEUED
        analysis.results = None
        analysis.error_message = ""
        analysis.save(update_fields=["status", "results", "error_message"])

        try:
            run_fraktal_analysis_task.delay(str(analysis.id))
        except OperationalError:
            logger.warning("Celery broker unavailable, running FRAKTAL task synchronously")
            run_fraktal_analysis_task(str(analysis.id))

        return Response(
            {"message": "Analysis re-queued", "id": str(analysis.id)},
            status=status.HTTP_202_ACCEPTED,
        )


class ComparisonSetViewSet(viewsets.ModelViewSet):
    """ViewSet for ComparisonSet CRUD operations."""

    # Prefetch M2M relationships to avoid N+1 queries
    queryset = ComparisonSet.objects.select_related("project").prefetch_related(
        "simulations",
        "analyses",
        "fraktal_analyses",
    )
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        if self.action in ("create", "update", "partial_update"):
            return ComparisonSetCreateSerializer
        return ComparisonSetSerializer

    def get_queryset(self):
        """Filter comparison sets by project if project_id in URL."""
        queryset = super().get_queryset()
        project_id = self.kwargs.get("project_pk")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset
