"""Cross-cutting integration test for fraktal-detector-fix (PYA-9, T6.1).

End-to-end validation that the detector autocalibrate pipeline (NMS=1.0 +
ALL-peaks median + scientific binary input) reports dpo within ±10% of
the true value on a synthetic projection.

Geometry:
    35 primaries arranged on a 7x5 grid, each radius=10 px, on a 512x512
    binary image.  Known dpo = 25 nm, scale = 80 px/100nm (so 10 px
    radius = 12.5 nm = dpo/2).

This test exercises:
    P1  NMS radius 1.0 + median over ALL peaks  (engine)
    P2  Scientific binary input path            (engine)
    P3  input_variants plumbing                 (binding)
    P4  autocalibrate_dpo=True path             (binding)
"""

from __future__ import annotations

import numpy as np
import pytest


def _draw_circles_binary(
    img_size: int,
    centers: list[tuple[int, int]],
    radius: int,
) -> np.ndarray:
    """Return an (img_size, img_size) uint8 array with white circles on black.

    Each circle is drawn by a simple Euclidean distance check — no
    anti-aliasing, strict binary (0 or 255).
    """
    arr = np.zeros((img_size, img_size), dtype=np.uint8)
    yy, xx = np.ogrid[:img_size, :img_size]
    for cx, cy in centers:
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2
        arr[mask] = 255
    return arr


def _grid_centers(
    nx: int, ny: int, spacing: int, img_size: int
) -> list[tuple[int, int]]:
    """Generate a regular grid of (x, y) centres, centred in the image."""
    total_w = (nx - 1) * spacing
    total_h = (ny - 1) * spacing
    x0 = (img_size - total_w) // 2
    y0 = (img_size - total_h) // 2
    return [
        (x0 + ix * spacing, y0 + iy * spacing) for iy in range(ny) for ix in range(nx)
    ]


# ---- Constants matching the spec scenario E4.1 ----
IMG_SIZE = 512
RADIUS_PX = 10
N_X, N_Y = 7, 5
N_PRIMARIES = N_X * N_Y  # 35
SPACING = 3 * RADIUS_PX  # 30 px centre-to-centre
TRUE_DPO_NM = 25.0
# dpo = 25 nm → radius = 12.5 nm → in pixels: 12.5 nm / length_per_pixel
# length_per_pixel = 100 / pixels_per_100nm
# radius_px = 12.5 / (100 / pixels_per_100nm) = 12.5 * pixels_per_100nm / 100
# We want radius_px = 10 → pixels_per_100nm = 10 * 100 / 12.5 = 80
PIXELS_PER_100NM = 80.0


@pytest.mark.integration
class TestFraktalDetectorPixelAccuracy:
    """Validates detector autocalibrate on a synthetic binary projection."""

    def _build_synthetic_image(self) -> np.ndarray:
        """Build the 512x512 binary image with 35 circles, radius=10px."""
        centres = _grid_centers(N_X, N_Y, SPACING, IMG_SIZE)
        assert len(centres) == N_PRIMARIES
        return _draw_circles_binary(IMG_SIZE, centres, RADIUS_PX)

    def test_detector_dpo_within_10_percent(self) -> None:
        """Assert detector reports dpo within ±10% of true 25 nm."""
        import aglogen_core

        binary_img = self._build_synthetic_image()

        result = aglogen_core.analyze_fraktal_batch_per_image_scale(
            images=[binary_img],
            pixels_per_100nm=[PIXELS_PER_100NM],
            autocalibrate_dpo=True,
            dpo_hint=TRUE_DPO_NM,
            algorithm="granulated_2012",
            input_variants=["scientific"],
        )

        dpo_used = result["dpo_used"]
        low = TRUE_DPO_NM * 0.9  # 22.5
        high = TRUE_DPO_NM * 1.1  # 27.5
        assert low <= dpo_used <= high, (
            f"Detector dpo_used={dpo_used:.2f} nm is outside ±10% of "
            f"true dpo={TRUE_DPO_NM} nm (expected {low}–{high})"
        )

    def test_autocalibrate_source_is_image0(self) -> None:
        """Assert autocalibrate ran on image[0] and produced a valid result."""
        import aglogen_core

        binary_img = self._build_synthetic_image()

        result = aglogen_core.analyze_fraktal_batch_per_image_scale(
            images=[binary_img],
            pixels_per_100nm=[PIXELS_PER_100NM],
            autocalibrate_dpo=True,
            dpo_hint=TRUE_DPO_NM,
            algorithm="granulated_2012",
            input_variants=["scientific"],
        )

        # Autocalibrate must have succeeded on image[0]
        assert result["autocalibrate_source"] == "image0", (
            f"Expected autocalibrate_source='image0', "
            f"got '{result['autocalibrate_source']}'"
        )

        # dpo_used must be positive and finite (detector found peaks)
        dpo = result["dpo_used"]
        assert dpo > 0 and np.isfinite(dpo), f"Invalid dpo_used={dpo}"

    def test_presentation_path_fails_on_binary_image(self) -> None:
        """Verify presentation path misdetects a pure binary image.

        A binary (0/255) image fed as "presentation" undergoes Otsu
        segmentation which inverts the polarity (selects background as
        foreground), causing autocalibrate to fail.  This validates that
        the scientific input path (P2) is essential for accurate
        detection on binary images — the fix wouldn't work without it.
        """
        import aglogen_core

        binary_img = self._build_synthetic_image()

        with pytest.raises(ValueError, match="no primary particles detected"):
            aglogen_core.analyze_fraktal_batch_per_image_scale(
                images=[binary_img],
                pixels_per_100nm=[PIXELS_PER_100NM],
                autocalibrate_dpo=True,
                dpo_hint=TRUE_DPO_NM,
                algorithm="granulated_2012",
                input_variants=["presentation"],
            )
