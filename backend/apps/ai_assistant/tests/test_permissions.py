"""Tests for AI Assistant permissions."""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory

from apps.ai_assistant.models import AIUserProfile
from apps.ai_assistant.permissions import IsAIUser, IsRAGAdmin

User = get_user_model()


@pytest.fixture
def request_factory():
    """Create a request factory."""
    return APIRequestFactory()


@pytest.fixture
def user_without_profile(db):
    """Create a user without AI profile."""
    return User.objects.create_user(
        username="noprofile",
        email="noprofile@example.com",
        password="testpass123",
    )


@pytest.fixture
def user_with_access(db):
    """Create a user with AI access."""
    user = User.objects.create_user(
        username="hasaccess",
        email="hasaccess@example.com",
        password="testpass123",
    )
    AIUserProfile.objects.create(user=user, has_ai_access=True)
    return user


@pytest.fixture
def user_without_access(db):
    """Create a user without AI access (profile exists but access denied)."""
    user = User.objects.create_user(
        username="noaccess",
        email="noaccess@example.com",
        password="testpass123",
    )
    AIUserProfile.objects.create(user=user, has_ai_access=False)
    return user


@pytest.mark.django_db
class TestIsAIUserPermission:
    """Tests for IsAIUser permission."""

    def test_unauthenticated_user_denied(self, request_factory):
        """Test that unauthenticated users are denied."""
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = type("AnonymousUser", (), {"is_authenticated": False})()

        assert permission.has_permission(request, None) is False

    def test_staff_user_always_allowed(self, request_factory, staff_user):
        """Test that staff users always have access."""
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = staff_user

        assert permission.has_permission(request, None) is True

    def test_user_with_ai_access_allowed(self, request_factory, user_with_access, settings):
        """Test that users with AI access are allowed."""
        settings.DEBUG = False  # Test production behavior
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = user_with_access

        assert permission.has_permission(request, None) is True

    def test_user_without_ai_access_denied_in_production(
        self, request_factory, user_without_access, settings
    ):
        """Test that users without AI access are denied in production."""
        settings.DEBUG = False  # Production mode
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = user_without_access

        assert permission.has_permission(request, None) is False

    def test_user_without_profile_denied_in_production(
        self, request_factory, user_without_profile, settings
    ):
        """Test that users without profile are denied in production."""
        settings.DEBUG = False  # Production mode
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = user_without_profile

        assert permission.has_permission(request, None) is False

    def test_user_without_access_allowed_in_debug(
        self, request_factory, user_without_access, settings
    ):
        """Test that all users are allowed in DEBUG mode."""
        settings.DEBUG = True  # Development mode
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = user_without_access

        assert permission.has_permission(request, None) is True

    def test_user_without_profile_allowed_in_debug(
        self, request_factory, user_without_profile, settings
    ):
        """Test that users without profile are allowed in DEBUG mode."""
        settings.DEBUG = True  # Development mode
        permission = IsAIUser()
        request = request_factory.get("/")
        request.user = user_without_profile

        assert permission.has_permission(request, None) is True

    def test_permission_message(self):
        """Test that permission has a descriptive message."""
        permission = IsAIUser()
        assert "not enabled" in permission.message
        assert "administrator" in permission.message


@pytest.mark.django_db
class TestIsRAGAdminPermission:
    """Tests for IsRAGAdmin permission."""

    def test_unauthenticated_user_denied(self, request_factory):
        """Test that unauthenticated users are denied."""
        permission = IsRAGAdmin()
        request = request_factory.get("/")
        request.user = type("AnonymousUser", (), {"is_authenticated": False})()

        assert permission.has_permission(request, None) is False

    def test_staff_user_allowed(self, request_factory, staff_user):
        """Test that staff users have RAG admin access."""
        permission = IsRAGAdmin()
        request = request_factory.get("/")
        request.user = staff_user

        assert permission.has_permission(request, None) is True

    def test_non_staff_user_denied(self, request_factory, user_with_access):
        """Test that non-staff users are denied RAG admin access."""
        permission = IsRAGAdmin()
        request = request_factory.get("/")
        request.user = user_with_access

        assert permission.has_permission(request, None) is False


@pytest.mark.django_db
class TestAIUserProfileModel:
    """Tests for AIUserProfile model."""

    def test_create_profile(self, user):
        """Test creating an AI user profile."""
        profile = AIUserProfile.objects.create(
            user=user,
            has_ai_access=True,
            notes="Test user for development",
        )

        assert profile.has_ai_access is True
        assert profile.user == user
        assert profile.notes == "Test user for development"
        assert profile.access_granted_at is None  # Not auto-set

    def test_profile_str_with_access(self, user):
        """Test profile string representation with access."""
        profile = AIUserProfile.objects.create(user=user, has_ai_access=True)
        assert str(profile) == f"{user.username} [\u2713]"

    def test_profile_str_without_access(self, user):
        """Test profile string representation without access."""
        profile = AIUserProfile.objects.create(user=user, has_ai_access=False)
        assert str(profile) == f"{user.username} [\u2717]"

    def test_one_to_one_relationship(self, user):
        """Test that user can only have one AI profile."""
        AIUserProfile.objects.create(user=user, has_ai_access=True)

        with pytest.raises(Exception):  # IntegrityError
            AIUserProfile.objects.create(user=user, has_ai_access=False)
