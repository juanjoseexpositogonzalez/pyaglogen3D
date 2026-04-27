"""Unit tests for FraktalBatch + FraktalBatchImage models.

Covers: creation, cascade delete, default values, str repr, BinaryField
storage, unique_together constraint, admin registration.
"""

from __future__ import annotations

import uuid

import pytest
from django.contrib import admin
from django.db import IntegrityError

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage
from apps.projects.models import Project


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(
        email=f"test-{uuid.uuid4()}@example.com",
        password="testpass",
    )


@pytest.fixture
def project(user) -> Project:
    return Project.objects.create(name="Test Project", owner=user)


@pytest.fixture
def batch(project, user) -> FraktalBatch:
    return FraktalBatch.objects.create(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
        n_images=3,
        n_successful=2,
        original_zip_filename="batch_001.zip",
    )


@pytest.fixture
def batch_image(batch) -> FraktalBatchImage:
    return FraktalBatchImage.objects.create(
        batch=batch,
        index=0,
        filename="proj_000_Az000_El+000.png",
        fractal_dimension=1.85,
        prefactor=1.2,
        r_squared=0.99,
        n_particles_counted=42,
        dpo_used=25.0,
        image_png=b"\x89PNG\r\n\x1a\n" + b"\x00" * 100,
    )


# ---------------------------------------------------------------------------
# FraktalBatch tests
# ---------------------------------------------------------------------------


class TestFraktalBatchCreation:
    """Test FraktalBatch model creation and field defaults."""

    def test_create_batch_with_required_fields(self, project, user):
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
        )
        assert batch.pk is not None
        assert isinstance(batch.pk, uuid.UUID)
        assert batch.project == project
        assert batch.created_by == user
        assert batch.algorithm == "granulated_2012"
        assert batch.calibration_source == "metadata"
        assert batch.pixels_per_100nm == 500.0
        assert batch.dpo_used == 25.0

    def test_default_values(self, project, user):
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="voxel_2018",
            calibration_source="manual",
            pixels_per_100nm=300.0,
            dpo_used=30.0,
        )
        assert batch.n_images == 0
        assert batch.n_successful == 0
        assert batch.mean_df is None
        assert batch.std_df is None
        assert batch.median_df is None
        assert batch.min_df is None
        assert batch.max_df is None
        assert batch.autocalibrate_source is None
        assert batch.autocalibrate_image_index is None
        assert batch.sim_id is None
        assert batch.original_zip_filename == ""

    def test_str_representation(self, batch):
        result = str(batch)
        assert "granulated_2012" in result
        assert "3" in result  # n_images

    def test_created_at_auto_set(self, batch):
        assert batch.created_at is not None

    def test_ordering_is_newest_first(self, project, user):
        b1 = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
        )
        b2 = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="voxel_2018",
            calibration_source="manual",
            pixels_per_100nm=300.0,
            dpo_used=30.0,
        )
        batches = list(FraktalBatch.objects.filter(project=project))
        assert batches[0] == b2
        assert batches[1] == b1

    def test_created_by_nullable(self, project):
        """created_by SET_NULL on user delete."""
        user = User.objects.create_user(
            email=f"temp-{uuid.uuid4()}@example.com",
            password="pass",
        )
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
        )
        user.delete()
        batch.refresh_from_db()
        assert batch.created_by is None


# ---------------------------------------------------------------------------
# FraktalBatchImage tests
# ---------------------------------------------------------------------------


class TestFraktalBatchImageCreation:
    """Test FraktalBatchImage model creation and fields."""

    def test_create_image_with_all_fields(self, batch_image):
        assert batch_image.pk is not None
        assert batch_image.batch.pk is not None
        assert batch_image.index == 0
        assert batch_image.filename == "proj_000_Az000_El+000.png"
        assert batch_image.fractal_dimension == 1.85
        assert batch_image.prefactor == 1.2
        assert batch_image.r_squared == 0.99
        assert batch_image.n_particles_counted == 42
        assert batch_image.dpo_used == 25.0
        assert batch_image.error == ""

    def test_png_bytes_stored_and_retrievable(self, batch_image):
        """BinaryField stores and retrieves PNG bytes intact."""
        expected = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        batch_image.refresh_from_db()
        assert bytes(batch_image.image_png) == expected

    def test_error_field_stores_text(self, batch):
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="failed.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
            error="Segmentation failed: no particles found",
        )
        img.refresh_from_db()
        assert img.error == "Segmentation failed: no particles found"
        assert img.fractal_dimension is None

    def test_unique_together_batch_index(self, batch):
        """Cannot create two images with same (batch, index)."""
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="first.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
        )
        with pytest.raises(IntegrityError):
            FraktalBatchImage.objects.create(
                batch=batch,
                index=0,
                filename="duplicate.png",
                dpo_used=25.0,
                image_png=b"\x89PNG" + b"\x00" * 10,
            )

    def test_ordering_by_index(self, batch):
        FraktalBatchImage.objects.create(
            batch=batch,
            index=2,
            filename="c.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="a.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="b.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        images = list(batch.images.all())
        assert [img.index for img in images] == [0, 1, 2]


# ---------------------------------------------------------------------------
# Cascade delete tests
# ---------------------------------------------------------------------------


class TestCascadeDelete:
    """Test cascade behavior on model deletion."""

    def test_delete_batch_cascades_to_images(self, batch):
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="a.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="b.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        batch_pk = batch.pk
        batch.delete()
        assert FraktalBatchImage.objects.filter(batch_id=batch_pk).count() == 0

    def test_delete_project_cascades_to_batches(self, project, user):
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="a.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        project.delete()
        assert FraktalBatch.objects.count() == 0
        assert FraktalBatchImage.objects.count() == 0


# ---------------------------------------------------------------------------
# Admin registration tests
# ---------------------------------------------------------------------------


class TestAdminRegistration:
    """Test Django admin registration for batch models."""

    def test_fraktal_batch_registered_in_admin(self):
        assert FraktalBatch in admin.site._registry

    def test_fraktal_batch_image_registered_in_admin(self):
        assert FraktalBatchImage in admin.site._registry

    def test_fraktal_batch_admin_list_display(self):
        model_admin = admin.site._registry[FraktalBatch]
        assert "id" in model_admin.list_display
        assert "project" in model_admin.list_display
        assert "algorithm" in model_admin.list_display
        assert "n_images" in model_admin.list_display
        assert "created_at" in model_admin.list_display

    def test_fraktal_batch_admin_search_fields(self):
        model_admin = admin.site._registry[FraktalBatch]
        assert "project__name" in model_admin.search_fields

    def test_fraktal_batch_image_admin_list_display(self):
        model_admin = admin.site._registry[FraktalBatchImage]
        assert "filename" in model_admin.list_display
        assert "index" in model_admin.list_display
        assert "batch" in model_admin.list_display

    def test_fraktal_batch_image_admin_readonly_png(self):
        """image_png should be readonly in admin (binary, non-editable)."""
        model_admin = admin.site._registry[FraktalBatchImage]
        assert "image_png" in model_admin.readonly_fields
