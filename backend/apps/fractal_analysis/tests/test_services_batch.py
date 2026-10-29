"""Unit tests for ``apps.fractal_analysis.services.batch``.

Covers spec requirements R1, R2, R7, R8, R9, R11.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile

import numpy as np
import pytest
from PIL import Image

from apps.fractal_analysis.services.batch import (
    SORENSEN_NOTE,
    build_comparison_data,
    compute_batch_statistics,
    compute_histogram,
    detect_sim_id_from_filename,
    extract_scale_from_metadata,
    extract_zip_images,
)

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_png_bytes(size: int = 50) -> bytes:
    """Return a trivial grayscale PNG as bytes."""
    buf = io.BytesIO()
    Image.new("L", (size, size), 128).save(buf, format="PNG")
    return buf.getvalue()


def _build_zip(
    png_bytes_map: dict[str, bytes] | None = None,
    metadata: dict | None = None,
    extras: dict[str, bytes] | None = None,
) -> bytes:
    """Build an in-memory ZIP with the given PNGs, optional metadata, extras."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in (png_bytes_map or {}).items():
            zf.writestr(name, data)
        if metadata is not None:
            zf.writestr("metadata.json", json.dumps(metadata))
        for name, data in (extras or {}).items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def test_project(db):
    """Local Project fixture (top-level conftest lives in backend/tests/)."""
    from apps.projects.models import Project

    return Project.objects.create(
        name="Services Batch Test Project",
        description="",
    )


# ---------------------------------------------------------------------------
# R1 / R2 — ZIP extraction
# ---------------------------------------------------------------------------


