"""Tests for batch origin-aware autocalibrate (Phase 4 — fraktal-detector-fix).

Covers R-DELTA-E3 scenarios:
- Simulation origin requires sim_dpo_nm (E3.4)
- Simulation origin defaults autocalibrate=OFF (E3.1)
- Simulation origin with explicit autocalibrate override (E3.2)
- External origin keeps autocalibrate=ON (E3.3)
- Missing origin defaults to external (backward compat)
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"origin-{uuid.uuid4()}@example.com",
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


BATCH_URL = "/api/v1/fraktal/analyze-batch/"


# ---------------------------------------------------------------------------
# T4.2/T4.3 — Validation: missing sim_dpo_nm with origin=simulation → 400
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSimulationOriginValidation:
    """E3.4 — origin=simulation without sim_dpo_nm must return 400."""

    def test_simulation_origin_missing_sim_dpo_nm_returns_400(
        self, authenticated_client: APIClient
    ) -> None:
        """POST with origin=simulation but no sim_dpo_nm → 400 with descriptive message."""
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("sim.zip", zip_bytes),
                "origin": "simulation",
                # sim_dpo_nm intentionally absent
            },
            format="multipart",
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "sim_dpo_nm" in detail.lower()

    def test_simulation_origin_non_positive_sim_dpo_nm_returns_400(
        self, authenticated_client: APIClient
    ) -> None:
        """POST with origin=simulation and sim_dpo_nm=0 → 400."""
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("sim.zip", zip_bytes),
                "origin": "simulation",
                "sim_dpo_nm": "0",
            },
            format="multipart",
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "sim_dpo_nm" in detail.lower()

    def test_simulation_origin_invalid_sim_dpo_nm_returns_400(
        self, authenticated_client: APIClient
    ) -> None:
        """POST with origin=simulation and sim_dpo_nm='abc' → 400."""
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("sim.zip", zip_bytes),
                "origin": "simulation",
                "sim_dpo_nm": "abc",
            },
            format="multipart",
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# T4.4/T4.5 — Default autocalibrate by origin
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAutocalibrateDefaultByOrigin:
    """E3.1, E3.2, E3.3 — autocalibrate default depends on origin."""

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_simulation_origin_defaults_autocalibrate_off(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        """E3.1 — origin=simulation, sim_dpo_nm=25 → autocalibrate=False, dpo=25."""
        mock_rust.return_value = _fake_rust_result(2, dpo_used=25.0)
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("sim.zip", zip_bytes),
                "origin": "simulation",
                "sim_dpo_nm": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200, resp.content
        # Verify autocalibrate was False and dpo_hint was 25.0 in the call
        call_args = mock_rust.call_args
        _, autocalibrate_arg, dpo_arg, _ = call_args[0][1:]
        assert autocalibrate_arg is False
        assert dpo_arg == 25.0
        # Calibration source should be "manual"
        data = resp.json()
        assert data["calibration"]["source"] == "manual"

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_simulation_origin_explicit_autocalibrate_override(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        """E3.2 — origin=simulation, sim_dpo_nm=25, autocalibrate_dpo=true → honored."""
        mock_rust.return_value = _fake_rust_result(2, dpo_used=25.0)
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("sim.zip", zip_bytes),
                "origin": "simulation",
                "sim_dpo_nm": "25.0",
                "autocalibrate_dpo": "true",
            },
            format="multipart",
        )
        assert resp.status_code == 200, resp.content
        call_args = mock_rust.call_args
        _, autocalibrate_arg, dpo_arg, _ = call_args[0][1:]
        assert autocalibrate_arg is True

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_external_origin_defaults_autocalibrate_on(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        """E3.3 — origin=external → autocalibrate default unchanged (depends on request)."""
        mock_rust.return_value = _fake_rust_result(2, dpo_used=25.0)
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("ext.zip", zip_bytes),
                "origin": "external",
                "autocalibrate_dpo": "true",
            },
            format="multipart",
        )
        assert resp.status_code == 200, resp.content
        call_args = mock_rust.call_args
        _, autocalibrate_arg, _, _ = call_args[0][1:]
        assert autocalibrate_arg is True

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_missing_origin_defaults_to_external(
        self, mock_rust, authenticated_client: APIClient
    ) -> None:
        """E3.3 — no origin field → defaults to external, autocalibrate from request."""
        mock_rust.return_value = _fake_rust_result(2, dpo_used=25.0)
        zip_bytes = _make_zip_with_metadata(n=2)
        resp = authenticated_client.post(
            BATCH_URL,
            {
                "file": SimpleUploadedFile("legacy.zip", zip_bytes),
                "autocalibrate_dpo": "true",
            },
            format="multipart",
        )
        assert resp.status_code == 200, resp.content
        call_args = mock_rust.call_args
        _, autocalibrate_arg, _, _ = call_args[0][1:]
        assert autocalibrate_arg is True
