"""
Admin configuration for accounts app.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import EmailVerificationToken, User
from .sharing import ProjectShare, ShareInvitation


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admin for custom User model."""

    list_display = ["email", "first_name", "last_name", "email_verified", "is_staff", "created_at"]
    list_filter = ["is_staff", "is_superuser", "is_active", "email_verified", "oauth_provider"]
    search_fields = ["email", "first_name", "last_name"]
    ordering = ["-created_at"]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name", "avatar_url")}),
        ("OAuth", {"fields": ("oauth_provider", "oauth_uid")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "email_verified", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    readonly_fields = ["created_at", "updated_at", "last_login"]

    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "password1", "password2"),
            },
        ),
    )


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    """Admin for email verification tokens."""

    list_display = ["user", "created_at", "expires_at", "used"]
    list_filter = ["used"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]


@admin.register(ProjectShare)
class ProjectShareAdmin(admin.ModelAdmin):
    """Admin for project shares."""

    list_display = ["user", "project", "permission", "invited_by", "created_at"]
    list_filter = ["permission"]
    search_fields = ["user__email", "project__name"]
    raw_id_fields = ["user", "project", "invited_by"]


@admin.register(ShareInvitation)
class ShareInvitationAdmin(admin.ModelAdmin):
    """Admin for share invitations."""

    list_display = ["email", "project", "permission", "invited_by", "created_at", "expires_at"]
    list_filter = ["permission"]
    search_fields = ["email", "project__name"]
    raw_id_fields = ["project", "invited_by"]
