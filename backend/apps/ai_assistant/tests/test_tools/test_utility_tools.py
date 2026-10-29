"""Tests for utility tools."""

import pytest
from unittest.mock import MagicMock, patch

from apps.ai_assistant.tools.utility_tools import (
    list_algorithms_tool,
    get_project_info_tool,
    check_task_status_tool,
    list_simulations_tool,
    get_simulation_details_tool,
)

# Get the actual handlers from the ToolDefinition objects
list_algorithms_handler = list_algorithms_tool.handler
get_project_info_handler = get_project_info_tool.handler
check_task_status_handler = check_task_status_tool.handler
list_simulations_handler = list_simulations_tool.handler
get_simulation_details_handler = get_simulation_details_tool.handler


@pytest.fixture
def mock_user():
    """Create a mock user."""
    user = MagicMock()
    user.id = 1
    user.username = "testuser"
    return user


class TestListAlgorithms:
    """Tests for list_algorithms tool."""

    def test_returns_all_algorithms(self, mock_user):
        """Test that all algorithms are returned."""
        result = list_algorithms_handler(user=mock_user)

        assert "algorithms" in result
        assert "count" in result
        assert len(result["algorithms"]) == result["count"]
        assert result["count"] > 0

        # Check algorithm structure
        for algo in result["algorithms"]:
            assert "code" in algo
            assert "name" in algo

    def test_includes_expected_algorithms(self, mock_user):
        """Test that expected algorithms are present."""
        result = list_algorithms_handler(user=mock_user)

        codes = [a["code"] for a in result["algorithms"]]
        assert "dla" in codes
        assert "cca" in codes
        assert "ballistic" in codes


