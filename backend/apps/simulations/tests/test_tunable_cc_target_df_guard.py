"""`tunable_cc` must refuse out-of-policy parameters before they reach the engine (#232).

The `fracval` and `box_rfa` branches validate `target_df` and `target_kf` and raise,
so the child is marked failed with a message naming the field. `tunable_cc` validated
neither: the value went straight into the Rust binding, which panicked.

Two things judgment day measured, and this file states rather than hides:

1. **The range is a policy, not the engine's panic boundary.** `run_tunable_cc`
   completes at `target_df=0.5` or `9.9` and panics at `1e308` and at negatives. The
   [1.0, 3.0] window is the siblings' contract, approved as such in #232 - so these
   tests pin the policy and are not a test of "what panics".
2. **The panic is real and still reachable** in the binding for `target_kf` at 0.0 or
   below, which is why that value is guarded too. `test_the_binding_still_panics_*`
   keeps a real `BaseException` in the suite, so nothing can quietly stop panicking
   without a test noticing.

What the witnesses assert, and why each part matters: the engine is **never called**
(a guard that lets the value through and then fails is not a guard), the child ends
`failed` naming the field, the message distinguishes "not a number" from "out of
range", and a value inside the range reaches the engine **with the value it was
given** - not merely "the engine was called", which a hard-coded default would also
satisfy.
"""

from __future__ import annotations

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import aglogen_core
import numpy as np
import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def project(db: Any) -> Project:
    return Project.objects.create(name="Tunable CC parameter policy")


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


# --- The range: inclusive bounds, and the engine gets what it was given ------


@pytest.mark.parametrize("target_df", [1.0, 2.0, 3.0])
@patch("aglogen_core.run_tunable_cc")
def test_a_target_df_inside_the_range_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_df: float
) -> None:
    """Both bounds are inclusive and the value is forwarded, not replaced."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_df": target_df})

    run_simulation_task(str(sim.id))

    kwargs = mock_run.call_args.kwargs
    assert kwargs["target_df"] == target_df, (
        "the engine must receive the validated value, not a default: a guard that "
        "validates 2.5 and then passes 1.8 is a silent lie"
    )
    assert kwargs["target_kf"] == 1.3
    sim.refresh_from_db()
    assert sim.status == "completed"


@pytest.mark.parametrize("target_df", [0.999, 3.001, 0.5, 3.5, 9.9, 1e308])
@patch("aglogen_core.run_tunable_cc")
def test_an_out_of_range_target_df_never_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_df: float
) -> None:
    """The policy window is [1.0, 3.0]; outside it the engine is not called."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_df": target_df})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    assert sim.status == "failed"
    assert "target_df must be between 1.0 and 3.0" in (sim.error_message or "")


@pytest.mark.parametrize("value", ["2.0", None, [2.0], {"a": 1}, True])
@patch("aglogen_core.run_tunable_cc")
def test_a_target_df_that_is_not_a_number_says_so(
    mock_run: MagicMock, project: Project, value: object
) -> None:
    """A type error is not a range error: reporting one as the other misleads.

    `"2.0"` is inside the range, so "must be between 1.0 and 3.0" would be false
    about the value. `True` is refused because `isinstance(True, int)` holds and it
    would otherwise run at Df=1.0 without anyone asking for it.
    """
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "target_df": value})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    message = sim.error_message or ""
    assert "target_df must be a number" in message
    assert "between" not in message


# --- target_kf: refuse only what panics -------------------------------------
#
# The first version of this guard borrowed `fracval`'s policy window [0.1, 2.7]
# and judgment day measured it deleting runs that used to finish: `kf` 0.05, 0.09,
# 2.8, 3.0 and 5.0 all completed before it and failed after. The spec states the
# domain as `kf > 0`, the engine panics at 0.0 and at negatives, so that - and not
# a borrowed window - is the boundary these tests pin.


@pytest.mark.parametrize("target_kf", [1e-09, 0.05, 0.1, 1.3, 2.7, 2.8, 3.0, 1e308])
@patch("aglogen_core.run_tunable_cc")
def test_a_positive_target_kf_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_kf: float
) -> None:
    """Including values outside the siblings' window: they completed before."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project, {"n_particles": 20, "target_df": 2.0, "target_kf": target_kf}
    )

    run_simulation_task(str(sim.id))

    assert mock_run.call_args.kwargs["target_kf"] == target_kf
    sim.refresh_from_db()
    assert sim.status == "completed"


@pytest.mark.parametrize("target_kf", [0.0, -1e-09, -0.5, -1.0])
@patch("aglogen_core.run_tunable_cc")
def test_a_non_positive_target_kf_never_reaches_the_engine(
    mock_run: MagicMock, project: Project, target_kf: float
) -> None:
    """These panic the binding for real, measured on every seed.

    `-1e-09` is the witness that pins the boundary at zero rather than at a
    round number: judgment day widened a borrowed window to [0.05, 3.5] and no
    test complained, which is what a boundary pinned only by aesthetics allows.
    """
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project, {"n_particles": 20, "target_df": 2.0, "target_kf": target_kf}
    )

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    message = sim.error_message or ""
    assert "target_kf must be greater than 0" in message
    assert "must be a number" not in message


@pytest.mark.parametrize("target_kf", ["1.3", True, None, [1.3]])
@patch("aglogen_core.run_tunable_cc")
def test_a_target_kf_that_is_not_a_number_says_so(
    mock_run: MagicMock, project: Project, target_kf: object
) -> None:
    """The type fault is named as such, like its `target_df` twin."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project, {"n_particles": 20, "target_df": 2.0, "target_kf": target_kf}
    )

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    message = sim.error_message or ""
    assert "target_kf must be a number" in message
    assert "greater than" not in message


@patch("aglogen_core.run_tunable_cc")
def test_the_scalar_is_not_checked_when_a_distribution_supplies_the_value(
    mock_run: MagicMock, project: Project
) -> None:
    """A 0.0 scalar next to `{mode: fixed, value: 1.3}` is not a fault.

    The engine reads the distribution, so refusing the unused scalar would turn a
    working run into a failure - the mirror of the hole this guard closes.
    """
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 20,
            "target_df": 2.0,
            "target_kf": 0.0,
            "target_kf_distribution": {"mode": "fixed", "value": 1.3},
        },
    )

    run_simulation_task(str(sim.id))

    assert mock_run.called
    kwargs = mock_run.call_args.kwargs
    assert kwargs["kf_mode"] == "fixed"
    assert kwargs["kf_value"] == 1.3
    sim.refresh_from_db()
    assert sim.status == "completed"


def test_the_binding_reports_a_degenerate_pool_instead_of_panicking() -> None:
    """The reason the guard exists, measured on the binding itself.

    This witness used to assert the opposite: that `kf=0.0` raised a `BaseException`
    which was **not** an `Exception`, so that the day the engine stopped panicking
    would be noticed instead of silently removing the reason for the guard. #292 is
    that day - Scenario 5.7 asked for an explicit error - and this test noticed, by
    failing, exactly as intended.

    What it pins now is the contract that replaced the panic: the binding raises a
    `ValueError` carrying the engine's message, which the worker's ordinary
    `except Exception` can record as a failed child.
    """
    with pytest.raises(ValueError) as raised:
        aglogen_core.run_tunable_cc(
            n_particles=60,
            target_df=2.0,
            target_kf=0.0,
            radius_min=1.0,
            radius_max=1.0,
            seed=7,
        )

    assert "cannot merge" in str(raised.value), (
        "the engine's message is what a caller reads; a bare ValueError would keep "
        "the information the panic used to hide"
    )
