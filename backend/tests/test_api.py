"""Tests for REST API endpoints.

Every endpoint here now requires authentication (DRF's ``IsAuthenticated`` is the
project default) and object-level access is decided by ``IsProjectOwnerOrShared``,
so each test needs a signed-in client and objects owned by that user. The
fixtures below override the ownerless, anonymous ones in ``tests/conftest.py`` —
those still serve the model/serializer tests, which do not go through the API.

``force_authenticate`` installs ``request.user`` directly, so it hides the
authentication layer: the guard rails themselves are covered explicitly by
``test_list_projects_requires_authentication`` and
``test_get_project_denied_to_another_user``, the only tests here that do not run
as the project's owner.
"""

import uuid

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import ImageAnalysis
from apps.projects.models import Project
from apps.simulations.models import Simulation


@pytest.fixture
def user(db):
    """Create the user the API requests are authenticated as."""
    return User.objects.create_user(
        email=f"api-{uuid.uuid4()}@example.com",
        password="testpass123",
    )


@pytest.fixture
def api_client(user):
    """Return a DRF client authenticated as `user`."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def anonymous_client():
    """Return a DRF client that never authenticated."""
    return APIClient()


@pytest.fixture
def stranger_client(db):
    """Return a client authenticated as a user with no access to `project`."""
    stranger = User.objects.create_user(
        email=f"stranger-{uuid.uuid4()}@example.com",
        password="testpass123",
    )
    client = APIClient()
    client.force_authenticate(user=stranger)
    return client


@pytest.fixture
def project(user):
    """Create a project owned by the authenticated user."""
    return Project.objects.create(
        name="Test Project",
        description="Test project description",
        owner=user,
    )


@pytest.fixture
def simulation(project):
    """Create a test simulation inside the owned project."""
    return Simulation.objects.create(
        project=project,
        algorithm="dla",
        parameters={"n_particles": 100, "sticking_probability": 1.0},
        seed=42,
    )


@pytest.fixture
def image_analysis(project):
    """Create a test image analysis inside the owned project."""
    return ImageAnalysis.objects.create(
        project=project,
        original_image=b"\x89PNG\r\n\x1a\n",  # Minimal PNG header
        original_filename="test.png",
        original_content_type="image/png",
        preprocessing_params={"threshold": 128, "invert": False},
        method="box_counting",
    )


class TestProjectsAPI:
    """Tests for Projects API."""

    def test_list_projects(self, api_client, db):
        """Test listing projects."""
        response = api_client.get("/api/v1/projects/")
        assert response.status_code == status.HTTP_200_OK
        assert "results" in response.data

    def test_list_projects_requires_authentication(self, anonymous_client, db):
        """An anonymous request is rejected before the list is built.

        Guards DRF's default ``IsAuthenticated``: every other test in this module
        arrives already authenticated, so removing the permission class would
        leave them all green.

        The status is 401 with the production authenticator (JWT, which sends a
        ``WWW-Authenticate`` header) and 403 here, because ``config.settings.test``
        swaps JWT for ``SessionAuthentication``, whose ``authenticate_header`` is
        ``None`` and makes DRF downgrade ``NotAuthenticated`` to 403. Both mean
        "rejected before the view ran"; 200 is the failure this test exists for.
        """
        response = anonymous_client.get("/api/v1/projects/")
        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )

    def test_create_project(self, api_client, db):
        """Test creating a project."""
        response = api_client.post(
            "/api/v1/projects/",
            {"name": "New Project", "description": "Test description"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["name"] == "New Project"
        assert response.data["simulation_count"] == 0

    def test_get_project(self, api_client, project):
        """Test retrieving a project."""
        response = api_client.get(f"/api/v1/projects/{project.id}/")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(project.id)

    def test_get_project_denied_to_another_user(self, stranger_client, project):
        """A user who neither owns nor shares the project cannot read it.

        Guards ``IsProjectOwnerOrShared`` and the owner/share filter in
        ``ProjectViewSet.get_queryset``: with the same owner in every test,
        dropping either one would go unnoticed.

        Measured today: 404, because ``get_object()`` resolves against the
        filtered queryset before the object permission runs. 403 is what
        ``IsProjectOwnerOrShared`` would answer for a foreign project, so both
        are accepted — the failure this test exists for is 200.
        """
        response = stranger_client.get(f"/api/v1/projects/{project.id}/")
        assert response.status_code in (
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        )

    def test_delete_project(self, api_client, project):
        """Test deleting a project."""
        response = api_client.delete(f"/api/v1/projects/{project.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT


class TestSimulationsAPI:
    """Tests for Simulations API."""

    def test_list_simulations(self, api_client, project):
        """Test listing simulations for a project."""
        response = api_client.get(f"/api/v1/projects/{project.id}/simulations/")
        assert response.status_code == status.HTTP_200_OK

    def test_create_simulation(self, api_client, project, mocker):
        """Test creating a simulation."""
        # Mock the Celery task to avoid actual execution. The view persists the
        # returned task id on `Simulation.task_id` (a CharField), so the mock has
        # to look like a Celery `AsyncResult` rather than a bare `MagicMock`.
        mocker.patch(
            "apps.simulations.views.run_simulation_task.delay",
            return_value=mocker.Mock(id="test-task-id"),
        )

        response = api_client.post(
            f"/api/v1/projects/{project.id}/simulations/",
            {
                "project": str(project.id),
                "algorithm": "dla",
                "parameters": {"n_particles": 100},
                "seed": 42,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["algorithm"] == "dla"
        assert response.data["status"] == "queued"

    def test_create_simulation_validates_parameters(self, api_client, project, mocker):
        """Test that simulation creation validates parameters."""
        mocker.patch(
            "apps.simulations.views.run_simulation_task.delay",
            return_value=mocker.Mock(id="test-task-id"),
        )

        # Missing n_particles
        response = api_client.post(
            f"/api/v1/projects/{project.id}/simulations/",
            {
                "algorithm": "dla",
                "parameters": {},
                "seed": 42,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_get_simulation(self, api_client, project, simulation):
        """Test retrieving a simulation."""
        response = api_client.get(
            f"/api/v1/projects/{project.id}/simulations/{simulation.id}/"
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(simulation.id)

    def test_geometry_download_not_available(self, api_client, simulation):
        """Test geometry download when not available.

        This endpoint answers 404 both for a missing geometry and for an object
        the caller cannot reach, so the error body is what tells them apart.
        """
        response = api_client.get(f"/api/v1/simulations/{simulation.id}/geometry/")
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert response.data["error"] == "Geometry not available"


class TestImageAnalysisAPI:
    """Tests for Image Analysis API."""

    def test_list_analyses(self, api_client, project):
        """Test listing analyses for a project."""
        response = api_client.get(f"/api/v1/projects/{project.id}/analyses/")
        assert response.status_code == status.HTTP_200_OK

    def test_get_analysis(self, api_client, project, image_analysis):
        """Test retrieving an analysis."""
        response = api_client.get(
            f"/api/v1/projects/{project.id}/analyses/{image_analysis.id}/"
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(image_analysis.id)
