"""AI Assistant serializers."""
from rest_framework import serializers

from .models import AIProviderConfig, Conversation, ChatMessage, Notification
from .services.encryption import get_encryption_service


class AIProviderConfigSerializer(serializers.ModelSerializer):
    """Serializer for AIProviderConfig model."""

    api_key = serializers.CharField(
        write_only=True,
        required=True,
        help_text="API key for the provider (will be encrypted)",
    )
    provider_display = serializers.CharField(
        source="get_provider_display",
        read_only=True,
    )

    class Meta:
        model = AIProviderConfig
        fields = [
            "id",
            "provider",
            "provider_display",
            "api_key",
            "model_name",
            "is_default",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data: dict) -> AIProviderConfig:
        """Create a new provider config with encrypted API key."""
        api_key = validated_data.pop("api_key")
        encryption = get_encryption_service()
        validated_data["api_key_encrypted"] = encryption.encrypt(api_key)
        validated_data["user"] = self.context["request"].user
        return super().create(validated_data)

    def update(self, instance: AIProviderConfig, validated_data: dict) -> AIProviderConfig:
        """Update provider config, re-encrypting API key if changed."""
        api_key = validated_data.pop("api_key", None)
        if api_key:
            encryption = get_encryption_service()
            validated_data["api_key_encrypted"] = encryption.encrypt(api_key)
        return super().update(instance, validated_data)


class AIProviderConfigListSerializer(serializers.ModelSerializer):
    """Read-only serializer for listing provider configs (no API key)."""

    provider_display = serializers.CharField(
        source="get_provider_display",
        read_only=True,
    )

    class Meta:
        model = AIProviderConfig
        fields = [
            "id",
            "provider",
            "provider_display",
            "model_name",
            "is_default",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ChatMessageSerializer(serializers.ModelSerializer):
    """Serializer for chat messages."""

    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "role",
            "content",
            "tool_call_id",
            "tool_calls",
            "token_usage",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ConversationListSerializer(serializers.ModelSerializer):
    """Serializer for listing conversations (minimal data)."""

    message_count = serializers.SerializerMethodField()
    last_message_preview = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id",
            "title",
            "project",
            "is_active",
            "message_count",
            "last_message_preview",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_message_count(self, obj) -> int:
        return obj.messages.count()

    def get_last_message_preview(self, obj) -> str | None:
        last_msg = obj.messages.filter(role="user").last()
        if last_msg and isinstance(last_msg.content, str):
            return last_msg.content[:100]
        return None


class ConversationDetailSerializer(serializers.ModelSerializer):
    """Serializer for conversation with all messages."""

    messages = ChatMessageSerializer(many=True, read_only=True)

    class Meta:
        model = Conversation
        fields = [
            "id",
            "title",
            "project",
            "is_active",
            "messages",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ConversationCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a conversation."""

    class Meta:
        model = Conversation
        fields = ["id", "title", "project", "is_active"]
        read_only_fields = ["id"]


class NotificationSerializer(serializers.ModelSerializer):
    """Serializer for notifications."""

    notification_type_display = serializers.CharField(
        source="get_notification_type_display",
        read_only=True,
    )

    class Meta:
        model = Notification
        fields = [
            "id",
            "notification_type",
            "notification_type_display",
            "title",
            "message",
            "data",
            "is_read",
            "created_at",
        ]
        read_only_fields = ["id", "notification_type", "title", "message", "data", "created_at"]
