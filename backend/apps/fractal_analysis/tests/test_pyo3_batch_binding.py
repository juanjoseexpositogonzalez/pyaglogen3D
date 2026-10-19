"""Smoke tests for the ``analyze_fraktal_batch`` PyO3 binding.

These tests exercise the Python surface of the batch orchestrator. The
numerical correctness of per-image analyzers and the one-shot dpo
policy is covered by Rust unit tests in
``aglogen_core/engine/src/fractal/fraktal/batch.rs``.
"""

from __future__ import annotations

import aglogen_core
import numpy as np
import pytest


def _make_grayscale_with_particles(size: int = 64) -> np.ndarray:
    """Synthetic grayscale image: light background with a 6x6 grid of
    small dark disks. Large enough that segmentation + adaptive particle
    detection can resolve primaries (used for the autocalibrate path)."""
    img = np.full((size, size), 220, dtype=np.uint8)
    radius = 3.0
    for r in range(6):
        for c in range(6):
            cy, cx = 8 + r * 8, 8 + c * 8
            yy, xx = np.ogrid[:size, :size]
            mask = (yy - cy) ** 2 + (xx - cx) ** 2 <= radius**2
            img[mask] = 30
    return img


class TestAnalyzeFraktalBatchBinding:
    def test_three_image_batch_roundtrip(self) -> None:
        images = [_make_grayscale_with_particles() for _ in range(3)]
        result = aglogen_core.analyze_fraktal_batch(
            images,
            500.0,
            False,
            25.0,
            "granulated_2012",
        )
        # Shape matches the design data contract.
        assert set(result.keys()) >= {
            "results",
            "dpo_used",
            "autocalibrate_source",
            "autocalibrate_image_index",
        }
        assert len(result["results"]) == 3
        assert result["dpo_used"] == 25.0
        assert result["autocalibrate_source"] == "manual"
        assert result["autocalibrate_image_index"] is None

        # Per-image entries have the R6 field set.
        for i, entry in enumerate(result["results"]):
            assert entry["index"] == i
            assert set(entry.keys()) >= {
                "index",
                "fractal_dimension",
                "prefactor",
                "r_squared",
                "n_particles_counted",
                "dpo_used",
                "error",
            }

    def test_voxel_algorithm_accepted(self) -> None:
        images = [_make_grayscale_with_particles()]
        result = aglogen_core.analyze_fraktal_batch(
            images,
            500.0,
            False,
            0.0,
            "voxel_2018",
        )
        assert len(result["results"]) == 1
        assert result["autocalibrate_source"] == "manual"

    def test_autocalibrate_happy_reports_image0(self) -> None:
        images = [_make_grayscale_with_particles() for _ in range(2)]
        result = aglogen_core.analyze_fraktal_batch(
            images,
            500.0,
            True,
            0.0,
            "granulated_2012",
        )
        assert result["autocalibrate_source"] == "image0"
        assert result["autocalibrate_image_index"] == 0
        assert result["dpo_used"] > 0.0

    def test_invalid_algorithm_raises(self) -> None:
        images = [_make_grayscale_with_particles()]
        with pytest.raises(ValueError, match="Unknown algorithm"):
            aglogen_core.analyze_fraktal_batch(
                images,
                500.0,
                False,
                25.0,
                "nonsense",
            )

    def test_empty_images_raises(self) -> None:
        with pytest.raises(ValueError, match="at least one image"):
            aglogen_core.analyze_fraktal_batch(
                [],
                500.0,
                False,
                25.0,
                "granulated_2012",
            )


class TestAnalyzeFraktalBatchPerImageScaleInputVariants:
    """Judgment-day fix round F1 — real-engine proof that the input
    variant decides convergence for scientific (0/255) bytes.

    The same binary image FAILS as Presentation (pixel_min=10 / pixel_max=240
    clipping eats the 0/255 mask → 'No object pixels found') and CONVERGES
    as Scientific (pixel range widened to 0/255). This is why the
    re-analysis path MUST forward each row's analysis_input_variant.
    """

    @staticmethod
    def _binary_image_with_particles(size: int = 64) -> np.ndarray:
        """Clean binary render: dark particle disks on white background."""
        img = np.full((size, size), 255, dtype=np.uint8)
        radius = 3.0
        for r in range(6):
            for c in range(6):
                cy, cx = 8 + r * 8, 8 + c * 8
                yy, xx = np.ogrid[:size, :size]
                mask = (yy - cy) ** 2 + (xx - cx) ** 2 <= radius**2
                img[mask] = 0
        return img

    def test_scientific_converges_where_presentation_fails(self) -> None:
        img = self._binary_image_with_particles()

        presentation = aglogen_core.analyze_fraktal_batch_per_image_scale(
            [img],
            [12.0],
            False,
            25.0,
            "granulated_2012",
            input_variants=["presentation"],
        )
        p0 = presentation["results"][0]
        # Presentation downgrades the binary input: error + no Df.
        assert p0["error"] is not None
        assert p0["fractal_dimension"] is None

        scientific = aglogen_core.analyze_fraktal_batch_per_image_scale(
            [img],
            [12.0],
            False,
            25.0,
            "granulated_2012",
            input_variants=["scientific"],
        )
        s0 = scientific["results"][0]
        # The SAME bytes converge when fed as scientific.
        assert s0["error"] is None
        assert s0["quality"] == "converged"
        assert s0["fractal_dimension"] is not None
        assert s0["n_particles_counted"] == 36
