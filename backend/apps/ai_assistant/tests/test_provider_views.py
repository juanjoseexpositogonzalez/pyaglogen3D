"""Integration tests for provider views — Phase 3 (model catalog endpoints)."""
import pytest
from unittest.mock import MagicMock, patch
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.ai_assistant.models import AIProviderConfig
from apps.ai_assistant.services.encryption import APIKeyEncryption
from apps.ai_assistant.services.model_catalog import (
    ProviderAuthError,
    ProviderRateLimitError,
    ProviderUnavailableError,
)
from apps.ai_assistant.services.providers import AIResponse, StopReason

User = get_user_model()


@pytest.fixture
def encryption_key():
    return APIKeyEncryption.generate_key()


@pytest.fixture
def user(db):
    return User.objects.create_user(
        email="provider-view-test@example.com",
        password="testpass123",
    )


@pytest.fixture
def authenticated_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def provider_config(user, encryption_key, settings):
    settings.AI_ENCRYPTION_KEY = encryption_key
    settings.DEBUG = True
    encryption = APIKeyEncryption(key=encryption_key)
    return AIProviderConfig.objects.create(
        user=user,
        provider=AIProviderConfig.Provider.ANTHROPIC,
        api_key_encrypted=encryption.encrypt("test-api-key"),
        model_name="claude-sonnet-4-20250514",
        is_default=True,
    )


# ---------------------------------------------------------------------------
# T3.1 — test_connection augmentation
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestTestConnectionWithCatalog:
    """test_connection should fetch + persist catalog on auth success."""

    def test_success_path_persists_catalog(
        self, authenticated_client, provider_config, settings
    ):
        """On auth success, catalog is fetched and persisted."""
        catalog = [
            {"id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4", "context_window": 200000, "is_recommended": True},
        ]

        with (
            patch("apps.ai_assistant.views.ProviderFactory.create_from_config") as mock_factory,
            patch("apps.ai_assistant.views.fetch_models") as mock_fetch,
        ):
            mock_provider = MagicMock()
            mock_provider.complete.return_value = AIResponse(
                content="connected", stop_reason=StopReason.END_TURN
            )
            mock_factory.return_value = mock_provider
            mock_fetch.return_value = catalog

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_200_OK
            assert response.data["success"] is True
            assert response.data["models"] == catalog
            assert response.data["refreshed_at"] is not None

            # Verify persisted to DB
            provider_config.refresh_from_db()
            assert len(provider_config.available_models) == 1
            assert provider_config.models_refreshed_at is not None

    def test_catalog_failure_does_not_mask_auth_success(
        self, authenticated_client, provider_config, settings
    ):
        """If catalog fetch fails after auth succeeds, still return success."""
        with (
            patch("apps.ai_assistant.views.ProviderFactory.create_from_config") as mock_factory,
            patch("apps.ai_assistant.views.fetch_models") as mock_fetch,
        ):
            mock_provider = MagicMock()
            mock_provider.complete.return_value = AIResponse(
                content="connected", stop_reason=StopReason.END_TURN
            )
            mock_factory.return_value = mock_provider
            mock_fetch.side_effect = ProviderUnavailableError("SDK down")

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_200_OK
            assert response.data["success"] is True
            assert response.data["models"] == []
            assert "models_error" in response.data

    def test_auth_failure_no_catalog_mutation(
        self, authenticated_client, provider_config, settings
    ):
        """On auth failure, available_models should NOT be touched."""
        import anthropic

        # Pre-set some models to verify they're not wiped
        provider_config.available_models = [{"id": "existing-model"}]
        provider_config.save()

        with patch(
            "apps.ai_assistant.views.ProviderFactory.create_from_config"
        ) as mock_factory:
            mock_factory.side_effect = anthropic.AuthenticationError(
                message="Invalid API key",
                response=MagicMock(status_code=401),
                body=None,
            )

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/test_connection/"
            )

            assert response.status_code == status.HTTP_400_BAD_REQUEST
            provider_config.refresh_from_db()
            assert provider_config.available_models == [{"id": "existing-model"}]


# ---------------------------------------------------------------------------
# T3.2 — refresh_models endpoint
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestRefreshModelsEndpoint:
    """POST /api/v1/ai/providers/{id}/refresh_models/."""

    def test_refresh_models_success(
        self, authenticated_client, provider_config, settings
    ):
        """Should fetch, persist, and return fresh catalog."""
        catalog = [
            {"id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4", "context_window": 200000, "is_recommended": True},
            {"id": "claude-3-haiku-20240307", "display_name": "Claude 3 Haiku", "context_window": 200000, "is_recommended": False},
        ]

        with patch("apps.ai_assistant.views.fetch_models") as mock_fetch:
            mock_fetch.return_value = catalog

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/refresh_models/"
            )

            assert response.status_code == status.HTTP_200_OK
            assert response.data["success"] is True
            assert len(response.data["models"]) == 2
            assert response.data["refreshed_at"] is not None

            # Verify DB persistence
            provider_config.refresh_from_db()
            assert len(provider_config.available_models) == 2
            assert provider_config.models_refreshed_at is not None

    def test_refresh_models_auth_error_returns_401(
        self, authenticated_client, provider_config, settings
    ):
        with patch("apps.ai_assistant.views.fetch_models") as mock_fetch:
            mock_fetch.side_effect = ProviderAuthError("Invalid key")

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/refresh_models/"
            )

            assert response.status_code == status.HTTP_401_UNAUTHORIZED
            assert response.data["success"] is False

    def test_refresh_models_unavailable_returns_503(
        self, authenticated_client, provider_config, settings
    ):
        with patch("apps.ai_assistant.views.fetch_models") as mock_fetch:
            mock_fetch.side_effect = ProviderUnavailableError("down")

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/refresh_models/"
            )

            assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE

    def test_refresh_models_rate_limit_returns_429(
        self, authenticated_client, provider_config, settings
    ):
        with patch("apps.ai_assistant.views.fetch_models") as mock_fetch:
            mock_fetch.side_effect = ProviderRateLimitError("rate limited")

            response = authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/refresh_models/"
            )

            assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS

    def test_refresh_models_does_not_wipe_on_error(
        self, authenticated_client, provider_config, settings
    ):
        """On error, existing available_models should not be wiped."""
        provider_config.available_models = [{"id": "old-model"}]
        provider_config.save()

        with patch("apps.ai_assistant.views.fetch_models") as mock_fetch:
            mock_fetch.side_effect = ProviderAuthError("bad key")

            authenticated_client.post(
                f"/api/v1/ai/providers/{provider_config.id}/refresh_models/"
            )

            provider_config.refresh_from_db()
            assert provider_config.available_models == [{"id": "old-model"}]

    def test_unauthenticated_access_denied(self, provider_config):
        """Unauthenticated user gets 403."""
        client = APIClient()
        response = client.post(
            f"/api/v1/ai/providers/{provider_config.id}/refresh_models/"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
