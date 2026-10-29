"""Tests for persist_batch_results helper and batch DB integration — Phase 3.

Covers:
- Creating FraktalBatchImage rows with correct data (unit)
- Updating FraktalBatch summary fields from per-image metrics (unit)
- Handling partial failures (some images have error, no Df) (unit)
- PNG bytes round-trip storage (unit)
- Sync path creates FraktalBatch + FraktalBatchImage in DB (integration)
- Sync path returns batch_id in response (integration)
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
        email=f"persist-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name="test-persist", owner=user)


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


def _make_image_results(n: int, dpo_used: float = 25.0) -> list[dict]:
    """Build synthetic per-image result dicts matching _build_batch_response shape."""
    results = []
    for i in range(n):
        results.append(
            {
                "index": i,
                "filename": f"proj_{i:03d}.png",
                "azimuth": float(i * 10),
                "elevation": 0.0,
                "fractal_dimension": 1.70 + 0.01 * i,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        )
    return results


def _make_image_results_with_failures(
    n: int, fail_indices: list[int], dpo_used: float = 25.0
) -> list[dict]:
    """Build results with some failures."""
    results = _make_image_results(n, dpo_used)
    for idx in fail_indices:
        results[idx]["fractal_dimension"] = None
        results[idx]["prefactor"] = None
        results[idx]["r_squared"] = None
        results[idx]["n_particles_counted"] = None
        results[idx]["error"] = f"Analyzer failed for image {idx}"
    return results


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPersistBatchResults:
    """Unit tests for persist_batch_results helper."""

    def test_creates_correct_number_of_image_rows(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(5)
        png_list = [_make_png() for _ in range(5)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        assert FraktalBatchImage.objects.filter(batch=batch).count() == 5

    def test_image_rows_have_correct_metrics(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(3)
        png_list = [_make_png() for _ in range(3)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        img0 = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert img0.filename == "proj_000.png"
        assert img0.fractal_dimension == pytest.approx(1.70)
        assert img0.prefactor == pytest.approx(1.5)
        assert img0.r_squared == pytest.approx(0.99)
        assert img0.n_particles_counted == 42
        assert img0.dpo_used == pytest.approx(25.0)
        assert img0.error == ""
        assert img0.azimuth == pytest.approx(0.0)
        assert img0.elevation == pytest.approx(0.0)

    def test_png_bytes_round_trip(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(1)
        png_bytes = _make_png(64)
        png_list = [png_bytes]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert bytes(img.image_png) == png_bytes

    def test_updates_batch_summary_fields(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results(3)
        png_list = [_make_png() for _ in range(3)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        batch.refresh_from_db()
        assert batch.n_images == 3
        assert batch.n_successful == 3
        expected_dfs = [1.70, 1.71, 1.72]
        assert batch.mean_df == pytest.approx(np.mean(expected_dfs))
        assert batch.std_df == pytest.approx(np.std(expected_dfs, ddof=0))
        assert batch.median_df == pytest.approx(np.median(expected_dfs))
        assert batch.min_df == pytest.approx(min(expected_dfs))
        assert batch.max_df == pytest.approx(max(expected_dfs))

    def test_partial_failure_stats_exclude_failed(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results_with_failures(5, fail_indices=[1, 3])
        png_list = [_make_png() for _ in range(5)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        batch.refresh_from_db()
        assert batch.n_images == 5
        assert batch.n_successful == 3
        # Successful: idx 0 (1.70), 2 (1.72), 4 (1.74)
        successful_dfs = [1.70, 1.72, 1.74]
        assert batch.mean_df == pytest.approx(np.mean(successful_dfs))

    def test_failed_images_have_error_and_null_df(self) -> None:
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        image_results = _make_image_results_with_failures(3, fail_indices=[1])
        png_list = [_make_png() for _ in range(3)]

        persist_batch_results(batch, image_results, png_list, dpo_used=25.0)

        failed_img = FraktalBatchImage.objects.get(batch=batch, index=1)
        assert failed_img.fractal_dimension is None
        assert "failed" in failed_img.error.lower()
        # PNG is still stored even for failed images
        assert len(bytes(failed_img.image_png)) > 0


# ---------------------------------------------------------------------------
# Integration: sync batch path → DB persistence
# ---------------------------------------------------------------------------

import json
import zipfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient


def _project_batch_url(project_id) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/analyze-batch/"


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_zip_with_metadata(n: int = 3, pixels_per_100nm: float = 500.0) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        directions = []
        for i in range(n):
            name = f"proj_{i:03d}_Az{i * 10:03d}_El+000.png"
            zf.writestr(name, _make_png())
            directions.append(
                {
                    "filename": name,
                    "azimuth": float(i * 10),
                    "elevation": 0.0,
                    "index": i,
                }
            )
        zf.writestr(
            "metadata.json",
            json.dumps(
                {
                    "mode": "grid",
                    "n_requested": n,
                    "n_generated": n,
                    "parameters": {"pixels_per_100nm": pixels_per_100nm},
                    "directions": directions,
                }
            ),
        )
    return buf.getvalue()


def _fake_rust_result(n: int, dpo_used: float = 25.0) -> dict:
    return {
        "results": [
            {
                "index": i,
                "fractal_dimension": 1.70 + 0.01 * i,
                "prefactor": 1.5,
                "r_squared": None,
                "n_particles_counted": 42,
                "dpo_used": dpo_used,
                "error": None,
            }
            for i in range(n)
        ],
        "dpo_used": dpo_used,
        "autocalibrate_source": "manual",
        "autocalibrate_image_index": None,
    }


@pytest.mark.django_db
class TestSyncPathPersistsToDB:
    """Integration: sync analyze_batch now creates FraktalBatch + images in DB."""

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_sync_batch_creates_fraktal_batch_row(self, mock_rust) -> None:
        mock_rust.return_value = _fake_rust_result(3)
        user = _make_user()
        project = _make_project(user)
        client = _authed_client(user)

        zip_bytes = _make_zip_with_metadata(n=3, pixels_per_100nm=500.0)
        resp = client.post(
            _project_batch_url(project.id),
            {
                "file": SimpleUploadedFile(
                    "test.zip", zip_bytes, content_type="application/zip"
                ),
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200, resp.content
        data = resp.json()

        # batch_id must be present in response
        assert "batch_id" in data, f"Missing batch_id in response: {data.keys()}"
        batch_id = data["batch_id"]

        # DB row must exist
        batch = FraktalBatch.objects.get(id=batch_id)
        assert batch.n_images == 3
        assert batch.n_successful == 3
        assert batch.algorithm == "granulated_2012"
        assert batch.calibration_source == "metadata"
        assert batch.pixels_per_100nm == 500.0

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_sync_batch_creates_image_rows(self, mock_rust) -> None:
        mock_rust.return_value = _fake_rust_result(3)
        user = _make_user()
        project = _make_project(user)
        client = _authed_client(user)

        zip_bytes = _make_zip_with_metadata(n=3, pixels_per_100nm=500.0)
        resp = client.post(
            _project_batch_url(project.id),
            {
                "file": SimpleUploadedFile(
                    "test.zip", zip_bytes, content_type="application/zip"
                ),
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200
        batch_id = resp.json()["batch_id"]
        batch = FraktalBatch.objects.get(id=batch_id)

        # Image rows must be in DB
        images = FraktalBatchImage.objects.filter(batch=batch).order_by("index")
        assert images.count() == 3
        assert images[0].fractal_dimension == pytest.approx(1.70)
        # PNG bytes are stored
        assert len(bytes(images[0].image_png)) > 0

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_sync_batch_response_still_has_legacy_shape(self, mock_rust) -> None:
        """Backwards-compat: response still contains images, stats, etc."""
        mock_rust.return_value = _fake_rust_result(3)
        user = _make_user()
        project = _make_project(user)
        client = _authed_client(user)

        zip_bytes = _make_zip_with_metadata(n=3, pixels_per_100nm=500.0)
        resp = client.post(
            _project_batch_url(project.id),
            {
                "file": SimpleUploadedFile(
                    "test.zip", zip_bytes, content_type="application/zip"
                ),
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200
        data = resp.json()
        # Legacy shape preserved
        assert "images" in data
        assert "stats" in data
        assert "calibration" in data
        assert len(data["images"]) == 3
        # batch_id also present
        assert "batch_id" in data


# ---------------------------------------------------------------------------
# Integration: async Celery task → DB persistence
# ---------------------------------------------------------------------------

import base64


def _encode_images_for_celery(
    images: list[np.ndarray],
) -> tuple[list[str], list[list[int]]]:
    """Convert numpy arrays to base64 + shapes as the Celery task expects."""
    b64_list = [base64.b64encode(img.tobytes()).decode() for img in images]
    shapes = [list(img.shape) for img in images]
    return b64_list, shapes


@pytest.mark.django_db
class TestAsyncTaskPersistsToDB:
    """Integration: Celery task creates FraktalBatch + images in DB."""

    @patch("aglogen_core.analyze_fraktal_batch")
    @patch("aglogen_core.version", return_value="0.1.0-test")
    def test_celery_task_creates_batch_and_images(
        self, mock_version, mock_rust
    ) -> None:
        mock_rust.return_value = _fake_rust_result(3)
        user = _make_user()
        project = _make_project(user)

        from apps.fractal_analysis.services.batch import extract_zip_images

        zip_bytes = _make_zip_with_metadata(n=3, pixels_per_100nm=500.0)
        images, metadata, filenames = extract_zip_images(zip_bytes)
        b64_list, shapes = _encode_images_for_celery(images)

        from apps.fractal_analysis.tasks import analyze_fraktal_batch_task

        result = analyze_fraktal_batch_task(
            images_npy_b64=b64_list,
            image_shapes=shapes,
            filenames=filenames,
            metadata=metadata,
            pixels_per_100nm=500.0,
            autocalibrate_dpo=False,
            dpo_hint=25.0,
            algorithm="granulated_2012",
            sim_id=None,
            calibration_source="metadata",
            project_id=str(project.id),
            user_id=str(user.id),
        )

        assert "batch_id" in result
        batch = FraktalBatch.objects.get(id=result["batch_id"])
        assert batch.n_images == 3
        assert batch.n_successful == 3
        assert batch.project_id == project.id

        images_db = FraktalBatchImage.objects.filter(batch=batch)
        assert images_db.count() == 3

    @patch("aglogen_core.analyze_fraktal_batch")
    @patch("aglogen_core.version", return_value="0.1.0-test")
    def test_celery_task_result_has_batch_id(self, mock_version, mock_rust) -> None:
        mock_rust.return_value = _fake_rust_result(2)
        user = _make_user()
        project = _make_project(user)

        from apps.fractal_analysis.services.batch import extract_zip_images

        zip_bytes = _make_zip_with_metadata(n=2, pixels_per_100nm=500.0)
        images, metadata, filenames = extract_zip_images(zip_bytes)
        b64_list, shapes = _encode_images_for_celery(images)

        from apps.fractal_analysis.tasks import analyze_fraktal_batch_task

        result = analyze_fraktal_batch_task(
            images_npy_b64=b64_list,
            image_shapes=shapes,
            filenames=filenames,
            metadata=metadata,
            pixels_per_100nm=500.0,
            autocalibrate_dpo=False,
            dpo_hint=25.0,
            algorithm="granulated_2012",
            sim_id=None,
            calibration_source="metadata",
            project_id=str(project.id),
            user_id=str(user.id),
        )

        assert "batch_id" in result
        assert result["n_images"] == 2


# ---------------------------------------------------------------------------
# Polling endpoint — batch_id in SUCCESS payload (T3.4 / T3.5)
# ---------------------------------------------------------------------------

from django.urls import reverse


class _FakeAsyncResult:
    def __init__(self, state: str, info=None, result=None):
        self.state = state
        self.info = info
        self.result = result


@pytest.mark.django_db
class TestPollingBatchIdField:
    """Contract test: polling SUCCESS includes batch_id per spec delta."""

    def test_success_includes_batch_id(self) -> None:
        user = _make_user()
        client = _authed_client(user)
        batch_uuid = str(uuid.uuid4())
        fake = _FakeAsyncResult(
            state="SUCCESS",
            result={"batch_id": batch_uuid, "n_images": 5},
        )
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            url = reverse("fraktal-status", kwargs={"job_id": "job-ok"})
            resp = client.get(url)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "done"
        assert body["batch_id"] == batch_uuid

    def test_failure_has_no_batch_id(self) -> None:
        user = _make_user()
        client = _authed_client(user)
        fake = _FakeAsyncResult(state="FAILURE", info=RuntimeError("boom"))
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            url = reverse("fraktal-status", kwargs={"job_id": "job-fail"})
            resp = client.get(url)
        body = resp.json()
        assert body["status"] == "failed"
        assert "batch_id" not in body

    def test_processing_has_no_batch_id(self) -> None:
        user = _make_user()
        client = _authed_client(user)
        fake = _FakeAsyncResult(state="PENDING")
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            url = reverse("fraktal-status", kwargs={"job_id": "job-pending"})
            resp = client.get(url)
        body = resp.json()
        assert body["status"] == "processing"
        assert "batch_id" not in body
