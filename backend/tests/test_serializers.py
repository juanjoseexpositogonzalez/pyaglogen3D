"""Tests for serializers validation."""
import base64
import uuid

import pytest
from rest_framework.exceptions import ValidationError

from apps.fractal_analysis.models import ImageAnalysis
from apps.fractal_analysis.serializers import (
    ComparisonSetCreateSerializer,
    ImageAnalysisCreateSerializer,
)
from apps.projects.models import Project
from apps.simulations.models import Simulation


class TestImageAnalysisCreateSerializer:
    """Tests for ImageAnalysisCreateSerializer validation."""

    def test_valid_base64_image(self, db, project):
        """Test that valid base64 image passes validation."""
        # 1x1 PNG image
        valid_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

        serializer = ImageAnalysisCreateSerializer(data={
            "project": str(project.id),
            "image": valid_png_b64,
            "original_filename": "test.png",
            "original_content_type": "image/png",
            "preprocessing_params": {"threshold": 128},
            "method": "box_counting",
        })

        assert serializer.is_valid(), serializer.errors

    def test_invalid_base64_image(self, db, project):
        """Test that invalid base64 data fails validation."""
        serializer = ImageAnalysisCreateSerializer(data={
            "project": str(project.id),
            "image": "not-valid-base64!!!",
            "original_filename": "test.png",
            "original_content_type": "image/png",
            "preprocessing_params": {"threshold": 128},
            "method": "box_counting",
        })

        assert not serializer.is_valid()
        assert "image" in serializer.errors

    def test_invalid_content_type(self, db, project):
        """Test that invalid content type fails validation."""
        valid_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

        serializer = ImageAnalysisCreateSerializer(data={
            "project": str(project.id),
            "image": valid_png_b64,
            "original_filename": "test.gif",
            "original_content_type": "image/gif",  # Not allowed
            "preprocessing_params": {"threshold": 128},
            "method": "box_counting",
        })

        assert not serializer.is_valid()
        assert "original_content_type" in serializer.errors

    def test_allowed_content_types(self, db, project):
        """Test that all allowed content types pass validation."""
        valid_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

        for content_type in ["image/png", "image/jpeg", "image/tiff", "image/bmp"]:
            serializer = ImageAnalysisCreateSerializer(data={
                "project": str(project.id),
                "image": valid_png_b64,
                "original_filename": "test.img",
                "original_content_type": content_type,
                "preprocessing_params": {"threshold": 128},
                "method": "box_counting",
            })
            assert serializer.is_valid(), f"Content type {content_type} should be valid"


