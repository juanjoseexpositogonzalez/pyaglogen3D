"""Tests for analysis tools."""

import pytest
from unittest.mock import MagicMock, patch

from apps.ai_assistant.tools.analysis_tools import (
    run_box_counting_tool,
    get_box_counting_results_tool,
    run_fraktal_analysis_tool,
    run_fraktal_from_image_tool,
    get_fraktal_results_tool,
    compare_simulations_tool,
    analyze_parametric_study_tool,
    list_analyses_tool,
    _compute_trend,
)

# Get the actual handlers from the ToolDefinition objects
run_box_counting_handler = run_box_counting_tool.handler
get_box_counting_results_handler = get_box_counting_results_tool.handler
run_fraktal_analysis_handler = run_fraktal_analysis_tool.handler
run_fraktal_from_image_handler = run_fraktal_from_image_tool.handler
get_fraktal_results_handler = get_fraktal_results_tool.handler
compare_simulations_handler = compare_simulations_tool.handler
analyze_parametric_study_handler = analyze_parametric_study_tool.handler
list_analyses_handler = list_analyses_tool.handler


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
    """Create a mock completed simulation."""
    import io
    import numpy as np

    sim = MagicMock()
    sim.id = "660e8400-e29b-41d4-a716-446655440001"
    sim.name = "Test Simulation"
    sim.algorithm = "dla"
    sim.status = "completed"
    sim.parameters = {"n_particles": 1000}
    sim.metrics = {
        "fractal_dimension": 1.78,
        "radius_of_gyration": 45.2,
        "porosity": 0.85,
    }

    # Create mock geometry data
    coords = np.random.randn(100, 3)
    radii = np.ones(100)
    geometry = np.column_stack([coords, radii])
    buffer = io.BytesIO()
    np.save(buffer, geometry)
    sim.geometry = buffer.getvalue()

    return sim


