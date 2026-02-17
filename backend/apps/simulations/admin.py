"""Simulation admin."""
from django.contrib import admin

from .models import ParametricStudy, Simulation


@admin.register(Simulation)
class SimulationAdmin(admin.ModelAdmin):
    """Admin for Simulation model."""

    list_display = ["id", "project", "algorithm", "status", "created_at"]
    list_filter = ["algorithm", "status"]
    search_fields = ["id", "project__name"]
    readonly_fields = [
        "id",
        "metrics",
        "execution_time_ms",
        "engine_version",
        "created_at",
        "started_at",
        "completed_at",
    ]


@admin.register(ParametricStudy)
class ParametricStudyAdmin(admin.ModelAdmin):
    """Admin for ParametricStudy model."""

    list_display = ["name", "project", "base_algorithm", "status", "created_at"]
    list_filter = ["base_algorithm", "status"]
    search_fields = ["name", "project__name"]
