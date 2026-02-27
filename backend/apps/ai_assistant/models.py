"""AI Assistant models."""
import uuid
from django.conf import settings
from django.db import models


class AIUserProfile(models.Model):
    """AI access profile for users.

    Controls which users can access the AI assistant features.
    Only users with has_ai_access=True (or staff) can use the AI tools.
    Admins manage this through Django admin.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_profile",
    )
    has_ai_access = models.BooleanField(
        default=False,
        help_text="Whether this user can access AI assistant features",
    )
    access_granted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When AI access was granted",
    )
    access_granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_access_granted_to",
        help_text="Admin who granted AI access",
    )
    notes = models.TextField(
        blank=True,
        help_text="Admin notes about this user's AI access",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "AI User Profile"
        verbose_name_plural = "AI User Profiles"

    def __str__(self) -> str:
        status = "✓" if self.has_ai_access else "✗"
        return f"{self.user.username} [{status}]"


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
