"""Shared test fixtures for AI Assistant tests."""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.ai_assistant.models import AIProviderConfig
from apps.ai_assistant.services.encryption import APIKeyEncryption

User = get_user_model()


@pytest.fixture
def encryption_key():
    """Generate a test encryption key."""
    return APIKeyEncryption.generate_key()


@pytest.fixture
def api_client():
    """Create an API client."""
    return APIClient()


@pytest.fixture
def user(db):
    """Create a test user."""
    return User.objects.create_user(
        username="testuser",
        email="test@example.com",
        password="testpass123",
    )


@pytest.fixture
def staff_user(db):
    """Create a staff user."""
    return User.objects.create_user(
        username="staffuser",
        email="staff@example.com",
        password="testpass123",
        is_staff=True,
    )


@pytest.fixture
def authenticated_client(api_client, user):
    """Create an authenticated API client."""
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def staff_client(api_client, staff_user):
    """Create an authenticated staff API client."""
    api_client.force_authenticate(user=staff_user)
    return api_client


@pytest.fixture
def provider_config(user, encryption_key, settings):
    """Create a test provider config."""
    settings.AI_ENCRYPTION_KEY = encryption_key
    encryption = APIKeyEncryption(key=encryption_key)

    return AIProviderConfig.objects.create(
        user=user,
        provider=AIProviderConfig.Provider.ANTHROPIC,
        api_key_encrypted=encryption.encrypt("test-api-key"),
        model_name="claude-sonnet-4-20250514",
        is_default=True,
    )
