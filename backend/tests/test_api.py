"""Tests for REST API endpoints."""
import pytest
from rest_framework import status


class TestProjectsAPI:
    """Tests for Projects API."""

    def test_list_projects(self, api_client, db):
        """Test listing projects."""
        response = api_client.get("/api/v1/projects/")
        assert response.status_code == status.HTTP_200_OK
        assert "results" in response.data

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
        # Mock the Celery task to avoid actual execution
        mocker.patch("apps.simulations.views.run_simulation_task.delay")

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
        mocker.patch("apps.simulations.views.run_simulation_task.delay")

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
        """Test geometry download when not available."""
        response = api_client.get(f"/api/v1/simulations/{simulation.id}/geometry/")
        assert response.status_code == status.HTTP_404_NOT_FOUND


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
