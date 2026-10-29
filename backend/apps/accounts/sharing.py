"""
Project sharing models for collaboration.
"""

import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class ProjectShare(models.Model):
    """
    Represents a user's access to a shared project.
    """

    class Permission(models.TextChoices):
        VIEW = "view", "View Only"
        EDIT = "edit", "Can Edit"
        ADMIN = "admin", "Admin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="shares",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="shared_projects",
    )
    permission = models.CharField(
        max_length=10,
        choices=Permission.choices,
        default=Permission.VIEW,
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="invitations_sent",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "project_shares"
        unique_together = ["project", "user"]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user.email} - {self.project.name} ({self.permission})"


class ShareInvitation(models.Model):
    """
    Pending invitation for users who don't have an account yet.

    When they register with the invited email, the invitation is converted
    to a ProjectShare.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="pending_invitations",
    )
    email = models.EmailField()
    permission = models.CharField(
        max_length=10,
        choices=ProjectShare.Permission.choices,
        default=ProjectShare.Permission.VIEW,
    )
    token = models.CharField(max_length=64, unique=True)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="pending_invitations_sent",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "share_invitations"
        unique_together = ["project", "email"]
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(days=7)
        super().save(*args, **kwargs)

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    def __str__(self) -> str:
        return f"Invitation: {self.email} - {self.project.name}"
