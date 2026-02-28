"""AI Assistant models."""
import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


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


class Conversation(models.Model):
    """A conversation session with the AI assistant.

    Stores the full conversation history so the AI can maintain context
    across multiple interactions.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_conversations",
    )
    title = models.CharField(
        max_length=200,
        blank=True,
        help_text="Auto-generated title based on first message",
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_conversations",
        help_text="Project context for this conversation",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Whether this is the active conversation",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Conversation"
        verbose_name_plural = "Conversations"

    def __str__(self) -> str:
        return f"{self.user.username}: {self.title or 'Untitled'}"

    def save(self, *args, **kwargs) -> None:
        """Ensure only one active conversation per user."""
        if self.is_active:
            Conversation.objects.filter(
                user=self.user,
                is_active=True,
            ).exclude(pk=self.pk).update(is_active=False)
        super().save(*args, **kwargs)


class ChatMessage(models.Model):
    """A single message in a conversation."""

    class Role(models.TextChoices):
        """Message roles."""

        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"
        TOOL = "tool", "Tool"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
    )
    content = models.TextField(
        help_text="Message content (text or JSON for tool calls)",
    )
    tool_call_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Tool call ID for tool messages",
    )
    tool_calls = models.JSONField(
        default=list,
        blank=True,
        help_text="Tool calls made in this message (for assistant messages)",
    )
    token_usage = models.JSONField(
        default=dict,
        blank=True,
        help_text="Token usage for this message",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Chat Message"
        verbose_name_plural = "Chat Messages"

    def __str__(self) -> str:
        preview = self.content[:50] if isinstance(self.content, str) else str(self.content)[:50]
        return f"[{self.role}] {preview}..."


class Notification(models.Model):
    """User notifications for async events like simulation completion."""

    class NotificationType(models.TextChoices):
        """Types of notifications."""

        SIMULATION_COMPLETE = "simulation_complete", "Simulation Complete"
        SIMULATION_FAILED = "simulation_failed", "Simulation Failed"
        STUDY_COMPLETE = "study_complete", "Study Complete"
        STUDY_FAILED = "study_failed", "Study Failed"
        ANALYSIS_COMPLETE = "analysis_complete", "Analysis Complete"
        INFO = "info", "Information"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(
        max_length=30,
        choices=NotificationType.choices,
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    data = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional data (e.g., simulation_id, results)",
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Notification"
        verbose_name_plural = "Notifications"

    def __str__(self) -> str:
        status = "read" if self.is_read else "unread"
        return f"{self.user.username}: {self.title} ({status})"

    @classmethod
    def create_simulation_notification(
        cls,
        user,
        simulation,
        success: bool = True,
    ) -> "Notification":
        """Create a notification for simulation completion."""
        if success:
            return cls.objects.create(
                user=user,
                notification_type=cls.NotificationType.SIMULATION_COMPLETE,
                title="Simulation Complete",
                message=f"Simulation '{simulation.name}' has completed successfully.",
                data={
                    "simulation_id": str(simulation.id),
                    "simulation_name": simulation.name,
                    "algorithm": simulation.algorithm,
                    "n_particles": simulation.n_particles,
                },
            )
        else:
            return cls.objects.create(
                user=user,
                notification_type=cls.NotificationType.SIMULATION_FAILED,
                title="Simulation Failed",
                message=f"Simulation '{simulation.name}' has failed.",
                data={
                    "simulation_id": str(simulation.id),
                    "simulation_name": simulation.name,
                    "error": simulation.error_message or "Unknown error",
                },
            )
