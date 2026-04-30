"""Tests for dual render (presentation + scientific) projection exports.

Covers T3.4 (presentation parity), T3.5 (scientific render), T3.6 (dual render),
T3.8 (ZIP dual PNGs), T3.9 (metadata per-direction scale), T3.10 (spec scenarios).
"""

import io
import json
import zipfile

import numpy as np
import pytest
from PIL import Image

from apps.simulations.services.projection import (
    _create_projection_figure,
    render_projection_dual_png,
    render_projection_png,
    render_scientific_png,
)
from apps.simulations.services.projections import (
    build_metadata_json,
    build_projection_zip,
)


# ---------------------------------------------------------------------------
# Fixtures: small synthetic agglomerate for rendering tests
# ---------------------------------------------------------------------------

SAMPLE_X = [0.0, 2.0, 1.0]
SAMPLE_Y = [0.0, 0.0, 1.73]
SAMPLE_RADII = [0.5, 0.5, 0.5]
SAMPLE_BOUNDS = (-0.5, 2.5, -0.5, 2.23)


# ---------------------------------------------------------------------------
# T3.4 — Presentation render parity: edgecolor=black, alpha=1.0
# ---------------------------------------------------------------------------


class TestPresentationRenderParity:
    """T3.4: _create_projection_figure uses edgecolor='black', alpha=1.0."""

    def test_presentation_has_black_edges(self) -> None:
        """Rendered presentation PNG must have black-tinted edge pixels.

        With edgecolor="black" + linewidth=0.5, anti-aliased edge pixels
        are darker than the pure red fill. We detect pixels where ALL
        three channels are below 128 (the black edge bleeds into both the
        red fill and white background, producing dark RGB values).
        """
        png_bytes = render_projection_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=256,
        )
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        arr = np.array(img)

        # Edge pixels: all channels < 128 (dark, black-tinted).
        # Pure red = (255,0,0), pure white = (255,255,255), pure black = (0,0,0).
        # Anti-aliased black edges produce pixels where R,G,B are ALL below 128.
        dark_mask = (arr[:, :, 0] < 128) & (arr[:, :, 1] < 128) & (arr[:, :, 2] < 128)
        dark_pixels = np.count_nonzero(dark_mask)
        assert dark_pixels > 0, "Expected dark edge pixels in presentation render"

    def test_presentation_has_red_interior(self) -> None:
        """Rendered presentation PNG must contain red fill pixels."""
        png_bytes = render_projection_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=256,
        )
        img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        arr = np.array(img)

        # Red pixels: high R channel, low G and B
        red_mask = (arr[:, :, 0] > 180) & (arr[:, :, 1] < 60) & (arr[:, :, 2] < 60)
        assert np.count_nonzero(red_mask) > 0, "Expected red interior pixels"

    def test_collection_alpha_is_1(self) -> None:
        """PatchCollection must use alpha=1.0 (fully opaque)."""
        import matplotlib.pyplot as plt

        fig, ax = _create_projection_figure(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            figsize=(5.12, 5.12),
            facecolor="red",
            edgecolor="black",
            background="white",
        )
        collection = ax.collections[0]
        assert collection.get_alpha() == 1.0, "alpha must be 1.0 for presentation"
        plt.close(fig)


# ---------------------------------------------------------------------------
# T3.5 — Scientific render: solid black, binary B/W, no AA halo
# ---------------------------------------------------------------------------


