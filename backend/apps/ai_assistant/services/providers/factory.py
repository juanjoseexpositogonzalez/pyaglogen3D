"""Provider factory for creating AI provider instances."""
from typing import TYPE_CHECKING, Any

from .base import BaseProvider
from .anthropic_provider import AnthropicProvider
from .openai_provider import OpenAIProvider
from .groq_provider import GroqProvider
from .xai_provider import XAIProvider

if TYPE_CHECKING:
    from apps.ai_assistant.models import AIProviderConfig


class ProviderFactory:
    """Factory for creating AI provider instances."""

    PROVIDERS: dict[str, type[BaseProvider]] = {
        "anthropic": AnthropicProvider,
        "openai": OpenAIProvider,
        "groq": GroqProvider,
        "xai": XAIProvider,
    }

    @classmethod
    def create_provider(
        cls,
        provider_name: str,
        api_key: str,
        model_name: str,
        **kwargs: Any,
    ) -> BaseProvider:
        """Create a provider instance.

        Args:
            provider_name: Name of the provider ('anthropic', 'openai', etc.).
            api_key: The decrypted API key.
            model_name: The model name to use.
            **kwargs: Additional provider-specific configuration.

        Returns:
            A configured provider instance.

        Raises:
            ValueError: If provider_name is not supported.
        """
        provider_class = cls.PROVIDERS.get(provider_name)
        if not provider_class:
            supported = ", ".join(cls.PROVIDERS.keys())
            raise ValueError(
                f"Unknown provider: {provider_name}. Supported: {supported}"
            )

        return provider_class(api_key=api_key, model_name=model_name, **kwargs)

    @classmethod
    def create_from_config(
        cls,
        config: "AIProviderConfig",
        decrypted_api_key: str,
    ) -> BaseProvider:
        """Create a provider from a config model.

        Args:
            config: The AIProviderConfig instance.
            decrypted_api_key: The decrypted API key.

        Returns:
            A configured provider instance.
        """
        return cls.create_provider(
            provider_name=config.provider,
            api_key=decrypted_api_key,
            model_name=config.model_name,
        )

    @classmethod
    def get_supported_providers(cls) -> list[str]:
        """Get list of supported provider names."""
        return list(cls.PROVIDERS.keys())
