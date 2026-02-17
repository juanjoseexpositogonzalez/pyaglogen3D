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
