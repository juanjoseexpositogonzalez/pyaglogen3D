"""
Views for project sharing and collaboration.
"""

import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsProjectAdmin
from apps.projects.models import Project

from .sharing import ProjectShare, ShareInvitation
from .sharing_serializers import (
    InviteUserSerializer,
    ProjectShareSerializer,
    ShareInvitationSerializer,
    UpdateSharePermissionSerializer,
)

logger = logging.getLogger(__name__)
User = get_user_model()


class ProjectSharingView(APIView):
    """
    List collaborators and pending invitations for a project.
    """

    permission_classes = [IsAuthenticated, IsProjectAdmin]

    def get_project(self, project_id: str) -> Project:
        """Get project and check permissions."""
        project = get_object_or_404(Project, id=project_id)
        self.check_object_permissions(self.request, project)
        return project

    def get(self, request: Request, project_id: str) -> Response:
        """List all collaborators and pending invitations."""
        project = self.get_project(project_id)

        shares = ProjectShare.objects.filter(project=project).select_related(
            "user", "invited_by"
        )
        invitations = ShareInvitation.objects.filter(
            project=project, expires_at__gt=timezone.now()
        ).select_related("invited_by")

        return Response(
            {
                "collaborators": ProjectShareSerializer(shares, many=True).data,
                "pending_invitations": ShareInvitationSerializer(
                    invitations, many=True
                ).data,
            }
        )


class InviteUserView(APIView):
    """
    Invite a user to collaborate on a project.
    """

    permission_classes = [IsAuthenticated, IsProjectAdmin]

    def get_project(self, project_id: str) -> Project:
        """Get project and check permissions."""
        project = get_object_or_404(Project, id=project_id)
        self.check_object_permissions(self.request, project)
        return project

    def post(self, request: Request, project_id: str) -> Response:
        """Invite a user by email."""
        project = self.get_project(project_id)
        serializer = InviteUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"]
        permission = serializer.validated_data["permission"]

        # Check if user already has access
        existing_share = ProjectShare.objects.filter(
            project=project, user__email=email
        ).first()
        if existing_share:
            return Response(
                {"error": "User already has access to this project."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if invitation already exists
        existing_invitation = ShareInvitation.objects.filter(
            project=project, email=email
        ).first()
        if existing_invitation:
            return Response(
                {"error": "Invitation already sent to this email."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if user exists
        user = User.objects.filter(email=email).first()

        if user:
            # User exists - create direct share
            share = ProjectShare.objects.create(
                project=project,
                user=user,
                permission=permission,
                invited_by=request.user,
                accepted_at=timezone.now(),  # Auto-accept for existing users
            )
            # Send notification email
            self._send_share_notification(user, project, request.user)
            return Response(
                ProjectShareSerializer(share).data, status=status.HTTP_201_CREATED
            )
        else:
            # User doesn't exist - create invitation
            invitation = ShareInvitation.objects.create(
                project=project,
                email=email,
                permission=permission,
                invited_by=request.user,
            )
            # Send invitation email
            self._send_invitation_email(invitation)
            return Response(
                ShareInvitationSerializer(invitation).data,
                status=status.HTTP_201_CREATED,
            )

    def _send_share_notification(self, user, project, inviter) -> None:
        """Send email notification about project share."""
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        project_url = f"{frontend_url}/projects/{project.id}"

        try:
            send_mail(
                subject=f"You've been added to {project.name}",
                message=(
                    f"{inviter.full_name or inviter.email} has shared the project "
                    f'"{project.name}" with you.\n\n'
                    f"View project: {project_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
        except Exception as e:
            logger.warning(f"Failed to send share notification: {e}")

    def _send_invitation_email(self, invitation: ShareInvitation) -> None:
        """Send invitation email to non-existing user."""
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        register_url = f"{frontend_url}/auth/register?invite={invitation.token}"

        try:
            send_mail(
                subject=f"You're invited to collaborate on {invitation.project.name}",
                message=(
                    f"{invitation.invited_by.full_name or invitation.invited_by.email} "
                    f"has invited you to collaborate on PyAglogen3D.\n\n"
                    f"Create your account to access the project:\n{register_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[invitation.email],
                fail_silently=True,
            )
        except Exception as e:
            logger.warning(f"Failed to send invitation email: {e}")


class UpdateSharePermissionView(APIView):
    """
    Update a collaborator's permission level.
    """

    permission_classes = [IsAuthenticated, IsProjectAdmin]

    def get_project(self, project_id: str) -> Project:
        """Get project and check permissions."""
        project = get_object_or_404(Project, id=project_id)
        self.check_object_permissions(self.request, project)
        return project

    def patch(self, request: Request, project_id: str, share_id: str) -> Response:
        """Update permission for a share."""
        project = self.get_project(project_id)
        serializer = UpdateSharePermissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        share = get_object_or_404(ProjectShare, id=share_id, project=project)
        share.permission = serializer.validated_data["permission"]
        share.save(update_fields=["permission"])

        return Response(ProjectShareSerializer(share).data)


class RemoveCollaboratorView(APIView):
    """
    Remove a collaborator or cancel a pending invitation.
    """

    permission_classes = [IsAuthenticated, IsProjectAdmin]

    def get_project(self, project_id: str) -> Project:
        """Get project and check permissions."""
        project = get_object_or_404(Project, id=project_id)
        self.check_object_permissions(self.request, project)
        return project

    def delete(self, request: Request, project_id: str, share_id: str) -> Response:
        """Remove a collaborator or cancel invitation."""
        project = self.get_project(project_id)

        # Try to find and delete a share
        share = ProjectShare.objects.filter(id=share_id, project=project).first()
        if share:
            share.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        # Try to find and delete an invitation
        invitation = ShareInvitation.objects.filter(
            id=share_id, project=project
        ).first()
        if invitation:
            invitation.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(
            {"error": "Share or invitation not found."},
            status=status.HTTP_404_NOT_FOUND,
        )


class AcceptInvitationView(APIView):
    """
    Accept a share invitation via token.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, token: str) -> Response:
        """Accept an invitation."""
        invitation = ShareInvitation.objects.filter(token=token).first()

        if not invitation:
            return Response(
                {"error": "Invalid invitation token."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if invitation.is_expired:
            return Response(
                {"error": "This invitation has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if invitation is for this user
        if invitation.email != request.user.email:
            return Response(
                {"error": "This invitation is for a different email address."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Create share from invitation
        share = ProjectShare.objects.create(
            project=invitation.project,
            user=request.user,
            permission=invitation.permission,
            invited_by=invitation.invited_by,
            accepted_at=timezone.now(),
        )

        # Delete the invitation
        invitation.delete()

        return Response(
            {
                "message": "Invitation accepted.",
                "project_id": str(invitation.project.id),
                "project_name": invitation.project.name,
            }
        )
