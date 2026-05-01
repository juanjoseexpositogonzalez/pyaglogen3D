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
# T4.2 — RED: missing sim_dpo_nm with origin=simulation → 400
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
