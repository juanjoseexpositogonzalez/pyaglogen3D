"""Integration tests for the projection-export endpoint's ``mode`` dispatch.

Covers:
- R1: grid mode count
- R2: fibonacci mode count
- R3: legacy backcompat (no ``mode`` field)
- R4: filename convention inside the ZIP
- R5: ``metadata.json`` shape
- R6: sync/async threshold (200 = inclusive sync, 201 = async 202)
- R8: validation rejections (400 codes for bad input)

All requests go through the real DRF viewset via ``APIClient`` so the
observable contract is verified at the HTTP boundary (not only in the
service layer). Uses ``uuid``-keyed users/projects for hermetic fixtures
— no conftest.py, matching the pattern in ``test_csv_import_v2_contract``.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from unittest.mock import patch

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus


# --- Fixture helpers ---------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"proj-modes-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="Projection Modes Test", owner=owner)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_completed_simulation(project: Project, n_particles: int = 8) -> Simulation:
    """Seed a Simulation in the DB with a small CCA-ish geometry.

    We bypass the real CCA algorithm (Rust-heavy, slow) by constructing a
    trivially-connected sphere cluster and saving it as the ``.geometry``
    NumPy payload — exactly what the view's ``_load_geometry`` expects.
    """
    # 8 spheres on a simple cube, radius 1.0
    coords = np.array(
        [
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [2.0, 2.0, 0.0],
            [0.0, 0.0, 2.0],
            [2.0, 0.0, 2.0],
            [0.0, 2.0, 2.0],
            [2.0, 2.0, 2.0],
        ][:n_particles],
        dtype=np.float64,
    )
    radii = np.ones((coords.shape[0], 1), dtype=np.float64)
    geometry = np.hstack([coords, radii])

    buf = io.BytesIO()
    np.save(buf, geometry)

    sim = Simulation.objects.create(
        project=project,
        algorithm="cca",
        parameters={"n_particles": int(coords.shape[0])},
        seed=42,
        status=SimulationStatus.COMPLETED,
        geometry=buf.getvalue(),
        metrics={"radius_of_gyration": 1.0},
    )
    return sim


def _batch_url(project: Project, sim: Simulation) -> str:
    return reverse(
        "project-simulations-projection-batch",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )


# ---------------------------------------------------------------------------
# R3: legacy backcompat
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestLegacyBackcompat:
    def test_no_mode_key_routes_legacy_path(self) -> None:
        """Scenario 3.1: omitted ``mode`` hits the legacy sweep unchanged."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {
                "azimuth_start": 0.0,
                "azimuth_end": 60.0,
                "azimuth_step": 30.0,
                "elevation_start": 0.0,
                "elevation_end": 30.0,
                "elevation_step": 30.0,
            },
            format="json",
        )

        assert response.status_code == 200
        assert response["Content-Type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            names = zf.namelist()
            # R3 evolution: legacy ZIPs now also include metadata.json
            # (additive file; PNG filenames unchanged). Legacy PNG names
            # keep the pre-existing shape — no "proj_" prefix.
            assert "metadata.json" in names
            png_names = [n for n in names if n != "metadata.json"]
            assert all(not n.startswith("proj_") for n in png_names)

    def test_explicit_mode_legacy(self) -> None:
        """Scenario 3.2: ``mode="legacy"`` behaves the same as omission."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {
                "mode": "legacy",
                "azimuth_start": 0.0,
                "azimuth_end": 30.0,
                "azimuth_step": 30.0,
                "elevation_start": 0.0,
                "elevation_end": 30.0,
                "elevation_step": 30.0,
            },
            format="json",
        )
        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            # R3 evolution: legacy mode now also emits metadata.json
            # (additive — PNGs are byte-for-byte unchanged).
            assert "metadata.json" in zf.namelist()

    def test_legacy_metadata_json_has_pixels_per_100nm(self) -> None:
        """Legacy metadata.json exposes ``pixels_per_100nm`` for FRAKTAL.

        R3 evolution: legacy ZIPs now include a metadata.json carrying the
        same scale stamp as grid/fibonacci so downstream FRAKTAL batch
        analysis can auto-calibrate regardless of the mode that produced
        the ZIP.
        """
        user = _make_user()
        project = _make_project(user)
        # Use default diameter in parameters so get_scale_factor_nm returns
        # a positive scale — otherwise pixels_per_100nm is None.
        sim = _make_completed_simulation(project)
        sim.parameters = {"n_particles": 8, "primary_particle_diameter_nm": 20.0}
        sim.save(update_fields=["parameters"])
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {
                "mode": "legacy",
                "azimuth_start": 0.0,
                "azimuth_end": 30.0,
                "azimuth_step": 30.0,
                "elevation_start": 0.0,
                "elevation_end": 30.0,
                "elevation_step": 30.0,
                "format": "png",
            },
            format="json",
        )
        assert response.status_code == 200, response.content
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            assert meta["mode"] == "legacy"
            params = meta["parameters"]
            assert "pixels_per_100nm" in params
            # Only assert positivity when the scale could be computed;
            # ``None`` is still a valid value for edge cases.
            if params["pixels_per_100nm"] is not None:
                assert params["pixels_per_100nm"] > 0


# ---------------------------------------------------------------------------
# R1 / R4 / R5: grid mode (count, filenames, metadata)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGridMode:
    def test_grid_10_5_yields_32_projections(self) -> None:
        """Scenario 1.1: grid ``n_az=10, n_el=5`` → exactly 32 PNGs + metadata."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 10, "n_el": 5, "img_size": 128},
            format="json",
        )
        assert response.status_code == 200, response.content
        assert response["Content-Type"] == "application/zip"

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            names = zf.namelist()
            pngs = [n for n in names if n.endswith(".png")]
            assert len(pngs) == 32, f"expected 32 PNGs, got {len(pngs)}: {pngs}"
            assert "metadata.json" in names

    def test_grid_filenames_match_spec_pattern(self) -> None:
        """R4: each filename matches ``proj_###_Az###_El±###.png``."""
        import re

        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 4, "n_el": 3, "img_size": 128},
            format="json",
        )
        assert response.status_code == 200
        pattern = re.compile(r"^proj_\d{3}_Az\d{3}_El[+-]\d{3}\.png$")
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            pngs = sorted(n for n in zf.namelist() if n.endswith(".png"))
            for name in pngs:
                assert pattern.match(name), f"bad filename: {name}"

    def test_grid_metadata_json_shape(self) -> None:
        """R5: ``metadata.json`` has mode / n_requested / n_generated / directions[]."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 6, "n_el": 3, "img_size": 128},
            format="json",
        )
        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            # 6*(3-2)+2 = 8
            assert meta["mode"] == "grid"
            assert meta["n_requested"] == 8
            assert meta["n_generated"] == 8
            assert len(meta["directions"]) == 8
            assert meta["parameters"]["n_az"] == 6
            assert meta["parameters"]["n_el"] == 3
            # Each direction has required keys
            for d in meta["directions"]:
                assert set(d.keys()) >= {"index", "filename", "azimuth", "elevation"}


# ---------------------------------------------------------------------------
# R2 / R4 / R5: fibonacci mode
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestFibonacciMode:
    def test_fibonacci_n_50_yields_50_projections(self) -> None:
        """Scenario 2.1: ``n=50`` → exactly 50 PNGs."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "fibonacci", "n": 50, "img_size": 128},
            format="json",
        )
        assert response.status_code == 200, response.content
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            pngs = [n for n in zf.namelist() if n.endswith(".png")]
            assert len(pngs) == 50
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            assert meta["mode"] == "fibonacci"
            assert meta["n_generated"] == 50
            assert meta["parameters"]["n"] == 50


