"""Tests for projection export services (filename, metadata, ZIP).

Covers spec R4 (filenames) and R5 (metadata.json shape + ZIP contents).
"""

import io
import json
import zipfile

import pytest

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
