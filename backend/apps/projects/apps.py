"""Projects app configuration."""
from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    """Projects application config."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.projects"
