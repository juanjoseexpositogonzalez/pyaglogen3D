"""Fractal Analysis URLs."""
from django.urls import include, path
from rest_framework_nested.routers import NestedDefaultRouter

from .views import ComparisonSetViewSet, ImageAnalysisViewSet

# Create nested router (will be attached to projects)
# This is imported and used in simulations/urls.py or core/urls.py

urlpatterns = []
