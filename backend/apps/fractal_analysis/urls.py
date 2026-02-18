"""Fractal Analysis URLs."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ComparisonSetViewSet, FraktalAnalysisViewSet, ImageAnalysisViewSet

# Main router for direct access
router = DefaultRouter()
router.register("analyses", ImageAnalysisViewSet, basename="analysis")
router.register("fraktal", FraktalAnalysisViewSet, basename="fraktal")
router.register("comparisons", ComparisonSetViewSet, basename="comparison")

# Nested routes are defined via pattern matching in the URL
# /projects/{project_pk}/analyses/
# /projects/{project_pk}/comparisons/

urlpatterns = [
    path("", include(router.urls)),
    # Nested project routes
    path(
        "projects/<uuid:project_pk>/analyses/",
        ImageAnalysisViewSet.as_view({"get": "list", "post": "create"}),
        name="project-analyses-list",
    ),
    path(
        "projects/<uuid:project_pk>/analyses/<uuid:pk>/",
        ImageAnalysisViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-analyses-detail",
    ),
    path(
        "projects/<uuid:project_pk>/analyses/<uuid:pk>/original_image/",
        ImageAnalysisViewSet.as_view({"get": "original_image"}),
        name="project-analyses-original-image",
    ),
    path(
        "projects/<uuid:project_pk>/analyses/<uuid:pk>/processed_image/",
        ImageAnalysisViewSet.as_view({"get": "processed_image"}),
        name="project-analyses-processed-image",
    ),
    path(
        "projects/<uuid:project_pk>/comparisons/",
        ComparisonSetViewSet.as_view({"get": "list", "post": "create"}),
        name="project-comparisons-list",
    ),
    path(
        "projects/<uuid:project_pk>/comparisons/<uuid:pk>/",
        ComparisonSetViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-comparisons-detail",
    ),
    # FRAKTAL analysis routes
    path(
        "projects/<uuid:project_pk>/fraktal/",
        FraktalAnalysisViewSet.as_view({"get": "list", "post": "create"}),
        name="project-fraktal-list",
    ),
    path(
        "projects/<uuid:project_pk>/fraktal/<uuid:pk>/",
        FraktalAnalysisViewSet.as_view(
            {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-fraktal-detail",
    ),
    path(
        "projects/<uuid:project_pk>/fraktal/<uuid:pk>/original_image/",
        FraktalAnalysisViewSet.as_view({"get": "original_image"}),
        name="project-fraktal-original-image",
    ),
    path(
        "projects/<uuid:project_pk>/fraktal/<uuid:pk>/rerun/",
        FraktalAnalysisViewSet.as_view({"post": "rerun"}),
        name="project-fraktal-rerun",
    ),
]
