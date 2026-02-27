"""AI Assistant app configuration."""
from django.apps import AppConfig


class AIAssistantConfig(AppConfig):
    """Configuration for the AI Assistant app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ai_assistant"
    verbose_name = "AI Assistant"

    def ready(self) -> None:
        """Initialize the AI Assistant app.

        Registers all tools with the global registry at startup.
        """
        from .tools.registration import register_all_tools
        from .tools.registry import get_registry

        register_all_tools(get_registry())