# ---------------------------------------------------------------------------
# R6: sync/async threshold
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAsyncThreshold:
    def test_n_201_returns_202_with_job_id(self) -> None:
        """Scenario 6.3: ``n=201`` → HTTP 202 + ``job_id``.

        We mock Celery's ``.delay(...)`` so the test doesn't need a worker.
        The response shape (status code + body keys) is what the contract
        locks in — actual task execution is covered by the unit tests on
        ``build_projections_zip_task`` and on the polling view.
        """
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        fake_task = type("FakeTask", (), {"id": "fake-job-id-12345"})()

        with patch(
            "apps.simulations.tasks.build_projections_zip_task.delay",
            return_value=fake_task,
        ):
            response = client.post(
                _batch_url(project, sim),
                {"mode": "fibonacci", "n": 201, "img_size": 128},
                format="json",
            )

        assert response.status_code == 202, response.content
        body = response.json()
        assert body["job_id"] == "fake-job-id-12345"
        assert body["status"] == "queued"


# ---------------------------------------------------------------------------
# R8: validation rejections
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestModeValidation:
    def _post(self, payload: dict):
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)
        return client.post(_batch_url(project, sim), payload, format="json")

    def test_unknown_mode_rejected(self) -> None:
        """Scenario 8.3: ``mode="nonsense"`` → 400."""
        response = self._post({"mode": "nonsense"})
        assert response.status_code == 400
        assert "mode" in response.json().get("detail", "").lower()

    def test_grid_missing_n_el(self) -> None:
        """Scenario 8.1."""
        response = self._post({"mode": "grid", "n_az": 5})
        assert response.status_code == 400
        assert "n_el" in response.json().get("detail", "")

    def test_grid_missing_n_az(self) -> None:
        response = self._post({"mode": "grid", "n_el": 5})
        assert response.status_code == 400
        assert "n_az" in response.json().get("detail", "")

    def test_fibonacci_missing_n(self) -> None:
        """Scenario 8.2."""
        response = self._post({"mode": "fibonacci"})
        assert response.status_code == 400
        assert response.json().get("detail", "").lower().count(
            "n "
        ) or "'n'" in response.json().get("detail", "")

    def test_grid_n_az_below_minimum(self) -> None:
        """Scenario 8.4."""
        response = self._post({"mode": "grid", "n_az": 0, "n_el": 5})
        assert response.status_code == 400
        assert "n_az" in response.json().get("detail", "")

    def test_grid_n_el_below_minimum(self) -> None:
        """Scenario 8.5."""
        response = self._post({"mode": "grid", "n_az": 5, "n_el": 1})
        assert response.status_code == 400
        assert "n_el" in response.json().get("detail", "")

    def test_fibonacci_n_above_cap(self) -> None:
        """Scenario 8.6: ``n > 10000`` → 400."""
        response = self._post({"mode": "fibonacci", "n": 10001})
        assert response.status_code == 400
        assert "10000" in response.json().get("detail", "")

    def test_fibonacci_n_zero(self) -> None:
        """Scenario 8.7."""
        response = self._post({"mode": "fibonacci", "n": 0})
        assert response.status_code == 400


