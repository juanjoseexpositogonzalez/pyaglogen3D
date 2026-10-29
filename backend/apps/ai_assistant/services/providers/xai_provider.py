"""xAI (Grok) provider implementation (OpenAI-compatible)."""
from typing import Any

from .openai_provider import OpenAIProvider


class XAIProvider(OpenAIProvider):
    """Provider for xAI's Grok models.

    Uses OpenAI-compatible API with different base URL.
    """

    XAI_BASE_URL = "https://api.x.ai/v1"

    def __init__(self, api_key: str, model_name: str, **kwargs: Any) -> None:
        """Initialize xAI provider.

        Args:
            api_key: xAI API key.
            model_name: Model name (e.g., 'grok-beta').
            **kwargs: Additional configuration.
        """
        super().__init__(
            api_key=api_key,
            model_name=model_name,
            base_url=self.XAI_BASE_URL,
            **kwargs,
        )

    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "xai"
