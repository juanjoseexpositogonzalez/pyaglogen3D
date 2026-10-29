"""Regression tests for the single-image FRAKTAL-from-simulation path.

Before the hotfix, both ``run_fraktal_analysis_task`` and
``run_fraktal_auto_calibrate_task`` passed ``resolution=...`` and
``format="raw"`` kwargs to ``aglogen_core.project_to_2d`` and then read
``projection_result.image`` — none of which exist on the Rust binding.
Any user triggering FRAKTAL analysis from a simulation (instead of an
uploaded image) hit ``TypeError: project_to_2d() got an unexpected
keyword argument 'resolution'``.

These tests lock in the fix:

1. The new ``_rasterize_projection_to_grayscale`` helper returns a 2D
   ``uint8`` array matching the shape the FRAKTAL analyzer expects.
2. The task path calls ``project_to_2d`` with only supported kwargs and
   rasterizes the result — no ``TypeError`` raised at the binding edge.
"""

from __future__ import annotations

import io
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from apps.fractal_analysis.tasks import _rasterize_projection_to_grayscale


class TestRasterizeProjectionHelper:
    """Unit tests for the rasterizer helper (no Django DB needed)."""

    def test_returns_2d_uint8_array_of_requested_size(self) -> None:
        """Helper output matches the shape FRAKTAL analyzers expect."""
        proj = SimpleNamespace(
            x=[0.0, 1.0, 2.0],
            y=[0.0, 1.0, 2.0],
            radii=[0.5, 0.5, 0.5],
            bounds=[-1.0, 3.0, -1.0, 3.0],  # (min_x, max_x, min_y, max_y)
        )
        out = _rasterize_projection_to_grayscale(proj, img_size=128)

        assert isinstance(out, np.ndarray)
        assert out.ndim == 2, f"expected 2D array, got shape {out.shape}"
        assert out.dtype == np.uint8
        # The matplotlib renderer is square when img_size is set — both
        # dimensions should match img_size.
        assert out.shape == (128, 128), f"unexpected shape: {out.shape}"

    def test_empty_projection_produces_blank_canvas(self) -> None:
        """No particles still produces a valid uint8 array."""
        proj = SimpleNamespace(
            x=[],
            y=[],
            radii=[],
            bounds=[0.0, 1.0, 0.0, 1.0],
        )
        out = _rasterize_projection_to_grayscale(proj, img_size=64)
        assert out.shape == (64, 64)
        assert out.dtype == np.uint8


@pytest.mark.django_db
class TestSingleImageFraktalFromSimulation:
    """Regression: the task path no longer raises TypeError at project_to_2d."""

    def test_project_to_2d_called_without_invalid_kwargs(self) -> None:
        """``run_fraktal_analysis_task`` must not pass ``resolution``/``format``.

        Previously the task call site used:
            aglogen_core.project_to_2d(..., resolution=..., format="raw")
        which immediately raised ``TypeError`` on the PyO3 binding.

        Here we spy on ``aglogen_core.project_to_2d`` and assert the kwargs
        only contain values the binding actually accepts. A successful
        rasterization + analysis is mocked so the test stays hermetic.
        """
        from apps.accounts.models import User
        from apps.fractal_analysis.models import (
            FraktalAnalysis,
            SourceType,
        )
        from apps.fractal_analysis.tasks import run_fraktal_analysis_task
        from apps.projects.models import Project
        from apps.simulations.models import Simulation, SimulationStatus

        # Seed project + simulation with a minimal geometry payload
        user = User.objects.create_user(
            email=f"fraktal-regression-{uuid.uuid4()}@example.com",
            password="irrelevant",
        )
        project = Project.objects.create(name="Fraktal regression", owner=user)
        coords = np.array(
            [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 2.0, 0.0]], dtype=np.float64
        )
        radii = np.ones((coords.shape[0], 1), dtype=np.float64)
        geometry = np.hstack([coords, radii])
        buf = io.BytesIO()
        np.save(buf, geometry)
        sim = Simulation.objects.create(
            project=project,
            algorithm="cca",
            parameters={"n_particles": 3, "primary_particle_diameter_nm": 20.0},
            seed=42,
            status=SimulationStatus.COMPLETED,
            geometry=buf.getvalue(),
        )
        analysis = FraktalAnalysis.objects.create(
            project=project,
            source_type=SourceType.SIMULATION_PROJECTION,
            simulation=sim,
            model="granulated_2012",
            npix=100.0,
            dpo=40.0,
            delta=1.1,
            correction_3d=False,
            pixel_min=10,
            pixel_max=240,
            npo_limit=5,
            escala=100.0,
            projection_params={"azimuth": 0.0, "elevation": 0.0, "resolution": 256},
        )

        fake_proj = SimpleNamespace(
            x=[0.0, 1.0],
            y=[0.0, 1.0],
            radii=[0.5, 0.5],
            bounds=[-1.0, 2.0, -1.0, 2.0],
        )
        fake_result = SimpleNamespace(
            rg=1.0,
            ap=1.0,
            df=1.8,
            npo=5,
            npo_visual=5,
            kf=1.2,
            zf=0.5,
            jf=0.3,
            volume=1.0,
            mass=1.0,
            surface_area=1.0,
            status="success",
            model="granulated_2012",
            npo_ratio=1.0,
            npo_aligned=True,
            dpo_estimated=40.0,
            execution_time_ms=10,
        )

        with (
            patch(
                "apps.fractal_analysis.tasks.aglogen_core.project_to_2d",
                return_value=fake_proj,
            ) as mock_project,
            patch(
                "apps.fractal_analysis.tasks.aglogen_core.fraktal_granulated_2012",
                return_value=fake_result,
            ),
            patch(
                "apps.fractal_analysis.tasks.aglogen_core.version",
                return_value="test-version",
            ),
        ):
            run_fraktal_analysis_task(str(analysis.id))

        # project_to_2d was called
        assert mock_project.call_count == 1
        call_kwargs = mock_project.call_args.kwargs
        # The fix: only the 4 supported kwargs are passed — never
        # ``resolution`` or ``format`` (which would raise TypeError).
        assert "resolution" not in call_kwargs
        assert "format" not in call_kwargs
        assert set(call_kwargs.keys()) <= {
            "coordinates",
            "radii",
            "azimuth",
            "elevation",
        }