class TestExtractZipImages:
    def test_standard_zip_with_metadata(self):
        zip_bytes = _build_zip(
            png_bytes_map={
                "proj_000_Az000_El-090.png": _make_png_bytes(),
                "proj_001_Az000_El+000.png": _make_png_bytes(),
            },
            metadata={"parameters": {"pixels_per_100nm": 500.0}},
        )
        images, meta, names = extract_zip_images(zip_bytes)

        assert len(images) == 2
        assert all(isinstance(img, np.ndarray) for img in images)
        assert all(img.dtype == np.uint8 for img in images)
        assert all(img.ndim == 2 for img in images)
        assert meta == {"parameters": {"pixels_per_100nm": 500.0}}
        assert names == [
            "proj_000_Az000_El-090.png",
            "proj_001_Az000_El+000.png",
        ]

    def test_png_filenames_sorted(self):
        # Insertion order intentionally not alphabetical.
        zip_bytes = _build_zip(
            png_bytes_map={
                "c.png": _make_png_bytes(),
                "a.png": _make_png_bytes(),
                "b.png": _make_png_bytes(),
            },
        )
        _, _, names = extract_zip_images(zip_bytes)
        assert names == ["a.png", "b.png", "c.png"]

    def test_zip_without_metadata(self):
        zip_bytes = _build_zip(png_bytes_map={"a.png": _make_png_bytes()})
        images, meta, names = extract_zip_images(zip_bytes)
        assert len(images) == 1
        assert meta is None
        assert names == ["a.png"]

    def test_zip_with_mixed_contents_filters_non_png(self):
        zip_bytes = _build_zip(
            png_bytes_map={"img.png": _make_png_bytes()},
            extras={"readme.txt": b"ignore me", "data.csv": b"x,y"},
        )
        images, meta, names = extract_zip_images(zip_bytes)
        assert len(images) == 1
        assert names == ["img.png"]
        assert "readme.txt" not in names
        assert "data.csv" not in names

    def test_empty_zip_raises(self):
        with pytest.raises(ValueError, match="no PNG"):
            extract_zip_images(_build_zip())

    def test_corrupt_zip_raises(self):
        with pytest.raises(ValueError, match="Invalid ZIP"):
            extract_zip_images(b"not-a-zip")

    def test_malformed_metadata_returns_none(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("img.png", _make_png_bytes())
            zf.writestr("metadata.json", b"{not valid json")
        images, meta, names = extract_zip_images(buf.getvalue())
        assert meta is None
        assert len(images) == 1

    def test_uppercase_png_extension_detected(self):
        zip_bytes = _build_zip(png_bytes_map={"IMG.PNG": _make_png_bytes()})
        images, _, names = extract_zip_images(zip_bytes)
        assert len(images) == 1
        assert names == ["IMG.PNG"]


# ---------------------------------------------------------------------------
# R1 / R2 — Metadata scale parsing
# ---------------------------------------------------------------------------


class TestExtractScaleFromMetadata:
    def test_valid_nested_path(self):
        result = extract_scale_from_metadata(
            {"parameters": {"pixels_per_100nm": 500.0}}
        )
        assert result == 500.0

    def test_integer_value_returns_float(self):
        result = extract_scale_from_metadata({"parameters": {"pixels_per_100nm": 300}})
        assert result == 300.0
        assert isinstance(result, float)

    def test_none_metadata(self):
        assert extract_scale_from_metadata(None) is None

    def test_empty_metadata(self):
        assert extract_scale_from_metadata({}) is None

    def test_missing_parameters_key(self):
        assert extract_scale_from_metadata({"other": 1}) is None

    def test_parameters_not_a_dict(self):
        assert extract_scale_from_metadata({"parameters": "nope"}) is None

    def test_missing_pixels_per_100nm(self):
        assert extract_scale_from_metadata({"parameters": {}}) is None

    def test_zero_value_rejected(self):
        assert (
            extract_scale_from_metadata({"parameters": {"pixels_per_100nm": 0}}) is None
        )

    def test_negative_value_rejected(self):
        assert (
            extract_scale_from_metadata({"parameters": {"pixels_per_100nm": -1}})
            is None
        )

    def test_non_numeric_rejected(self):
        assert (
            extract_scale_from_metadata({"parameters": {"pixels_per_100nm": "nope"}})
            is None
        )

    def test_nan_rejected(self):
        assert (
            extract_scale_from_metadata(
                {"parameters": {"pixels_per_100nm": float("nan")}}
            )
            is None
        )

    def test_inf_rejected(self):
        assert (
            extract_scale_from_metadata(
                {"parameters": {"pixels_per_100nm": float("inf")}}
            )
            is None
        )


# ---------------------------------------------------------------------------
# R9 — Filename → sim_id detection
# ---------------------------------------------------------------------------


class TestDetectSimIdFromFilename:
    def test_matching_pattern_projections(self):
        result = detect_sim_id_from_filename(
            "a0b1c2d3-e4f5-6789-abcd-ef0123456789_projections.zip"
        )
        assert result == uuid.UUID("a0b1c2d3-e4f5-6789-abcd-ef0123456789")

    def test_fibonacci_suffix(self):
        result = detect_sim_id_from_filename(
            "a0b1c2d3-e4f5-6789-abcd-ef0123456789_fibonacci.zip"
        )
        assert result == uuid.UUID("a0b1c2d3-e4f5-6789-abcd-ef0123456789")

    def test_uppercase_uuid_accepted(self):
        result = detect_sim_id_from_filename(
            "A0B1C2D3-E4F5-6789-ABCD-EF0123456789_x.zip"
        )
        assert result == uuid.UUID("a0b1c2d3-e4f5-6789-abcd-ef0123456789")

    def test_non_matching_no_uuid(self):
        assert detect_sim_id_from_filename("random.zip") is None

    def test_empty_filename(self):
        assert detect_sim_id_from_filename("") is None

    def test_uuid_without_trailing_underscore(self):
        # Must be followed by '_' per R9 pattern.
        assert (
            detect_sim_id_from_filename("a0b1c2d3-e4f5-6789-abcd-ef0123456789.zip")
            is None
        )


# ---------------------------------------------------------------------------
# R7 — Batch statistics
# ---------------------------------------------------------------------------


class TestComputeBatchStatistics:
    def test_all_successful(self):
        results = [
            {"fractal_dimension": 1.7},
            {"fractal_dimension": 1.8},
            {"fractal_dimension": 1.9},
        ]
        stats = compute_batch_statistics(results)
        assert stats["n_images"] == 3
        assert stats["n_successful"] == 3
        assert stats["mean_df"] == pytest.approx(1.8)
        assert stats["std_df"] > 0
        assert stats["median_df"] == pytest.approx(1.8)
        assert stats["min_df"] == pytest.approx(1.7)
        assert stats["max_df"] == pytest.approx(1.9)

    def test_n_equals_1_std_is_zero(self):
        results = [{"fractal_dimension": 1.7}]
        stats = compute_batch_statistics(results)
        assert stats["n_successful"] == 1
        assert stats["std_df"] == 0.0
        assert stats["mean_df"] == pytest.approx(1.7)
        assert stats["median_df"] == pytest.approx(1.7)

    def test_partial_failure(self):
        results = [
            {"fractal_dimension": 1.7},
            {"fractal_dimension": None, "error": "boom"},
            {"fractal_dimension": 1.9},
        ]
        stats = compute_batch_statistics(results)
        assert stats["n_images"] == 3
        assert stats["n_successful"] == 2
        assert stats["mean_df"] == pytest.approx(1.8)

    def test_all_failed(self):
        results = [
            {"fractal_dimension": None},
            {"fractal_dimension": None},
        ]
        stats = compute_batch_statistics(results)
        assert stats["n_images"] == 2
        assert stats["n_successful"] == 0
        for key in (
            "mean_df",
            "std_df",
            "median_df",
            "q1_df",
            "q3_df",
            "min_df",
            "max_df",
        ):
            assert stats[key] is None

    def test_empty_results(self):
        stats = compute_batch_statistics([])
        assert stats["n_images"] == 0
        assert stats["n_successful"] == 0
        assert stats["mean_df"] is None


# ---------------------------------------------------------------------------
# R8 — Histogram
# ---------------------------------------------------------------------------


class TestComputeHistogram:
    def test_below_threshold_returns_none(self):
        assert compute_histogram([1.5, 1.6, 1.7, 1.8]) is None  # N=4

    def test_sturges_at_boundary_n5(self):
        result = compute_histogram([1.5, 1.6, 1.7, 1.8, 1.9])  # N=5
        assert result is not None
        assert result["rule_used"] == "sturges"
        assert sum(result["counts"]) == 5
        assert len(result["bin_edges"]) == len(result["counts"]) + 1

    def test_sturges_at_n9(self):
        result = compute_histogram([1.5 + i * 0.05 for i in range(9)])
        assert result["rule_used"] == "sturges"
        assert sum(result["counts"]) == 9

    def test_freedman_diaconis_at_boundary_n10(self):
        result = compute_histogram([1.5 + i * 0.05 for i in range(10)])
        assert result["rule_used"] == "freedman_diaconis"
        assert sum(result["counts"]) == 10

    def test_freedman_diaconis_larger_n(self):
        result = compute_histogram([1.5 + i * 0.05 for i in range(15)])
        assert result["rule_used"] == "freedman_diaconis"
        assert sum(result["counts"]) == 15

    def test_degenerate_iqr_fallback_uses_sqrt(self):
        # All identical → IQR=0 on the FD path → sqrt fallback (N≥10 only).
        result = compute_histogram([1.7] * 12)
        assert result is not None
        assert result["rule_used"] == "sqrt"
        assert sum(result["counts"]) == 12

    def test_filters_none_and_non_finite(self):
        # 5 finite values after filtering → Sturges path.
        result = compute_histogram(
            [1.5, None, float("inf"), float("nan"), 1.6, 1.7, 1.8, 1.9]
        )
        assert result is not None
        assert result["rule_used"] == "sturges"
        assert sum(result["counts"]) == 5

    def test_all_none_returns_none(self):
        assert compute_histogram([None, None, None]) is None


# ---------------------------------------------------------------------------
# R9 + R11 — Comparison card
# ---------------------------------------------------------------------------


class TestBuildComparisonData:
    def test_none_sim_id_returns_none(self):
        assert build_comparison_data(None, 1.8, 0.1) is None

    @pytest.mark.django_db
    def test_sim_found_fills_target_and_box_counting(self, test_project):
        from apps.simulations.models import Simulation

        sim = Simulation.objects.create(
            project=test_project,
            algorithm="dla",
            name="Test Sim",
            parameters={"n_particles": 100, "target_df": 1.78},
            metrics={"fractal_dimension": 1.75},
            seed=7,
        )
        result = build_comparison_data(sim.id, 1.80, 0.12)
        assert result is not None
        assert result["sim_id"] == str(sim.id)
        assert result["sim_name"] == "Test Sim"
        assert result["sim_target_df"] == 1.78
        assert result["sim_box_counting_df"] == 1.75
        assert result["batch_mean_df"] == 1.80
        assert result["batch_std_df"] == 0.12
        assert result["sorensen_note"] == SORENSEN_NOTE

    @pytest.mark.django_db
    def test_sim_found_with_missing_optional_fields(self, test_project):
        from apps.simulations.models import Simulation

        sim = Simulation.objects.create(
            project=test_project,
            algorithm="dla",
            parameters={"n_particles": 100},  # no target_df
            metrics={},  # no fractal_dimension
            seed=7,
        )
        result = build_comparison_data(sim.id, 1.80, 0.12)
        assert result is not None
        assert result["sim_target_df"] is None
        assert result["sim_box_counting_df"] is None
        assert "Sorensen" in result["sorensen_note"]

    @pytest.mark.django_db
    def test_sim_not_found(self):
        fake_uuid = uuid.uuid4()
        result = build_comparison_data(fake_uuid, 1.8, 0.1)
        assert result is not None
        assert result["sim_id"] == str(fake_uuid)
        assert result["sim_name"] is None
        assert result["sim_target_df"] is None
        assert result["sim_box_counting_df"] is None
        assert result["batch_mean_df"] == 1.8
        assert result["batch_std_df"] == 0.1
        assert result["sorensen_note"] == SORENSEN_NOTE

    @pytest.mark.django_db
    def test_sorensen_note_always_included_when_card_built(self):
        fake_uuid = uuid.uuid4()
        result = build_comparison_data(fake_uuid, None, None)
        assert result is not None
        assert "Sorensen" in result["sorensen_note"]
        assert "2D projection" in result["sorensen_note"]
