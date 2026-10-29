"""Smoke tests for the new projections PyO3 bindings.

These tests exercise the Python surface of the Rust direction generators
and ``project_directions`` to catch binding regressions. Numerical
correctness of the generators themselves is covered by the Rust unit
tests in ``aglogen_core/engine/src/projection/directions.rs``.
"""

from __future__ import annotations

import numpy as np
import pytest

import aglogen_core


class TestGenerateDirectionGrid:
    """R1: grid count formula and tuple shape."""

    def test_count_formula(self) -> None:
        # n_az*(n_el-2)+2 = 10*3+2 = 32
        dirs = aglogen_core.generate_direction_grid(10, 5)
        assert len(dirs) == 32

    def test_count_formula_various(self) -> None:
        for n_az, n_el in [(4, 3), (6, 7), (1, 2), (8, 4)]:
            dirs = aglogen_core.generate_direction_grid(n_az, n_el)
            assert len(dirs) == n_az * (n_el - 2) + 2, f"n_az={n_az} n_el={n_el}"

    def test_n_el_2_yields_only_poles(self) -> None:
        dirs = aglogen_core.generate_direction_grid(10, 2)
        assert len(dirs) == 2
        elevations = sorted(el for _, el in dirs)
        assert elevations == pytest.approx([-90.0, 90.0])

    def test_tuple_shape_and_ranges(self) -> None:
        dirs = aglogen_core.generate_direction_grid(4, 3)
        for entry in dirs:
            # Must unpack as (float, float)
            az, el = entry
            assert isinstance(az, float)
            assert isinstance(el, float)
            assert 0.0 <= az < 360.0 + 1e-9
            assert -90.0 - 1e-9 <= el <= 90.0 + 1e-9

    def test_invalid_n_az_raises(self) -> None:
        with pytest.raises(ValueError):
            aglogen_core.generate_direction_grid(0, 5)

    def test_invalid_n_el_raises(self) -> None:
        with pytest.raises(ValueError):
            aglogen_core.generate_direction_grid(5, 1)


class TestGenerateDirectionFibonacci:
    """R2: fibonacci count and tuple shape."""

    def test_count_equals_n(self) -> None:
        for n in [1, 2, 50, 500]:
            dirs = aglogen_core.generate_direction_fibonacci(n)
            assert len(dirs) == n, f"n={n}"

    def test_tuple_shape_and_ranges(self) -> None:
        dirs = aglogen_core.generate_direction_fibonacci(10)
        for entry in dirs:
            az, el = entry
            assert isinstance(az, float)
            assert isinstance(el, float)
            assert 0.0 <= az < 360.0 + 1e-9
            assert -90.0 - 1e-9 <= el <= 90.0 + 1e-9

    def test_invalid_n_raises(self) -> None:
        with pytest.raises(ValueError):
            aglogen_core.generate_direction_fibonacci(0)


class TestProjectDirections:
    """Round-trip tests for ``project_directions``."""

    def test_single_particle_single_direction(self) -> None:
        coords = np.array([[0.0, 0.0, 0.0]], dtype=np.float64)
        radii = np.array([1.0], dtype=np.float64)
        directions = [(0.0, 0.0)]
        results = aglogen_core.project_directions(coords, radii, directions)
        assert len(results) == 1
        res = results[0]
        # Should have the same fields as project_batch output (PyProjectionResult)
        assert res.azimuth == pytest.approx(0.0)
        assert res.elevation == pytest.approx(0.0)
        assert len(res.x) == 1
        assert len(res.y) == 1
        assert len(res.radii) == 1
        assert res.radii[0] == pytest.approx(1.0)

    def test_count_matches_directions(self) -> None:
        coords = np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]], dtype=np.float64)
        radii = np.array([1.0, 1.0], dtype=np.float64)
        directions = [(0.0, 0.0), (90.0, 0.0), (180.0, 0.0)]
        results = aglogen_core.project_directions(coords, radii, directions)
        assert len(results) == 3
        for r in results:
            assert len(r.x) == 2
            assert len(r.y) == 2

    def test_preserves_direction_order(self) -> None:
        coords = np.array([[0.0, 0.0, 0.0]], dtype=np.float64)
        radii = np.array([1.0], dtype=np.float64)
        directions = [(10.0, -30.0), (45.0, 60.0), (200.0, 0.0)]
        results = aglogen_core.project_directions(coords, radii, directions)
        for (az_in, el_in), res in zip(directions, results):
            assert res.azimuth == pytest.approx(az_in)
            assert res.elevation == pytest.approx(el_in)

    def test_shape_mismatch_raises(self) -> None:
        with pytest.raises(ValueError):
            aglogen_core.project_directions(
                np.array([[0.0, 0.0, 0.0]], dtype=np.float64),
                np.array([1.0, 2.0], dtype=np.float64),  # wrong length
                [(0.0, 0.0)],
            )

    def test_non_3_columns_raises(self) -> None:
        with pytest.raises(ValueError):
            aglogen_core.project_directions(
                np.array([[0.0, 0.0]], dtype=np.float64),  # (N, 2), not (N, 3)
                np.array([1.0], dtype=np.float64),
                [(0.0, 0.0)],
            )

    def test_roundtrip_with_generated_grid(self) -> None:
        """End-to-end: grid generator + project_directions composes cleanly."""
        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]], dtype=np.float64)
        radii = np.array([1.0, 1.0], dtype=np.float64)
        directions = aglogen_core.generate_direction_grid(4, 3)
        assert len(directions) == 4 * 1 + 2  # = 6
        results = aglogen_core.project_directions(coords, radii, directions)
        assert len(results) == len(directions)
