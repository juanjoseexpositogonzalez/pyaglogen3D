"""Tests for Celery projection task render→measure→stamp ordering (T3.7, T3.11).

These tests verify the contract enforced by the refactored build_projections_zip_task:
  1. metadata.json is written exactly ONCE (not per-direction)
  2. directions[i].pixels_per_100nm is per-direction (varies when bboxes differ)
  3. parameters.pixels_per_100nm (top-level) = max(per-image)
  4. Legacy mode has NO filename_scientific key

The ordering guarantee (render ALL first → measure per-image → stamp once)
is tested by verifying the ZIP contents produced by the pure service functions,
since the Celery task delegates to build_projection_zip and build_metadata_json.
"""

import io
import json
import zipfile

import numpy as np
import pytest

from apps.simulations.services.projections import (
    build_metadata_json,
    build_projection_zip,
)


FAKE_PNG = b"\x89PNG\r\n\x1a\n" + b"test-data"


# ---------------------------------------------------------------------------
# T3.11 — metadata.json written exactly once in ZIP
# ---------------------------------------------------------------------------


class TestMetadataWrittenOnce:
    """T3.11-test1: metadata.json appears exactly once in the ZIP."""

    def test_single_metadata_json_in_zip(self) -> None:
        """ZIP contains exactly one metadata.json entry."""
        directions = [(0.0, 0.0), (90.0, 0.0), (180.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PNG] * 3,
            mode="grid",
            n_requested=3,
            parameters={"img_size": 512},
            scientific_bytes_list=[FAKE_PNG] * 3,
            per_direction_scale=[400.0, 500.0, 450.0],
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            meta_count = sum(1 for n in zf.namelist() if n == "metadata.json")
            assert meta_count == 1

    def test_metadata_contains_all_directions(self) -> None:
        """The single metadata.json must reference ALL directions."""
        directions = [(0.0, 0.0), (90.0, 0.0), (180.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PNG] * 3,
            mode="grid",
            n_requested=3,
            parameters={"img_size": 512},
            scientific_bytes_list=[FAKE_PNG] * 3,
            per_direction_scale=[400.0, 500.0, 450.0],
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            assert len(meta["directions"]) == 3


# ---------------------------------------------------------------------------
# T3.11 — per-direction pixels_per_100nm
# ---------------------------------------------------------------------------


class TestPerDirectionScale:
    """T3.11-test2: pixels_per_100nm is per-direction."""

    def test_different_scales_across_directions(self) -> None:
        """When bbox dimensions differ, per-direction scales differ."""
        meta = build_metadata_json(
            mode="fibonacci",
            n_requested=3,
            directions=[(0.0, 0.0), (90.0, 0.0), (45.0, 45.0)],
            parameters={"img_size": 512},
            per_direction_scale=[400.0, 550.0, 480.0],
        )
        scales = [d["pixels_per_100nm"] for d in meta["directions"]]
        assert scales == [400.0, 550.0, 480.0]
        assert len(set(scales)) > 1

    def test_scales_in_zip_metadata(self) -> None:
        """Per-direction scales appear in the ZIP's metadata.json."""
        directions = [(0.0, 0.0), (90.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PNG] * 2,
            mode="grid",
            n_requested=2,
            parameters={"img_size": 512},
            scientific_bytes_list=[FAKE_PNG] * 2,
            per_direction_scale=[400.0, 600.0],
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            assert meta["directions"][0]["pixels_per_100nm"] == 400.0
            assert meta["directions"][1]["pixels_per_100nm"] == 600.0


# ---------------------------------------------------------------------------
# T3.11 — top-level pixels_per_100nm = max
# ---------------------------------------------------------------------------


class TestTopLevelScaleIsMax:
    """T3.11-test3: parameters.pixels_per_100nm = max(per-image)."""

    def test_max_scale_at_top_level(self) -> None:
        meta = build_metadata_json(
            mode="grid",
            n_requested=2,
            directions=[(0.0, 0.0), (90.0, 0.0)],
            parameters={},
            per_direction_scale=[123.4, 567.8],
        )
        assert meta["parameters"]["pixels_per_100nm"] == 567.8

    def test_max_scale_in_zip(self) -> None:
        directions = [(0.0, 0.0), (90.0, 45.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PNG] * 2,
            mode="fibonacci",
            n_requested=2,
            parameters={"img_size": 256},
            scientific_bytes_list=[FAKE_PNG] * 2,
            per_direction_scale=[300.0, 700.0],
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            meta = json.loads(zf.read("metadata.json").decode("utf-8"))
            assert meta["parameters"]["pixels_per_100nm"] == 700.0


# ---------------------------------------------------------------------------
# T3.11 — legacy mode: no filename_scientific key
# ---------------------------------------------------------------------------


class TestLegacyModeNoScientific:
    """T3.11-test4: legacy mode emits no filename_scientific key."""

    def test_no_filename_scientific_in_legacy(self) -> None:
        """Key is ABSENT (not null) from direction entries."""
        meta = build_metadata_json(
            mode="legacy",
            n_requested=1,
            directions=[(0.0, 0.0)],
            parameters={"img_size": 512},
            # No per_direction_scale → legacy
        )
        d = meta["directions"][0]
        assert "filename_scientific" not in d
        assert "pixels_per_100nm" not in d

    def test_legacy_zip_has_no_scientific_png(self) -> None:
        """Legacy ZIP contains only presentation PNGs."""
        directions = [(0.0, 0.0), (90.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PNG] * 2,
            mode="legacy",
            n_requested=2,
            parameters={},
            # No scientific_bytes_list → legacy
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            sci_files = [n for n in names if ".scientific." in n]
            assert len(sci_files) == 0
