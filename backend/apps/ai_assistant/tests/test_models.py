"""Tests for AI Assistant models."""
import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError

from apps.ai_assistant.models import AIProviderConfig

User = get_user_model()


@pytest.fixture
def user(db):
    """Create a test user."""
    return User.objects.create_user(
        username="testuser",
        email="test@example.com",
        password="testpass123",
    )


@pytest.fixture
def another_user(db):
    """Create another test user."""
    return User.objects.create_user(
        username="anotheruser",
        email="another@example.com",
        password="testpass123",
    )


@pytest.mark.django_db
class TestAIProviderConfig:
    """Tests for AIProviderConfig model."""

    def test_create_provider_config(self, user):
        """Test creating a provider config."""
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="encrypted_key_123",
            model_name="claude-sonnet-4-20250514",
            is_default=True,
        )
        assert config.id is not None
        assert config.user == user
        assert config.provider == "anthropic"
        assert config.api_key_encrypted == "encrypted_key_123"
        assert config.is_default is True

    def test_str_representation(self, user):
        """Test string representation."""
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key",
            model_name="claude-sonnet-4-20250514",
        )
        expected = f"{user.username} - Anthropic (Claude)"
        assert str(config) == expected

    def test_unique_together_constraint(self, user):
        """Test that user+provider combination must be unique."""
        AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key1",
            model_name="claude-sonnet-4-20250514",
        )

        with pytest.raises(IntegrityError):
            AIProviderConfig.objects.create(
                user=user,
                provider=AIProviderConfig.Provider.ANTHROPIC,
                api_key_encrypted="key2",
                model_name="claude-sonnet-4-20250514",
            )

    def test_different_users_same_provider(self, user, another_user):
        """Test that different users can have same provider."""
        config1 = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key1",
            model_name="claude-sonnet-4-20250514",
        )
        config2 = AIProviderConfig.objects.create(
            user=another_user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key2",
            model_name="claude-sonnet-4-20250514",
        )
        assert config1.id != config2.id

    def test_is_default_only_one_per_user(self, user):
        """Test that only one config can be default per user."""
        config1 = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key1",
            model_name="claude-sonnet-4-20250514",
            is_default=True,
        )
        config2 = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.OPENAI,
            api_key_encrypted="key2",
            model_name="gpt-4o",
            is_default=True,
        )

        # Refresh config1 from database
        config1.refresh_from_db()

        # config1 should no longer be default
        assert config1.is_default is False
        assert config2.is_default is True

    def test_ordering(self, user):
        """Test that configs are ordered by is_default and created_at."""
        config1 = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.OPENAI,
            api_key_encrypted="key1",
            model_name="gpt-4o",
            is_default=False,
        )
        config2 = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key2",
            model_name="claude-sonnet-4-20250514",
            is_default=True,
        )

        configs = list(AIProviderConfig.objects.filter(user=user))
        # Default should come first
        assert configs[0].is_default is True
        assert configs[0].id == config2.id

    def test_provider_choices(self):
        """Test provider choices."""
        choices = AIProviderConfig.Provider.choices
        assert ("anthropic", "Anthropic (Claude)") in choices
        assert ("openai", "OpenAI (GPT)") in choices
        assert ("groq", "Groq") in choices
        assert ("xai", "xAI (Grok)") in choices

    def test_default_field_values(self, user):
        """Test default field values."""
        config = AIProviderConfig.objects.create(
            user=user,
            provider=AIProviderConfig.Provider.ANTHROPIC,
            api_key_encrypted="key",
            model_name="claude-sonnet-4-20250514",
        )
        assert config.is_default is False
        assert config.is_active is True