class TestScientificRender:
    """T3.5: _create_scientific_projection_figure + binary threshold."""

    def test_scientific_png_is_strictly_binary(self) -> None:
        """Every pixel must be exactly 0 or 255 (no anti-aliasing halo)."""
        png_bytes = render_scientific_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=256,
        )
        img = Image.open(io.BytesIO(png_bytes)).convert("L")
        arr = np.array(img)
        unique_vals = set(np.unique(arr))
        assert unique_vals <= {0, 255}, (
            f"Scientific render must be strictly binary, got values: {unique_vals}"
        )

    def test_scientific_png_has_black_pixels(self) -> None:
        """Scientific render must have black (0) pixels from the particles."""
        png_bytes = render_scientific_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=256,
        )
        img = Image.open(io.BytesIO(png_bytes)).convert("L")
        arr = np.array(img)
        assert np.count_nonzero(arr == 0) > 0, "Expected black particle pixels"

    def test_scientific_png_has_white_background(self) -> None:
        """Scientific render must have white (255) background pixels."""
        png_bytes = render_scientific_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=256,
        )
        img = Image.open(io.BytesIO(png_bytes)).convert("L")
        arr = np.array(img)
        assert np.count_nonzero(arr == 255) > 0, "Expected white background pixels"

    def test_scientific_png_is_rgb_3channel(self) -> None:
        """Output must be RGB (3 channels, no alpha) per spec."""
        png_bytes = render_scientific_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=256,
        )
        img = Image.open(io.BytesIO(png_bytes))
        assert img.mode == "RGB", f"Expected RGB mode, got {img.mode}"

    def test_scientific_png_valid_png_bytes(self) -> None:
        """Return value must be valid PNG bytes (starts with PNG signature)."""
        png_bytes = render_scientific_png(
            x=SAMPLE_X,
            y=SAMPLE_Y,
            radii=SAMPLE_RADII,
            bounds=SAMPLE_BOUNDS,
            img_size=512,
        )
        assert isinstance(png_bytes, bytes)
        assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n", "Not a valid PNG"


# ---------------------------------------------------------------------------
# T3.6 — render_projection_dual_png: both variants + bbox dims
# ---------------------------------------------------------------------------

# 3D positions + radii for compute_2d_bbox mocking
SAMPLE_POSITIONS_3D = np.array(
    [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [1.0, 1.73, 0.0]], dtype=np.float64
)
SAMPLE_RADII_3D = np.array([0.5, 0.5, 0.5], dtype=np.float64)


class TestRenderProjectionDualPng:
    """T3.6: render_projection_dual_png returns both variants + bbox."""

    def test_returns_four_element_tuple(self) -> None:
        """Must return (pres_bytes, sci_bytes, bbox_w, bbox_h)."""
        result = render_projection_dual_png(
            positions=SAMPLE_POSITIONS_3D,
            radii=SAMPLE_RADII_3D,
            azimuth=0.0,
            elevation=0.0,
            img_size=256,
        )
        assert isinstance(result, tuple)
        assert len(result) == 4

    def test_both_outputs_are_valid_png(self) -> None:
        """Both presentation and scientific bytes must be valid PNG."""
        pres, sci, bw, bh = render_projection_dual_png(
            positions=SAMPLE_POSITIONS_3D,
            radii=SAMPLE_RADII_3D,
            azimuth=0.0,
            elevation=0.0,
            img_size=256,
        )
        assert pres[:8] == b"\x89PNG\r\n\x1a\n"
        assert sci[:8] == b"\x89PNG\r\n\x1a\n"

    def test_both_pngs_have_identical_dimensions(self) -> None:
        """Presentation and scientific PNGs must have the same pixel size."""
        pres, sci, _, _ = render_projection_dual_png(
            positions=SAMPLE_POSITIONS_3D,
            radii=SAMPLE_RADII_3D,
            azimuth=0.0,
            elevation=0.0,
            img_size=256,
        )
        pres_img = Image.open(io.BytesIO(pres))
        sci_img = Image.open(io.BytesIO(sci))
        assert pres_img.size == sci_img.size

    def test_bbox_dimensions_are_positive(self) -> None:
        """bbox_w and bbox_h must be positive floats."""
        _, _, bw, bh = render_projection_dual_png(
            positions=SAMPLE_POSITIONS_3D,
            radii=SAMPLE_RADII_3D,
            azimuth=0.0,
            elevation=0.0,
            img_size=256,
        )
        assert isinstance(bw, float)
        assert isinstance(bh, float)
        assert bw > 0.0
        assert bh > 0.0

    def test_scientific_is_binary(self) -> None:
        """Scientific output must be strictly binary (0 or 255 only)."""
        _, sci, _, _ = render_projection_dual_png(
            positions=SAMPLE_POSITIONS_3D,
            radii=SAMPLE_RADII_3D,
            azimuth=90.0,
            elevation=45.0,
            img_size=256,
        )
        img = Image.open(io.BytesIO(sci)).convert("L")
        arr = np.array(img)
        unique = set(np.unique(arr))
        assert unique <= {0, 255}


# ---------------------------------------------------------------------------
# T3.8 — build_projection_zip: dual PNGs per direction
# ---------------------------------------------------------------------------

