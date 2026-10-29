"""Phase 5 tests — scientific PNG variant, per-image scale, drill-down flag.

Covers:
- T5.1: ZIP unpack detects *.scientific.png per direction
- T5.2: Persist both png_bytes and png_scientific_bytes
- T5.3: Per-image scale from metadata.directions to engine
- T5.4: ?variant=presentation|scientific on PNG endpoint
- T5.5: Fallback when png_scientific_bytes IS NULL
- T5.6: has_scientific_png flag in drill-down detail

Spec: fraktal-batch-contract-delta.md (R-DELTA-D, R-DELTA-E),
      fraktal-batch-persistence-delta.md (R-DELTA-G, R3 modified).
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile

import numpy as np
import pytest
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.fractal_analysis.models import (
    FraktalBatch,
    FraktalBatchImage,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(**kwargs) -> User:
    email = kwargs.pop("email", f"ep-{uuid.uuid4()}@example.com")
    return User.objects.create_user(email=email, password="irrelevant", **kwargs)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_project(user: User):
    from apps.projects.models import Project

    return Project.objects.create(name=f"proj-{uuid.uuid4()}", owner=user)


def _make_png(size: int = 32, color: int = 128) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (size, size), color).save(buf, format="PNG")
    return buf.getvalue()


def _make_scientific_png(size: int = 32) -> bytes:
    """Create a strictly binary (0/255 only) PNG."""
    arr = np.zeros((size, size), dtype=np.uint8)
    arr[: size // 2, :] = 255  # top half white
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


def _make_batch(project, user: User, **kwargs) -> FraktalBatch:
    defaults = dict(
        project=project,
        created_by=user,
        algorithm="granulated_2012",
        calibration_source="metadata",
        pixels_per_100nm=500.0,
        dpo_used=25.0,
    )
    defaults.update(kwargs)
    return FraktalBatch.objects.create(**defaults)


def _add_images(
    batch: FraktalBatch,
    n: int,
    *,
    png_bytes: bytes | None = None,
    scientific_bytes: bytes | None = None,
) -> list[FraktalBatchImage]:
    """Add N image rows to a batch. Returns the created rows."""
    imgs = []
    for i in range(n):
        imgs.append(
            FraktalBatchImage.objects.create(
                batch=batch,
                index=i,
                filename=f"proj_{i:03d}.png",
                azimuth=float(i * 10),
                elevation=0.0,
                fractal_dimension=1.70 + 0.01 * i,
                prefactor=1.5,
                r_squared=0.99,
                n_particles_counted=42,
                dpo_used=25.0,
                error="",
                image_png=png_bytes or _make_png(),
                png_scientific_bytes=scientific_bytes,
            )
        )
    batch.n_images = n
    batch.n_successful = n
    batch.save()
    return imgs


def _image_png_url(project_id, batch_id, index: int) -> str:
    return (
        f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/png/"
    )


def _image_detail_url(project_id, batch_id, index: int) -> str:
    return f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/images/{index}/"


def _build_zip_with_scientific(
    n_directions: int = 2,
    *,
    per_image_scale: list[float] | None = None,
    include_scientific: bool = True,
    top_level_scale: float = 42.0,
) -> bytes:
    """Build a ZIP in the pyaglogen metadata format.

    Each direction gets a presentation PNG and optionally a scientific PNG.
    metadata.json includes directions[] with per-direction pixels_per_100nm
    when *per_image_scale* is provided.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        directions = []
        for i in range(n_directions):
            base = f"proj_{i:03d}"
            pres_name = f"{base}.png"
            sci_name = f"{base}.scientific.png"

            zf.writestr(pres_name, _make_png())

            d: dict = {
                "filename": pres_name,
                "azimuth": float(i * 36),
                "elevation": 0.0,
            }

            if include_scientific:
                zf.writestr(sci_name, _make_scientific_png())
                d["filename_scientific"] = sci_name

            if per_image_scale is not None and i < len(per_image_scale):
                d["pixels_per_100nm"] = per_image_scale[i]

            directions.append(d)

        metadata = {
            "parameters": {"pixels_per_100nm": top_level_scale},
            "directions": directions,
        }
        zf.writestr("metadata.json", json.dumps(metadata))

    return buf.getvalue()


# ===========================================================================
# T5.3 — Per-image scale extraction from metadata
# ===========================================================================


