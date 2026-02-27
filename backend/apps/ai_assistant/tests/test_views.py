"""Tests for AI Assistant views."""
import pytest
from unittest.mock import MagicMock, patch
from django.urls import reverse
from rest_framework import status

from apps.ai_assistant.models import AIProviderConfig
from apps.ai_assistant.services.encryption import APIKeyEncryption
from apps.ai_assistant.services.providers import AIResponse, StopReason


@pytest.fixture
def encryption_key():
    """Generate a test encryption key."""
    return APIKeyEncryption.generate_key()


@pytest.mark.django_db
class TestAIProviderConfigViewSet:
    """Tests for AIProviderConfigViewSet."""

    def test_list_providers_empty(self, authenticated_client):
        """Test listing providers when none exist."""
        response = authenticated_client.get("/api/v1/ai/providers/")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["results"] == []

    def test_list_providers_returns_only_user_configs(
        self, authenticated_client, user, staff_user, encryption_key, settings
    ):
        """Test that users only see their own configs."""
        settings.AI_ENCRYPTION_KEY = encryption_key
        encryption = APIKeyEncryption(key=encryption_key)

        # Create config for user
        AIProviderConfig.objects.create(
            user=user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("user-key"),
            model_name="claude-sonnet-4-20250514",
        )

        # Create config for staff user
        AIProviderConfig.objects.create(
            user=staff_user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("staff-key"),
            model_name="claude-sonnet-4-20250514",
        )

        response = authenticated_client.get("/api/v1/ai/providers/")
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1

    def test_create_provider_config(self, authenticated_client, encryption_key, settings):
        """Test creating a provider config."""
        settings.AI_ENCRYPTION_KEY = encryption_key

        response = authenticated_client.post(
            "/api/v1/ai/providers/",
            {
                "provider": "anthropic",
                "api_key": "sk-ant-test-key",
                "model_name": "claude-sonnet-4-20250514",
                "is_default": True,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["provider"] == "anthropic"
        assert response.data["is_default"] is True
        assert "api_key" not in response.data  # API key should not be returned

    def test_create_provider_config_encrypts_key(
        self, authenticated_client, user, encryption_key, settings
    ):
        """Test that API key is encrypted when stored."""
        settings.AI_ENCRYPTION_KEY = encryption_key

        response = authenticated_client.post(
            "/api/v1/ai/providers/",
            {
                "provider": "openai",
                "api_key": "sk-openai-test-key",
                "model_name": "gpt-4o",
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED

        # Verify encrypted storage
        config = AIProviderConfig.objects.get(user=user, provider="openai")
        assert config.api_key_encrypted != "sk-openai-test-key"

        # Verify decryption works
        encryption = APIKeyEncryption(key=encryption_key)
        decrypted = encryption.decrypt(config.api_key_encrypted)
        assert decrypted == "sk-openai-test-key"

    def test_unauthenticated_access_denied(self, api_client):
        """Test that unauthenticated users cannot access providers."""
        response = api_client.get("/api/v1/ai/providers/")
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestTestConnectionAction:
    """Tests for the test_connection action."""

    def test_test_connection_success(
        self, authenticated_client, user, encryption_key, settings
    ):
        """Test successful connection test."""
        settings.AI_ENCRYPTION_KEY = encryption_key
        encryption = APIKeyEncryption(key=encryption_key)

        config = AIProviderConfig.objects.create(
            user=user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("test-key"),
            model_name="claude-sonnet-4-20250514",
        )

        with patch(
            "apps.ai_assistant.views.ProviderFactory.create_from_config"
        ) as mock_factory:
            mock_provider = MagicMock()
            mock_provider.complete.return_value = AIResponse(
                content="connected",
                stop_reason=StopReason.END_TURN,
            )
            mock_factory.return_value = mock_provider

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_200_OK
            assert response.data["success"] is True
            assert "Connected to" in response.data["message"]

    def test_test_connection_error_response(
        self, authenticated_client, user, encryption_key, settings
    ):
        """Test connection test with error response."""
        settings.AI_ENCRYPTION_KEY = encryption_key
        encryption = APIKeyEncryption(key=encryption_key)

        config = AIProviderConfig.objects.create(
            user=user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("test-key"),
            model_name="claude-sonnet-4-20250514",
        )

        with patch(
            "apps.ai_assistant.views.ProviderFactory.create_from_config"
        ) as mock_factory:
            mock_provider = MagicMock()
            mock_provider.complete.return_value = AIResponse(
                content="API Error",
                stop_reason=StopReason.ERROR,
            )
            mock_factory.return_value = mock_provider

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert response.data["success"] is False

    def test_test_connection_authentication_error(
        self, authenticated_client, user, encryption_key, settings
    ):
        """Test connection test with authentication error."""
        import anthropic

        settings.AI_ENCRYPTION_KEY = encryption_key
        encryption = APIKeyEncryption(key=encryption_key)

        config = AIProviderConfig.objects.create(
            user=user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("invalid-key"),
            model_name="claude-sonnet-4-20250514",
        )

        with patch(
            "apps.ai_assistant.views.ProviderFactory.create_from_config"
        ) as mock_factory:
            mock_factory.side_effect = anthropic.AuthenticationError(
                message="Invalid API key",
                response=MagicMock(status_code=401),
                body=None,
            )

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert "Invalid API key" in response.data["message"]

    def test_test_connection_rate_limit_error(
        self, authenticated_client, user, encryption_key, settings
    ):
        """Test connection test with rate limit error."""
        import anthropic

        settings.AI_ENCRYPTION_KEY = encryption_key
        encryption = APIKeyEncryption(key=encryption_key)

        config = AIProviderConfig.objects.create(
            user=user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("test-key"),
            model_name="claude-sonnet-4-20250514",
        )

        with patch(
            "apps.ai_assistant.views.ProviderFactory.create_from_config"
        ) as mock_factory:
            mock_factory.side_effect = anthropic.RateLimitError(
                message="Rate limit exceeded",
                response=MagicMock(status_code=429),
                body=None,
            )

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
class TestSetDefaultAction:
    """Tests for the set_default action."""

    def test_set_default_success(
        self, authenticated_client, user, encryption_key, settings
    ):
        """Test setting a provider as default."""
        settings.AI_ENCRYPTION_KEY = encryption_key
        encryption = APIKeyEncryption(key=encryption_key)

        # Create two configs
        config1 = AIProviderConfig.objects.create(
            user=user,
            provider="anthropic",
            api_key_encrypted=encryption.encrypt("key1"),
            model_name="claude-sonnet-4-20250514",
            is_default=True,
        )
        config2 = AIProviderConfig.objects.create(
            user=user,
            provider="openai",
            api_key_encrypted=encryption.encrypt("key2"),
            model_name="gpt-4o",
            is_default=False,
        )

        # Set config2 as default
        response = authenticated_client.post(
            f"/api/v1/ai/providers/{config2.id}/set_default/"
        )

        assert response.status_code == status.HTTP_200_OK

        # Verify config2 is now default and config1 is not
        config1.refresh_from_db()
        config2.refresh_from_db()

        assert config2.is_default is True
        assert config1.is_default is False


@pytest.mark.django_db
class TestSanitizeErrorMessage:
    """Tests for error message sanitization."""

    def test_sanitize_removes_api_keys(self, authenticated_client, user, encryption_key, settings):
        """Test that API keys are removed from error messages."""
        from apps.ai_assistant.views import AIProviderConfigViewSet

        viewset = AIProviderConfigViewSet()

        # Test with various API key patterns
        test_cases = [
            ("Error with sk-ant-api03-xyz123", "Error with [REDACTED]"),
            ("key-123abc failed", "[REDACTED] failed"),
            ("api-key-test error", "[REDACTED] error"),
        ]

        for input_msg, expected_pattern in test_cases:
            result = viewset._sanitize_error_message(input_msg)
            assert "sk-" not in result
            assert "key-" not in result.replace("[REDACTED]", "")

    def test_sanitize_truncates_long_messages(self, authenticated_client):
        """Test that long messages are truncated."""
        from apps.ai_assistant.views import AIProviderConfigViewSet

        viewset = AIProviderConfigViewSet()
        long_message = "A" * 500
        result = viewset._sanitize_error_message(long_message)

        assert len(result) <= 203  # 200 + "..."
        assert result.endswith("...")

    def test_sanitize_handles_none(self, authenticated_client):
        """Test that None messages return default error."""
        from apps.ai_assistant.views import AIProviderConfigViewSet

        viewset = AIProviderConfigViewSet()
        result = viewset._sanitize_error_message(None)

        assert result == "An error occurred."
