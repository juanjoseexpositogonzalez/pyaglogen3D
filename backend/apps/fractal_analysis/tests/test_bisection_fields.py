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


# ============================================================================
# T3.4 — batch_image_detail_view includes 5 new fields
# ============================================================================

from rest_framework.test import APIClient


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestDrillDownBisectionFields:
    """T3.4: batch_image_detail_view includes 5 bisection fields."""

    def test_converged_image_detail_has_all_fields(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="img_000.png",
            dpo_used=25.0,
            image_png=_make_png(),
            fractal_dimension=1.82,
            quality="converged",
            bisection_iterations=12,
            bisection_residual=0.04,
            failure_reason="none",
            df_estimate=1.82,
        )
        client = _authed_client(user)
        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/images/0/"
        resp = client.get(url)
        assert resp.status_code == 200
        data = resp.json()
        assert data["quality"] == "converged"
        assert data["bisection_iterations"] == 12
        assert data["bisection_residual"] == pytest.approx(0.04)
        assert data["failure_reason"] == "none"
        assert data["df_estimate"] == pytest.approx(1.82)

    def test_null_fields_returned_as_json_null(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="legacy.png",
            dpo_used=25.0,
            image_png=_make_png(),
            # no bisection fields set → defaults
        )
        client = _authed_client(user)
        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/images/0/"
        resp = client.get(url)
        assert resp.status_code == 200
        data = resp.json()
        assert data["quality"] == "converged"  # default
        assert data["bisection_iterations"] is None
        assert data["bisection_residual"] is None
        assert data["failure_reason"] is None
        assert data["df_estimate"] is None


# ============================================================================
# T3.5 + T3.6 + T3.7 — Per-batch counters, mean_df_inclusive, semantic shift
# ============================================================================


def _create_mixed_quality_batch(project, user):
    """Create batch with 10 images: 6 converged, 2 approximate, 1 excluded, 1 failed.

    Converged Df values: 1.80, 1.78, 1.82, 1.79, 1.81, 1.80 → mean = 1.80
    Approximate df_estimate: 1.70, 1.72 → mean = 1.71
    """
    batch = _make_batch(project, user)
    converged_dfs = [1.80, 1.78, 1.82, 1.79, 1.81, 1.80]
    approx_dfs = [1.70, 1.72]

    for i, df in enumerate(converged_dfs):
        FraktalBatchImage.objects.create(
            batch=batch,
            index=i,
            filename=f"c_{i}.png",
            dpo_used=25.0,
            image_png=_make_png(),
            fractal_dimension=df,
            quality="converged",
            bisection_iterations=10 + i,
            bisection_residual=0.01 * i,
            failure_reason="none",
            df_estimate=df,
        )
    for j, df in enumerate(approx_dfs):
        idx = len(converged_dfs) + j
        FraktalBatchImage.objects.create(
            batch=batch,
            index=idx,
            filename=f"a_{j}.png",
            dpo_used=25.0,
            image_png=_make_png(),
            fractal_dimension=None,
            quality="approximate",
            bisection_iterations=50,
            bisection_residual=0.5 + 0.1 * j,
            failure_reason="iteration_limit",
            df_estimate=df,
        )
    FraktalBatchImage.objects.create(
        batch=batch,
        index=8,
        filename="excluded.png",
        dpo_used=25.0,
        image_png=_make_png(),
        fractal_dimension=None,
        quality="excluded",
        failure_reason="no_sign_change",
    )
    FraktalBatchImage.objects.create(
        batch=batch,
        index=9,
        filename="failed.png",
        dpo_used=25.0,
        image_png=_make_png(),
        fractal_dimension=None,
        quality="failed",
        failure_reason="kf_negative",
    )
    batch.n_images = 10
    batch.n_successful = 6
    batch.save(update_fields=["n_images", "n_successful"])
    return batch


