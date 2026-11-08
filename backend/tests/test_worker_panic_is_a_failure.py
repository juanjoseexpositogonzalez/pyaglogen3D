"""#115, point 15 - a Rust panic must leave a failed simulation, not a stuck one.

Measured on develop: `aglogen_core` answers some inputs with `PanicException`,
which derives from `BaseException` and therefore escapes the worker's single
`except Exception`. In eager mode it propagates out of the task; in production the
task dies and the row keeps its previous status, so the study stays `running` and
its child never reaches a terminal state.

The point records two candidate fixes and prefers this one - catch the panic and
record a failure - over an upper bound on `std`, because the set of inputs that
panic the engine has never been enumerated and any new hole would produce the same
silent hang. #232 is the same root cause reached through `target_df`; a per-input
range guard there fixes one door, this fixes the mechanism.

The trigger below is deterministic (`target_df = 1e308` panics on every seed, as
measured in #232); `kf_std = 100.0`, the one this point records, panics on 12 of
20 seeds and would make a flaky witness.
"""

from __future__ import annotations

import uuid

import pytest

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def simulation(db: None) -> Simulation:
    user: User = User.objects.create_user(
        email=f"panic-{uuid.uuid4()}@example.com", password="x"
    )
    project = Project.objects.create(name="panic", owner=user)
    return Simulation.objects.create(
        project=project,
        name="Panicking run",
        algorithm="tunable_cc",
        # `1e308` is finite, passes every range check the engine has, and makes
        # `run_tunable_cc` panic inside the Rust binding.
        parameters={"n_particles": 60, "target_df": 1e308, "target_kf": 1.3},
        seed=1,
        status=SimulationStatus.QUEUED,
        is_batch=True,
    )


def test_a_rust_panic_leaves_a_failed_simulation(simulation: Simulation) -> None:
    result = run_simulation_task(str(simulation.id))

    simulation.refresh_from_db()
    assert simulation.status == SimulationStatus.FAILED, (
        f"the panic left the simulation in {simulation.status!r} - nothing will ever "
        "settle it"
    )
    assert simulation.error_message, "a failed simulation must say why"
    assert simulation.completed_at is not None
    assert result["status"] == "failed", result


def test_an_operator_interrupt_is_not_recorded_as_a_failure(
    simulation: Simulation, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other half: a worker being stopped is not a broken simulation.

    Catching `BaseException` outright would swallow `KeyboardInterrupt` and
    `SystemExit`, so a deploy or a Ctrl-C would mark healthy work as failed.
    """

    def explode(*args: object, **kwargs: object) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr("aglogen_core.run_tunable_cc", explode, raising=False)

    with pytest.raises(KeyboardInterrupt):
        run_simulation_task(str(simulation.id))

    simulation.refresh_from_db()
    # The task marks the row RUNNING before its try block, so the assertion is
    # that the interrupt did not turn it into a FAILURE - measured while writing
    # it: the first version of this test expected QUEUED and was wrong.
    assert simulation.status != SimulationStatus.FAILED, (
        "a stopped worker must not record healthy work as broken"
    )
    assert simulation.error_message == ""
