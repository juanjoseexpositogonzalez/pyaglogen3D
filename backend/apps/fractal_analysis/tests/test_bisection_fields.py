"""Tests for PYA-13 Phase 3 — bisection diagnostic fields.

T3.1: Migration 0011 creates 5 new fields on FraktalBatchImage.
T3.2: Model fields match migration choices.
T3.3: persist_batch_results extracts + stores new fields with quality override.
T3.4: batch_image_detail_view includes 5 new fields in drill-down.
T3.5: batch_detail_view computes per-quality counters.
T3.6: mean_df semantic shift + mean_df_inclusive.
"""

from __future__ import annotations

import io
import uuid

import numpy as np
import pytest
from PIL import Image

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"bisection-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="test-bisection", owner=user)


def _make_batch(project, user: User) -> FraktalBatch:
    return FraktalBatch.objects.create(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
    )


def _make_png(size: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


# ============================================================================
# T3.1 — Migration detectable + model fields exist
# ============================================================================


@pytest.mark.django_db
class TestBisectionFieldsExist:
    """T3.1/T3.2: FraktalBatchImage has 5 bisection diagnostic fields."""

    def test_quality_field_exists_with_default(self) -> None:
        """quality CharField with default 'converged' exists on model."""
        field = FraktalBatchImage._meta.get_field("quality")
        assert field is not None
        assert field.default == "converged"
        assert field.max_length == 12

    def test_bisection_iterations_field_is_nullable_int(self) -> None:
        field = FraktalBatchImage._meta.get_field("bisection_iterations")
        assert field.null is True

    def test_bisection_residual_field_is_nullable_float(self) -> None:
        field = FraktalBatchImage._meta.get_field("bisection_residual")
        assert field.null is True

    def test_failure_reason_field_is_nullable_char(self) -> None:
        field = FraktalBatchImage._meta.get_field("failure_reason")
        assert field.null is True
        assert field.max_length == 20

    def test_df_estimate_field_is_nullable_float(self) -> None:
        field = FraktalBatchImage._meta.get_field("df_estimate")
        assert field.null is True

    def test_quality_choices_cover_four_states(self) -> None:
        field = FraktalBatchImage._meta.get_field("quality")
        choice_values = [c[0] for c in field.choices]
        assert set(choice_values) == {"converged", "approximate", "excluded", "failed"}

    def test_failure_reason_choices(self) -> None:
        field = FraktalBatchImage._meta.get_field("failure_reason")
        choice_values = [c[0] for c in field.choices]
        assert set(choice_values) == {
            "no_sign_change",
            "kf_negative",
            "iteration_limit",
        }

    def test_legacy_row_defaults_quality_converged(self) -> None:
        """Legacy-style creation (no quality kwarg) → quality='converged'."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        img = FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy.png",
            dpo_used=25.0,
            image_png=_make_png(),
        )
        assert img.quality == "converged"
        assert img.bisection_iterations is None
        assert img.bisection_residual is None
        assert img.failure_reason is None
        assert img.df_estimate is None


# ============================================================================
# T3.3 — persist_batch_results with quality override
# ============================================================================


@pytest.mark.django_db
class TestPersistBatchQualityOverride:
    """T3.3: persist_batch_results stores new fields + applies quality override."""

    def test_converged_image_stored_with_quality(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        results = [
            {
                "index": 0,
                "filename": "img_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.82,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
                "quality": "converged",
                "bisection_iterations": 12,
                "bisection_residual": 0.04,
                "failure_reason": "none",
                "df_estimate": 1.82,
            }
        ]
        persist_batch_results(batch, results, [_make_png()], dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.quality == "converged"
        assert img.bisection_iterations == 12
        assert img.bisection_residual == pytest.approx(0.04)
        assert img.failure_reason == "none"
        assert img.df_estimate == pytest.approx(1.82)

    def test_approximate_image_stored(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        results = [
            {
                "index": 0,
                "filename": "img_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": None,
                "r_squared": None,
                "n_particles_counted": None,
                "error": None,
                "quality": "approximate",
                "bisection_iterations": 50,
                "bisection_residual": 0.5,
                "failure_reason": "iteration_limit",
                "df_estimate": 1.71,
            }
        ]
        persist_batch_results(batch, results, [_make_png()], dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.quality == "approximate"
        assert img.bisection_iterations == 50
        assert img.bisection_residual == pytest.approx(0.5)
        assert img.failure_reason == "iteration_limit"
        assert img.df_estimate == pytest.approx(1.71)

    def test_error_image_quality_overridden_to_failed(self) -> None:
        """CRITICAL: engine returns quality='converged' for blank/error images.
        Backend MUST override to 'failed' when error field is non-null."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        results = [
            {
                "index": 0,
                "filename": "blank.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": None,
                "r_squared": None,
                "n_particles_counted": None,
                "error": "No particles found in image",
                "quality": "converged",  # Engine bug: says converged for blank
                "bisection_iterations": None,
                "bisection_residual": None,
                "failure_reason": None,
                "df_estimate": None,
            }
        ]
        persist_batch_results(batch, results, [_make_png()], dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.quality == "failed"  # overridden!
        assert img.error == "No particles found in image"

    def test_no_error_no_quality_defaults_to_converged(self) -> None:
        """Legacy result dict without quality field → default 'converged'."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        results = [
            {
                "index": 0,
                "filename": "old.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
                # no quality, bisection_iterations, etc.
            }
        ]
        persist_batch_results(batch, results, [_make_png()], dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.quality == "converged"
        assert img.bisection_iterations is None

    def test_excluded_image_stored(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        results = [
            {
                "index": 0,
                "filename": "img_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": None,
                "prefactor": None,
                "r_squared": None,
                "n_particles_counted": None,
                "error": None,
                "quality": "excluded",
                "bisection_iterations": None,
                "bisection_residual": None,
                "failure_reason": "no_sign_change",
                "df_estimate": None,
            }
        ]
        persist_batch_results(batch, results, [_make_png()], dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img.quality == "excluded"
        assert img.failure_reason == "no_sign_change"
