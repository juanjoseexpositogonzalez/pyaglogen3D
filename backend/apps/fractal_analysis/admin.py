"""Fractal Analysis admin."""

from django.contrib import admin

from .models import (
    ComparisonSet,
    FraktalAnalysis,
    FraktalBatch,
    FraktalBatchImage,
    ImageAnalysis,
)


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
        (None, {"fields": ["id", "project", "source_type", "status"]}),
        (
            "Image Source",
            {
                "fields": [
                    "original_filename",
                    "original_content_type",
                    "simulation",
                    "projection_params",
                ],
            },
        ),
        (
            "Model Parameters",
            {
                "fields": [
                    "model",
                    "npix",
                    "dpo",
                    "delta",
                    "correction_3d",
                    "pixel_min",
                    "pixel_max",
                    "npo_limit",
                    "escala",
                    "m_exponent",
                ],
            },
        ),
        (
            "Results",
            {
                "fields": [
                    "results",
                    "execution_time_ms",
                    "engine_version",
                    "error_message",
                ],
            },
        ),
        (
            "Timestamps",
            {
                "fields": ["created_at", "started_at", "completed_at"],
            },
        ),
    ]


@admin.register(FraktalBatch)
class FraktalBatchAdmin(admin.ModelAdmin):
    """Admin for FraktalBatch model."""

    list_display = [
        "id",
        "project",
        "algorithm",
        "calibration_source",
        "n_images",
        "n_successful",
        "dpo_used",
        "created_at",
    ]
    list_filter = ["algorithm", "calibration_source"]
    search_fields = ["id", "project__name", "original_zip_filename"]
    readonly_fields = [
        "id",
        "created_at",
        "mean_df",
        "std_df",
        "median_df",
        "min_df",
        "max_df",
    ]


@admin.register(FraktalBatchImage)
class FraktalBatchImageAdmin(admin.ModelAdmin):
    """Admin for FraktalBatchImage model."""

    list_display = [
        "batch",
        "index",
        "filename",
        "fractal_dimension",
        "dpo_used",
        "error",
    ]
    list_filter = ["batch__algorithm"]
    search_fields = ["filename", "batch__project__name"]
    readonly_fields = ["image_png"]


@admin.register(ComparisonSet)
class ComparisonSetAdmin(admin.ModelAdmin):
    """Admin for ComparisonSet model."""

    list_display = ["name", "project", "created_at"]
    search_fields = ["name", "project__name"]
    filter_horizontal = ["simulations", "analyses", "fraktal_analyses"]
