"""AI Assistant permissions."""
from rest_framework.permissions import BasePermission


class IsAIUser(BasePermission):
    """Permission for users who can access AI features.

    For now, allows all authenticated users during development.
    In production, this should check user.has_ai_access or user.is_staff.
    """

    message = "AI features are not enabled for your account."

    def has_permission(self, request, view) -> bool:
        """Check if user can access AI features."""
        if not request.user.is_authenticated:
            return False

        # For development: allow all authenticated users
        # For production: return request.user.is_staff or getattr(request.user, 'has_ai_access', False)
        return True


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