@pytest.mark.django_db
class TestBatchDetailQualityCounters:
    """T3.5: batch_detail_view stats include quality counters."""

    def test_mixed_batch_counters_correct(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _create_mixed_quality_batch(project, user)
        client = _authed_client(user)

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        assert resp.status_code == 200
        stats = resp.json()["stats"]

        assert stats["n_converged"] == 6
        assert stats["n_approximate"] == 2
        assert stats["n_excluded"] == 1
        assert stats["n_failed"] == 1

    def test_all_converged_counters(self) -> None:
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(5):
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"c_{i}.png",
                dpo_used=25.0,
                image_png=_make_png(),
                fractal_dimension=1.80,
                quality="converged",
            )
        batch.n_images = 5
        batch.n_successful = 5
        batch.save(update_fields=["n_images", "n_successful"])
        client = _authed_client(user)

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        stats = resp.json()["stats"]
        assert stats["n_converged"] == 5
        assert stats["n_approximate"] == 0
        assert stats["n_excluded"] == 0
        assert stats["n_failed"] == 0


@pytest.mark.django_db
class TestMeanDfSemanticShift:
    """T3.6/T3.7: mean_df is converged-only, mean_df_inclusive includes approximate."""

    def test_all_converged_means_equal(self) -> None:
        """Scenario 7.1: all converged → mean_df == mean_df_inclusive."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        dfs = [1.80, 1.78, 1.82]
        for i, df in enumerate(dfs):
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"c_{i}.png",
                dpo_used=25.0,
                image_png=_make_png(),
                fractal_dimension=df,
                quality="converged",
                df_estimate=df,
            )
        batch.n_images = 3
        batch.n_successful = 3
        batch.save(update_fields=["n_images", "n_successful"])
        client = _authed_client(user)

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        stats = resp.json()["stats"]

        expected = float(np.mean(dfs))
        assert stats["mean_df"] == pytest.approx(expected)
        assert stats["mean_df_inclusive"] == pytest.approx(expected)

    def test_mixed_batch_means_differ(self) -> None:
        """Scenario 7.2: mixed → mean_df ≠ mean_df_inclusive."""
        user = _make_user()
        project = _make_project(user)
        batch = _create_mixed_quality_batch(project, user)
        client = _authed_client(user)

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        stats = resp.json()["stats"]

        converged_dfs = [1.80, 1.78, 1.82, 1.79, 1.81, 1.80]
        approx_dfs = [1.70, 1.72]

        assert stats["mean_df"] == pytest.approx(float(np.mean(converged_dfs)))
        assert stats["mean_df_inclusive"] == pytest.approx(
            float(np.mean(converged_dfs + approx_dfs))
        )
        assert stats["mean_df"] != stats["mean_df_inclusive"]

    def test_all_failed_means_null(self) -> None:
        """Scenario 7.3: all failed → both means null."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        for i in range(3):
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"f_{i}.png",
                dpo_used=25.0,
                image_png=_make_png(),
                fractal_dimension=None,
                quality="failed",
            )
        batch.n_images = 3
        batch.n_successful = 0
        batch.save(update_fields=["n_images", "n_successful"])
        client = _authed_client(user)

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        stats = resp.json()["stats"]

        assert stats["mean_df"] is None
        assert stats["mean_df_inclusive"] is None

    def test_all_approximate_mean_df_null_inclusive_present(self) -> None:
        """Scenario 7.5: all approximate → mean_df null, inclusive has value."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        approx_dfs = [1.70, 1.72, 1.68, 1.73, 1.71]
        for i, df in enumerate(approx_dfs):
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"a_{i}.png",
                dpo_used=25.0,
                image_png=_make_png(),
                fractal_dimension=None,
                quality="approximate",
                df_estimate=df,
            )
        batch.n_images = 5
        batch.n_successful = 0
        batch.save(update_fields=["n_images", "n_successful"])
        client = _authed_client(user)

        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)
        stats = resp.json()["stats"]

        assert stats["mean_df"] is None  # no converged
        assert stats["mean_df_inclusive"] == pytest.approx(float(np.mean(approx_dfs)))
