"""AI Assistant URL configuration."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AIAccessCheckView,
    AIProviderConfigViewSet,
    ChatView,
    ConversationViewSet,
    NotificationViewSet,
    RecentSimulationsView,
    ToolExecuteView,
    ToolListView,
)

router = DefaultRouter()
router.register("providers", AIProviderConfigViewSet, basename="ai-provider")
router.register("conversations", ConversationViewSet, basename="ai-conversation")
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("", include(router.urls)),
    path("access/", AIAccessCheckView.as_view(), name="ai-access-check"),
    path("chat/", ChatView.as_view(), name="ai-chat"),
    path("tools/", ToolListView.as_view(), name="tool-list"),
    path("tools/<str:name>/execute/", ToolExecuteView.as_view(), name="tool-execute"),
    path("recent-simulations/", RecentSimulationsView.as_view(), name="recent-simulations"),
]
