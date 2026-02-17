"""Project views."""
from rest_framework import viewsets

from .models import Project
from .serializers import ProjectSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """ViewSet for Project CRUD operations."""

    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
