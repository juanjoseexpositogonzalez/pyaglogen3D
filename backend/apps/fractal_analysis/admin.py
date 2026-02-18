"""Fractal Analysis admin."""
from django.contrib import admin

from .models import ComparisonSet, FraktalAnalysis, ImageAnalysis


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


@admin.register(FraktalAnalysis)
class FraktalAnalysisAdmin(admin.ModelAdmin):
    """Admin for FraktalAnalysis model."""

    list_display = ["id", "project", "model", "source_type", "status", "created_at"]
    list_filter = ["model", "source_type", "status"]
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
    fieldsets = [
        (None, {
            "fields": ["id", "project", "source_type", "status"]
        }),
        ("Image Source", {
            "fields": ["original_filename", "original_content_type", "simulation", "projection_params"],
        }),
        ("Model Parameters", {
            "fields": ["model", "npix", "dpo", "delta", "correction_3d", "pixel_min", "pixel_max", "npo_limit", "escala", "m_exponent"],
        }),
        ("Results", {
            "fields": ["results", "execution_time_ms", "engine_version", "error_message"],
        }),
        ("Timestamps", {
            "fields": ["created_at", "started_at", "completed_at"],
        }),
    ]


@admin.register(ComparisonSet)
class ComparisonSetAdmin(admin.ModelAdmin):
    """Admin for ComparisonSet model."""

    list_display = ["name", "project", "created_at"]
    search_fields = ["name", "project__name"]
    filter_horizontal = ["simulations", "analyses", "fraktal_analyses"]
