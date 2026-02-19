"""Simulation URLs."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ParametricStudyViewSet, SimulationViewSet

# Main router for direct simulation access (e.g., geometry download)
router = DefaultRouter()
router.register("simulations", SimulationViewSet, basename="simulation")

urlpatterns = [
    path("", include(router.urls)),
    # Nested project routes for simulations
    path(
        "projects/<uuid:project_pk>/simulations/",
        SimulationViewSet.as_view({"get": "list", "post": "create"}),
        name="project-simulations-list",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/",
        SimulationViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-simulations-detail",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/geometry/",
        SimulationViewSet.as_view({"get": "geometry"}),
        name="project-simulations-geometry",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/projection/",
        SimulationViewSet.as_view({"post": "projection"}),
        name="project-simulations-projection",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/projection/batch/",
        SimulationViewSet.as_view({"post": "projection_batch"}),
        name="project-simulations-projection-batch",
    ),
    # Nested project routes for parametric studies
    path(
        "projects/<uuid:project_pk>/studies/",
        ParametricStudyViewSet.as_view({"get": "list", "post": "create"}),
        name="project-studies-list",
    ),
    path(
        "projects/<uuid:project_pk>/studies/<uuid:pk>/",
        ParametricStudyViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-studies-detail",
    ),
    path(
        "projects/<uuid:project_pk>/studies/<uuid:pk>/results/",
        ParametricStudyViewSet.as_view({"get": "results"}),
        name="project-studies-results",
    ),
    path(
        "projects/<uuid:project_pk>/studies/<uuid:pk>/export/",
        ParametricStudyViewSet.as_view({"get": "export_csv"}),
        name="project-studies-export",
    ),
    # Individual simulation export and neighbor graph (new endpoints)
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/export/",
        SimulationViewSet.as_view({"get": "export_csv"}),
        name="project-simulations-export",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/neighbor-graph/",
        SimulationViewSet.as_view({"get": "neighbor_graph"}),
        name="project-simulations-neighbor-graph",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/cancel/",
        SimulationViewSet.as_view({"post": "cancel"}),
        name="project-simulations-cancel",
    ),
    path(
        "projects/<uuid:project_pk>/simulations/<uuid:pk>/box-counting/",
        SimulationViewSet.as_view({"get": "box_counting"}),
        name="project-simulations-box-counting",
    ),
]
