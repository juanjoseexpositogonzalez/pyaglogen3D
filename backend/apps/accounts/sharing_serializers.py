"""
Serializers for project sharing.
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .sharing import ProjectShare, ShareInvitation

User = get_user_model()


class ShareUserSerializer(serializers.ModelSerializer):
    """Minimal user serializer for sharing context."""

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "avatar_url"]
        read_only_fields = fields


class ProjectShareSerializer(serializers.ModelSerializer):
    """Serializer for project shares."""

    user = ShareUserSerializer(read_only=True)
    invited_by = ShareUserSerializer(read_only=True)

    class Meta:
        model = ProjectShare
        fields = [
            "id",
            "user",
            "permission",
            "invited_by",
            "created_at",
            "accepted_at",
        ]
        read_only_fields = ["id", "user", "invited_by", "created_at", "accepted_at"]


class ShareInvitationSerializer(serializers.ModelSerializer):
    """Serializer for pending share invitations."""

    invited_by = ShareUserSerializer(read_only=True)

    class Meta:
        model = ShareInvitation
        fields = [
            "id",
            "email",
            "permission",
            "invited_by",
            "created_at",
            "expires_at",
        ]
        read_only_fields = ["id", "invited_by", "created_at", "expires_at"]


class InviteUserSerializer(serializers.Serializer):
    """Serializer for inviting a user to a project."""

    email = serializers.EmailField()
    permission = serializers.ChoiceField(
        choices=ProjectShare.Permission.choices,
        default=ProjectShare.Permission.VIEW,
    )


class UpdateSharePermissionSerializer(serializers.Serializer):
    """Serializer for updating share permission."""

    permission = serializers.ChoiceField(choices=ProjectShare.Permission.choices)
