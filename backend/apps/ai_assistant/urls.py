"""AI Assistant URL configuration."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AIProviderConfigViewSet

router = DefaultRouter()
router.register("providers", AIProviderConfigViewSet, basename="ai-provider")

urlpatterns = [
    path("", include(router.urls)),
]
