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
