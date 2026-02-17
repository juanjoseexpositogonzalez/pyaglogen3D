"""Pytest configuration and fixtures."""
import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client() -> APIClient:
    """Return a DRF API client."""
    return APIClient()


@pytest.fixture
def project(db):
    """Create a test project."""
    from apps.projects.models import Project

    return Project.objects.create(
        name="Test Project",
        description="Test project description",
    )


@pytest.fixture
def simulation(db, project):
    """Create a test simulation."""
    from apps.simulations.models import Simulation

    return Simulation.objects.create(
        project=project,
        algorithm="dla",
        parameters={"n_particles": 100, "sticking_probability": 1.0},
        seed=42,
    )


@pytest.fixture
def image_analysis(db, project):
    """Create a test image analysis."""
    from apps.fractal_analysis.models import ImageAnalysis

    return ImageAnalysis.objects.create(
        project=project,
        original_image=b"\x89PNG\r\n\x1a\n",  # Minimal PNG header
        original_filename="test.png",
        original_content_type="image/png",
        preprocessing_params={"threshold": 128, "invert": False},
        method="box_counting",
    )
