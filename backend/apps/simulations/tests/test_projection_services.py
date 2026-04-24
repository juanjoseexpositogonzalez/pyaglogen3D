"""Tests for projection export services (filename, metadata, ZIP).

Covers spec R4 (filenames) and R5 (metadata.json shape + ZIP contents).
"""

import io
import json
import uuid
import zipfile

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus
from apps.simulations.services.projections import (
    build_metadata_json,
    build_projection_filename,
    build_projection_zip,
)


class TestBuildProjectionFilename:
    def test_spec_examples(self):
        # R4 canonical examples
        assert build_projection_filename(7, 45.0, 30.0) == "proj_007_Az045_El+030.png"
        assert build_projection_filename(0, 180.0, -90.0) == "proj_000_Az180_El-090.png"
        assert build_projection_filename(15, 0.0, 0.0) == "proj_015_Az000_El+000.png"

    def test_azimuth_wraps_modulo_360(self):
        assert build_projection_filename(0, 360.0, 0.0) == "proj_000_Az000_El+000.png"
        assert build_projection_filename(0, 450.0, 0.0) == "proj_000_Az090_El+000.png"
        assert build_projection_filename(0, -45.0, 0.0) == "proj_000_Az315_El+000.png"

    def test_elevation_clamped_to_plus_minus_90(self):
        assert build_projection_filename(0, 0.0, 120.0) == "proj_000_Az000_El+090.png"
        assert build_projection_filename(0, 0.0, -120.0) == "proj_000_Az000_El-090.png"

    def test_three_digit_index_padding(self):
        assert build_projection_filename(0, 0.0, 0.0).startswith("proj_000_")
        assert build_projection_filename(42, 0.0, 0.0).startswith("proj_042_")
        assert build_projection_filename(999, 0.0, 0.0).startswith("proj_999_")

    def test_custom_format(self):
        assert (
            build_projection_filename(0, 0.0, 0.0, fmt="svg")
            == "proj_000_Az000_El+000.svg"
        )


class TestBuildMetadataJson:
    def test_shape(self):
        meta = build_metadata_json(
            mode="grid",
            n_requested=8,
            directions=[(0.0, 0.0), (90.0, 0.0), (180.0, 0.0)],
            parameters={"img_size": 512, "n_az": 3, "n_el": 3},
        )
        assert meta["mode"] == "grid"
        assert meta["n_requested"] == 8
        assert meta["n_generated"] == 3
        assert meta["parameters"] == {"img_size": 512, "n_az": 3, "n_el": 3}
        assert len(meta["directions"]) == 3

    def test_directions_entries(self):
        meta = build_metadata_json(
            mode="fibonacci",
            n_requested=2,
            directions=[(45.0, 30.0), (180.0, -90.0)],
            parameters={},
        )
        assert meta["directions"][0] == {
            "index": 0,
            "filename": "proj_000_Az045_El+030.png",
            "azimuth": 45.0,
            "elevation": 30.0,
        }
        assert meta["directions"][1] == {
            "index": 1,
            "filename": "proj_001_Az180_El-090.png",
            "azimuth": 180.0,
            "elevation": -90.0,
        }

    def test_json_serializable(self):
        meta = build_metadata_json(
            mode="grid",
            n_requested=2,
            directions=[(0.0, 0.0)],
            parameters={"img_size": 256},
        )
        # Must round-trip through JSON without error
        s = json.dumps(meta)
        roundtrip = json.loads(s)
        assert roundtrip == meta


