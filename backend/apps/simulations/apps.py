"""Simulations app configuration."""
from django.apps import AppConfig


class SimulationsConfig(AppConfig):
    """Simulations application config."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.simulations"

    def ready(self) -> None:
        # Registered here so the hook exists for every process that touches the
        # models - worker, API and shell - and cannot be forgotten by a caller.
        from . import signals  # noqa: F401
