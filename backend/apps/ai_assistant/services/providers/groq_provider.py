"""Groq provider implementation (OpenAI-compatible)."""
from typing import Any

from .openai_provider import OpenAIProvider


class GroqProvider(OpenAIProvider):
    """Provider for Groq's fast inference models.

    Uses OpenAI-compatible API with different base URL.
    """

    GROQ_BASE_URL = "https://api.groq.com/openai/v1"

    def __init__(self, api_key: str, model_name: str, **kwargs: Any) -> None:
        """Initialize Groq provider.

        Args:
            api_key: Groq API key.
            model_name: Model name (e.g., 'llama-3.3-70b-versatile').
            **kwargs: Additional configuration.
        """
        super().__init__(
            api_key=api_key,
            model_name=model_name,
            base_url=self.GROQ_BASE_URL,
            **kwargs,
        )

    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "groq"
