"""
Custom permissions for project access control.
"""

from rest_framework import permissions


class IsProjectOwnerOrShared(permissions.BasePermission):
    """
    Permission that checks if user owns the project or has shared access.

    For list views: filters queryset (handled in view)
    For detail views: checks ownership or share permission
    """

    def has_object_permission(self, request, view, obj) -> bool:
        # Check if obj is a project or has a project attribute
        project = getattr(obj, "project", obj)

        # Owner has full access
        if project.owner == request.user:
            return True

        # Check for shared access
        from apps.accounts.sharing import ProjectShare

        share = ProjectShare.objects.filter(project=project, user=request.user).first()
        if not share:
            return False

        # Read-only methods allowed for any share
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write methods require edit or admin permission
        return share.permission in [ProjectShare.Permission.EDIT, ProjectShare.Permission.ADMIN]


class IsProjectAdmin(permissions.BasePermission):
    """
    Permission that checks if user is project owner or has admin share permission.
    """

    def has_object_permission(self, request, view, obj) -> bool:
        project = getattr(obj, "project", obj)

        # Owner is always admin
        if project.owner == request.user:
            return True

        # Check for admin share
        from apps.accounts.sharing import ProjectShare

        return ProjectShare.objects.filter(
            project=project, user=request.user, permission=ProjectShare.Permission.ADMIN
        ).exists()


class IsEmailVerified(permissions.BasePermission):
    """
    Permission that requires the user to have a verified email.
    """

    message = "Email verification required."

    def has_permission(self, request, view) -> bool:
        return request.user.is_authenticated and request.user.email_verified
