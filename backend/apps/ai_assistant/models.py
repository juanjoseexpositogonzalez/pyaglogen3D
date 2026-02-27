"""AI Assistant models."""
import uuid
from django.conf import settings
from django.db import models


class AIProviderConfig(models.Model):
    """User's AI provider configuration.

    Stores encrypted API keys and provider preferences for each user.
    """

    class Provider(models.TextChoices):
        """Supported AI providers."""

        ANTHROPIC = "anthropic", "Anthropic (Claude)"
        OPENAI = "openai", "OpenAI (GPT)"
        GROQ = "groq", "Groq"
        XAI = "xai", "xAI (Grok)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_provider_configs",
    )
    provider = models.CharField(
        max_length=20,
        choices=Provider.choices,
        default=Provider.ANTHROPIC,
    )
    api_key_encrypted = models.TextField(
        help_text="Fernet-encrypted API key",
    )
    model_name = models.CharField(
        max_length=100,
        default="claude-sonnet-4-20250514",
        help_text="Model name to use (e.g., claude-sonnet-4-20250514, gpt-4o)",
    )
    is_default = models.BooleanField(
        default=False,
        help_text="Use this provider by default",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Whether this configuration is active",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["user", "provider"]
        ordering = ["-is_default", "-created_at"]
        verbose_name = "AI Provider Config"
        verbose_name_plural = "AI Provider Configs"

    def __str__(self) -> str:
        return f"{self.user.username} - {self.get_provider_display()}"

    def save(self, *args, **kwargs) -> None:
        """Ensure only one default provider per user."""
        if self.is_default:
            # Set all other configs for this user to non-default
            AIProviderConfig.objects.filter(
                user=self.user,
                is_default=True,
            ).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)
