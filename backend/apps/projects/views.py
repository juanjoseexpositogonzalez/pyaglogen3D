"""Project views."""
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.accounts.permissions import IsProjectOwnerOrShared
from apps.accounts.sharing import ProjectShare

from .models import Project
from .serializers import ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """ViewSet for Project CRUD operations."""

    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated, IsProjectOwnerOrShared]

    def get_queryset(self):
        """Filter projects to show owned, shared, and public projects."""
        user = self.request.user
        if not user.is_authenticated:
            return Project.objects.filter(is_public=True)

        # Get IDs of projects shared with user
        shared_project_ids = ProjectShare.objects.filter(user=user).values_list(
            "project_id", flat=True
        )

        # Return owned, shared, or public projects
        return Project.objects.filter(
            Q(owner=user) | Q(id__in=shared_project_ids) | Q(is_public=True)
        ).distinct()

    def perform_create(self, serializer):
        """Set owner to current user on creation."""
        serializer.save(owner=self.request.user)
