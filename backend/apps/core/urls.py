"""Core URL configuration."""

from django.urls import include, path

from .views import health_check

urlpatterns = [
    path("health/", health_check, name="health-check"),
    path("projects/", include("apps.projects.urls")),
    path("", include("apps.simulations.urls")),
    path("", include("apps.fractal_analysis.urls")),
    path("ai/", include("apps.ai_assistant.urls")),
]
