"""Fractal Analysis admin."""
from django.contrib import admin

from .models import ComparisonSet, ImageAnalysis


@admin.register(ImageAnalysis)
class ImageAnalysisAdmin(admin.ModelAdmin):
    """Admin for ImageAnalysis model."""

    list_display = ["id", "project", "method", "status", "created_at"]
    list_filter = ["method", "status"]
    search_fields = ["id", "project__name", "original_filename"]
    readonly_fields = [
        "id",
        "results",
        "execution_time_ms",
        "engine_version",
        "created_at",
        "started_at",
        "completed_at",
    ]


@admin.register(ComparisonSet)
class ComparisonSetAdmin(admin.ModelAdmin):
    """Admin for ComparisonSet model."""

    list_display = ["name", "project", "created_at"]
    search_fields = ["name", "project__name"]
    filter_horizontal = ["simulations", "analyses"]
