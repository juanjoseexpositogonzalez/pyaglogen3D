"""#152 — a batch study stops saying `running` once its children are done.

Measured before writing this module: eight places write `simulation.status` and
none writes `study.status`, so a study created as `running` keeps saying that
forever even with every child completed. The counts the interface shows are
`SerializerMethodField`s computed per request, which is why the list *looks*
right while the status lies.

The hook is a `post_save` signal on `Simulation`: one place instead of the seven
call sites a future algorithm branch could forget. It only reacts to a child
reaching a terminal state, and only when the study is still running, so it is
idempotent.

The aggregation rule, written down because the contract does not state it: when
every child is terminal the study is `completed` if at least one child completed
- there are results to look at - and `failed` if none did.
"""

from __future__ import annotations

import uuid

import pytest

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation, SimulationStatus


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"study-status-{uuid.uuid4()}@example.com", password="x"
    )
    return created


def _study_with_children(user: User, children: int) -> ParametricStudy:
    """Built with the ORM, not through the API.

    This project's test settings run Celery eagerly, so posting a study actually
    executes its children and completes them - which made the first version of
    this module assert on a study that had already settled. These tests are about
    the aggregation, so they own the children's states.
    """
    project = Project.objects.create(name="study status", owner=user)
    study = ParametricStudy.objects.create(
        project=project,
        name="sweep",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        parameter_grid={"n_particles": [60, 120, 180][:children]},
        seeds_per_combination=1,
        status=SimulationStatus.RUNNING,
    )
    for index in range(children):
        child = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            seed=index,
            status=SimulationStatus.QUEUED,
        )
        study.simulations.add(child)
    assert study.simulations.count() == children
    return study


def _settle(child: Simulation, status: str) -> None:
    """The way the worker and the cancel endpoint do it: an instance save."""
    child.status = status
    child.save(update_fields=["status"])


def test_the_study_completes_when_every_child_completed(
    user: User
) -> None:
    study = _study_with_children(user, 2)
    assert study.status == SimulationStatus.RUNNING

    children = list(study.simulations.all())
    _settle(children[0], SimulationStatus.COMPLETED)
    study.refresh_from_db()
    assert study.status == SimulationStatus.RUNNING, "settled before the last child finished"

    _settle(children[1], SimulationStatus.COMPLETED)
    study.refresh_from_db()
    assert study.status == SimulationStatus.COMPLETED
    assert study.completed_at is not None


def test_a_partial_failure_still_completes_the_study(api_client: APIClient, user: User) -> None:
    """One child failed, one succeeded: there are results, so the study completed."""
    study = _study_with_children(user, 2)
    children = list(study.simulations.all())

    _settle(children[0], SimulationStatus.COMPLETED)
    _settle(children[1], SimulationStatus.FAILED)

    study.refresh_from_db()
    assert study.status == SimulationStatus.COMPLETED


def test_the_study_fails_when_no_child_completed(api_client: APIClient, user: User) -> None:
    study = _study_with_children(user, 2)
    children = list(study.simulations.all())

    for child in children:
        _settle(child, SimulationStatus.FAILED)

    study.refresh_from_db()
    assert study.status == SimulationStatus.FAILED


def test_a_running_child_keeps_the_study_running(api_client: APIClient, user: User) -> None:
    study = _study_with_children(user, 2)
    children = list(study.simulations.all())

    _settle(children[0], SimulationStatus.COMPLETED)

    study.refresh_from_db()
    assert study.status == SimulationStatus.RUNNING


def test_cancelling_the_last_running_child_settles_the_study(
    user: User
) -> None:
    """The cancel endpoint saves the child too, so the same hook covers it."""
    study = _study_with_children(user, 2)
    children = list(study.simulations.all())

    _settle(children[0], SimulationStatus.COMPLETED)
    _settle(children[1], SimulationStatus.CANCELLED)

    study.refresh_from_db()
    assert study.status == SimulationStatus.COMPLETED


def test_an_already_settled_study_is_not_touched_again(
    user: User
) -> None:
    """Idempotent: a later save on a child must not rewrite a settled study."""
    study = _study_with_children(user, 1)
    child = study.simulations.first()
    assert child is not None

    _settle(child, SimulationStatus.COMPLETED)
    study.refresh_from_db()
    assert study.status == SimulationStatus.COMPLETED

    child.error_message = "late note"
    child.save()

    study.refresh_from_db()
    assert study.status == SimulationStatus.COMPLETED
