"""Tests for GET /api/v1/fraktal-status/{job_id}/results/ endpoint.

Covers the hotfix: legacy /results/ endpoint must read from DB (FraktalBatch
+ FraktalBatchImage) instead of the defunct JSON-on-disk path that Phase 3
stopped writing.

Also covers backwards-compat fallback to legacy JSON files for in-flight
batches that completed before the deploy.
"""

from __future__ import annotations

import io
import json
import os
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
        email=f"results-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="test-results", owner=user)


def _make_png(size: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


def _make_batch_with_images(
    project, user: User, n: int = 2, celery_task_id: str | None = None
) -> FraktalBatch:
    """Create a FraktalBatch + N FraktalBatchImage rows in DB."""
    batch = FraktalBatch.objects.create(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
        n_images=n,
        n_successful=n,
        mean_df=1.75,
        std_df=0.02,
        median_df=1.75,
        min_df=1.70,
        max_df=1.80,
    )
    for i in range(n):
        FraktalBatchImage.objects.create(
            batch=batch,
            index=i,
            filename=f"proj_{i:03d}.png",
            azimuth=float(i * 10),
            elevation=0.0,
            fractal_dimension=1.70 + 0.05 * i,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
        )
    return batch


class _FakeAsyncResult:
    """Mock for celery.result.AsyncResult."""

    def __init__(self, state: str, result=None, info=None):
        self.state = state
        self.result = result
        self.info = info


# ---------------------------------------------------------------------------
# Tests: DB path (post-Phase 3)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestFraktalResultsFromDB:
    """fraktal_results_view reads from FraktalBatch DB after Phase 3."""

    def test_returns_200_with_batch_result_shape(self) -> None:
        """GET /fraktal-status/{job_id}/results/ returns 200 when batch
        exists in DB via Celery result → batch_id lookup."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch_with_images(project, user, n=2)

        # Celery task result includes batch_id
        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"batch_id": str(batch.id), "n_images": 2},
        )

        client = _authed_client(user)
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get(f"/api/v1/fraktal-status/test-job-123/results/")

        assert resp.status_code == 200, (
            f"Expected 200, got {resp.status_code}: {resp.content}"
        )
        data = resp.json()

        # FraktalBatchResult shape check
        assert "images" in data
        assert "stats" in data
        assert "calibration" in data
        assert len(data["images"]) == 2

        # images[0] shape
        img0 = data["images"][0]
        assert img0["index"] == 0
        assert img0["filename"] == "proj_000.png"
        assert img0["fractal_dimension"] == pytest.approx(1.70)
        assert img0["prefactor"] == pytest.approx(1.5)
        assert img0["r_squared"] == pytest.approx(0.99)
        assert img0["n_particles_counted"] == 42
        assert img0["error"] is None

        # stats shape
        stats = data["stats"]
        assert stats["n_images"] == 2
        assert stats["n_successful"] == 2
        assert stats["mean_df"] is not None

        # calibration shape
        cal = data["calibration"]
        assert cal["source"] == "metadata"
        assert cal["pixels_per_100nm"] == 500.0
        assert cal["dpo_used"] == 25.0

    def test_returns_404_when_no_batch_and_no_json(self) -> None:
        """GET /results/ returns 404 when no DB batch AND no JSON file."""
        user = _make_user()
        client = _authed_client(user)

        # Celery result has no batch_id
        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"n_images": 5},  # no batch_id
        )

        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get("/api/v1/fraktal-status/no-such-job/results/")

        assert resp.status_code == 404

    def test_batch_id_in_response_when_available(self) -> None:
        """Response includes batch_id field when loaded from DB."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch_with_images(project, user, n=1)

        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"batch_id": str(batch.id), "n_images": 1},
        )

        client = _authed_client(user)
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get(f"/api/v1/fraktal-status/job-with-batch/results/")

        assert resp.status_code == 200
        data = resp.json()
        assert data.get("batch_id") == str(batch.id)

    def test_histogram_and_comparison_fields_present(self) -> None:
        """Response includes histogram (null for n<5) and comparison (null
        when no sim_id) matching frontend FraktalBatchResult shape."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch_with_images(project, user, n=2)

        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"batch_id": str(batch.id), "n_images": 2},
        )

        client = _authed_client(user)
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get("/api/v1/fraktal-status/job-shape/results/")

        assert resp.status_code == 200
        data = resp.json()
        # With only 2 images, histogram should be None (< 5 threshold)
        assert data["histogram"] is None
        # No sim_id on batch → comparison is None
        assert data["comparison"] is None

    def test_celery_pending_returns_404(self) -> None:
        """If Celery task hasn't finished yet, no batch_id → 404."""
        user = _make_user()
        client = _authed_client(user)

        fake_celery = _FakeAsyncResult(state="PENDING")

        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get("/api/v1/fraktal-status/pending-job/results/")

        assert resp.status_code == 404

    def test_batch_with_failed_images_has_null_df(self) -> None:
        """Images with errors have fractal_dimension=None in response."""
        user = _make_user()
        project = _make_project(user)
        batch = FraktalBatch.objects.create(
            project=project,
            created_by=user,
            algorithm="granulated_2012",
            calibration_source="metadata",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            n_images=2,
            n_successful=1,
            mean_df=1.75,
            std_df=0.0,
            median_df=1.75,
            min_df=1.75,
            max_df=1.75,
        )
        # One success, one failure
        FraktalBatchImage.objects.create(
            batch=batch,
            index=0,
            filename="ok.png",
            fractal_dimension=1.75,
            prefactor=1.5,
            r_squared=0.99,
            n_particles_counted=42,
            dpo_used=25.0,
            error="",
            image_png=_make_png(),
        )
        FraktalBatchImage.objects.create(
            batch=batch,
            index=1,
            filename="fail.png",
            fractal_dimension=None,
            prefactor=None,
            r_squared=None,
            n_particles_counted=None,
            dpo_used=25.0,
            error="Analyzer failed for image 1",
            image_png=_make_png(),
        )

        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"batch_id": str(batch.id), "n_images": 2},
        )

        client = _authed_client(user)
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake_celery,
        ):
            resp = client.get("/api/v1/fraktal-status/mixed-job/results/")

        assert resp.status_code == 200
        data = resp.json()
        assert data["images"][0]["fractal_dimension"] == pytest.approx(1.75)
        assert data["images"][1]["fractal_dimension"] is None
        assert data["images"][1]["error"] == "Analyzer failed for image 1"


