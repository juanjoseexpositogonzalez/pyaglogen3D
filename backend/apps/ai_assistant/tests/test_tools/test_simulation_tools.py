"""Tests for simulation tools."""

import pytest
from unittest.mock import MagicMock, patch

from apps.ai_assistant.tools.simulation_tools import (
    run_simulation_tool,
    run_dla_simulation_tool,
    run_cca_simulation_tool,
    run_ballistic_simulation_tool,
    run_ballistic_cc_simulation_tool,
    run_tunable_simulation_tool,
    run_limiting_case_tool,
)

# Get the actual handlers from the ToolDefinition objects
run_simulation_handler = run_simulation_tool.handler
run_dla_simulation_handler = run_dla_simulation_tool.handler
run_cca_simulation_handler = run_cca_simulation_tool.handler
run_ballistic_simulation_handler = run_ballistic_simulation_tool.handler
run_ballistic_cc_simulation_handler = run_ballistic_cc_simulation_tool.handler
run_tunable_simulation_handler = run_tunable_simulation_tool.handler
run_limiting_case_handler = run_limiting_case_tool.handler


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
def mock_simulation():
    """Create a mock simulation."""
    sim = MagicMock()
    sim.id = "660e8400-e29b-41d4-a716-446655440001"
    sim.task_id = "celery-task-123"
    sim.algorithm = "dla"
    sim.get_algorithm_display.return_value = "Diffusion-Limited Aggregation"
    return sim