class TestBuildProjectionZip:
    def test_contains_all_named_files(self):
        fake_png = b"\x89PNG\r\n\x1a\n" + b"fake-image-data"
        directions = [(0.0, -90.0), (0.0, 0.0), (90.0, 0.0)]
        image_bytes_list = [fake_png] * 3

        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=image_bytes_list,
            mode="grid",
            n_requested=3,
            parameters={"n_az": 3, "n_el": 3},
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = set(zf.namelist())
            assert "proj_000_Az000_El-090.png" in names
            assert "proj_001_Az000_El+000.png" in names
            assert "proj_002_Az090_El+000.png" in names
            assert "metadata.json" in names

    def test_metadata_json_content(self):
        fake_png = b"\x89PNG"
        directions = [(0.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[fake_png],
            mode="fibonacci",
            n_requested=1,
            parameters={"n": 1},
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            with zf.open("metadata.json") as f:
                meta = json.loads(f.read().decode("utf-8"))

        assert meta["mode"] == "fibonacci"
        assert meta["n_generated"] == 1
        assert meta["directions"][0]["filename"] == "proj_000_Az000_El+000.png"

    def test_zip_contents_match_directions_count(self):
        fake_png = b"fake"
        directions = [(float(i * 10), 0.0) for i in range(5)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[fake_png] * 5,
            mode="grid",
            n_requested=5,
            parameters={},
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            # 5 PNGs + 1 metadata.json
            assert len(zf.namelist()) == 6

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError, match="length mismatch"):
            build_projection_zip(
                directions=[(0.0, 0.0), (90.0, 0.0)],
                image_bytes_list=[b"fake"],  # only 1 image for 2 directions
                mode="grid",
                n_requested=2,
                parameters={},
            )

    def test_no_orphan_pngs_all_in_directions(self):
        # R5: every PNG in ZIP is referenced by exactly one metadata directions entry
        fake_png = b"fake"
        directions = [(45.0, 30.0), (90.0, -30.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[fake_png] * 2,
            mode="grid",
            n_requested=2,
            parameters={},
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            png_names = {n for n in zf.namelist() if n.endswith(".png")}
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            meta_filenames = {d["filename"] for d in meta["directions"]}
            assert png_names == meta_filenames


# ---------------------------------------------------------------------------
# Fixture helpers for integration tests (pixels_per_100nm in real metadata)
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"scale-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_project(owner: User) -> Project:
    return Project.objects.create(name="Scale Metadata Test", owner=owner)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_completed_simulation(
    project: Project,
    *,
    parameters: dict | None = None,
) -> Simulation:
    """Seed a Simulation with 8 radius-1 spheres on a cube spanning 0..2."""
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
        ],
        dtype=np.float64,
    )
    radii = np.ones((coords.shape[0], 1), dtype=np.float64)
    geometry = np.hstack([coords, radii])
    buf = io.BytesIO()
    np.save(buf, geometry)
    return Simulation.objects.create(
        project=project,
        algorithm="cca",
        parameters=parameters if parameters is not None else {"n_particles": 8},
        seed=42,
        status=SimulationStatus.COMPLETED,
        geometry=buf.getvalue(),
        metrics={"radius_of_gyration": 1.0},
    )


def _batch_url(project: Project, sim: Simulation) -> str:
    return reverse(
        "project-simulations-projection-batch",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )


# ---------------------------------------------------------------------------
# Scale metadata (pixels_per_100nm) — FRAKTAL automation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPixelsPer100nmMetadata:
    """Root-level ``pixels_per_100nm`` in metadata.json for grid/fibonacci.

    Formula (see views._stamp_scale_metadata):
      max_extent_engine = max(bbox side) + 2*max(radii)
      span_engine       = max_extent_engine * 1.04     # 2% padding per side
      span_nm           = span_engine * scale_factor_nm
      pixels_per_100nm  = 100 * img_size / span_nm

    Fixture: cube span 0..2 on each axis, radius=1 per sphere →
      max_extent_engine = 2 + 2*1 = 4
      span_engine       = 4 * 1.04 = 4.16
    With default diameter=50nm (legacy fallback, scale_factor_nm=25.0):
      span_nm           = 4.16 * 25 = 104
      pixels_per_100nm  ≈ 100 * 512 / 104 ≈ 492.31
    """

    EXPECTED_DEFAULT_SCALE = 100.0 * 512.0 / (4.16 * 25.0)  # ~492.31

    def test_metadata_includes_pixels_per_100nm_for_grid(self) -> None:
        """Grid mode exports must include pixels_per_100nm in metadata."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 5, "n_el": 3, "img_size": 512},
            format="json",
        )

        assert response.status_code == 200, response.content
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))

        params = meta["parameters"]
        assert "pixels_per_100nm" in params
        assert "scale_factor_nm" in params
        assert params["scale_factor_nm"] == pytest.approx(25.0, rel=1e-6)
        assert params["pixels_per_100nm"] == pytest.approx(
            self.EXPECTED_DEFAULT_SCALE, rel=0.05
        )

    def test_metadata_includes_pixels_per_100nm_for_fibonacci(self) -> None:
        """Fibonacci mode exports must include pixels_per_100nm in metadata."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "fibonacci", "n": 10, "img_size": 512},
            format="json",
        )

        assert response.status_code == 200, response.content
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))

        assert meta["parameters"]["pixels_per_100nm"] == pytest.approx(
            self.EXPECTED_DEFAULT_SCALE, rel=0.05
        )

    def test_pixels_per_100nm_constant_across_modes(self) -> None:
        """Value is root-level: same aggregate + same img_size → same scale.

        The scale is a property of the aggregate's 3D bounding box, not
        the direction, so grid and fibonacci exports of the same sim at
        the same img_size yield the same value.
        """
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        resp_grid = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 4, "n_el": 3, "img_size": 512},
            format="json",
        )
        resp_fib = client.post(
            _batch_url(project, sim),
            {"mode": "fibonacci", "n": 20, "img_size": 512},
            format="json",
        )
        assert resp_grid.status_code == 200
        assert resp_fib.status_code == 200

        with zipfile.ZipFile(io.BytesIO(resp_grid.content)) as zf:
            meta_grid = json.loads(zf.read("metadata.json").decode("utf-8"))
        with zipfile.ZipFile(io.BytesIO(resp_fib.content)) as zf:
            meta_fib = json.loads(zf.read("metadata.json").decode("utf-8"))

        assert meta_grid["parameters"]["pixels_per_100nm"] == pytest.approx(
            meta_fib["parameters"]["pixels_per_100nm"], rel=1e-9
        )

    def test_pixels_per_100nm_honors_primary_particle_diameter(self) -> None:
        """Explicit v2 diameter flows through ``get_scale_factor_nm``.

        Doubling the diameter halves pixels_per_100nm (same pixels cover
        2× the physical span).
        """
        user = _make_user()
        project = _make_project(user)
        # v2 schema with explicit diameter = 100 nm → scale_factor_nm = 50
        sim = _make_completed_simulation(
            project,
            parameters={
                "n_particles": 8,
                "primary_particle_diameter_nm": 100.0,
                "parameters_schema_version": "v2",
            },
        )
        client = _authed_client(user)

        response = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 3, "n_el": 2, "img_size": 512},
            format="json",
        )
        assert response.status_code == 200, response.content
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))

        # span_nm = 4.16 * 50 = 208 → pixels_per_100nm ≈ 246.15
        expected = 100.0 * 512.0 / (4.16 * 50.0)
        assert meta["parameters"]["scale_factor_nm"] == pytest.approx(50.0, rel=1e-6)
        assert meta["parameters"]["pixels_per_100nm"] == pytest.approx(
            expected, rel=0.05
        )

    def test_pixels_per_100nm_scales_with_img_size(self) -> None:
        """Doubling img_size doubles pixels_per_100nm (same physical span)."""
        user = _make_user()
        project = _make_project(user)
        sim = _make_completed_simulation(project)
        client = _authed_client(user)

        resp_512 = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 3, "n_el": 2, "img_size": 512},
            format="json",
        )
        resp_1024 = client.post(
            _batch_url(project, sim),
            {"mode": "grid", "n_az": 3, "n_el": 2, "img_size": 1024},
            format="json",
        )
        assert resp_512.status_code == 200
        assert resp_1024.status_code == 200

        with zipfile.ZipFile(io.BytesIO(resp_512.content)) as zf:
            v_512 = json.loads(zf.read("metadata.json"))["parameters"][
                "pixels_per_100nm"
            ]
        with zipfile.ZipFile(io.BytesIO(resp_1024.content)) as zf:
            v_1024 = json.loads(zf.read("metadata.json"))["parameters"][
                "pixels_per_100nm"
            ]

        assert v_1024 == pytest.approx(v_512 * 2.0, rel=1e-6)

    def test_legacy_mode_includes_pixels_per_100nm(self) -> None:
        """R3 evolution (2026-04-24): legacy ZIP now carries metadata.json.

        Before: the legacy sweep wrote a ZIP with no metadata.json.
        After: legacy ZIPs include metadata.json with ``pixels_per_100nm``
        so FRAKTAL batch analysis has parity across all modes. PNG
        filenames and bytes are still preserved (R3 PNG-layer backcompat).
        """
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

        assert response.status_code == 200, response.content
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            assert "metadata.json" in zf.namelist()
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            assert meta["mode"] == "legacy"
            # ``pixels_per_100nm`` is present in the parameters block.
            # The value may be ``None`` when scale can't be derived, but
            # the key must exist.
            assert "pixels_per_100nm" in meta["parameters"]
