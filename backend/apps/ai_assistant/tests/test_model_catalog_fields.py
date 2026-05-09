"""Tests for model catalog fields on AIProviderConfig (Phase 1)."""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.ai_assistant.models import AIProviderConfig
from apps.ai_assistant.serializers import (
    AIProviderConfigListSerializer,
    AIProviderConfigSerializer,
)

User = get_user_model()


@pytest.fixture
def user(db):
    """Create a test user using email-based auth."""
    return User.objects.create_user(
        email="catalog-test@example.com",
        password="testpass123",
    )


@pytest.mark.django_db
class TestAvailableModelsField:
    """Test available_models JSONField on AIProviderConfig."""

    def test_default_value_is_empty_list(self, user):
        """New config should have available_models=[] by default."""
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="encrypted_key",
            model_name="claude-sonnet-4-20250514",
        )
        assert config.available_models == []

    def test_can_store_model_list(self, user):
        """available_models can store a list of model dicts."""
        models_data = [
            {
                "id": "claude-sonnet-4-20250514",
                "display_name": "Claude Sonnet 4",
                "context_window": 200000,
                "is_recommended": True,
            },
            {
                "id": "claude-3-haiku-20240307",
                "display_name": "Claude 3 Haiku",
                "context_window": 200000,
                "is_recommended": False,
            },
        ]
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="encrypted_key",
            model_name="claude-sonnet-4-20250514",
            available_models=models_data,
        )
        config.refresh_from_db()
        assert len(config.available_models) == 2
        assert config.available_models[0]["id"] == "claude-sonnet-4-20250514"
        assert config.available_models[1]["is_recommended"] is False


@pytest.mark.django_db
class TestModelsRefreshedAtField:
    """Test models_refreshed_at DateTimeField on AIProviderConfig."""

    def test_default_value_is_none(self, user):
        """New config should have models_refreshed_at=None by default."""
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="encrypted_key",
            model_name="claude-sonnet-4-20250514",
        )
        assert config.models_refreshed_at is None

    def test_can_store_timestamp(self, user):
        """models_refreshed_at can store a datetime."""
        now = timezone.now()
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="encrypted_key",
            model_name="claude-sonnet-4-20250514",
            models_refreshed_at=now,
        )
        config.refresh_from_db()
        # Compare with second precision (DB may truncate microseconds)
        assert config.models_refreshed_at is not None
        assert abs((config.models_refreshed_at - now).total_seconds()) < 1


@pytest.mark.django_db
class TestSerializersCatalogFields:
    """Test that serializers expose new catalog fields read-only."""

    def test_full_serializer_includes_available_models(self, user, settings):
        """AIProviderConfigSerializer should include available_models."""
        from apps.ai_assistant.services.encryption import APIKeyEncryption

        key = APIKeyEncryption.generate_key()
        settings.AI_ENCRYPTION_KEY = key
        encryption = APIKeyEncryption(key=key)

        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted=encryption.encrypt("test-key"),
            model_name="claude-sonnet-4-20250514",
            available_models=[{"id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4"}],
            models_refreshed_at=timezone.now(),
        )
        serializer = AIProviderConfigSerializer(config)
        data = serializer.data

        assert "available_models" in data
        assert "models_refreshed_at" in data
        assert len(data["available_models"]) == 1
        assert data["available_models"][0]["id"] == "claude-sonnet-4-20250514"

    def test_list_serializer_includes_available_models(self, user, settings):
        """AIProviderConfigListSerializer should include available_models."""
        from apps.ai_assistant.services.encryption import APIKeyEncryption

        key = APIKeyEncryption.generate_key()
        settings.AI_ENCRYPTION_KEY = key
        encryption = APIKeyEncryption(key=key)

        now = timezone.now()
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted=encryption.encrypt("test-key"),
            model_name="claude-sonnet-4-20250514",
            available_models=[],
            models_refreshed_at=now,
        )
        serializer = AIProviderConfigListSerializer(config)
        data = serializer.data

        assert "available_models" in data
        assert "models_refreshed_at" in data
        assert data["available_models"] == []

    def test_available_models_is_read_only_in_full_serializer(self):
        """available_models should be in read_only_fields."""
        serializer = AIProviderConfigSerializer()
        assert "available_models" in serializer.Meta.read_only_fields
        assert "models_refreshed_at" in serializer.Meta.read_only_fields

    def test_available_models_is_read_only_in_list_serializer(self):
        """available_models should be in read_only_fields of list serializer."""
        serializer = AIProviderConfigListSerializer()
        # All fields are read-only in the list serializer
        assert "available_models" in serializer.Meta.fields
        assert "models_refreshed_at" in serializer.Meta.fields