class TestRunBoxCounting:
    """Tests for run_box_counting tool."""

    @pytest.mark.django_db
    def test_simulation_not_found(self, mock_user):
        """Test error when simulation not found."""
        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            from django.core.exceptions import ObjectDoesNotExist

            MockSim.DoesNotExist = ObjectDoesNotExist
            MockSim.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                run_box_counting_handler(
                    simulation_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_simulation_not_completed(self, mock_user, mock_simulation):
        """Test error when simulation not completed."""
        mock_simulation.status = "running"

        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            MockSim.objects.get.return_value = mock_simulation

            with pytest.raises(ValueError) as exc_info:
                run_box_counting_handler(
                    simulation_id="660e8400-e29b-41d4-a716-446655440001",
                    user=mock_user,
                )
            assert "not completed" in str(exc_info.value)

    @pytest.mark.django_db
    def test_no_geometry_data(self, mock_user, mock_simulation):
        """Test error when no geometry data."""
        mock_simulation.geometry = None

        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            MockSim.objects.get.return_value = mock_simulation

            with pytest.raises(ValueError) as exc_info:
                run_box_counting_handler(
                    simulation_id="660e8400-e29b-41d4-a716-446655440001",
                    user=mock_user,
                )
            assert "no geometry data" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_box_counting(self, mock_user, mock_simulation):
        """Test successful box-counting analysis."""
        import sys

        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            MockSim.objects.get.return_value = mock_simulation

            # Mock aglogen_core module
            mock_core = MagicMock()
            mock_result = MagicMock()
            mock_result.dimension = 1.78
            mock_result.r_squared = 0.998
            mock_result.std_error = 0.02
            mock_result.confidence_interval = [1.74, 1.82]
            mock_result.log_scales = MagicMock(tolist=MagicMock(return_value=[1, 2, 3]))
            mock_result.log_values = MagicMock(tolist=MagicMock(return_value=[4, 5, 6]))
            mock_result.execution_time_ms = 150
            mock_core.box_counting_agglomerate.return_value = mock_result

            with patch.dict(sys.modules, {"aglogen_core": mock_core}):
                result = run_box_counting_handler(
                    simulation_id="660e8400-e29b-41d4-a716-446655440001",
                    points_per_sphere=100,
                    precision=18,
                    user=mock_user,
                )

            assert result["status"] == "completed"
            assert result["dimension"] == 1.78
            assert result["r_squared"] == 0.998


class TestGetBoxCountingResults:
    """Tests for get_box_counting_results tool."""

    @pytest.mark.django_db
    def test_simulation_not_found(self, mock_user):
        """Test error when simulation not found."""
        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            from django.core.exceptions import ObjectDoesNotExist

            MockSim.DoesNotExist = ObjectDoesNotExist
            MockSim.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                get_box_counting_results_handler(
                    simulation_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_no_box_counting_results(self, mock_user, mock_simulation):
        """Test error when no box-counting results."""
        mock_simulation.metrics = {"fractal_dimension": 1.78}  # No box_counting

        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            MockSim.objects.get.return_value = mock_simulation

            with pytest.raises(ValueError) as exc_info:
                get_box_counting_results_handler(
                    simulation_id="660e8400-e29b-41d4-a716-446655440001",
                    user=mock_user,
                )
            assert "No box-counting analysis" in str(exc_info.value)

    @pytest.mark.django_db
    def test_returns_existing_results(self, mock_user, mock_simulation):
        """Test returning existing box-counting results."""
        mock_simulation.metrics = {
            "box_counting": {
                "dimension": 1.78,
                "r_squared": 0.998,
                "std_error": 0.02,
                "confidence_interval": [1.74, 1.82],
                "parameters": {"points_per_sphere": 100, "precision": 18},
            }
        }

        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            MockSim.objects.get.return_value = mock_simulation

            result = get_box_counting_results_handler(
                simulation_id="660e8400-e29b-41d4-a716-446655440001",
                user=mock_user,
            )

            assert result["dimension"] == 1.78
            assert result["r_squared"] == 0.998


class TestRunFraktalAnalysis:
    """Tests for run_fraktal_analysis tool."""

    def test_requires_project_id(self, mock_user):
        """Test that project_id is required."""
        with pytest.raises(ValueError) as exc_info:
            run_fraktal_analysis_handler(
                simulation_id="660e8400-e29b-41d4-a716-446655440001",
                project_id=None,
                user=mock_user,
            )
        assert "project_id is required" in str(exc_info.value)

    @pytest.mark.django_db
    def test_invalid_model(self, mock_user, mock_project, mock_simulation):
        """Test error with invalid model."""
        with patch("apps.ai_assistant.tools.analysis_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.get.return_value = mock_simulation

            with pytest.raises(ValueError) as exc_info:
                run_fraktal_analysis_handler(
                    simulation_id="660e8400-e29b-41d4-a716-446655440001",
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    model="invalid_model",
                    user=mock_user,
                )
            assert "Invalid model" in str(exc_info.value)

    @pytest.mark.django_db
    def test_invalid_projection_axis(self, mock_user, mock_project, mock_simulation):
        """Test error with invalid projection axis."""
        with patch("apps.ai_assistant.tools.analysis_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.get.return_value = mock_simulation

            with pytest.raises(ValueError) as exc_info:
                run_fraktal_analysis_handler(
                    simulation_id="660e8400-e29b-41d4-a716-446655440001",
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    projection_axis="w",
                    user=mock_user,
                )
            assert "Invalid projection_axis" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_fraktal_creation(self, mock_user, mock_project, mock_simulation):
        """Test successful FRAKTAL analysis creation."""
        with patch("apps.ai_assistant.tools.analysis_tools.Project") as MockProject, \
             patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim, \
             patch("apps.ai_assistant.tools.analysis_tools.FraktalAnalysis") as MockFraktal, \
             patch("apps.fractal_analysis.tasks.run_fraktal_analysis_task") as mock_task:

            MockProject.objects.get.return_value = mock_project
            MockSim.objects.get.return_value = mock_simulation

            mock_analysis = MagicMock()
            mock_analysis.id = "770e8400-e29b-41d4-a716-446655440002"
            MockFraktal.objects.create.return_value = mock_analysis

            mock_task.delay.return_value = MagicMock(id="celery-task-123")

            result = run_fraktal_analysis_handler(
                simulation_id="660e8400-e29b-41d4-a716-446655440001",
                project_id="550e8400-e29b-41d4-a716-446655440000",
                model="granulated_2012",
                npix=10.0,
                dpo=40.0,
                projection_axis="z",
                user=mock_user,
            )

            assert result["status"] == "queued"
            assert "analysis_id" in result
            assert "task_id" in result


class TestRunFraktalFromImage:
    """Tests for run_fraktal_from_image tool."""

    def test_requires_project_id(self, mock_user):
        """Test that project_id is required."""
        with pytest.raises(ValueError) as exc_info:
            run_fraktal_from_image_handler(
                image_base64="dGVzdA==",
                npix=10.0,
                dpo=40.0,
                project_id=None,
                user=mock_user,
            )
        assert "project_id is required" in str(exc_info.value)

    @pytest.mark.django_db
    def test_invalid_base64(self, mock_user, mock_project):
        """Test error with invalid base64 data."""
        with patch("apps.ai_assistant.tools.analysis_tools.Project") as MockProject:
            MockProject.objects.get.return_value = mock_project

            with pytest.raises(ValueError) as exc_info:
                run_fraktal_from_image_handler(
                    image_base64="not_valid_base64!!!",
                    npix=10.0,
                    dpo=40.0,
                    project_id="550e8400-e29b-41d4-a716-446655440000",
                    user=mock_user,
                )
            assert "Invalid base64" in str(exc_info.value)


class TestGetFraktalResults:
    """Tests for get_fraktal_results tool."""

    @pytest.mark.django_db
    def test_analysis_not_found(self, mock_user):
        """Test error when analysis not found."""
        with patch("apps.ai_assistant.tools.analysis_tools.FraktalAnalysis") as MockFraktal:
            from django.core.exceptions import ObjectDoesNotExist

            MockFraktal.DoesNotExist = ObjectDoesNotExist
            MockFraktal.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                get_fraktal_results_handler(
                    analysis_id="770e8400-e29b-41d4-a716-446655440002",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_queued_analysis(self, mock_user):
        """Test status for queued analysis."""
        with patch("apps.ai_assistant.tools.analysis_tools.FraktalAnalysis") as MockFraktal:
            mock_analysis = MagicMock()
            mock_analysis.id = "770e8400-e29b-41d4-a716-446655440002"
            mock_analysis.status = "queued"
            MockFraktal.objects.get.return_value = mock_analysis

            result = get_fraktal_results_handler(
                analysis_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["status"] == "queued"

    @pytest.mark.django_db
    def test_completed_analysis(self, mock_user):
        """Test results for completed analysis."""
        with patch("apps.ai_assistant.tools.analysis_tools.FraktalAnalysis") as MockFraktal:
            mock_analysis = MagicMock()
            mock_analysis.id = "770e8400-e29b-41d4-a716-446655440002"
            mock_analysis.name = "Test FRAKTAL"
            mock_analysis.status = "completed"
            mock_analysis.model = "granulated_2012"
            mock_analysis.source_type = "simulation_projection"
            mock_analysis.simulation = None
            mock_analysis.simulation_id = None
            mock_analysis.execution_time_ms = 500
            mock_analysis.results = {
                "df": 1.78,
                "rg": 45.2,
                "kf": 1.3,
                "npo": 125,
                "ap": 20.5,
            }
            MockFraktal.objects.get.return_value = mock_analysis

            result = get_fraktal_results_handler(
                analysis_id="770e8400-e29b-41d4-a716-446655440002",
                user=mock_user,
            )

            assert result["status"] == "completed"
            assert result["df"] == 1.78
            assert result["rg"] == 45.2
            assert result["kf"] == 1.3


class TestCompareSimulations:
    """Tests for compare_simulations tool."""

    def test_minimum_simulations(self, mock_user):
        """Test error with less than 2 simulations."""
        with pytest.raises(ValueError) as exc_info:
            compare_simulations_handler(
                simulation_ids=["sim-1"],
                user=mock_user,
            )
        assert "At least 2 simulations" in str(exc_info.value)

    def test_maximum_simulations(self, mock_user):
        """Test error with more than 20 simulations."""
        sim_ids = [f"sim-{i}" for i in range(25)]
        with pytest.raises(ValueError) as exc_info:
            compare_simulations_handler(
                simulation_ids=sim_ids,
                user=mock_user,
            )
        assert "Maximum 20 simulations" in str(exc_info.value)

    @pytest.mark.django_db
    def test_simulation_not_found(self, mock_user):
        """Test error when simulation not found."""
        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            from django.core.exceptions import ObjectDoesNotExist

            MockSim.DoesNotExist = ObjectDoesNotExist
            MockSim.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                compare_simulations_handler(
                    simulation_ids=["sim-1", "sim-2"],
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_successful_comparison(self, mock_user):
        """Test successful comparison."""
        with patch("apps.ai_assistant.tools.analysis_tools.Simulation") as MockSim:
            # Create mock simulations
            mock_sims = []
            for i, (df, rg) in enumerate([(1.78, 45.2), (1.82, 48.1), (1.75, 43.8)]):
                sim = MagicMock()
                sim.id = f"sim-{i}"
                sim.name = f"Simulation {i}"
                sim.algorithm = "dla"
                sim.status = "completed"
                sim.parameters = {"n_particles": 1000}
                sim.metrics = {
                    "fractal_dimension": df,
                    "radius_of_gyration": rg,
                    "porosity": 0.85,
                }
                mock_sims.append(sim)

            MockSim.objects.get.side_effect = mock_sims

            result = compare_simulations_handler(
                simulation_ids=["sim-0", "sim-1", "sim-2"],
                metrics=["df", "rg"],
                user=mock_user,
            )

            assert result["simulation_count"] == 3
            assert "statistics" in result
            assert "fractal_dimension" in result["statistics"]
            assert result["statistics"]["fractal_dimension"]["count"] == 3


class TestAnalyzeParametricStudy:
    """Tests for analyze_parametric_study tool."""

    @pytest.mark.django_db
    def test_study_not_found(self, mock_user):
        """Test error when study not found."""
        with patch("apps.ai_assistant.tools.analysis_tools.ParametricStudy") as MockStudy:
            from django.core.exceptions import ObjectDoesNotExist

            MockStudy.DoesNotExist = ObjectDoesNotExist
            MockStudy.objects.get.side_effect = ObjectDoesNotExist()

            with pytest.raises(ValueError) as exc_info:
                analyze_parametric_study_handler(
                    study_id="880e8400-e29b-41d4-a716-446655440003",
                    user=mock_user,
                )
            assert "not found" in str(exc_info.value)

    @pytest.mark.django_db
    def test_no_completed_simulations(self, mock_user):
        """Test result when no simulations completed."""
        with patch("apps.ai_assistant.tools.analysis_tools.ParametricStudy") as MockStudy:
            mock_study = MagicMock()
            mock_study.id = "880e8400-e29b-41d4-a716-446655440003"
            mock_study.name = "Test Study"

            # Create a mock queryset that returns empty on filter
            mock_completed_qs = MagicMock()
            mock_completed_qs.count.return_value = 0
            mock_completed_qs.__iter__ = MagicMock(return_value=iter([]))

            mock_simulations = MagicMock()
            mock_simulations.filter.return_value = mock_completed_qs
            mock_simulations.count.return_value = 5
            mock_study.simulations = mock_simulations

            MockStudy.objects.get.return_value = mock_study

            result = analyze_parametric_study_handler(
                study_id="880e8400-e29b-41d4-a716-446655440003",
                user=mock_user,
            )

            assert result["status"] == "no_completed_simulations"
            assert result["completed_simulations"] == 0


class TestListAnalyses:
    """Tests for list_analyses tool."""

    def test_requires_project_or_simulation(self, mock_user):
        """Test that project_id or simulation_id is required."""
        with pytest.raises(ValueError) as exc_info:
            list_analyses_handler(
                project_id=None,
                simulation_id=None,
                user=mock_user,
            )
        assert "Either project_id or simulation_id is required" in str(exc_info.value)

    @pytest.mark.django_db
    def test_list_by_project(self, mock_user):
        """Test listing analyses by project."""
        with patch("apps.ai_assistant.tools.analysis_tools.FraktalAnalysis") as MockFraktal, \
             patch("apps.ai_assistant.tools.analysis_tools.ImageAnalysis") as MockImage:

            mock_analysis = MagicMock()
            mock_analysis.id = "770e8400-e29b-41d4-a716-446655440002"
            mock_analysis.name = "Test FRAKTAL"
            mock_analysis.model = "granulated_2012"
            mock_analysis.source_type = "uploaded_image"
            mock_analysis.simulation = None
            mock_analysis.simulation_id = None
            mock_analysis.status = "completed"
            mock_analysis.results = {"df": 1.78, "rg": 45.2}
            mock_analysis.created_at = MagicMock()
            mock_analysis.created_at.isoformat.return_value = "2024-01-01T00:00:00"

            mock_fraktal_qs = MagicMock()
            mock_fraktal_qs.filter.return_value = mock_fraktal_qs
            mock_fraktal_qs.__getitem__ = MagicMock(return_value=[mock_analysis])
            MockFraktal.objects.all.return_value = mock_fraktal_qs

            mock_image_qs = MagicMock()
            mock_image_qs.filter.return_value = mock_image_qs
            mock_image_qs.__getitem__ = MagicMock(return_value=[])
            MockImage.objects.all.return_value = mock_image_qs

            result = list_analyses_handler(
                project_id="550e8400-e29b-41d4-a716-446655440000",
                user=mock_user,
            )

            assert result["count"] >= 0
            assert "analyses" in result


class TestComputeTrend:
    """Tests for _compute_trend helper."""

    def test_empty_values(self):
        """Test with empty values."""
        result = _compute_trend([])
        assert result is None

    def test_single_value(self):
        """Test with single value."""
        result = _compute_trend([{"df_mean": 1.78}])
        assert result is None

    def test_stable_trend(self):
        """Test stable trend (small change)."""
        values = [
            {"df_mean": 1.78},
            {"df_mean": 1.79},
            {"df_mean": 1.80},
        ]
        result = _compute_trend(values)
        assert result["direction"] == "stable"

    def test_increasing_trend(self):
        """Test increasing trend."""
        values = [
            {"df_mean": 1.50},
            {"df_mean": 1.70},
            {"df_mean": 1.90},
        ]
        result = _compute_trend(values)
        assert result["direction"] == "increasing"
        assert result["change"] > 0

    def test_decreasing_trend(self):
        """Test decreasing trend."""
        values = [
            {"df_mean": 2.00},
            {"df_mean": 1.70},
            {"df_mean": 1.40},
        ]
        result = _compute_trend(values)
        assert result["direction"] == "decreasing"
        assert result["change"] < 0


class TestToolDefinitions:
    """Tests for tool definition metadata."""

    def test_run_box_counting_definition(self):
        """Test run_box_counting tool definition."""
        assert run_box_counting_tool.name == "run_box_counting"
        assert run_box_counting_tool.category == "analysis"
        assert run_box_counting_tool.is_async is True

    def test_get_box_counting_results_definition(self):
        """Test get_box_counting_results tool definition."""
        assert get_box_counting_results_tool.name == "get_box_counting_results"
        assert get_box_counting_results_tool.category == "query"

    def test_run_fraktal_analysis_definition(self):
        """Test run_fraktal_analysis tool definition."""
        assert run_fraktal_analysis_tool.name == "run_fraktal_analysis"
        assert run_fraktal_analysis_tool.requires_project is True
        assert run_fraktal_analysis_tool.is_async is True

    def test_compare_simulations_definition(self):
        """Test compare_simulations tool definition."""
        assert compare_simulations_tool.name == "compare_simulations"
        assert "compare" in compare_simulations_tool.description.lower()

    def test_analyze_parametric_study_definition(self):
        """Test analyze_parametric_study tool definition."""
        assert analyze_parametric_study_tool.name == "analyze_parametric_study"
        assert analyze_parametric_study_tool.category == "analysis"

    def test_list_analyses_definition(self):
        """Test list_analyses tool definition."""
        assert list_analyses_tool.name == "list_analyses"
        assert list_analyses_tool.category == "query"
