"""AI Assistant admin configuration."""
from django.contrib import admin
from django.utils import timezone

from .models import AIProviderConfig, AIUserProfile


@admin.register(AIUserProfile)
class AIUserProfileAdmin(admin.ModelAdmin):
    """Admin for managing AI user access."""

    list_display = [
        "user",
        "has_ai_access",
        "access_granted_at",
        "access_granted_by",
        "created_at",
    ]
    list_filter = ["has_ai_access", "access_granted_at"]
    search_fields = ["user__username", "user__email", "notes"]
    readonly_fields = ["created_at", "updated_at", "access_granted_at", "access_granted_by"]
    raw_id_fields = ["user"]
    ordering = ["-created_at"]

    fieldsets = [
        (
            None,
            {
                "fields": ["user", "has_ai_access"],
            },
        ),
        (
            "Access Details",
            {
                "fields": ["access_granted_at", "access_granted_by", "notes"],
            },
        ),
        (
            "Timestamps",
            {
                "fields": ["created_at", "updated_at"],
                "classes": ["collapse"],
            },
        ),
    ]

    def save_model(self, request, obj, form, change):
        """Track who granted access and when."""
        if "has_ai_access" in form.changed_data:
            if obj.has_ai_access:
                obj.access_granted_at = timezone.now()
                obj.access_granted_by = request.user
            else:
                obj.access_granted_at = None
                obj.access_granted_by = None
        super().save_model(request, obj, form, change)


@admin.register(AIProviderConfig)
class AIProviderConfigAdmin(admin.ModelAdmin):
    """Admin for managing AI provider configurations."""

    list_display = [
        "user",
        "provider",
        "model_name",
        "is_default",
        "is_active",
        "created_at",
    ]
    list_filter = ["provider", "is_default", "is_active"]
    search_fields = ["user__username", "user__email", "model_name"]
    readonly_fields = ["created_at", "updated_at"]
    raw_id_fields = ["user"]
    ordering = ["-created_at"]

    fieldsets = [
        (
            None,
            {
                "fields": ["user", "provider", "model_name"],
            },
        ),
        (
            "API Configuration",
            {
                "fields": ["api_key_encrypted", "is_default", "is_active"],
                "description": "API key is stored encrypted. Do not modify directly.",
            },
        ),
        (
            "Timestamps",
            {
                "fields": ["created_at", "updated_at"],
                "classes": ["collapse"],
            },
        ),
    ]
