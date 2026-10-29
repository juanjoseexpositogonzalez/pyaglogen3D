"""Tests for parametric study tools."""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from apps.ai_assistant.tools.study_tools import (
    create_parametric_study_tool,
    get_study_status_tool,
    get_study_results_tool,
    list_studies_tool,
    cancel_study_tool,
    _generate_parameter_combinations,
)

# Get the actual handlers from the ToolDefinition objects
create_parametric_study_handler = create_parametric_study_tool.handler
get_study_status_handler = get_study_status_tool.handler
get_study_results_handler = get_study_results_tool.handler
list_studies_handler = list_studies_tool.handler
cancel_study_handler = cancel_study_tool.handler


@pytest.fixture
def mock_user():
    """Create a mock user."""
    user = MagicMock()
    user.id = 1
    user.username = "testuser"
    return user


@pytest.fixture
def mock_project():
    """Create a mock project."""
    project = MagicMock()
    project.id = "550e8400-e29b-41d4-a716-446655440000"
    project.name = "Test Project"
    return project


@pytest.fixture
def mock_study():
    """Create a mock parametric study."""
    study = MagicMock()
    study.id = "770e8400-e29b-41d4-a716-446655440002"
    study.name = "Test Study"
    study.base_algorithm = "dla"
    study.base_parameters = {"n_particles": 1000}
    study.parameter_grid = {"sticking_probability": [0.1, 0.5, 1.0]}
    study.seeds_per_combination = 2
    study.status = "running"
    study.created_at = MagicMock()
    study.created_at.isoformat.return_value = "2024-01-01T00:00:00"
    return study


class TestGenerateParameterCombinations:
    """Tests for parameter combination generator."""

    def test_empty_grid(self):
        """Test empty parameter grid."""
        result = _generate_parameter_combinations({})
        assert result == [{}]

    def test_single_parameter(self):
        """Test single parameter with multiple values."""
        result = _generate_parameter_combinations({
            "sticking_probability": [0.1, 0.5, 1.0]
        })
        assert len(result) == 3
        assert {"sticking_probability": 0.1} in result
        assert {"sticking_probability": 0.5} in result
        assert {"sticking_probability": 1.0} in result

    def test_multiple_parameters(self):
        """Test multiple parameters with multiple values."""
        result = _generate_parameter_combinations({
            "sticking_probability": [0.1, 1.0],
            "particle_radius": [1.0, 2.0],
        })
        assert len(result) == 4  # 2 x 2 = 4 combinations
        assert {"sticking_probability": 0.1, "particle_radius": 1.0} in result
        assert {"sticking_probability": 0.1, "particle_radius": 2.0} in result
        assert {"sticking_probability": 1.0, "particle_radius": 1.0} in result
        assert {"sticking_probability": 1.0, "particle_radius": 2.0} in result

    def test_three_parameters(self):
        """Test three parameters."""
        result = _generate_parameter_combinations({
            "a": [1, 2],
            "b": [3, 4],
            "c": [5],
        })
        assert len(result) == 4  # 2 x 2 x 1 = 4 combinations


