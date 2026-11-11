"""`tunable` must refuse a non-positive `target_kf` before it reaches the engine (#293).

`tunable_cc` got this guard in #232; its sibling did not, and the consequence is
worse than a crash: `run_tunable(target_kf=0.0)` never returns. The task dispatched
for it is still running after 25 s, so the child stays `queued` for ever and the
study never settles - the harm #232 named, one branch over.

`-1.0` and `1e308` do not hang, they come back with a result that ignores the value
asked for. That is a different failure mode and it is not fixed here: these tests pin
the boundary the engine actually has (`kf > 0`, measured in #232 against the same
binding family), not an upper bound nobody has measured.

The witnesses assert the engine is **never called** - the only assertion that can
tell a guard from a lucky mock - and that the child fails naming `target_kf`.
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
    return Project.objects.create(name="Tunable target_kf guard")


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
        algorithm="tunable",
        parameters=parameters,
        seed=42,
    )


@pytest.mark.parametrize("target_kf", [0.0, -1.0, -1e-09])
@patch("aglogen_core.run_tunable")
def test_a_non_positive_target_kf_never_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_kf: float
) -> None:
    """`kf=0.0` never returns from the engine; the guard must answer first."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_kf": target_kf})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    assert sim.status == "failed"
    message = sim.error_message or ""
    assert "target_kf must be greater than 0" in message
    assert "must be a number" not in message


@pytest.mark.parametrize("target_kf", [0.05, 1.3, 3.0])
@patch("aglogen_core.run_tunable")
def test_a_positive_target_kf_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_kf: float
) -> None:
    """The boundary is zero, so nothing above it is refused."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_kf": target_kf})

    run_simulation_task(str(sim.id))

    assert mock_run.call_args.kwargs["target_kf"] == target_kf
    sim.refresh_from_db()
    assert sim.status == "completed"


@pytest.mark.parametrize("target_kf", ["1.3", True, None, [1.3]])
@patch("aglogen_core.run_tunable")
def test_a_target_kf_that_is_not_a_number_says_so(
    mock_run: MagicMock, project: Project, target_kf: object
) -> None:
    """A type fault is named as such, as on the `tunable_cc` side."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_kf": target_kf})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    message = sim.error_message or ""
    assert "target_kf must be a number" in message
    assert "greater than" not in message