class TestPerImageScaleExtraction:
    """R-DELTA-C / R1 modified: per-direction pixels_per_100nm."""

    def test_per_image_scales_extracted(self) -> None:
        """Scenario 1.1 — new-mode ZIP: per-image scales consumed."""
        from apps.fractal_analysis.services.batch import extract_per_image_scales

        scales = [42.1, 38.5]
        filenames = ["proj_000.png", "proj_001.png"]
        metadata = {
            "parameters": {"pixels_per_100nm": 42.1},
            "directions": [
                {"filename": "proj_000.png", "pixels_per_100nm": 42.1},
                {"filename": "proj_001.png", "pixels_per_100nm": 38.5},
            ],
        }

        result = extract_per_image_scales(metadata, filenames)
        assert result is not None
        assert result == pytest.approx(scales)

    def test_legacy_zip_returns_none(self) -> None:
        """Scenario 1.2 — legacy ZIP: no per-direction scales."""
        from apps.fractal_analysis.services.batch import extract_per_image_scales

        filenames = ["proj_000.png", "proj_001.png"]
        metadata = {
            "parameters": {"pixels_per_100nm": 42.0},
            "directions": [
                {"filename": "proj_000.png"},
                {"filename": "proj_001.png"},
            ],
        }

        result = extract_per_image_scales(metadata, filenames)
        assert result is None

    def test_mixed_zip_falls_back_to_top_level(self) -> None:
        """Scenario 1.3 — mixed ZIP: partial per-direction scales."""
        from apps.fractal_analysis.services.batch import extract_per_image_scales

        filenames = ["proj_000.png", "proj_001.png"]
        metadata = {
            "parameters": {"pixels_per_100nm": 40.0},
            "directions": [
                {"filename": "proj_000.png", "pixels_per_100nm": 42.1},
                {"filename": "proj_001.png"},  # no per-direction scale
            ],
        }

        result = extract_per_image_scales(metadata, filenames)
        assert result is not None
        assert result[0] == pytest.approx(42.1)
        assert result[1] == pytest.approx(40.0)  # falls back to top-level

    def test_no_metadata_returns_none(self) -> None:
        from apps.fractal_analysis.services.batch import extract_per_image_scales

        result = extract_per_image_scales(None, ["proj_000.png"])
        assert result is None


# ===========================================================================
# T5.1 — ZIP unpack: detect *.scientific.png per direction
# ===========================================================================


@pytest.mark.django_db
class TestZipUnpackScientificPng:
    """R-DELTA-D: ZIP unpack detects *.scientific.png per direction."""

    def test_new_mode_zip_scientific_bytes_extracted(self) -> None:
        """Scenario D.1 — new-mode ZIP: scientific PNG consumed."""
        from apps.fractal_analysis.services.batch import extract_zip_images

        zip_bytes = _build_zip_with_scientific(n_directions=2, include_scientific=True)
        images, metadata, filenames = extract_zip_images(zip_bytes)

        # Should NOT include *.scientific.png in the image list
        # (those are stored separately)
        assert len(images) == 2
        for fn in filenames:
            assert ".scientific.png" not in fn

    def test_legacy_zip_no_scientific_present(self) -> None:
        """Scenario D.2 — legacy ZIP: no scientific PNGs."""
        from apps.fractal_analysis.services.batch import extract_zip_images

        zip_bytes = _build_zip_with_scientific(n_directions=2, include_scientific=False)
        images, metadata, filenames = extract_zip_images(zip_bytes)

        assert len(images) == 2
        for fn in filenames:
            assert ".scientific.png" not in fn

    def test_scientific_png_map_extracted(self) -> None:
        """extract_scientific_png_map returns presentation→scientific mapping."""
        from apps.fractal_analysis.services.batch import (
            extract_scientific_png_map,
            extract_zip_images,
        )

        zip_bytes = _build_zip_with_scientific(n_directions=2, include_scientific=True)
        _images, metadata, _filenames = extract_zip_images(zip_bytes)

        sci_map = extract_scientific_png_map(zip_bytes, metadata)
        assert len(sci_map) == 2
        assert "proj_000.png" in sci_map
        assert "proj_001.png" in sci_map
        # Each value is non-empty bytes
        for v in sci_map.values():
            assert len(v) > 0

    def test_scientific_png_map_empty_for_legacy(self) -> None:
        """Legacy ZIP → empty map."""
        from apps.fractal_analysis.services.batch import (
            extract_scientific_png_map,
            extract_zip_images,
        )

        zip_bytes = _build_zip_with_scientific(n_directions=2, include_scientific=False)
        _images, metadata, _filenames = extract_zip_images(zip_bytes)

        sci_map = extract_scientific_png_map(zip_bytes, metadata)
        assert sci_map == {}


# ===========================================================================
# T5.2 — Persist both PNG variants in FraktalBatchImage
# ===========================================================================


