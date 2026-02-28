"""RAG app configuration."""

from django.apps import AppConfig


class RagConfig(AppConfig):
    """RAG application configuration."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.rag"
    verbose_name = "RAG Knowledge Base"