@pytest.mark.django_db
class TestGetProjectInfo:
    """Tests for get_project_info tool."""

    def test_list_projects_when_no_id(self, mock_user):
        """Test listing projects when no project_id provided."""
        with patch("apps.ai_assistant.tools.utility_tools.Project") as MockProject:
            mock_qs = MagicMock()
            mock_qs.order_by.return_value.__getitem__.return_value = []
            MockProject.objects.all.return_value = mock_qs

            result = get_project_info_handler(project_id=None, user=mock_user)

            assert "projects" in result
            assert "message" in result

    def test_project_not_found(self, mock_user):
        """Test error when project not found."""
        with patch("apps.ai_assistant.tools.utility_tools.Project") as MockProject:
            from django.core.exceptions import ObjectDoesNotExist

            MockProject.DoesNotExist = ObjectDoesNotExist
            MockProject.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                get_project_info_handler(
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )

            assert "not found" in str(exc_info.value)

    def test_returns_project_details(self, mock_user):
        """Test returning project details."""
        with patch("apps.ai_assistant.tools.utility_tools.Project") as MockProject:
            mock_project = MagicMock()
            mock_project.id = "550e8400-e29b-41d4-a716-446655440000"
            mock_project.name = "Test Project"
            mock_project.description = "Test Description"
            mock_project.created_at.isoformat.return_value = "2024-01-01T00:00:00"
            mock_project.updated_at.isoformat.return_value = "2024-01-02T00:00:00"
            mock_project.simulation_count = 5
            mock_project.analysis_count = 2

            mock_simulations = MagicMock()
            mock_simulations.order_by.return_value.__getitem__.return_value = []
            mock_simulations.filter.return_value.count.return_value = 0
            mock_project.simulations = mock_simulations

            MockProject.objects.get.return_value = mock_project

            result = get_project_info_handler(
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["name"] == "Test Project"
            assert result["simulation_count"] == 5
            assert result["analysis_count"] == 2


class TestCheckTaskStatus:
    """Tests for check_task_status tool."""

    def test_returns_task_status(self, mock_user):
        """Test returning task status."""
        with patch("apps.ai_assistant.tools.utility_tools.AsyncResult") as MockResult:
            mock_result = MagicMock()
            mock_result.status = "PENDING"
            mock_result.ready.return_value = False
            MockResult.return_value = mock_result

            result = check_task_status_handler(
                task_id="test-task-id",
                user=mock_user,
            )

            assert result["task_id"] == "test-task-id"
            assert result["status"] == "PENDING"

    def test_returns_completed_result(self, mock_user):
        """Test returning completed task result."""
        with patch("apps.ai_assistant.tools.utility_tools.AsyncResult") as MockResult:
            mock_result = MagicMock()
            mock_result.status = "SUCCESS"
            mock_result.ready.return_value = True
            mock_result.successful.return_value = True
            mock_result.result = {"data": "completed"}
            MockResult.return_value = mock_result

            result = check_task_status_handler(
                task_id="test-task-id",
                user=mock_user,
            )

            assert result["status"] == "SUCCESS"
            assert result["result"] == {"data": "completed"}

    def test_returns_failed_result(self, mock_user):
        """Test returning failed task error."""
        with patch("apps.ai_assistant.tools.utility_tools.AsyncResult") as MockResult:
            mock_result = MagicMock()
            mock_result.status = "FAILURE"
            mock_result.ready.return_value = True
            mock_result.successful.return_value = False
            mock_result.failed.return_value = True
            mock_result.result = Exception("Task failed")
            MockResult.return_value = mock_result

            result = check_task_status_handler(
                task_id="test-task-id",
                user=mock_user,
            )

            assert result["status"] == "FAILURE"
            assert "error" in result


@pytest.mark.django_db
class TestListSimulations:
    """Tests for list_simulations tool."""

    def test_list_all_simulations(self, mock_user):
        """Test listing all simulations."""
        with patch("apps.ai_assistant.tools.utility_tools.Simulation") as MockSim:
            mock_qs = MagicMock()
            mock_qs.filter.return_value = mock_qs
            mock_qs.order_by.return_value.__getitem__.return_value = []
            MockSim.objects.all.return_value = mock_qs

            result = list_simulations_handler(user=mock_user)

            assert "simulations" in result
            assert "count" in result
            assert "filters_applied" in result

    def test_filter_by_project(self, mock_user):
        """Test filtering by project."""
        with patch("apps.ai_assistant.tools.utility_tools.Simulation") as MockSim:
            mock_qs = MagicMock()
            mock_qs.filter.return_value = mock_qs
            mock_qs.order_by.return_value.__getitem__.return_value = []
            MockSim.objects.all.return_value = mock_qs

            result = list_simulations_handler(
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["filters_applied"]["project_id"] == "550e8400-e29b-41d4-a716-446655440000"

    def test_filter_by_algorithm(self, mock_user):
        """Test filtering by algorithm."""
        with patch("apps.ai_assistant.tools.utility_tools.Simulation") as MockSim:
            mock_qs = MagicMock()
            mock_qs.filter.return_value = mock_qs
            mock_qs.order_by.return_value.__getitem__.return_value = []
            MockSim.objects.all.return_value = mock_qs

            result = list_simulations_handler(algorithm="DLA", user=mock_user)

            mock_qs.filter.assert_called()
            assert result["filters_applied"]["algorithm"] == "DLA"

    def test_limit_enforced(self, mock_user):
        """Test that limit is enforced."""
        with patch("apps.ai_assistant.tools.utility_tools.Simulation") as MockSim:
            mock_qs = MagicMock()
            mock_qs.filter.return_value = mock_qs
            mock_qs.order_by.return_value.__getitem__.return_value = []
            MockSim.objects.all.return_value = mock_qs

            # Test max limit
            result = list_simulations_handler(limit=200, user=mock_user)
            assert result["filters_applied"]["limit"] == 100  # Capped at 100

            # Test min limit
            result = list_simulations_handler(limit=0, user=mock_user)
            assert result["filters_applied"]["limit"] == 1  # Min is 1


@pytest.mark.django_db
class TestGetSimulationDetails:
    """Tests for get_simulation_details tool."""

    def test_simulation_not_found(self, mock_user):
        """Test error when simulation not found."""
        with patch("apps.ai_assistant.tools.utility_tools.Simulation") as MockSim:
            from django.core.exceptions import ObjectDoesNotExist

            MockSim.DoesNotExist = ObjectDoesNotExist
            MockSim.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                get_simulation_details_handler(
                    simulation_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )

            assert "not found" in str(exc_info.value)

    def test_returns_simulation_details(self, mock_user):
        """Test returning simulation details."""
        with patch("apps.ai_assistant.tools.utility_tools.Simulation") as MockSim:
            mock_sim = MagicMock()
            mock_sim.id = "550e8400-e29b-41d4-a716-446655440000"
            mock_sim.name = "Test Simulation"
            mock_sim.project_id = "project-id"
            mock_sim.project.name = "Test Project"
            mock_sim.algorithm = "dla"
            mock_sim.get_algorithm_display.return_value = "Diffusion-Limited Aggregation"
            mock_sim.status = "completed"
            mock_sim.get_status_display.return_value = "Completed"
            mock_sim.parameters = {"n_particles": 1000}
            mock_sim.seed = 12345
            mock_sim.created_at.isoformat.return_value = "2024-01-01T00:00:00"
            mock_sim.started_at = None
            mock_sim.completed_at = None
            mock_sim.execution_time_ms = None
            mock_sim.metrics = {"df": 1.8, "kf": 1.2}
            mock_sim.error_message = ""
            mock_sim.task_id = ""

            MockSim.objects.get.return_value = mock_sim

            result = get_simulation_details_handler(
                simulation_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["name"] == "Test Simulation"
            assert result["algorithm"] == "dla"
            assert result["metrics"] == {"df": 1.8, "kf": 1.2}
