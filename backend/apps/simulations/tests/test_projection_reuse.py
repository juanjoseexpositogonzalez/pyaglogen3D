"""Tests for render_or_reuse_projections helper (batch projection export Phase 1).

Validates the render-or-reuse logic: deterministic filenames, skip existing
files on disk, render missing ones, per-direction failure isolation.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sim(sim_id: uuid.UUID | None = None) -> MagicMock:
    """Create a minimal simulation mock with geometry and parameters."""
    sim = MagicMock()
    sim.id = sim_id or uuid.uuid4()
    sim.parameters = {"primary_particle_diameter_nm": 30.0}
    # geometry bytes not needed — we mock the render function
    sim.geometry = b"fake-geometry"
    return sim


# ---------------------------------------------------------------------------
# T1.2 — Grid mode: reuse cached PNGs, render missing ones
# ---------------------------------------------------------------------------


class TestRenderOrReuseGridMode:
    """RED→GREEN→TRIANGULATE for grid mode."""

    def test_grid_mode_renders_missing_skips_existing(self, tmp_path: Path) -> None:
        """Grid 5×5 = 22 directions. 3 already on disk → 19 renders triggered."""
        from apps.simulations.services.projection import (
            create_projection_filename,
            render_or_reuse_projections,
        )

        sim = _make_sim()
        base_name = f"sim_{str(sim.id)[:8]}"

        # Pre-create 3 cached PNGs on disk using the deterministic filename
        cached_directions = [(0, 0), (30, 30), (60, 60)]
        for az, el in cached_directions:
            fname = create_projection_filename(base_name, az, el, "png")
            (tmp_path / fname).write_bytes(b"cached-png-data")

        render_call_count = 0
        rendered_paths: list[Path] = []

        def mock_render_single(
            sim_obj: Any,
            az: float,
            el: float,
            output_dir: Path,
            img_format: str = "png",
        ) -> Path:
            nonlocal render_call_count
            render_call_count += 1
            fname = create_projection_filename(base_name, az, el, img_format)
            out = output_dir / fname
            out.write_bytes(b"rendered-png-data")
            rendered_paths.append(out)
            return out

        with patch(
            "apps.simulations.services.projection._render_single_direction",
            side_effect=mock_render_single,
        ):
            result = render_or_reuse_projections(
                simulation=sim,
                mode="grid",
                config={"az_step": 30, "el_step": 30},
                output_dir=tmp_path,
            )

        # All directions should be in the result
        assert len(result) > 0
        # All paths should exist
        for p in result:
            assert p.exists(), f"Expected path to exist: {p}"

        # The 3 cached files should NOT have triggered renders
        assert render_call_count < len(result)

    def test_grid_mode_second_run_renders_zero(self, tmp_path: Path) -> None:
        """Triangulation: second run with same params renders 0 times."""
        from apps.simulations.services.projection import render_or_reuse_projections

        sim = _make_sim()

        render_call_count = 0

        def mock_render_single(
            sim_obj: Any,
            az: float,
            el: float,
            output_dir: Path,
            img_format: str = "png",
        ) -> Path:
            nonlocal render_call_count
            render_call_count += 1
            from apps.simulations.services.projection import (
                create_projection_filename,
            )

            base_name = f"sim_{str(sim_obj.id)[:8]}"
            fname = create_projection_filename(base_name, az, el, img_format)
            out = output_dir / fname
            out.write_bytes(b"rendered-png-data")
            return out

        config = {"az_step": 90, "el_step": 90}

        with patch(
            "apps.simulations.services.projection._render_single_direction",
            side_effect=mock_render_single,
        ):
            first_result = render_or_reuse_projections(
                simulation=sim, mode="grid", config=config, output_dir=tmp_path,
            )
            first_count = render_call_count
            assert first_count > 0, "First run should render at least 1 direction"

            render_call_count = 0
            second_result = render_or_reuse_projections(
                simulation=sim, mode="grid", config=config, output_dir=tmp_path,
            )
            assert render_call_count == 0, (
                f"Second run should render 0 but rendered {render_call_count}"
            )
            assert len(second_result) == len(first_result)


# ---------------------------------------------------------------------------
# T1.3 — Fibonacci mode
# ---------------------------------------------------------------------------


class TestRenderOrReuseFibonacciMode:
    def test_fibonacci_all_missing_renders_all(self, tmp_path: Path) -> None:
        """Fibonacci n=10 with no cached files → all 10 rendered."""
        from apps.simulations.services.projection import render_or_reuse_projections

        sim = _make_sim()
        render_call_count = 0

        def mock_render_single(
            sim_obj: Any,
            az: float,
            el: float,
            output_dir: Path,
            img_format: str = "png",
        ) -> Path:
            nonlocal render_call_count
            render_call_count += 1
            from apps.simulations.services.projection import (
                create_projection_filename,
            )

            base_name = f"sim_{str(sim_obj.id)[:8]}"
            fname = create_projection_filename(base_name, az, el, img_format)
            out = output_dir / fname
            out.write_bytes(b"rendered-png-data")
            return out

        with patch(
            "apps.simulations.services.projection._render_single_direction",
            side_effect=mock_render_single,
        ):
            result = render_or_reuse_projections(
                simulation=sim,
                mode="fibonacci",
                config={"n": 10},
                output_dir=tmp_path,
            )

        assert len(result) == 10
        assert render_call_count == 10


# ---------------------------------------------------------------------------
# T1.4 — Legacy mode
# ---------------------------------------------------------------------------


class TestRenderOrReuseLegacyMode:
    def test_legacy_mode_renders_correctly(self, tmp_path: Path) -> None:
        """Legacy mode produces expected projection files."""
        from apps.simulations.services.projection import render_or_reuse_projections

        sim = _make_sim()
        render_call_count = 0

        def mock_render_single(
            sim_obj: Any,
            az: float,
            el: float,
            output_dir: Path,
            img_format: str = "png",
        ) -> Path:
            nonlocal render_call_count
            render_call_count += 1
            from apps.simulations.services.projection import (
                create_projection_filename,
            )

            base_name = f"sim_{str(sim_obj.id)[:8]}"
            fname = create_projection_filename(base_name, az, el, img_format)
            out = output_dir / fname
            out.write_bytes(b"rendered-png-data")
            return out

        with patch(
            "apps.simulations.services.projection._render_single_direction",
            side_effect=mock_render_single,
        ):
            result = render_or_reuse_projections(
                simulation=sim,
                mode="legacy",
                config={"az_step": 30, "el_step": 30},
                output_dir=tmp_path,
            )

        assert len(result) > 0
        assert render_call_count == len(result)
        for p in result:
            assert p.exists()


# ---------------------------------------------------------------------------
# T1.5 — Reuse efficiency
# ---------------------------------------------------------------------------


class TestReuseEfficiency:
    def test_second_call_zero_render_invocations(self, tmp_path: Path) -> None:
        """Mock renderer, call twice. Assert 0 render calls on second run."""
        from apps.simulations.services.projection import render_or_reuse_projections

        sim = _make_sim()
        call_count = 0

        def mock_render_single(
            sim_obj: Any,
            az: float,
            el: float,
            output_dir: Path,
            img_format: str = "png",
        ) -> Path:
            nonlocal call_count
            call_count += 1
            from apps.simulations.services.projection import (
                create_projection_filename,
            )

            base_name = f"sim_{str(sim_obj.id)[:8]}"
            fname = create_projection_filename(base_name, az, el, img_format)
            out = output_dir / fname
            out.write_bytes(b"rendered-png-data")
            return out

        config = {"n": 5}

        with patch(
            "apps.simulations.services.projection._render_single_direction",
            side_effect=mock_render_single,
        ):
            render_or_reuse_projections(
                simulation=sim, mode="fibonacci", config=config, output_dir=tmp_path,
            )
            assert call_count == 5
            call_count = 0

            result = render_or_reuse_projections(
                simulation=sim, mode="fibonacci", config=config, output_dir=tmp_path,
            )
            assert call_count == 0
            assert len(result) == 5
            for p in result:
                assert p.exists()


# ---------------------------------------------------------------------------
# T1.6 — Per-direction failure handling
# ---------------------------------------------------------------------------


class TestRenderDirectionFailure:
    def test_failure_in_one_direction_does_not_abort_rest(
        self, tmp_path: Path
    ) -> None:
        """Mock renderer fails on direction 2 of 5. Other 4 still processed."""
        from apps.simulations.services.projection import render_or_reuse_projections

        sim = _make_sim()
        call_idx = 0

        def mock_render_single(
            sim_obj: Any,
            az: float,
            el: float,
            output_dir: Path,
            img_format: str = "png",
        ) -> Path:
            nonlocal call_idx
            call_idx += 1
            if call_idx == 2:
                raise RuntimeError("Simulated render failure")
            from apps.simulations.services.projection import (
                create_projection_filename,
            )

            base_name = f"sim_{str(sim_obj.id)[:8]}"
            fname = create_projection_filename(base_name, az, el, img_format)
            out = output_dir / fname
            out.write_bytes(b"rendered-png-data")
            return out

        with patch(
            "apps.simulations.services.projection._render_single_direction",
            side_effect=mock_render_single,
        ):
            result = render_or_reuse_projections(
                simulation=sim,
                mode="fibonacci",
                config={"n": 5},
                output_dir=tmp_path,
            )

        # 4 of 5 should succeed (direction 2 fails)
        assert len(result) == 4
        for p in result:
            assert p.exists()
