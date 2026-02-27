"""AI Service - main interface for AI operations."""
import logging
from typing import TYPE_CHECKING, Any

from django.contrib.auth import get_user_model

from .encryption import get_encryption_service
from .providers import AIResponse, BaseProvider, ProviderFactory, StopReason

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractUser

User = get_user_model()
logger = logging.getLogger(__name__)


class AIService:
    """Main service for interacting with AI providers.

    Handles provider selection, API key decryption, and message completion.
    """

    def __init__(self, user: "AbstractUser") -> None:
        """Initialize AI service for a user.

        Args:
            user: The user making the AI request.
        """
        self.user = user
        self._provider: BaseProvider | None = None
        self._encryption = get_encryption_service()

    def get_provider(self) -> BaseProvider:
        """Get the configured provider for the user.

        Returns:
            The configured provider instance.

        Raises:
            ValueError: If no provider is configured for the user.
        """
        if self._provider:
            return self._provider

        # Import here to avoid circular imports
        from apps.ai_assistant.models import AIProviderConfig

        # Get user's default provider config
        config = AIProviderConfig.objects.filter(
            user=self.user,
            is_active=True,
        ).order_by("-is_default", "-created_at").first()

        if not config:
            raise ValueError(
                "No AI provider configured. Please add a provider configuration "
                "in your settings."
            )

        # Decrypt API key and create provider
        api_key = self._encryption.decrypt(config.api_key_encrypted)
        self._provider = ProviderFactory.create_from_config(config, api_key)

        return self._provider

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
        try:
            provider = self.get_provider()
            return provider.complete(
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                system_prompt=system_prompt,
            )
        except Exception as e:
            logger.error(f"AI completion error: {e}")
            return AIResponse(
                content=f"Error: {str(e)}",
                stop_reason=StopReason.ERROR,
            )

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
            tools: List of tool definitions.
            max_tokens: Maximum tokens to generate.
            temperature: Sampling temperature.
            system_prompt: Optional system prompt.

        Returns:
            AIResponse with completion and/or tool calls.
        """
        try:
            provider = self.get_provider()
            return provider.complete_with_tools(
                messages=messages,
                tools=tools,
                max_tokens=max_tokens,
                temperature=temperature,
                system_prompt=system_prompt,
            )
        except Exception as e:
            logger.error(f"AI completion with tools error: {e}")
            return AIResponse(
                content=f"Error: {str(e)}",
                stop_reason=StopReason.ERROR,
            )

    def test_connection(self) -> tuple[bool, str]:
        """Test the provider connection with a simple request.

        Returns:
            Tuple of (success, message).
        """
        try:
            provider = self.get_provider()
            response = provider.complete(
                messages=[{"role": "user", "content": "Say 'connected' in one word."}],
                max_tokens=10,
                temperature=0,
            )

            if response.stop_reason == StopReason.ERROR:
                return False, response.text

            return True, f"Connected to {provider.provider_name}/{provider.model_name}"

        except Exception as e:
            return False, str(e)
