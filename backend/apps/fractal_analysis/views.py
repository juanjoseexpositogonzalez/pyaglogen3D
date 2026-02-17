"""Fractal Analysis views."""
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .models import ComparisonSet, ImageAnalysis
from .serializers import (
    ComparisonSetCreateSerializer,
    ComparisonSetSerializer,
    ImageAnalysisCreateSerializer,
    ImageAnalysisSerializer,
)
from .tasks import run_fractal_analysis_task


class ImageAnalysisViewSet(viewsets.ModelViewSet):
    """ViewSet for ImageAnalysis CRUD operations."""

    queryset = ImageAnalysis.objects.all()

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
        # Enqueue Celery task
        run_fractal_analysis_task.delay(str(analysis.id))

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


class ComparisonSetViewSet(viewsets.ModelViewSet):
    """ViewSet for ComparisonSet CRUD operations."""

    queryset = ComparisonSet.objects.all()

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
