"""Project URLs."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.sharing_views import (
    AcceptInvitationView,
    InviteUserView,
    ProjectSharingView,
    RemoveCollaboratorView,
    UpdateSharePermissionView,
)

from .views import ProjectViewSet

router = DefaultRouter()
router.register("", ProjectViewSet, basename="project")

urlpatterns = [
    path("", include(router.urls)),
    # Project sharing endpoints
    path(
        "<uuid:project_id>/sharing/",
        ProjectSharingView.as_view(),
        name="project-sharing",
    ),
    path(
        "<uuid:project_id>/sharing/invite/",
        InviteUserView.as_view(),
        name="project-sharing-invite",
    ),
    path(
        "<uuid:project_id>/sharing/update/<uuid:share_id>/",
        UpdateSharePermissionView.as_view(),
        name="project-sharing-update",
    ),
    path(
        "<uuid:project_id>/sharing/remove/<uuid:share_id>/",
        RemoveCollaboratorView.as_view(),
        name="project-sharing-remove",
    ),
    # Accept invitation (uses token, not project ID)
    path(
        "invitations/<str:token>/accept/",
        AcceptInvitationView.as_view(),
        name="invitation-accept",
    ),
]