# ---------------------------------------------------------------------------
# Tests: Legacy JSON fallback (in-flight batches from pre-deploy)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestFraktalResultsLegacyFallback:
    """Legacy JSON file path still works for batches that completed before deploy."""

    def test_falls_back_to_json_when_no_batch_in_celery_result(self, tmp_path) -> None:
        """If Celery result has no batch_id but JSON file exists, serve it."""
        user = _make_user()
        client = _authed_client(user)

        # Write a legacy JSON file
        legacy_payload = {
            "images": [
                {
                    "index": 0,
                    "filename": "legacy.png",
                    "azimuth": None,
                    "elevation": None,
                    "fractal_dimension": 1.80,
                    "prefactor": 1.2,
                    "r_squared": 0.98,
                    "n_particles_counted": 10,
                    "error": None,
                }
            ],
            "stats": {
                "n_images": 1,
                "n_successful": 1,
                "mean_df": 1.80,
                "std_df": 0.0,
                "median_df": 1.80,
                "q1_df": 1.80,
                "q3_df": 1.80,
                "min_df": 1.80,
                "max_df": 1.80,
            },
            "histogram": None,
            "comparison": None,
            "calibration": {
                "source": "manual",
                "pixels_per_100nm": 400.0,
                "dpo_used": 20.0,
                "autocalibrate_image": None,
            },
        }

        job_id = "legacy-job-abc"
        json_path = tmp_path / f"{job_id}.json"
        json_path.write_text(json.dumps(legacy_payload))

        fake_celery = _FakeAsyncResult(
            state="SUCCESS",
            result={"n_images": 1},  # no batch_id
        )

        with (
            patch(
                "apps.fractal_analysis.views.AsyncResult",
                return_value=fake_celery,
            ),
            patch(
                "apps.fractal_analysis.views._fraktal_batches_storage_dir",
                return_value=str(tmp_path),
            ),
        ):
            resp = client.get(f"/api/v1/fraktal-status/{job_id}/results/")

        assert resp.status_code == 200
        # Legacy path returns raw HttpResponse (application/json)
        data = json.loads(resp.content)
        assert data["images"][0]["fractal_dimension"] == 1.80
