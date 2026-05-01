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


# ---------------------------------------------------------------------------
# T4.6 — Persist origin in FraktalBatch model + migration 0009
# ---------------------------------------------------------------------------

from apps.fractal_analysis.models import FraktalBatch  # noqa: E402


class TestMigration0009Structure:
    """Structural tests for migration 0009 — no DB needed."""

    def test_migration_module_exists(self) -> None:
        import importlib

        mod = importlib.import_module(
            "apps.fractal_analysis.migrations.0009_add_origin_field"
        )
        assert hasattr(mod, "Migration")

    def test_depends_on_0008(self) -> None:
        import importlib

        mod = importlib.import_module(
            "apps.fractal_analysis.migrations.0009_add_origin_field"
        )
        deps = mod.Migration.dependencies
        assert any("0008" in d[1] for d in deps)

    def test_single_add_field_operation(self) -> None:
        import importlib

        from django.db import migrations as dj_migrations

        mod = importlib.import_module(
            "apps.fractal_analysis.migrations.0009_add_origin_field"
        )
        ops = mod.Migration.operations
        assert len(ops) == 1
        assert isinstance(ops[0], dj_migrations.AddField)

    def test_field_targets_fraktalbatch(self) -> None:
        import importlib

        mod = importlib.import_module(
            "apps.fractal_analysis.migrations.0009_add_origin_field"
        )
        op = mod.Migration.operations[0]
        assert op.model_name.lower() == "fraktalbatch"

    def test_field_is_charfield_default_external(self) -> None:
        import importlib

        from django.db import models

        mod = importlib.import_module(
            "apps.fractal_analysis.migrations.0009_add_origin_field"
        )
        op = mod.Migration.operations[0]
        field = op.field
        assert isinstance(field, models.CharField)
        assert field.max_length == 16
        assert field.default == "external"


@pytest.mark.django_db
class TestFraktalBatchOriginField:
    """Verify origin field on FraktalBatch model."""

    def test_origin_field_exists_with_default(self) -> None:
        """FraktalBatch.origin defaults to 'external'."""
        from apps.projects.models import Project

        project = Project.objects.create(name="test-origin")
        batch = FraktalBatch.objects.create(
            project=project,
            algorithm="granulated_2012",
            calibration_source="manual",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
        )
        assert batch.origin == "external"

    def test_origin_simulation_persisted(self) -> None:
        """FraktalBatch.origin='simulation' persists correctly."""
        from apps.projects.models import Project

        project = Project.objects.create(name="test-origin-sim")
        batch = FraktalBatch.objects.create(
            project=project,
            algorithm="granulated_2012",
            calibration_source="manual",
            pixels_per_100nm=500.0,
            dpo_used=25.0,
            origin="simulation",
        )
        batch.refresh_from_db()
        assert batch.origin == "simulation"

    @patch("aglogen_core.analyze_fraktal_batch")
    def test_origin_persisted_via_endpoint(self, mock_rust, db) -> None:
        """E3.1 — origin=simulation persisted on FraktalBatch when project present."""
        from apps.projects.models import Project

        mock_rust.return_value = _fake_rust_result(2, dpo_used=25.0)
        project = Project.objects.create(name="persist-origin")
        user = _make_user()
        client = _authed_client(user)
        zip_bytes = _make_zip_with_metadata(n=2)

        resp = client.post(
            f"/api/v1/projects/{project.id}/fraktal/analyze-batch/",
            {
                "file": SimpleUploadedFile("sim.zip", zip_bytes),
                "origin": "simulation",
                "sim_dpo_nm": "25.0",
            },
            format="multipart",
        )
        assert resp.status_code == 200, resp.content
        batch_id = resp.json().get("batch_id")
        assert batch_id is not None
        batch = FraktalBatch.objects.get(id=batch_id)
        assert batch.origin == "simulation"
