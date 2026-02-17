"""Simulation URLs."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_nested.routers import NestedDefaultRouter

from apps.projects.views import ProjectViewSet

from .views import ParametricStudyViewSet, SimulationViewSet

# Main router
router = DefaultRouter()

# Nested router for project-scoped resources
projects_router = NestedDefaultRouter(router, "", lookup="project")
projects_router.register(
    r"projects/(?P<project_pk>[^/.]+)/simulations",
    SimulationViewSet,
    basename="project-simulation",
)
projects_router.register(
    r"projects/(?P<project_pk>[^/.]+)/studies",
    ParametricStudyViewSet,
    basename="project-study",
)

# Also allow direct access to simulations for geometry download
router.register("simulations", SimulationViewSet, basename="simulation")

urlpatterns = [
    path("", include(router.urls)),
    path("", include(projects_router.urls)),
]
