"""Tests for dual render (presentation + scientific) projection exports.

Covers T3.4 (presentation parity), T3.5 (scientific render), T3.6 (dual render),
T3.8 (ZIP dual PNGs), T3.9 (metadata per-direction scale), T3.10 (spec scenarios).
"""

import io

import numpy as np
import pytest
from PIL import Image

from apps.simulations.services.projection import (
    _create_projection_figure,
    render_projection_png,
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