FAKE_PRES = b"\x89PNG\r\n\x1a\n" + b"presentation-data"
FAKE_SCI = b"\x89PNG\r\n\x1a\n" + b"scientific-data"


class TestBuildProjectionZipDual:
    """T3.8: ZIP includes both presentation and scientific PNGs."""

    def test_zip_contains_both_pngs_per_direction(self) -> None:
        """Each direction should have a .png and a .scientific.png."""
        directions = [(0.0, 0.0), (90.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PRES, FAKE_PRES],
            mode="grid",
            n_requested=2,
            parameters={},
            scientific_bytes_list=[FAKE_SCI, FAKE_SCI],
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = set(zf.namelist())
            # presentation
            assert "proj_000_Az000_El+000.png" in names
            assert "proj_001_Az090_El+000.png" in names
            # scientific
            assert "proj_000_Az000_El+000.scientific.png" in names
            assert "proj_001_Az090_El+000.scientific.png" in names
            # metadata
            assert "metadata.json" in names

    def test_zip_file_count_with_dual(self) -> None:
        """2 directions × 2 PNGs + metadata.json = 5 files."""
        directions = [(0.0, 0.0), (90.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PRES, FAKE_PRES],
            mode="grid",
            n_requested=2,
            parameters={},
            scientific_bytes_list=[FAKE_SCI, FAKE_SCI],
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            assert len(zf.namelist()) == 5

    def test_legacy_mode_no_scientific(self) -> None:
        """Legacy mode (no scientific_bytes_list) produces single PNG only."""
        directions = [(0.0, 0.0)]
        zip_bytes = build_projection_zip(
            directions=directions,
            image_bytes_list=[FAKE_PRES],
            mode="legacy",
            n_requested=1,
            parameters={},
            # No scientific_bytes_list → legacy
        )
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = set(zf.namelist())
            assert "proj_000_Az000_El+000.png" in names
            assert "proj_000_Az000_El+000.scientific.png" not in names
            # 1 PNG + metadata.json
            assert len(zf.namelist()) == 2


# ---------------------------------------------------------------------------
# T3.9 — build_metadata_json: per-direction scale + filename_scientific
# ---------------------------------------------------------------------------


class TestBuildMetadataJsonDual:
    """T3.9: metadata.json gains per-direction scale and filename_scientific."""

    def test_per_direction_pixels_per_100nm(self) -> None:
        """Each direction entry has its own pixels_per_100nm."""
        meta = build_metadata_json(
            mode="grid",
            n_requested=2,
            directions=[(0.0, 0.0), (90.0, 0.0)],
            parameters={"img_size": 512},
            per_direction_scale=[400.0, 500.0],
        )
        assert meta["directions"][0]["pixels_per_100nm"] == 400.0
        assert meta["directions"][1]["pixels_per_100nm"] == 500.0

    def test_top_level_pixels_per_100nm_is_max(self) -> None:
        """parameters.pixels_per_100nm = max(per-image scales)."""
        meta = build_metadata_json(
            mode="grid",
            n_requested=2,
            directions=[(0.0, 0.0), (90.0, 0.0)],
            parameters={"img_size": 512},
            per_direction_scale=[400.0, 500.0],
        )
        assert meta["parameters"]["pixels_per_100nm"] == 500.0

    def test_filename_scientific_present_in_dual_mode(self) -> None:
        """In dual mode, directions[i] has filename_scientific."""
        meta = build_metadata_json(
            mode="grid",
            n_requested=1,
            directions=[(45.0, 30.0)],
            parameters={"img_size": 512},
            per_direction_scale=[450.0],
        )
        d = meta["directions"][0]
        assert "filename_scientific" in d
        assert d["filename_scientific"] == "proj_000_Az045_El+030.scientific.png"

    def test_filename_scientific_absent_in_legacy_mode(self) -> None:
        """In legacy mode (no per_direction_scale), filename_scientific is ABSENT."""
        meta = build_metadata_json(
            mode="legacy",
            n_requested=1,
            directions=[(0.0, 0.0)],
            parameters={},
            # No per_direction_scale → legacy behavior
        )
        d = meta["directions"][0]
        assert "filename_scientific" not in d
        assert "pixels_per_100nm" not in d