class TestCreateParametricStudy:
    """Tests for create_parametric_study tool."""

    def test_requires_project_id(self, mock_user):
        """Test that project_id is required."""
        with pytest.raises(ValueError) as exc_info:
            create_parametric_study_handler(
                name="Test Study",
                algorithm="dla",
                base_parameters={"n_particles": 1000},
                parameter_grid={"sticking_probability": [0.1, 0.5, 1.0]},
                project_id=None,
                user=mock_user,
            )
        assert "project_id is required" in str(exc_info.value)

    def test_requires_parameter_grid(self, mock_user):
        """Test that parameter_grid must not be empty."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject:
            MockProject.objects.get.return_value = MagicMock()

            with pytest.raises(ValueError) as exc_info:
                create_parametric_study_handler(
                    name="Test Study",
                    algorithm="dla",
                    base_parameters={"n_particles": 1000},
                    parameter_grid={},
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "parameter_grid must specify at least one parameter" in str(exc_info.value)

    @pytest.mark.django_db
    def test_project_not_found(self, mock_user):
        """Test error when project not found."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject:
            from django.core.exceptions import ObjectDoesNotExist

            MockProject.DoesNotExist = ObjectDoesNotExist
            MockProject.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                create_parametric_study_handler(
                    name="Test Study",
                    algorithm="dla",
                    base_parameters={"n_particles": 1000},
                    parameter_grid={"sticking_probability": [0.1, 0.5, 1.0]},
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_invalid_algorithm(self, mock_user, mock_project):
        """Test error with invalid algorithm."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject:
            MockProject.objects.get.return_value = mock_project

            with pytest.raises(ValueError) as exc_info:
                create_parametric_study_handler(
                    name="Test Study",
                    algorithm="invalid_algo",
                    base_parameters={"n_particles": 1000},
                    parameter_grid={"sticking_probability": [0.1, 0.5, 1.0]},
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "Invalid algorithm" in str(exc_info.value)

    @pytest.mark.django_db
    def test_too_many_simulations(self, mock_user, mock_project):
        """Test error when too many simulations would be created."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject:
            MockProject.objects.get.return_value = mock_project

            # Create a grid that would produce > 10000 simulations
            # 100 values x 100 values x 2 seeds = 20000 simulations
            with pytest.raises(ValueError) as exc_info:
                create_parametric_study_handler(
                    name="Test Study",
                    algorithm="dla",
                    base_parameters={"n_particles": 1000},
                    parameter_grid={
                        "sticking_probability": list(range(100)),
                        "particle_radius": list(range(100)),
                    },
                    seeds_per_combination=2,
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "Maximum is 10000" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_study_creation(self, mock_user, mock_project, mock_study):
        """Test successful parametric study creation."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy, \
             patch("apps.ai_assistant.tools.study_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.study_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockStudy.objects.create.return_value = mock_study
            mock_sim = MagicMock()
            MockSim.objects.create.return_value = mock_sim
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = create_parametric_study_handler(
                name="Sticking probability sweep",
                algorithm="dla",
                base_parameters={"n_particles": 1000, "lattice_size": 200},
                parameter_grid={"sticking_probability": [0.1, 0.5, 1.0]},
                seeds_per_combination=2,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["status"] == "running"
            assert result["study_name"] == "Sticking probability sweep"
            assert result["algorithm"] == "dla"
            assert result["total_simulations"] == 6  # 3 values x 2 seeds
            assert result["parameter_combinations"] == 3
            assert result["seeds_per_combination"] == 2
            assert "sticking_probability" in result["varied_parameters"]


class TestGetStudyStatus:
    """Tests for get_study_status tool."""

    @pytest.mark.django_db
    def test_study_not_found(self, mock_user):
        """Test error when study not found."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            from django.core.exceptions import ObjectDoesNotExist

            MockStudy.DoesNotExist = ObjectDoesNotExist
            MockStudy.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                get_study_status_handler(
                    study_id="770e8400-e29b-41d4-a716-446655440002",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_running_study_status(self, mock_user, mock_study):
        """Test status of a running study."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            # Set up simulations mock
            mock_simulations = MagicMock()
            mock_simulations.count.return_value = 6
            mock_simulations.filter.return_value.count.side_effect = [
                1,  # queued
                2,  # running
                2,  # completed
                1,  # failed
                0,  # cancelled
            ]
            mock_study.simulations.all.return_value = mock_simulations

            MockStudy.objects.get.return_value = mock_study

            result = get_study_status_handler(
                study_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["study_name"] == "Test Study"
            assert result["status"] == "running"
            assert result["total_simulations"] == 6
            assert "progress_percent" in result

    @pytest.mark.django_db
    def test_completed_study_status(self, mock_user, mock_study):
        """Test status of a completed study."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            mock_simulations = MagicMock()
            mock_simulations.count.return_value = 6
            mock_simulations.filter.return_value.count.side_effect = [
                0,  # queued
                0,  # running
                6,  # completed
                0,  # failed
                0,  # cancelled
            ]
            mock_study.simulations.all.return_value = mock_simulations

            MockStudy.objects.get.return_value = mock_study

            result = get_study_status_handler(
                study_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["status"] == "completed"
            assert result["progress_percent"] == 100.0


class TestGetStudyResults:
    """Tests for get_study_results tool."""

    @pytest.mark.django_db
    def test_study_not_found(self, mock_user):
        """Test error when study not found."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            from django.core.exceptions import ObjectDoesNotExist

            MockStudy.DoesNotExist = ObjectDoesNotExist
            MockStudy.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                get_study_results_handler(
                    study_id="770e8400-e29b-41d4-a716-446655440002",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_no_completed_simulations(self, mock_user, mock_study):
        """Test result when no simulations completed."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            mock_simulations = MagicMock()
            mock_simulations.filter.return_value.exclude.return_value.count.return_value = 0
            mock_study.simulations = mock_simulations

            MockStudy.objects.get.return_value = mock_study

            result = get_study_results_handler(
                study_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["status"] == "no_completed_simulations"

    @pytest.mark.django_db
    def test_results_with_metrics(self, mock_user, mock_study):
        """Test results with completed simulations."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            # Create mock completed simulations with metrics
            sim1 = MagicMock()
            sim1.id = "sim-1"
            sim1.parameters = {"sticking_probability": 0.1}
            sim1.metrics = {"fractal_dimension": 1.7, "radius_of_gyration": 10.5}

            sim2 = MagicMock()
            sim2.id = "sim-2"
            sim2.parameters = {"sticking_probability": 0.5}
            sim2.metrics = {"fractal_dimension": 1.9, "radius_of_gyration": 12.3}

            # Create a MagicMock that returns an iterable
            mock_completed_sims = MagicMock()
            mock_completed_sims.__iter__ = MagicMock(return_value=iter([sim1, sim2]))
            mock_completed_sims.count.return_value = 2

            mock_simulations = MagicMock()
            mock_simulations.filter.return_value.exclude.return_value = mock_completed_sims
            mock_simulations.count.return_value = 6
            mock_study.simulations = mock_simulations

            MockStudy.objects.get.return_value = mock_study

            result = get_study_results_handler(
                study_id="770e8400-e29b-41d4-a716-446655440002",
                include_individual=True,
                user=mock_user,
            )

            assert result["study_name"] == "Test Study"
            assert "summary" in result
            assert result["summary"]["completed_simulations"] == 2
            assert "fractal_dimension" in result["summary"]
            assert "individual_results" in result
            assert len(result["individual_results"]) == 2


class TestListStudies:
    """Tests for list_studies tool."""

    def test_requires_project_id(self, mock_user):
        """Test that project_id is required."""
        with pytest.raises(ValueError) as exc_info:
            list_studies_handler(
                project_id=None,
                user=mock_user,
            )
        assert "project_id is required" in str(exc_info.value)

    @pytest.mark.django_db
    def test_project_not_found(self, mock_user):
        """Test error when project not found."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject:
            from django.core.exceptions import ObjectDoesNotExist

            MockProject.DoesNotExist = ObjectDoesNotExist
            MockProject.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                list_studies_handler(
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_list_all_studies(self, mock_user, mock_project, mock_study):
        """Test listing all studies in a project."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:

            MockProject.objects.get.return_value = mock_project

            # Mock simulations for the study
            mock_simulations = MagicMock()
            mock_simulations.count.return_value = 6
            mock_simulations.filter.return_value.count.return_value = 4
            mock_study.simulations = mock_simulations

            mock_qs = MagicMock()
            mock_qs.filter.return_value = mock_qs
            mock_qs.__getitem__ = MagicMock(return_value=[mock_study])
            MockStudy.objects.filter.return_value = mock_qs

            result = list_studies_handler(
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert "studies" in result
            assert result["total_count"] == 1
            assert result["studies"][0]["name"] == "Test Study"

    @pytest.mark.django_db
    def test_invalid_status_filter(self, mock_user, mock_project):
        """Test error with invalid status filter."""
        with patch("apps.ai_assistant.tools.study_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:

            MockProject.objects.get.return_value = mock_project

            with pytest.raises(ValueError) as exc_info:
                list_studies_handler(
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    status_filter="invalid_status",
                    user=mock_user,
                )
            assert "Invalid status_filter" in str(exc_info.value)


class TestCancelStudy:
    """Tests for cancel_study tool."""

    @pytest.mark.django_db
    def test_study_not_found(self, mock_user):
        """Test error when study not found."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            from django.core.exceptions import ObjectDoesNotExist

            MockStudy.DoesNotExist = ObjectDoesNotExist
            MockStudy.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                cancel_study_handler(
                    study_id="770e8400-e29b-41d4-a716-446655440002",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_already_completed_study(self, mock_user, mock_study):
        """Test cancelling already completed study."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            mock_study.status = "completed"
            MockStudy.objects.get.return_value = mock_study

            result = cancel_study_handler(
                study_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["status"] == "completed"
            assert "already completed" in result["message"]

    @pytest.mark.django_db
    def test_successful_cancellation(self, mock_user, mock_study):
        """Test successful study cancellation."""
        with patch("apps.ai_assistant.tools.study_tools.ParametricStudy") as MockStudy:
            mock_study.status = "running"

            mock_pending_sims = MagicMock()
            mock_pending_sims.update.return_value = 3
            mock_study.simulations.filter.return_value = mock_pending_sims

            MockStudy.objects.get.return_value = mock_study

            result = cancel_study_handler(
                study_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["status"] == "cancelled"
            assert result["simulations_cancelled"] == 3
            mock_study.save.assert_called()


class TestToolDefinitions:
    """Tests for tool definition metadata."""

    def test_create_parametric_study_definition(self):
        """Test create_parametric_study tool definition."""
        assert create_parametric_study_tool.name == "create_parametric_study"
        assert create_parametric_study_tool.category == "study"
        assert create_parametric_study_tool.requires_project is True
        assert create_parametric_study_tool.is_async is True

    def test_get_study_status_definition(self):
        """Test get_study_status tool definition."""
        assert get_study_status_tool.name == "get_study_status"
        assert get_study_status_tool.requires_project is False

    def test_get_study_results_definition(self):
        """Test get_study_results tool definition."""
        assert get_study_results_tool.name == "get_study_results"
        assert "results" in get_study_results_tool.description.lower()

    def test_list_studies_definition(self):
        """Test list_studies tool definition."""
        assert list_studies_tool.name == "list_studies"
        assert list_studies_tool.requires_project is True

    def test_cancel_study_definition(self):
        """Test cancel_study tool definition."""
        assert cancel_study_tool.name == "cancel_study"
        assert "cancel" in cancel_study_tool.description.lower()
