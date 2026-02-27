"""AI Assistant app configuration."""
from django.apps import AppConfig


class AIAssistantConfig(AppConfig):
    """Configuration for the AI Assistant app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ai_assistant"
    verbose_name = "AI Assistant"