class TestComparisonSetCreateSerializer:
    """Tests for ComparisonSetCreateSerializer validation."""

    def test_valid_comparison_set(self, db, project, simulation, image_analysis):
        """Test creating a comparison set with valid data."""
        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Test Comparison",
            "description": "Test description",
            "simulation_ids": [str(simulation.id)],
            "analysis_ids": [str(image_analysis.id)],
        })

        assert serializer.is_valid(), serializer.errors
        comparison = serializer.save()

        assert comparison.name == "Test Comparison"
        assert comparison.simulations.count() == 1
        assert comparison.analyses.count() == 1

    def test_simulation_from_different_project_fails(self, db, project, simulation):
        """Test that simulations from different projects are rejected."""
        # Create another project with a simulation
        other_project = Project.objects.create(name="Other Project")
        other_simulation = Simulation.objects.create(
            project=other_project,
            algorithm="dla",
            parameters={"n_particles": 100},
            seed=123,
        )

        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Invalid Comparison",
            "simulation_ids": [str(other_simulation.id)],  # Wrong project!
        })

        assert not serializer.is_valid()
        assert "simulation_ids" in serializer.errors

    def test_analysis_from_different_project_fails(self, db, project, image_analysis):
        """Test that analyses from different projects are rejected."""
        # Create another project with an analysis
        other_project = Project.objects.create(name="Other Project")
        other_analysis = ImageAnalysis.objects.create(
            project=other_project,
            original_image=b"test",
            original_filename="test.png",
            original_content_type="image/png",
            preprocessing_params={"threshold": 128},
            method="box_counting",
        )

        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Invalid Comparison",
            "analysis_ids": [str(other_analysis.id)],  # Wrong project!
        })

        assert not serializer.is_valid()
        assert "analysis_ids" in serializer.errors

    def test_nonexistent_simulation_fails(self, db, project):
        """Test that non-existent simulation IDs are rejected."""
        fake_id = str(uuid.uuid4())

        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Invalid Comparison",
            "simulation_ids": [fake_id],
        })

        assert not serializer.is_valid()
        assert "simulation_ids" in serializer.errors

    def test_nonexistent_analysis_fails(self, db, project):
        """Test that non-existent analysis IDs are rejected."""
        fake_id = str(uuid.uuid4())

        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Invalid Comparison",
            "analysis_ids": [fake_id],
        })

        assert not serializer.is_valid()
        assert "analysis_ids" in serializer.errors

    def test_empty_comparison_set_allowed(self, db, project):
        """Test that comparison sets can be created without any items."""
        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Empty Comparison",
        })

        assert serializer.is_valid(), serializer.errors
        comparison = serializer.save()

        assert comparison.simulations.count() == 0
        assert comparison.analyses.count() == 0

    def test_mixed_valid_and_invalid_simulations_fails(self, db, project, simulation):
        """Test that mixing valid and invalid IDs fails validation."""
        other_project = Project.objects.create(name="Other Project")
        other_simulation = Simulation.objects.create(
            project=other_project,
            algorithm="dla",
            parameters={"n_particles": 100},
            seed=456,
        )

        serializer = ComparisonSetCreateSerializer(data={
            "project": str(project.id),
            "name": "Mixed Comparison",
            "simulation_ids": [
                str(simulation.id),  # Valid
                str(other_simulation.id),  # Invalid - wrong project
            ],
        })

        assert not serializer.is_valid()
        assert "simulation_ids" in serializer.errors


class TestParametricStudySerializer:
    """Tests for ParametricStudySerializer validation."""

    def test_valid_sintering_config_fixed(self, db, project):
        """Test valid fixed sintering configuration."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "fixed",
                "coefficient": 0.9,
            },
        })

        assert serializer.is_valid(), serializer.errors

    def test_valid_sintering_config_uniform(self, db, project):
        """Test valid uniform sintering configuration."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "uniform",
                "min": 0.85,
                "max": 0.95,
            },
        })

        assert serializer.is_valid(), serializer.errors

    def test_valid_sintering_config_normal(self, db, project):
        """Test valid normal distribution sintering configuration."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "normal",
                "mean": 0.9,
                "std": 0.05,
            },
        })

        assert serializer.is_valid(), serializer.errors

    def test_invalid_sintering_distribution_type(self, db, project):
        """Test invalid sintering distribution type fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "invalid_type",
            },
        })

        assert not serializer.is_valid()
        assert "sintering_config" in serializer.errors

    def test_invalid_sintering_coefficient_out_of_range(self, db, project):
        """Test sintering coefficient outside valid range fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        # Coefficient too low
        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "fixed",
                "coefficient": 0.4,  # Below 0.5
            },
        })

        assert not serializer.is_valid()
        assert "sintering_config" in serializer.errors

    def test_invalid_sintering_uniform_min_greater_than_max(self, db, project):
        """Test uniform sintering with min > max fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "uniform",
                "min": 0.95,
                "max": 0.85,  # max < min
            },
        })

        assert not serializer.is_valid()
        assert "sintering_config" in serializer.errors

    def test_invalid_sintering_normal_std_out_of_range(self, db, project):
        """Test normal sintering with std outside valid range fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": {
                "distribution_type": "normal",
                "mean": 0.9,
                "std": 0.3,  # Above 0.2
            },
        })

        assert not serializer.is_valid()
        assert "sintering_config" in serializer.errors

    def test_valid_box_counting_params(self, db, project):
        """Test valid box counting parameters."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "include_box_counting": True,
            "box_counting_params": {
                "points_per_sphere": 100,
                "precision": 18,
            },
        })

        assert serializer.is_valid(), serializer.errors

    def test_invalid_box_counting_points_out_of_range(self, db, project):
        """Test box counting with invalid points_per_sphere fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "include_box_counting": True,
            "box_counting_params": {
                "points_per_sphere": 5,  # Below 10
                "precision": 18,
            },
        })

        assert not serializer.is_valid()
        assert "box_counting_params" in serializer.errors

    def test_invalid_box_counting_precision_out_of_range(self, db, project):
        """Test box counting with invalid precision fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "include_box_counting": True,
            "box_counting_params": {
                "points_per_sphere": 100,
                "precision": 25,  # Above 21
            },
        })

        assert not serializer.is_valid()
        assert "box_counting_params" in serializer.errors

    def test_valid_limiting_cases_config(self, db, project):
        """Test valid limiting cases configuration."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "include_limiting_cases": True,
            "limiting_cases_config": {
                "include_boundaries": True,
                "include_theoretical": True,
            },
        })

        assert serializer.is_valid(), serializer.errors

    def test_invalid_limiting_cases_config_unknown_key(self, db, project):
        """Test limiting cases config with unknown key fails."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "include_limiting_cases": True,
            "limiting_cases_config": {
                "unknown_key": True,  # Invalid key
            },
        })

        assert not serializer.is_valid()
        assert "limiting_cases_config" in serializer.errors

    def test_null_configs_allowed(self, db, project):
        """Test that null configs are allowed."""
        from apps.simulations.serializers import ParametricStudySerializer

        serializer = ParametricStudySerializer(data={
            "project": str(project.id),
            "name": "Test Study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "sintering_config": None,
            "box_counting_params": None,
            "limiting_cases_config": None,
        })

        assert serializer.is_valid(), serializer.errors


