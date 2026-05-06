"""Tests for NaN/Inf JSON serialization crash — hotfix post-frente-12.

Production 500 on GET /api/v1/fraktal-status/{job_id}/results/ when
FraktalBatchImage rows contain NaN or Infinity in float fields.

JSON RFC 8259 forbids non-finite floats. Python/Postgres accept them silently,
DRF's JSON renderer crashes with ``ValueError: Out of range float values are
not JSON compliant``.

These tests cover:
1. ``json_safe_float`` pure helper unit tests
2. ``_serialize_batch_from_db`` end-to-end: NaN/Inf DB rows → valid JSON response
3. ``persist_batch_results`` defense-in-depth: NaN engine output → NULL in DB
"""

from __future__ import annotations

import io
import json
import math
import uuid
from unittest.mock import patch

import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import FraktalBatch, FraktalBatchImage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"nan-test-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="test-nan", owner=user)


def _make_png(size: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


class _FakeAsyncResult:
    """Mock for celery.result.AsyncResult."""

    def __init__(self, state: str, result=None, info=None):
        self.state = state
        self.result = result
        self.info = info


# ---------------------------------------------------------------------------
# 1. Unit tests: json_safe_float helper
# ---------------------------------------------------------------------------


class TestJsonSafeFloat:
    """Pure-function tests for json_safe_float."""

    def test_nan_returns_none(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(float("nan")) is None

    def test_positive_infinity_returns_none(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(float("inf")) is None

    def test_negative_infinity_returns_none(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(float("-inf")) is None

    def test_none_passes_through(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(None) is None

    def test_normal_float_passes_through(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(1.75) == 1.75

    def test_zero_passes_through(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(0.0) == 0.0

    def test_negative_float_passes_through(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(-3.14) == -3.14

    def test_integer_passes_through(self) -> None:
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float(42) == 42

    def test_string_passes_through(self) -> None:
        """Non-float types should pass through untouched (TypeError guard)."""
        from apps.fractal_analysis.services.json_safe import json_safe_float

        assert json_safe_float("hello") == "hello"


# ---------------------------------------------------------------------------
# 2. Integration: _serialize_batch_from_db with NaN/Inf in DB
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSerializeBatchNanInf:
    """_serialize_batch_from_db must produce JSON-safe output when DB rows
    contain NaN or Infinity float values."""

    def test_nan_inf_fields_become_null_in_results_endpoint(self) -> None:
        """GET /fraktal-status/{job_id}/results/ returns 200 (not 500)
        when FraktalBatchImage has NaN/Inf float fields.

        This is the exact production crash scenario.
        """
        user = _make_user()
        project = _make_project(user)

        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=1,
            n_successful=0,
            mean_df=None,
            std_df=None,
            median_df=None,
            min_df=None,
            max_df=None,
        )

        # Create image row with NaN and Inf — the production crash scenario
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="fail_bisection.png",
            fractal_dimension=float("nan"),
            prefactor=float("inf"),
            r_squared=float("-inf"),
            n_particles_counted=42,
            rg_nm=float("nan"),
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
            bisection_residual=float("nan"),
            df_estimate=float("inf"),
            quality="excluded",
            bisection_iterations=50,
            failure_reason="no_sign_change",
        )

        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"batch_id": str(batch.id)},
        )

        client = _authed_client(user)
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get("/api/v1/fraktal-status/nan-crash-job/results/")

        # THE BUG: today this returns 500 with ValueError
        assert resp.status_code == 200, (
            f"Expected 200 but got {resp.status_code}. "
            f"NaN/Inf floats crashed the JSON encoder. Body: {resp.content[:500]}"
        )

        data = resp.json()
        img = data["images"][0]

        # All NaN/Inf float fields must be None in JSON
        assert img["fractal_dimension"] is None
        assert img["prefactor"] is None
        assert img["r_squared"] is None
        assert img["rg_nm"] is None
        assert img["bisection_residual"] is None
        assert img["df_estimate"] is None

        # Non-float fields remain untouched
        assert img["n_particles_counted"] == 42
        assert img["quality"] == "excluded"
        assert img["bisection_iterations"] == 50
        assert img["failure_reason"] == "no_sign_change"

    def test_batch_detail_endpoint_with_nan_inf(self) -> None:
        """GET /projects/{pk}/fraktal/batches/{batchId}/ also survives
        NaN/Inf in image rows."""
        user = _make_user()
        project = _make_project(user)

        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=1,
            n_successful=0,
        )

        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="nan_detail.png",
            fractal_dimension=float("nan"),
            prefactor=float("inf"),
            r_squared=float("nan"),
            rg_nm=float("-inf"),
            n_particles_counted=10,
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
            bisection_residual=float("nan"),
            df_estimate=float("inf"),
            quality="failed",
        )

        client = _authed_client(user)
        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/"
        resp = client.get(url)

        assert resp.status_code == 200, (
            f"batch_detail_view crashed with NaN/Inf. "
            f"Status: {resp.status_code}, Body: {resp.content[:500]}"
        )

        data = resp.json()
        img = data["images"][0]
        assert img["fractal_dimension"] is None
        assert img["prefactor"] is None
        assert img["r_squared"] is None
        assert img["rg_nm"] is None

    def test_batch_image_detail_endpoint_with_nan_inf(self) -> None:
        """GET .../images/{index}/ drill-down also survives NaN/Inf."""
        user = _make_user()
        project = _make_project(user)

        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=1,
            n_successful=0,
        )

        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="nan_drill.png",
            fractal_dimension=float("nan"),
            prefactor=float("inf"),
            r_squared=float("-inf"),
            rg_nm=float("nan"),
            n_particles_counted=5,
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
            bisection_residual=float("nan"),
            df_estimate=float("inf"),
            quality="excluded",
        )

        client = _authed_client(user)
        url = f"/api/v1/projects/{project.id}/fraktal/batches/{batch.id}/images/0/"
        resp = client.get(url)

        assert resp.status_code == 200, (
            f"batch_image_detail_view crashed with NaN/Inf. "
            f"Status: {resp.status_code}, Body: {resp.content[:500]}"
        )

        data = resp.json()
        assert data["fractal_dimension"] is None
        assert data["prefactor"] is None
        assert data["r_squared"] is None
        assert data["rg_nm"] is None
        assert data["bisection_residual"] is None
        assert data["df_estimate"] is None


