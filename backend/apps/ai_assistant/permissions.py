"""AI Assistant permissions."""
from django.conf import settings
from rest_framework.permissions import BasePermission


class IsAIUser(BasePermission):
    """Permission for users who can access AI features.

    Access is granted if the user:
    - Is a staff member (admin), OR
    - Has an AIUserProfile with has_ai_access=True

    Note:
        In development (DEBUG=True), all authenticated users have access
        for easier testing. In production, proper access control is enforced.
    """

    message = "AI features are not enabled for your account. Contact an administrator to request access."

    def has_permission(self, request, view) -> bool:
        """Check if user can access AI features."""
        if not request.user.is_authenticated:
            return False

        # Staff always has access
        if request.user.is_staff:
            return True

        # Check AIUserProfile for access permission
        if hasattr(request.user, "ai_profile"):
            if request.user.ai_profile.has_ai_access:
                return True

        # In development mode, allow all authenticated users for testing
        # In production, deny access if user doesn't have explicit access
        if settings.DEBUG:
            return True

        return False


class IsRAGAdmin(BasePermission):
    """Permission for users who can manage RAG knowledge base.

    Only staff users can manage RAG documents.
    """

    message = "RAG management requires admin privileges."

    def has_permission(self, request, view) -> bool:
        """Check if user can manage RAG."""
        return (
            request.user.is_authenticated and
            request.user.is_staff
        )