class TestSimulationSerializer:
    """Tests for SimulationSerializer."""

    def test_name_auto_generation(self, db, project):
        """Test that name is auto-generated when not provided."""
        from apps.simulations.serializers import SimulationSerializer

        serializer = SimulationSerializer(data={
            "algorithm": "dla",
            "parameters": {"n_particles": 100},
            "seed": 42,
        })

        assert serializer.is_valid(), serializer.errors

        # Save to trigger create() with auto-generation
        simulation = serializer.save(project=project)

        assert simulation.name != ""
        assert "DLA" in simulation.name
        assert "Simulation" in simulation.name

    def test_custom_name_preserved(self, db, project):
        """Test that custom name is preserved."""
        from apps.simulations.serializers import SimulationSerializer

        serializer = SimulationSerializer(data={
            "name": "My Custom Name",
            "algorithm": "dla",
            "parameters": {"n_particles": 100},
            "seed": 42,
        })

        assert serializer.is_valid(), serializer.errors
        simulation = serializer.save(project=project)

        assert simulation.name == "My Custom Name"

    def test_blank_name_allowed(self, db, project):
        """Test that blank name triggers auto-generation."""
        from apps.simulations.serializers import SimulationSerializer

        serializer = SimulationSerializer(data={
            "name": "",
            "algorithm": "dla",
            "parameters": {"n_particles": 100},
            "seed": 42,
        })

        assert serializer.is_valid(), serializer.errors
        simulation = serializer.save(project=project)

        # Blank name should trigger auto-generation
        assert "DLA" in simulation.name

    def test_parameter_validation_dla(self, db, project):
        """Test DLA parameter validation."""
        from apps.simulations.serializers import SimulationSerializer

        # Missing n_particles
        serializer = SimulationSerializer(data={
            "algorithm": "dla",
            "parameters": {},
            "seed": 42,
        })

        assert not serializer.is_valid()
        assert "parameters" in serializer.errors

    def test_parameter_validation_n_particles_too_low(self, db, project):
        """Test n_particles minimum validation."""
        from apps.simulations.serializers import SimulationSerializer

        serializer = SimulationSerializer(data={
            "algorithm": "dla",
            "parameters": {"n_particles": 5},  # Below 10
            "seed": 42,
        })

        assert not serializer.is_valid()
        assert "parameters" in serializer.errors

    def test_parameter_validation_n_particles_too_high(self, db, project):
        """Test n_particles maximum validation."""
        from apps.simulations.serializers import SimulationSerializer

        serializer = SimulationSerializer(data={
            "algorithm": "dla",
            "parameters": {"n_particles": 200000},  # Above 100,000
            "seed": 42,
        })

        assert not serializer.is_valid()
        assert "parameters" in serializer.errors
