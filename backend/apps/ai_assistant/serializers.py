"""AI Assistant serializers."""
from rest_framework import serializers

from .models import AIProviderConfig
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
