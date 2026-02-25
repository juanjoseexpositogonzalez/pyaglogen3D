"""
Serializers for authentication and user management.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Serializer for user profile data."""

    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "email_verified",
            "is_staff",
            "avatar_url",
            "oauth_provider",
            "created_at",
        ]
        read_only_fields = ["id", "email", "email_verified", "is_staff", "oauth_provider", "created_at"]


class RegisterSerializer(serializers.ModelSerializer):
    """Serializer for user registration."""

    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ["email", "password", "password_confirm", "first_name", "last_name"]

    def validate(self, attrs: dict) -> dict:
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        return attrs

    def create(self, validated_data: dict) -> User:
        validated_data.pop("password_confirm")
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    """Serializer for user login."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for password change."""

    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])

    def validate_old_password(self, value: str) -> str:
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value


class EmailVerificationSerializer(serializers.Serializer):
    """Serializer for email verification."""

    token = serializers.CharField()


class ResendVerificationSerializer(serializers.Serializer):
    """Serializer for resending verification email."""

    email = serializers.EmailField()


class AdminUserSerializer(serializers.ModelSerializer):
    """Serializer for admin user listing with project info."""

    full_name = serializers.CharField(read_only=True)
    project_count = serializers.IntegerField(read_only=True)
    simulation_count = serializers.IntegerField(read_only=True)
    projects = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "email_verified",
            "is_staff",
            "is_active",
            "oauth_provider",
            "created_at",
            "last_login",
            "project_count",
            "simulation_count",
            "projects",
        ]

    def get_projects(self, obj):
        """Get list of user's projects with counts."""
        from apps.projects.models import Project

        projects = Project.objects.filter(owner=obj).order_by("-created_at")
        return [
            {
                "id": str(p.id),
                "name": p.name,
                "description": p.description,
                "simulation_count": p.simulations.count(),
                "study_count": p.studies.count(),
                "created_at": p.created_at.isoformat(),
            }
            for p in projects
        ]
