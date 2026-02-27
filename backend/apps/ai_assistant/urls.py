"""AI Assistant URL configuration."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AIProviderConfigViewSet, ToolExecuteView, ToolListView

router = DefaultRouter()
router.register("providers", AIProviderConfigViewSet, basename="ai-provider")

urlpatterns = [
    path("", include(router.urls)),
    path("tools/", ToolListView.as_view(), name="tool-list"),
    path("tools/<str:name>/execute/", ToolExecuteView.as_view(), name="tool-execute"),
]
