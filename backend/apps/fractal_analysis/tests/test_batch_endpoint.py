"""Integration tests for the FRAKTAL batch endpoint.

Covers the contract surface of:

- ``POST /api/v1/fraktal/analyze-batch/`` — multipart upload, scale
  precedence, sim_id detection, algorithm validation, sync vs async
  dispatch (R1, R2, R4-R7, R9).
- ``GET /api/v1/fraktal-status/{job_id}/`` — Celery state → contract
  mapping (PENDING / PROGRESS / SUCCESS / FAILURE).
- ``GET /api/v1/fraktal-status/{job_id}/results/`` — streams the stored
  batch JSON (R10).
- Legacy single-image endpoint remains reachable (R10).

Rust orchestrator calls are mocked so these tests don't depend on the
shape of synthetic images or the actual FRAKTAL algorithm numerical
output — that surface is owned by the PyO3 smoke tests and the Rust
unit tests.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from unittest.mock import MagicMock, patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"batch-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def authenticated_client(db) -> APIClient:
    return _authed_client(_make_user())


def _make_png(size: int = 32) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


def _make_zip_with_metadata(n: int = 3, pixels_per_100nm: float = 500.0) -> bytes:
    """Build a projection-ZIP-like artifact with metadata.json."""
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


def _make_plain_zip(n: int = 3) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for i in range(n):
            zf.writestr(f"img_{i:03d}.png", _make_png())
    return buf.getvalue()


def _fake_rust_result(n: int, dpo_used: float = 25.0) -> dict:
    """Return a synthetic ``analyze_fraktal_batch`` payload for mocking."""
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


BATCH_URL = "/api/v1/fraktal/analyze-batch/"


# ---------------------------------------------------------------------------
# Sync path (N ≤ 30)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAnalyzeBatchSync:
    @patch("aglogen_core.analyze_fraktal_batch")
    def test_small_zip_with_metadata_sync_success(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        mock_rust.return_value = _fake_rust_result(3)

        zip_bytes = _make_zip_with_metadata(n=3, pixels_per_100nm=500.0)
        resp = authenticated_client.post(
            BATCH_URL,
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
        assert len(data["images"]) == 3
        assert data["calibration"]["source"] == "metadata"
        assert data["calibration"]["pixels_per_100nm"] == 500.0
        # Az/el from metadata.directions is wired through.
        assert data["images"][1]["azimuth"] == 10.0
        assert data["images"][0]["fractal_dimension"] == pytest.approx(1.70)
        assert data["stats"]["n_images"] == 3
        assert data["stats"]["n_successful"] == 3

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_manual_scale_overrides_metadata(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        mock_rust.return_value = _fake_rust_result(2)

        zip_bytes = _make_zip_with_metadata(n=2, pixels_per_100nm=500.0)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("t.zip", zip_bytes),
                "pixels_per_100nm": "300.0",
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200
        calibration = resp.json()["calibration"]
        assert calibration["source"] == "manual"
        assert calibration["pixels_per_100nm"] == 300.0

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_plain_zip_with_manual_scale(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        mock_rust.return_value = _fake_rust_result(3)

        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("manual.zip", _make_plain_zip(3)),
                "pixels_per_100nm": "300.0",
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200
        assert resp.json()["calibration"]["source"] == "manual"

    def test_plain_zip_without_scale_rejected(
        self, authenticated_client: APIClient
    ) -> None:
        resp = authenticated_client.post(
            BATCH_URL,
            {"file": SimpleUploadedFile("x.zip", _make_plain_zip(2))},
            format="multipart",
        )
        assert resp.status_code == 400
        assert "calibration" in resp.json()["detail"].lower()

    def test_missing_file_rejected(self, authenticated_client: APIClient) -> None:
        resp = authenticated_client.post(BATCH_URL, {}, format="multipart")
        assert resp.status_code == 400

    def test_corrupt_zip_rejected(self, authenticated_client: APIClient) -> None:
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("bad.zip", b"garbage-not-a-zip"),
                "pixels_per_100nm": "500",
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 400

    def test_empty_zip_rejected(self, authenticated_client: APIClient) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("readme.txt", b"nothing here")

        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("empty.zip", buf.getvalue()),
                "pixels_per_100nm": "500",
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 400

    def test_invalid_algorithm_rejected(self, authenticated_client: APIClient) -> None:
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("t.zip", _make_zip_with_metadata(2)),
                "algorithm": "nonsense",
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 400

    def test_missing_dpo_without_autocalibrate_rejected(
        self, authenticated_client: APIClient
    ) -> None:
        resp = authenticated_client.post(
            BATCH_URL,
            {"file": SimpleUploadedFile("t.zip", _make_zip_with_metadata(2))},
            format="multipart",
        )
        assert resp.status_code == 400

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_autocalibrate_flag_accepted_without_dpo_hint(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        mock_rust.return_value = _fake_rust_result(2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("t.zip", _make_zip_with_metadata(2)),
                "autocalibrate_dpo": "true",
            },
            format="multipart",
        )
        assert resp.status_code == 200

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_filename_sim_id_auto_detected(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        mock_rust.return_value = _fake_rust_result(2)
        sim_uuid = uuid.uuid4()

        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile(
                    f"{sim_uuid}_projections.zip", _make_zip_with_metadata(2)
                ),
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200
        comparison = resp.json()["comparison"]
        assert comparison is not None
        assert comparison["sim_id"] == str(sim_uuid)

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_manual_sim_id_overrides_filename(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        mock_rust.return_value = _fake_rust_result(2)
        filename_uuid = uuid.uuid4()
        manual_uuid = uuid.uuid4()

        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile(
                    f"{filename_uuid}_x.zip", _make_zip_with_metadata(2)
                ),
                "sim_id": str(manual_uuid),
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200
        comparison = resp.json()["comparison"]
        assert comparison is not None
        assert comparison["sim_id"] == str(manual_uuid)

    def test_invalid_sim_id_rejected(self, authenticated_client: APIClient) -> None:
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("t.zip", _make_zip_with_metadata(2)),
                "sim_id": "not-a-uuid",
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 400

    def test_unauthenticated_rejected(self) -> None:
        client = APIClient()
        resp = client.post(
            BATCH_URL,
            {"file": SimpleUploadedFile("t.zip", _make_zip_with_metadata(2))},
            format="multipart",
        )
        assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Async path (N > 30)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAnalyzeBatchAsync:
    @patch("apps.fractal_analysis.tasks.analyze_fraktal_batch_task.delay")
    def test_large_zip_dispatches_async(
        self, mock_delay, authenticated_client: APIClient
    ) -> None:
        fake_task = MagicMock()
        fake_task.id = "test-job-id"
        mock_delay.return_value = fake_task

        zip_bytes = _make_zip_with_metadata(n=31, pixels_per_100nm=500.0)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("big.zip", zip_bytes),
                "dpo_hint": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["job_id"] == "test-job-id"
        assert body["status"] == "queued"
        mock_delay.assert_called_once()
        # Delay was called with b64-encoded images + shapes.
        kwargs = mock_delay.call_args.kwargs
        assert len(kwargs["images_npy_b64"]) == 31
        assert len(kwargs["image_shapes"]) == 31
        assert kwargs["pixels_per_100nm"] == 500.0
        assert kwargs["algorithm"] == "granulated_2012"
        assert kwargs["calibration_source"] == "metadata"


# ---------------------------------------------------------------------------
# Polling endpoint
# ---------------------------------------------------------------------------


class _FakeAsyncResult:
    def __init__(self, state: str, info=None, result=None):
        self.state = state
        self.info = info
        self.result = result


def _status_url(job_id: str) -> str:
    return reverse("fraktal-status", kwargs={"job_id": job_id})


def _results_url(job_id: str) -> str:
    return reverse("fraktal-results", kwargs={"job_id": job_id})


@pytest.mark.django_db
class TestFraktalStatusPolling:
    def test_unauthenticated_rejected(self) -> None:
        client = APIClient()
        resp = client.get(_status_url("any-id"))
        assert resp.status_code in (401, 403)

    def test_pending_state(self, authenticated_client: APIClient) -> None:
        fake = _FakeAsyncResult(state="PENDING")
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            resp = authenticated_client.get(_status_url("nonexistent"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "processing"
        assert body["progress"] == 0.0
        assert body["stage"] == "autocalibrate"

    def test_progress_state_maps_stage(self, authenticated_client: APIClient) -> None:
        fake = _FakeAsyncResult(
            state="PROGRESS",
            info={
                "progress": 0.5,
                "current": 15,
                "total": 30,
                "stage": "analyzing",
            },
        )
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            resp = authenticated_client.get(_status_url("job-2"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "processing"
        assert body["progress"] == 0.5
        assert body["current"] == 15
        assert body["total"] == 30
        assert body["stage"] == "analyzing"

    def test_success_state_returns_results_url(
        self, authenticated_client: APIClient
    ) -> None:
        fake = _FakeAsyncResult(
            state="SUCCESS",
            result={"results_url": "/api/v1/fraktal-status/job-3/results/"},
        )
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            resp = authenticated_client.get(_status_url("job-3"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "done"
        assert body["results_url"].endswith("/results/")

    def test_failure_state_returns_error(self, authenticated_client: APIClient) -> None:
        fake = _FakeAsyncResult(state="FAILURE", info=RuntimeError("boom"))
        with patch(
            "apps.fractal_analysis.views.AsyncResult",
            return_value=fake,
            create=True,
        ):
            resp = authenticated_client.get(_status_url("job-fail"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "failed"
        assert "boom" in body["error"]


# ---------------------------------------------------------------------------
# Results download endpoint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestFraktalResultsDownload:
    def test_unauthenticated_rejected(self) -> None:
        client = APIClient()
        resp = client.get(_results_url("any"))
        assert resp.status_code in (401, 403)

    def test_missing_file_returns_404(
        self, authenticated_client: APIClient, tmp_path, settings
    ) -> None:
        settings.MEDIA_ROOT = str(tmp_path)
        resp = authenticated_client.get(_results_url("nope"))
        assert resp.status_code == 404

    def test_streams_stored_json(
        self, authenticated_client: APIClient, tmp_path, settings
    ) -> None:
        settings.MEDIA_ROOT = str(tmp_path)
        storage = tmp_path / "fraktal_batches"
        storage.mkdir()
        payload = {"images": [{"index": 0}], "stats": {"n_images": 1}}
        (storage / "task-xyz.json").write_text(json.dumps(payload))

        resp = authenticated_client.get(_results_url("task-xyz"))
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/json"
        assert json.loads(resp.content) == payload


# ---------------------------------------------------------------------------
# Legacy endpoint — R10 (existing single-image viewset untouched)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestLegacyFraktalEndpointUnchanged:
    def test_legacy_list_endpoint_resolves(
        self, authenticated_client: APIClient
    ) -> None:
        """Router-registered ``/api/v1/fraktal/`` still responds (R10)."""
        resp = authenticated_client.get("/api/v1/fraktal/")
        # We don't care about the body; the route must not be 404/500.
        assert resp.status_code in (200, 403)

    def test_analyze_batch_url_reversible(self) -> None:
        """``analyze_batch`` action is reachable via router + extra action."""
        # ``fraktal-analyze-batch`` is the DRF-generated name for the
        # router-registered extra action.
        assert reverse("fraktal-analyze-batch").endswith("/analyze-batch/")