class TestRunSimulation:
    """Tests for generic run_simulation tool."""

    def test_requires_project_id(self, mock_user):
        """Test that project_id is required."""
        with pytest.raises(ValueError) as exc_info:
            run_simulation_handler(
                algorithm="dla",
                n_particles=100,
                project_id=None,
                user=mock_user,
            )
        assert "project_id is required" in str(exc_info.value)

    def test_validates_n_particles_minimum(self, mock_user):
        """Test n_particles minimum validation."""
        with pytest.raises(ValueError) as exc_info:
            run_simulation_handler(
                algorithm="dla",
                n_particles=5,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )
        assert "n_particles must be between 10 and 100000" in str(exc_info.value)

    def test_validates_n_particles_maximum(self, mock_user):
        """Test n_particles maximum validation."""
        with pytest.raises(ValueError) as exc_info:
            run_simulation_handler(
                algorithm="dla",
                n_particles=200000,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )
        assert "n_particles must be between 10 and 100000" in str(exc_info.value)

    def test_validates_sticking_probability(self, mock_user):
        """Test sticking_probability validation."""
        with pytest.raises(ValueError) as exc_info:
            run_simulation_handler(
                algorithm="dla",
                n_particles=100,
                sticking_probability=1.5,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )
        assert "sticking_probability must be between 0.0 and 1.0" in str(exc_info.value)

    @pytest.mark.django_db
    def test_project_not_found(self, mock_user):
        """Test error when project not found."""
        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject:
            from django.core.exceptions import ObjectDoesNotExist

            MockProject.DoesNotExist = ObjectDoesNotExist
            MockProject.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                run_simulation_handler(
                    algorithm="dla",
                    n_particles=100,
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_invalid_algorithm(self, mock_user, mock_project):
        """Test error with invalid algorithm."""
        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject:
            MockProject.objects.get.return_value = mock_project

            with pytest.raises(ValueError) as exc_info:
                run_simulation_handler(
                    algorithm="invalid_algo",
                    n_particles=100,
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "Invalid algorithm" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_simulation_creation(self, mock_user, mock_project, mock_simulation):
        """Test successful simulation creation."""
        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_simulation_handler(
                algorithm="dla",
                n_particles=1000,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                name="Test Simulation",
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert "simulation_id" in result
            assert "task_id" in result
            assert result["algorithm"] == "dla"
            assert result["n_particles"] == 1000


class TestRunDLASimulation:
    """Tests for DLA simulation tool."""

    def test_requires_project_id(self, mock_user):
        """Test that project_id is required."""
        with pytest.raises(ValueError) as exc_info:
            run_dla_simulation_handler(
                n_particles=100,
                project_id=None,
                user=mock_user,
            )
        assert "project_id is required" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_dla_simulation(self, mock_user, mock_project, mock_simulation):
        """Test successful DLA simulation creation."""
        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_dla_simulation_handler(
                n_particles=500,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                sticking_probability=0.8,
                lattice_size=150,
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert result["algorithm"] == "dla"
            assert result["n_particles"] == 500

            # Verify Simulation.objects.create was called with correct params
            MockSim.objects.create.assert_called_once()
            call_kwargs = MockSim.objects.create.call_args.kwargs
            assert call_kwargs["algorithm"] == "dla"
            assert call_kwargs["parameters"]["lattice_size"] == 150
            assert call_kwargs["parameters"]["sticking_probability"] == 0.8


class TestRunCCASimulation:
    """Tests for CCA simulation tool."""

    @pytest.mark.django_db
    def test_successful_cca_simulation(self, mock_user, mock_project, mock_simulation):
        """Test successful CCA simulation creation."""
        mock_simulation.algorithm = "cca"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_cca_simulation_handler(
                n_particles=500,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                box_size=150.0,
                single_agglomerate=True,
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert result["algorithm"] == "cca"

            call_kwargs = MockSim.objects.create.call_args.kwargs
            assert call_kwargs["algorithm"] == "cca"
            assert call_kwargs["parameters"]["box_size"] == 150.0
            assert call_kwargs["parameters"]["single_agglomerate"] is True


class TestRunBallisticSimulation:
    """Tests for ballistic simulation tools."""

    @pytest.mark.django_db
    def test_successful_ballistic_simulation(self, mock_user, mock_project, mock_simulation):
        """Test successful ballistic simulation creation."""
        mock_simulation.algorithm = "ballistic"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_ballistic_simulation_handler(
                n_particles=500,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert result["algorithm"] == "ballistic"

    @pytest.mark.django_db
    def test_successful_ballistic_cc_simulation(self, mock_user, mock_project, mock_simulation):
        """Test successful ballistic CC simulation creation."""
        mock_simulation.algorithm = "ballistic_cc"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_ballistic_cc_simulation_handler(
                n_particles=500,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert result["algorithm"] == "ballistic_cc"


class TestRunTunableSimulation:
    """Tests for tunable simulation tool."""

    def test_validates_target_df_minimum(self, mock_user):
        """Test target_df minimum validation."""
        with pytest.raises(ValueError) as exc_info:
            run_tunable_simulation_handler(
                n_particles=100,
                target_df=0.5,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )
        assert "target_df must be between 1.0 and 3.0" in str(exc_info.value)

    def test_validates_target_df_maximum(self, mock_user):
        """Test target_df maximum validation."""
        with pytest.raises(ValueError) as exc_info:
            run_tunable_simulation_handler(
                n_particles=100,
                target_df=3.5,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )
        assert "target_df must be between 1.0 and 3.0" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_tunable_simulation(self, mock_user, mock_project, mock_simulation):
        """Test successful tunable simulation creation."""
        mock_simulation.algorithm = "tunable"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_tunable_simulation_handler(
                n_particles=500,
                target_df=2.0,
                target_kf=1.5,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert result["algorithm"] == "tunable"
            assert result["target_df"] == 2.0

            call_kwargs = MockSim.objects.create.call_args.kwargs
            assert call_kwargs["parameters"]["target_df"] == 2.0
            assert call_kwargs["parameters"]["target_kf"] == 1.5


class TestRunLimitingCase:
    """Tests for limiting case tool."""

    def test_validates_geometry_type(self, mock_user):
        """Test geometry_type validation."""
        with pytest.raises(ValueError) as exc_info:
            run_limiting_case_handler(
                geometry_type="invalid",
                n_particles=100,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )
        assert "Invalid geometry_type" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_chain_geometry(self, mock_user, mock_project, mock_simulation):
        """Test successful chain geometry creation."""
        mock_simulation.algorithm = "limiting"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_limiting_case_handler(
                geometry_type="chain",
                n_particles=50,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert result["algorithm"] == "limiting"
            assert result["geometry_type"] == "chain"
            assert result["expected_df"] == 1.0

    @pytest.mark.django_db
    def test_successful_plane_geometry(self, mock_user, mock_project, mock_simulation):
        """Test successful plane geometry creation."""
        mock_simulation.algorithm = "limiting"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_limiting_case_handler(
                geometry_type="plane",
                n_particles=100,
                packing="CCC",
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["geometry_type"] == "plane"
            assert result["expected_df"] == 2.0

    @pytest.mark.django_db
    def test_successful_sphere_geometry(self, mock_user, mock_project, mock_simulation):
        """Test successful sphere geometry creation."""
        mock_simulation.algorithm = "limiting"

        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_limiting_case_handler(
                geometry_type="sphere",
                n_particles=500,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["geometry_type"] == "sphere"
            assert result["expected_df"] == 3.0


class TestToolDefinitions:
    """Tests for tool definition metadata."""

    def test_run_simulation_tool_definition(self):
        """Test run_simulation tool definition."""
        assert run_simulation_tool.name == "run_simulation"
        assert run_simulation_tool.category == "simulation"
        assert run_simulation_tool.requires_project is True
        assert run_simulation_tool.is_async is True

    def test_run_dla_simulation_tool_definition(self):
        """Test run_dla_simulation tool definition."""
        assert run_dla_simulation_tool.name == "run_dla_simulation"
        assert "DLA" in run_dla_simulation_tool.description

    def test_run_cca_simulation_tool_definition(self):
        """Test run_cca_simulation tool definition."""
        assert run_cca_simulation_tool.name == "run_cca_simulation"
        assert "CCA" in run_cca_simulation_tool.description

    def test_run_tunable_simulation_tool_definition(self):
        """Test run_tunable_simulation tool definition."""
        assert run_tunable_simulation_tool.name == "run_tunable_simulation"
        assert "fractal dimension" in run_tunable_simulation_tool.description.lower()

    def test_run_limiting_case_tool_definition(self):
        """Test run_limiting_case tool definition."""
        assert run_limiting_case_tool.name == "run_limiting_case"
        assert "limiting case" in run_limiting_case_tool.description.lower()


class TestSeedHandling:
    """Tests for random seed handling."""

    @pytest.mark.django_db
    def test_custom_seed_used(self, mock_user, mock_project, mock_simulation):
        """Test that custom seed is used when provided."""
        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            run_dla_simulation_handler(
                n_particles=100,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                seed=42,
                user=mock_user,
            )

            call_kwargs = MockSim.objects.create.call_args.kwargs
            assert call_kwargs["seed"] == 42

    @pytest.mark.django_db
    def test_random_seed_generated(self, mock_user, mock_project, mock_simulation):
        """Test that random seed is generated when not provided."""
        with patch("apps.ai_assistant.tools.simulation_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.simulation_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.simulation_tools.run_simulation_task") as mock_task, \
             patch("apps.ai_assistant.tools.simulation_tools.random") as mock_random:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.create.return_value = mock_simulation
            mock_task.delay.return_value = MagicMock(id="celery-task-123")
            mock_random.randint.return_value = 987654321

            run_dla_simulation_handler(
                n_particles=100,
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            call_kwargs = MockSim.objects.create.call_args.kwargs
            assert call_kwargs["seed"] == 987654321
