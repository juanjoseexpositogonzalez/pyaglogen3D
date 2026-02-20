"""Tests for Django models."""
import pytest

from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation, SimulationAlgorithm
from apps.fractal_analysis.models import ComparisonSet, FractalMethod, ImageAnalysis


class TestProjectModel:
    """Tests for Project model."""

    def test_create_project(self, db):
        """Test creating a project."""
        project = Project.objects.create(
            name="Test Project",
            description="Description",
        )
        assert project.id is not None
        assert project.name == "Test Project"
        assert project.simulation_count == 0
        assert project.analysis_count == 0

    def test_project_str(self, project):
        """Test project string representation."""
        assert str(project) == project.name


class TestSimulationModel:
    """Tests for Simulation model."""

    def test_create_simulation(self, db, project):
        """Test creating a simulation."""
        simulation = Simulation.objects.create(
            project=project,
            algorithm=SimulationAlgorithm.DLA,
            parameters={"n_particles": 500},
            seed=12345,
        )
        assert simulation.id is not None
        assert simulation.status == "queued"
        assert simulation.geometry is None
        assert simulation.metrics is None

    def test_simulation_with_custom_name(self, db, project):
        """Test creating a simulation with custom name."""
        simulation = Simulation.objects.create(
            project=project,
            name="My Custom Simulation",
            algorithm=SimulationAlgorithm.DLA,
            parameters={"n_particles": 100},
            seed=42,
        )
        assert simulation.name == "My Custom Simulation"
        assert str(simulation) == "My Custom Simulation"

    def test_simulation_name_blank_allowed(self, db, project):
        """Test simulation name can be blank."""
        simulation = Simulation.objects.create(
            project=project,
            name="",
            algorithm=SimulationAlgorithm.DLA,
            parameters={"n_particles": 100},
            seed=42,
        )
        assert simulation.name == ""
        # When name is blank, __str__ falls back to algorithm - status format
        assert "dla" in str(simulation)

    def test_simulation_str(self, simulation):
        """Test simulation string representation."""
        assert "dla" in str(simulation)
        assert "queued" in str(simulation)

    def test_simulation_algorithms(self, db):
        """Test all algorithm choices are valid."""
        assert SimulationAlgorithm.DLA == "dla"
        assert SimulationAlgorithm.CCA == "cca"
        assert SimulationAlgorithm.BALLISTIC == "ballistic"
        assert SimulationAlgorithm.TUNABLE == "tunable"


class TestImageAnalysisModel:
    """Tests for ImageAnalysis model."""

    def test_create_image_analysis(self, db, project):
        """Test creating an image analysis."""
        analysis = ImageAnalysis.objects.create(
            project=project,
            original_image=b"test image data",
            original_filename="test.png",
            original_content_type="image/png",
            preprocessing_params={"threshold": 128},
            method=FractalMethod.BOX_COUNTING,
        )
        assert analysis.id is not None
        assert analysis.status == "queued"
        assert analysis.results is None

    def test_fractal_methods(self, db):
        """Test all fractal method choices are valid."""
        assert FractalMethod.BOX_COUNTING == "box_counting"
        assert FractalMethod.SANDBOX == "sandbox"
        assert FractalMethod.CORRELATION == "correlation"
        assert FractalMethod.LACUNARITY == "lacunarity"
        assert FractalMethod.MULTIFRACTAL == "multifractal"


class TestParametricStudyModel:
    """Tests for ParametricStudy model."""

    def test_create_parametric_study(self, db, project):
        """Test creating a parametric study."""
        study = ParametricStudy.objects.create(
            project=project,
            name="Test Study",
            base_algorithm=SimulationAlgorithm.DLA,
            base_parameters={"sticking_probability": 1.0},
            parameter_grid={"n_particles": [100, 500, 1000]},
        )
        assert study.id is not None
        assert study.status == "queued"
        assert study.simulations.count() == 0

    def test_parametric_study_with_limiting_cases(self, db, project):
        """Test creating a parametric study with limiting cases enabled."""
        study = ParametricStudy.objects.create(
            project=project,
            name="Study with Limiting Cases",
            base_algorithm=SimulationAlgorithm.DLA,
            base_parameters={"sticking_probability": 1.0},
            parameter_grid={"n_particles": [100, 500]},
            include_limiting_cases=True,
            limiting_cases_config={
                "include_boundaries": True,
                "include_theoretical": True,
            },
        )
        assert study.include_limiting_cases is True
        assert study.limiting_cases_config["include_boundaries"] is True

    def test_parametric_study_with_sintering(self, db, project):
        """Test creating a parametric study with sintering configuration."""
        study = ParametricStudy.objects.create(
            project=project,
            name="Study with Sintering",
            base_algorithm=SimulationAlgorithm.DLA,
            base_parameters={"sticking_probability": 1.0},
            parameter_grid={"n_particles": [100, 500]},
            sintering_config={
                "distribution_type": "uniform",
                "min": 0.85,
                "max": 0.95,
            },
        )
        assert study.sintering_config["distribution_type"] == "uniform"
        assert study.sintering_config["min"] == 0.85
        assert study.sintering_config["max"] == 0.95

    def test_parametric_study_with_box_counting(self, db, project):
        """Test creating a parametric study with box-counting enabled."""
        study = ParametricStudy.objects.create(
            project=project,
            name="Study with Box Counting",
            base_algorithm=SimulationAlgorithm.DLA,
            base_parameters={"sticking_probability": 1.0},
            parameter_grid={"n_particles": [100, 500]},
            include_box_counting=True,
            box_counting_params={
                "points_per_sphere": 100,
                "precision": 18,
            },
        )
        assert study.include_box_counting is True
        assert study.box_counting_params["points_per_sphere"] == 100
        assert study.box_counting_params["precision"] == 18

    def test_parametric_study_defaults(self, db, project):
        """Test default values for new batch fields."""
        study = ParametricStudy.objects.create(
            project=project,
            name="Basic Study",
            base_algorithm=SimulationAlgorithm.DLA,
            base_parameters={"sticking_probability": 1.0},
            parameter_grid={"n_particles": [100]},
        )
        assert study.include_limiting_cases is False
        assert study.limiting_cases_config is None
        assert study.sintering_config is None
        assert study.include_box_counting is False
        assert study.box_counting_params is None


class TestComparisonSetModel:
    """Tests for ComparisonSet model."""

    def test_create_comparison_set(self, db, project, simulation, image_analysis):
        """Test creating a comparison set."""
        comparison = ComparisonSet.objects.create(
            project=project,
            name="Test Comparison",
            description="Comparing sim and analysis",
        )
        comparison.simulations.add(simulation)
        comparison.analyses.add(image_analysis)

        assert comparison.id is not None
        assert comparison.simulations.count() == 1
        assert comparison.analyses.count() == 1