@pytest.mark.django_db
class TestPersistBothPngVariants:
    """R-DELTA-G: batch task stores both png_bytes AND png_scientific_bytes."""

    def test_new_mode_both_bytes_persisted(self) -> None:
        """Scenario G.1 — both fields stored."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        pres = _make_png()
        sci = _make_scientific_png()

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        ]

        persist_batch_results(
            batch,
            image_results,
            [pres],
            dpo_used=25.0,
            scientific_png_list=[sci],
        )

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert bytes(img.image_png) == pres
        assert img.png_scientific_bytes is not None
        assert bytes(img.png_scientific_bytes) == sci

    def test_legacy_mode_scientific_null(self) -> None:
        """Scenario G.2 — legacy ZIP: only presentation stored."""
        from apps.fractal_analysis.services.batch import persist_batch_results

        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)

        pres = _make_png()

        image_results = [
            {
                "index": 0,
                "filename": "proj_000.png",
                "azimuth": 0.0,
                "elevation": 0.0,
                "fractal_dimension": 1.75,
                "prefactor": 1.5,
                "r_squared": 0.99,
                "n_particles_counted": 42,
                "error": None,
            }
        ]

        persist_batch_results(
            batch,
            image_results,
            [pres],
            dpo_used=25.0,
        )

        img = FraktalBatchImage.objects.get(batch=batch, index=0)
        assert bytes(img.image_png) == pres
        assert img.png_scientific_bytes is None


# ===========================================================================
# T5.4 / T5.5 — PNG endpoint ?variant= with fallback
# ===========================================================================


@pytest.mark.django_db
class TestPngVariantEndpoint:
    """R-DELTA-E: PNG endpoint gains ?variant=presentation|scientific."""

    def test_variant_presentation_returns_presentation_bytes(self) -> None:
        """Scenario E.3 — variant=presentation returns png_bytes."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        pres = _make_png(32, 100)
        sci = _make_scientific_png(32)
        _add_images(batch, 1, png_bytes=pres, scientific_bytes=sci)
        client = _authed_client(user)

        url = _image_png_url(project.id, batch.id, 0) + "?variant=presentation"
        resp = client.get(url)
        assert resp.status_code == 200
        assert resp["Content-Type"] == "image/png"
        assert bytes(resp.content) == pres

    def test_variant_scientific_returns_scientific_bytes(self) -> None:
        """Scenario E.1 — variant=scientific returns png_scientific_bytes."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        pres = _make_png(32, 100)
        sci = _make_scientific_png(32)
        _add_images(batch, 1, png_bytes=pres, scientific_bytes=sci)
        client = _authed_client(user)

        url = _image_png_url(project.id, batch.id, 0) + "?variant=scientific"
        resp = client.get(url)
        assert resp.status_code == 200
        assert resp["Content-Type"] == "image/png"
        assert bytes(resp.content) == sci

    def test_variant_scientific_fallback_to_presentation_when_null(self) -> None:
        """Scenario E.2 — variant=scientific falls back for legacy row."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        pres = _make_png(32, 100)
        # scientific_bytes=None (legacy)
        _add_images(batch, 1, png_bytes=pres, scientific_bytes=None)
        client = _authed_client(user)

        url = _image_png_url(project.id, batch.id, 0) + "?variant=scientific"
        resp = client.get(url)
        assert resp.status_code == 200  # NOT 404
        assert bytes(resp.content) == pres

    def test_no_variant_defaults_to_presentation(self) -> None:
        """Scenario E.3 — omitted variant defaults to presentation."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        pres = _make_png(32, 100)
        sci = _make_scientific_png(32)
        _add_images(batch, 1, png_bytes=pres, scientific_bytes=sci)
        client = _authed_client(user)

        url = _image_png_url(project.id, batch.id, 0)
        resp = client.get(url)
        assert resp.status_code == 200
        assert bytes(resp.content) == pres

    def test_invalid_variant_returns_400(self) -> None:
        """Scenario E.5 — unknown variant value rejected."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 1)
        client = _authed_client(user)

        url = _image_png_url(project.id, batch.id, 0) + "?variant=raw"
        resp = client.get(url)
        assert resp.status_code == 400

    def test_cache_headers_on_both_variants(self) -> None:
        """Cache-Control: public, max-age=31536000, immutable for both."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        pres = _make_png(32, 100)
        sci = _make_scientific_png(32)
        _add_images(batch, 1, png_bytes=pres, scientific_bytes=sci)
        client = _authed_client(user)

        for variant in ("presentation", "scientific"):
            url = _image_png_url(project.id, batch.id, 0) + f"?variant={variant}"
            resp = client.get(url)
            assert resp.status_code == 200
            cc = resp.get("Cache-Control", "")
            assert "public" in cc
            assert "max-age=31536000" in cc
            assert "immutable" in cc


# ===========================================================================
# T5.6 — has_scientific_png flag in drill-down detail
# ===========================================================================


@pytest.mark.django_db
class TestDrilldownHasScientificPng:
    """R3 modified: drill-down detail gains has_scientific_png flag."""

    def test_has_scientific_png_true_when_populated(self) -> None:
        """Scenario 3.1 — new-mode batch: has_scientific_png = true."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 1, scientific_bytes=_make_scientific_png())
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert "has_scientific_png" in data
        assert data["has_scientific_png"] is True

    def test_has_scientific_png_false_when_null(self) -> None:
        """Scenario 3.3 — legacy row: has_scientific_png = false."""
        user = _make_user()
        project = _make_project(user)
        batch = _make_batch(project, user)
        _add_images(batch, 1, scientific_bytes=None)
        client = _authed_client(user)

        resp = client.get(_image_detail_url(project.id, batch.id, 0))
        assert resp.status_code == 200
        data = resp.json()
        assert "has_scientific_png" in data
        assert data["has_scientific_png"] is False
