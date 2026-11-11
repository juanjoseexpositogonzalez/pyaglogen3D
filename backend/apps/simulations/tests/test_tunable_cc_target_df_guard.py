"""`tunable_cc` must refuse an out-of-range `target_df` before it reaches the engine (#232).

The `fracval` and `box_rfa` branches validate `target_df` and raise, so the child is
marked failed with a message. `tunable_cc` had no such check: the value went straight
into the Rust engine, which panicked with `select_pair_smart called with empty pool`.

A `PanicException` derives from `BaseException`, so the guard added in #115 point 15
does catch it and the child no longer stays `running` - but a worker is spent on a
panic, and the caller reads a crash instead of the field it got wrong. These tests pin
the range check itself, which is what makes the outcome the same as its siblings'.

What they assert, and why each part matters:

- the engine is **never called**: with the check the value cannot reach it, and that is
  the difference the fix makes;
- the child ends `failed` with a message naming `target_df`, so the caller can act;
- a valid `target_df` still runs, so the guard cannot be satisfied by refusing
  everything.
"""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def project(db: Any) -> Project:
    return Project.objects.create(name="Tunable CC target_df guard")


@pytest.fixture(autouse=True)
def _silence_side_effects() -> Iterator[None]:
    """Stub post-run side-effects that need richer DB fixtures."""
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured",
            return_value=None,
        ),
    ):
        yield


def _fake_engine_result(n: int = 2) -> SimpleNamespace:
    """Minimal stand-in for an engine result."""
    return SimpleNamespace(
        coordinates=np.zeros((n, 3), dtype=np.float64),
        radii=np.ones(n, dtype=np.float64),
        fractal_dimension=1.8,
        fractal_dimension_std=0.0,
        prefactor=1.0,
        radius_of_gyration=1.0,
        porosity=0.5,
        coordination_mean=2.0,
        coordination_std=0.0,
        rg_evolution=np.array([], dtype=np.float64),
        anisotropy=1.0,
        asphericity=0.0,
        acylindricity=0.0,
        principal_moments=np.array([1.0, 1.0, 1.0]),
        principal_axes=np.eye(3),
        execution_time_ms=1,
    )


def _make_sim(project: Project, parameters: dict[str, Any]) -> Simulation:
    return Simulation.objects.create(
        project=project,
        algorithm="tunable_cc",
        parameters=parameters,
        seed=42,
    )


@pytest.mark.parametrize("target_df", [1e308, "1e308", 0.5, 3.5])
@patch("aglogen_core.run_tunable_cc")
def test_out_of_range_target_df_never_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_df: object
) -> None:
    """The check happens before the call, so no panic can be produced."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_df": target_df})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    assert sim.status == "failed"
    assert "target_df" in (sim.error_message or "")


@patch("aglogen_core.run_tunable_cc")
def test_a_valid_target_df_still_runs(
    mock_run: MagicMock, project: Project
) -> None:
    """The guard must not be satisfiable by refusing everything."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_df": 2.0})

    run_simulation_task(str(sim.id))

    assert mock_run.called
    sim.refresh_from_db()
    assert sim.status == "completed"