# ---------------------------------------------------------------------------
# FIX A: modern-path render errors surface as 400 with a descriptive detail
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestModernPathErrorSurfacing:
    def test_projection_export_wraps_render_exceptions_as_400(self) -> None:
        """A failure in ``aglogen_core.project_directions`` must surface as
        HTTP 400 with a ``detail`` field containing the exception message —
        not a 500 that loses all context. This closes the gap where a
        downstream render failure previously leaked as an uninformative
        server error.
        """
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        with patch(
            "aglogen_core.project_directions",
            side_effect=RuntimeError("boom: projection kernel exploded"),
        ):
            response = client.post(
                _batch_url(project, sim),
                {"mode": "grid", "n_az": 4, "n_el": 3, "img_size": 128},
                format="json",
            )

        assert response.status_code == 400, response.content
        body = response.json()
        assert "detail" in body
        assert "boom: projection kernel exploded" in body["detail"]


# ---------------------------------------------------------------------------
# FIX B: img_size actually controls the output pixel dimensions
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestImgSizeDimensions:
    def test_img_size_produces_correct_pixel_dimensions(self) -> None:
        """``img_size`` must produce a PNG with those exact pixel dimensions.

        Previously the renderer hardcoded dpi=150 without a figsize so
        ``img_size=128`` and ``img_size=4096`` emitted identical PNGs.
        """
        from PIL import Image

        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        def _extract_first_png_dims(zip_body: bytes) -> tuple[int, int]:
            with zipfile.ZipFile(io.BytesIO(zip_body)) as zf:
                png_names = sorted(n for n in zf.namelist() if n.endswith(".png"))
                assert png_names, "expected at least one PNG in the ZIP"
                img = Image.open(io.BytesIO(zf.read(png_names[0])))
                return img.size  # (width, height)

        # Small size: 128×128
        response_small = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 2, "n_el": 3, "img_size": 128},
            format="json",
        )
        assert response_small.status_code == 200, response_small.content
        w_small, h_small = _extract_first_png_dims(response_small.content)
        assert (w_small, h_small) == (128, 128), (
            f"expected 128x128 for img_size=128, got {w_small}x{h_small}"
        )

        # Larger size: 512×512
        response_large = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 2, "n_el": 3, "img_size": 512},
            format="json",
        )
        assert response_large.status_code == 200, response_large.content
        w_large, h_large = _extract_first_png_dims(response_large.content)
        assert (w_large, h_large) == (512, 512), (
            f"expected 512x512 for img_size=512, got {w_large}x{h_large}"
        )
