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
# FraktalBatchImage — analysis_input_variant field tests
# ---------------------------------------------------------------------------


class TestAnalysisInputVariantField:
    """Test CharField analysis_input_variant on FraktalBatchImage.

    Covers spec R-DELTA-H: default, accepts both values, verbose_name,
    queryable by value.
    """

    def test_defaults_to_presentation(self, batch):
        """Default value is 'presentation' for rows without explicit variant."""
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
        )
        img.refresh_from_db()
        assert img.analysis_input_variant == "presentation"

    def test_accepts_scientific_value(self, batch):
        """Field stores 'scientific' when explicitly set."""
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="scientific.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
            analysis_input_variant="scientific",
        )
        img.refresh_from_db()
        assert img.analysis_input_variant == "scientific"

    def test_accepts_presentation_value(self, batch):
        """Field stores 'presentation' when explicitly set."""
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="pres.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
            analysis_input_variant="presentation",
        )
        img.refresh_from_db()
        assert img.analysis_input_variant == "presentation"

    def test_queryable_by_variant_value(self, batch):
        """Can filter FraktalBatchImage by analysis_input_variant."""
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="a.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
            analysis_input_variant="scientific",
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="b.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
            analysis_input_variant="presentation",
        )
        sci_count = FraktalBatchImage.objects.filter(
            analysis_input_variant="scientific"
        ).count()
        pres_count = FraktalBatchImage.objects.filter(
            analysis_input_variant="presentation"
        ).count()
        assert sci_count == 1
        assert pres_count == 1

    def test_verbose_name(self):
        """Field has verbose_name per spec."""
        field = FraktalBatchImage._meta.get_field("analysis_input_variant")
        assert field.verbose_name == "Analysis input variant"

    def test_max_length_is_16(self):
        """Field max_length matches migration spec."""
        field = FraktalBatchImage._meta.get_field("analysis_input_variant")
        assert field.max_length == 16


# ---------------------------------------------------------------------------
# FraktalBatchImage — png_scientific_bytes field tests
# ---------------------------------------------------------------------------


class TestPngScientificBytesField:
    """Test the nullable BinaryField png_scientific_bytes on FraktalBatchImage.

    Covers spec R-DELTA-F scenarios: null default, accepts bytes, is_null query,
    and coexistence with existing fields.
    """

    def test_defaults_to_null_when_not_provided(self, batch):
        """Scenario F.1: new field defaults to NULL on create (no value given)."""
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
        )
        img.refresh_from_db()
        assert img.png_scientific_bytes is None

    def test_accepts_bytes_when_provided(self, batch):
        """Scenario F.3: field stores scientific PNG bytes when explicitly set."""
        scientific_data = b"\x89PNG\r\n\x1a\n" + b"\xff\x00\xff\x00" * 50
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="scientific.png",
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 10,
            png_scientific_bytes=scientific_data,
        )
        img.refresh_from_db()
        assert bytes(img.png_scientific_bytes) == scientific_data

    def test_queryable_as_isnull_true_for_legacy_rows(self, batch):
        """Scenario 2.2/2.4: legacy rows (no scientific PNG) are queryable via isnull."""
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy_a.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="legacy_b.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        legacy_count = FraktalBatchImage.objects.filter(
            png_scientific_bytes__isnull=True
        ).count()
        assert legacy_count == 2

    def test_queryable_as_isnull_false_for_new_rows(self, batch):
        """Scenario 2.1: new-mode rows with scientific PNG are queryable."""
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="new_mode.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
            png_scientific_bytes=b"\x89PNG" + b"\xff" * 20,
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="legacy.png",
            dpo_used=25.0,
            image_png=b"\x89PNG",
        )
        with_scientific = FraktalBatchImage.objects.filter(
            png_scientific_bytes__isnull=False
        ).count()
        without_scientific = FraktalBatchImage.objects.filter(
            png_scientific_bytes__isnull=True
        ).count()
        assert with_scientific == 1
        assert without_scientific == 1

    def test_existing_fields_unaffected(self, batch):
        """Verify adding png_scientific_bytes does not break existing fields."""
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="full_row.png",
            azimuth=45.0,
            elevation=30.0,
            fractal_dimension=1.85,
            prefactor=1.2,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            image_png=b"\x89PNG" + b"\x00" * 100,
            png_scientific_bytes=b"\x89PNG" + b"\xff" * 50,
        )
        img.refresh_from_db()
        assert img.fractal_dimension == 1.85
        assert img.prefactor == 1.2
        assert img.r_squared == 0.99
        assert img.n_particles_counted == 42
        assert bytes(img.image_png) == b"\x89PNG" + b"\x00" * 100
        assert bytes(img.png_scientific_bytes) == b"\x89PNG" + b"\xff" * 50

    def test_verbose_name(self):
        """Field has the required verbose_name per spec."""
        field = FraktalBatchImage._meta.get_field("png_scientific_bytes")
        assert field.verbose_name == "Scientific PNG bytes"


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
