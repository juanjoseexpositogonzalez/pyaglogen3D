"""Base provider abstract class."""
from abc import ABC, abstractmethod
from typing import Any

from .models import AIResponse


class BaseProvider(ABC):
    """Abstract base class for AI providers."""

    def __init__(self, api_key: str, model_name: str, **kwargs: Any) -> None:
        """Initialize provider with API key and model.

        Args:
            api_key: The API key for the provider.
            model_name: The model name to use.
            **kwargs: Additional provider-specific configuration.
        """
        self.api_key = api_key
        self.model_name = model_name
        self.config = kwargs

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the provider name (e.g., 'anthropic', 'openai')."""
        ...

    @abstractmethod
    def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        system_prompt: str | None = None,
    ) -> AIResponse:
        """Complete a conversation without tools.

        Args:
            messages: List of message dicts with 'role' and 'content'.
            max_tokens: Maximum tokens to generate.
            temperature: Sampling temperature.
            system_prompt: Optional system prompt.

        Returns:
            AIResponse with the completion.
        """
        ...

    @abstractmethod
    def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        system_prompt: str | None = None,
    ) -> AIResponse:
        """Complete a conversation with tool definitions.

        Args:
            messages: List of message dicts with 'role' and 'content'.
            tools: List of tool definitions in provider-specific format.
            max_tokens: Maximum tokens to generate.
            temperature: Sampling temperature.
            system_prompt: Optional system prompt.

        Returns:
            AIResponse with completion and/or tool calls.
        """
        ...

    def get_model_info(self) -> dict[str, Any]:
        """Return information about the current model.

        Returns:
            Dict with model information.
        """
        return {
            "provider": self.provider_name,
            "model": self.model_name,
        }