# ---------------------------------------------------------------------------
# 3. Defense-in-depth: persist_batch_results sanitizes at write time
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPersistBatchResultsSanitizesNanInf:
    """persist_batch_results should write NULL (not NaN/Inf) to DB."""

    def test_nan_engine_output_stored_as_null(self) -> None:
        """When engine returns NaN/Inf in float fields, persist_batch_results
        must store NULL in the DB, not the non-finite value."""
        user = _make_user()
        project = _make_project(user)

        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
        )

        # Simulate engine output with NaN/Inf
        image_results = [
            {
                "index": 0,
                "filename": "engine_nan.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": float("nan"),
                "prefactor": float("inf"),
                "r_squared": float("-inf"),
                "n_particles_counted": 42,
                "rg_nm": float("nan"),
                "error": None,
                "quality": "excluded",
                "bisection_iterations": 50,
                "bisection_residual": float("nan"),
                "failure_reason": "no_sign_change",
                "df_estimate": float("inf"),
            }
        ]

        from apps.fractal_analysis.services.batch import persist_batch_results

        persist_batch_results(
            batch,
            image_results,
            [_make_png()],
            dpo_used=25.0,
        )

        img = FraktalBatchImage.objects.get(batch=batch, index=0)

        # All NaN/Inf fields should be NULL in DB
        assert img.fractal_dimension is None, (
            f"fractal_dimension should be None, got {img.fractal_dimension}"
        )
        assert img.prefactor is None, f"prefactor should be None, got {img.prefactor}"
        assert img.r_squared is None, f"r_squared should be None, got {img.r_squared}"
        assert img.rg_nm is None, f"rg_nm should be None, got {img.rg_nm}"
        assert img.bisection_residual is None, (
            f"bisection_residual should be None, got {img.bisection_residual}"
        )
        assert img.df_estimate is None, (
            f"df_estimate should be None, got {img.df_estimate}"
        )

        # Non-float fields remain untouched
        assert img.n_particles_counted == 42
        assert img.bisection_iterations == 50
        assert img.quality == "excluded"
        assert img.failure_reason == "no_sign_change"
