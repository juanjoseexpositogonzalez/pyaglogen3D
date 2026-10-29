"""Cross-cutting integration test for fraktal-batch-distributions-and-entry (frente 9, T6.1).

End-to-end validation of the new data flow introduced in this cycle:

    P1  Engine surfaces rg_nm in BatchImageResult (Rust)
    P2  Backend persists rg_nm and exposes aggregate stats (Django)
    P3  Frontend renders 4 distributions (covered by vitest, not here)
    P4  Frontend table shows Rg column (covered by vitest, not here)
    P5  Sim → batch entry button (covered by vitest, not here)

This test exercises the engine→binding→backend portion: feeds a synthetic
batch through the engine via the per-image-scale binding and asserts that
``rg_nm`` is surfaced (positive finite for successful images, None for
failures) — the prerequisite that lets the backend persist it and the
frontend display the histograms + table column.
"""

from __future__ import annotations

import numpy as np
import pytest


def _draw_circles_binary(
    img_size: int,
    centers: list[tuple[int, int]],
    radius: int,
) -> np.ndarray:
    """Strict binary (0/255) image with white circles on black."""
    arr = np.zeros((img_size, img_size), dtype=np.uint8)
    yy, xx = np.ogrid[:img_size, :img_size]
    for cx, cy in centers:
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2
        arr[mask] = 255
    return arr


def _grid_centers(
    nx: int, ny: int, spacing: int, img_size: int
) -> list[tuple[int, int]]:
    """Regular (x, y) grid centred in the image."""
    total_w = (nx - 1) * spacing
    total_h = (ny - 1) * spacing
    x0 = (img_size - total_w) // 2
    y0 = (img_size - total_h) // 2
    return [
        (x0 + ix * spacing, y0 + iy * spacing) for iy in range(ny) for ix in range(nx)
    ]


# Same geometry as the PYA-9 pixel-accuracy test so a known dpo / radius
# pair holds: 35 primaries, radius=10 px, 80 px/100nm → dpo=25 nm.
IMG_SIZE = 512
RADIUS_PX = 10
N_X, N_Y = 7, 5
SPACING = 3 * RADIUS_PX
TRUE_DPO_NM = 25.0
PIXELS_PER_100NM = 80.0


@pytest.mark.integration
class TestFraktalBatchRgSurfacing:
    """Validates rg_nm surfaces through engine → binding for batch results."""

    def _build_synthetic_image(self) -> np.ndarray:
        centres = _grid_centers(N_X, N_Y, SPACING, IMG_SIZE)
        return _draw_circles_binary(IMG_SIZE, centres, RADIUS_PX)

    def test_rg_nm_is_surfaced_for_successful_image(self) -> None:
        """Successful batch image must have rg_nm > 0 (positive finite)."""
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

        # Engine returns dict with `results` list; per-image dicts gain rg_nm.
        assert "results" in result
        assert len(result["results"]) == 1

        img_result = result["results"][0]
        assert "rg_nm" in img_result, (
            "rg_nm key missing from per-image batch result — P1 wiring broken"
        )

        rg_nm = img_result["rg_nm"]
        assert rg_nm is not None, "rg_nm should be set on a successful image"
        assert rg_nm > 0 and np.isfinite(rg_nm), (
            f"rg_nm must be positive finite, got {rg_nm}"
        )

    def test_rg_nm_in_reasonable_range_for_compact_aggregate(self) -> None:
        """For a 7x5 grid (35 primaries on a ~180x120 px area at this scale),
        Rg of the 2D projection should be of the same order as the cluster
        half-extent — order 50-500 nm. This is a sanity bound, not a
        scientific assertion."""
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

        rg_nm = result["results"][0]["rg_nm"]
        # Sanity bounds: 10 nm (single primary) to 1000 nm (very large)
        assert 10 < rg_nm < 1000, (
            f"rg_nm={rg_nm} nm is outside sane bounds [10, 1000] for this "
            "synthetic 35-primary 7x5 grid; check engine output unit."
        )

    def test_multi_image_batch_each_carries_rg_nm_key(self) -> None:
        """Run a batch with 2 images; each per-image result must carry the
        rg_nm key (Frente 9 wiring, not the underlying engine value).

        This validates the binding plumbing: image_count == result_count,
        and every result dict has the rg_nm key — not None — regardless
        of the underlying detector behavior on synthetic geometry. The
        scientific value of rg_nm is the engine's responsibility, not
        this cycle's scope.
        """
        import aglogen_core

        img_a = self._build_synthetic_image()
        # Smaller geometry to force a different result row.
        centres_b = _grid_centers(3, 3, SPACING, IMG_SIZE)
        img_b = _draw_circles_binary(IMG_SIZE, centres_b, RADIUS_PX)

        result = aglogen_core.analyze_fraktal_batch_per_image_scale(
            images=[img_a, img_b],
            pixels_per_100nm=[PIXELS_PER_100NM, PIXELS_PER_100NM],
            autocalibrate_dpo=True,
            dpo_hint=TRUE_DPO_NM,
            algorithm="granulated_2012",
            input_variants=["scientific", "scientific"],
        )

        assert len(result["results"]) == 2
        for i, r in enumerate(result["results"]):
            assert "rg_nm" in r, f"image[{i}] result missing rg_nm key"
            assert r["rg_nm"] is not None, (
                f"image[{i}] rg_nm should be set on a successful result"
            )
            assert r["rg_nm"] > 0 and np.isfinite(r["rg_nm"]), (
                f"image[{i}] rg_nm must be positive finite, got {r['rg_nm']}"
            )
