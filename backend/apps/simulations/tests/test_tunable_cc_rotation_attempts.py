"""`max_rotation_attempts` gets a window, a name, and one home (#290).

The `tunable_cc` branch forwarded whatever the request carried. Measured, a large
value does not crash and does not refuse: it runs, and the child sits `queued` while
the worker is still inside the call — the symptom #232 closed for a different
parameter, reached with a perfectly valid `target_df`.

`fracval`, in the same file, clamps its own attempts value silently
(`min(max(10, x), 10_000)`). That is the one shape this issue ruled out, because a
bigger value is **a different experiment, not a slower one**:

    n=20  attempts      50    0.015 s   df=2.1109  kf=1.1000
    n=20  attempts  100000   19.209 s   df=2.0420  kf=1.2082

So the value is refused with a message naming the field, never reinterpreted, and the
window is the siblings' policy window rather than a number read off a time curve —
time depends on `n` as much as on this value, so no fixed cap bounds it (that is the
engine-side time budget, its own issue).

Three things measured while writing this, stated rather than hidden:

1. **`null` is not "choose for me" here.** The binding declares
   `max_rotation_attempts: usize` — not `Option<usize>`, unlike `seed_cluster_size` —
   so a stored `null` reached it as `TypeError: 'NoneType' object cannot be
   interpreted as an integer`, and the child failed with a type error instead of a
   message. `null` therefore means the engine's own default, 50, which is what the
   signature already says when the argument is absent.
2. **A negative value was not a 400 either**: it reached `usize` as
   `OverflowError: can't convert negative int to unsigned`.
3. **The window is inclusive on both ends and the value is forwarded unchanged**, so a
   guard that validates 10_000 and then passes a default is a failing test here, not a
   passing one.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.tasks import run_simulation_task

#: The message both surfaces answer with. One string, asserted literally: the
#: serializer and the worker must not drift into two differently-worded refusals.
WINDOW_MESSAGE = "max_rotation_attempts must be between 1 and 10000"
TYPE_MESSAGE = "max_rotation_attempts must be a whole number"


@pytest.fixture
def project(db: Any) -> Project:
    return Project.objects.create(name="Rotation attempts policy")


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


# --- The worker: refuse, never reinterpret -----------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("attempts", [1, 50, 500, 10_000])
@patch("aglogen_core.run_tunable_cc")
def test_a_value_inside_the_window_reaches_the_engine_unchanged(
    mock_run: MagicMock, project: Project, attempts: int
) -> None:
    """Both bounds are inclusive and the number is forwarded, not replaced."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "max_rotation_attempts": attempts})

    run_simulation_task(str(sim.id))

    assert mock_run.call_args.kwargs["max_rotation_attempts"] == attempts, (
        "the engine must receive the validated value: a guard that accepts 10_000 "
        "and then passes a default is a silent reinterpretation"
    )
    sim.refresh_from_db()
    assert sim.status == "completed"


@pytest.mark.django_db
@pytest.mark.parametrize("attempts", [10_001, 100_000, 10_000_000])
@patch("aglogen_core.run_tunable_cc")
def test_a_value_above_the_window_never_reaches_the_engine(
    mock_run: MagicMock, project: Project, attempts: int
) -> None:
    """The measured hang: 1e7 ran past a minute and left the child without a state."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "max_rotation_attempts": attempts})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    assert sim.status == "failed"
    assert WINDOW_MESSAGE in (sim.error_message or "")


@pytest.mark.django_db
@pytest.mark.parametrize("attempts", [0, -1, -5])
@patch("aglogen_core.run_tunable_cc")
def test_zero_and_negative_values_are_refused_with_the_window(
    mock_run: MagicMock, project: Project, attempts: int
) -> None:
    """`0` completes with a different result and a negative died as an `OverflowError`.

    Both read as "a number the engine accepted", and neither is a value anyone asked
    six million rotations for: the refusal says which field and which window.
    """
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "max_rotation_attempts": attempts})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    message = sim.error_message or ""
    assert WINDOW_MESSAGE in message
    # The assertion that the value no longer reaches `usize`.
    assert "OverflowError" not in message


@pytest.mark.django_db
@pytest.mark.parametrize("value", ["80", 80.5, True, [80], {"attempts": 80}])
@patch("aglogen_core.run_tunable_cc")
def test_a_value_that_is_not_a_whole_number_says_so(
    mock_run: MagicMock, project: Project, value: object
) -> None:
    """A type error is not a range error: reporting one as the other misleads.

    `80.5` is inside the window, so "must be between 1 and 10000" would be false
    about it. `True` is refused because `isinstance(True, int)` holds and it would
    otherwise run as 1 attempt without anyone asking for it.
    """
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, {"n_particles": 20, "max_rotation_attempts": value})

    run_simulation_task(str(sim.id))

    mock_run.assert_not_called()
    sim.refresh_from_db()
    message = sim.error_message or ""
    assert TYPE_MESSAGE in message
    assert "between" not in message


@pytest.mark.django_db
@pytest.mark.parametrize(
    "parameters",
    [
        pytest.param({"n_particles": 20}, id="absent"),
        pytest.param({"n_particles": 20, "max_rotation_attempts": None}, id="null"),
    ],
)
@patch("aglogen_core.run_tunable_cc")
def test_absent_or_null_runs_at_the_engines_own_default(
    mock_run: MagicMock, project: Project, parameters: dict[str, Any]
) -> None:
    """`null` used to reach the binding and die as a TypeError, not as a message.

    The binding's signature declares 50 when the argument is absent, and unlike
    `seed_cluster_size` it does not take `None` at all, so "absent" is the only thing
    a stored `null` can honestly mean here.
    """
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(project, parameters)

    run_simulation_task(str(sim.id))

    assert mock_run.call_args.kwargs["max_rotation_attempts"] == 50
    sim.refresh_from_db()
    assert sim.status == "completed"


# --- The API: the same message, before a row is written ----------------------


@pytest.fixture
def api_client(db: Any) -> APIClient:
    user: User = User.objects.create_user(
        email=f"attempts-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def owned_project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="attempts-")
    return Project.objects.create(name="attempts", owner=user)


def _post(
    api_client: APIClient, project: Project, mocker: Any, **parameters: Any
) -> Any:
    mocker.patch(
        "apps.simulations.views.run_simulation_task.delay",
        return_value=mocker.Mock(id="task-id"),
    )
    return api_client.post(
        f"/api/v1/projects/{project.id}/simulations/",
        {
            "algorithm": "tunable_cc",
            "parameters": {"n_particles": 20, "target_df": 2.0, **parameters},
            "seed": 42,
        },
        format="json",
    )


@pytest.mark.django_db
@pytest.mark.parametrize("attempts", [1, 10_000])
def test_the_api_accepts_the_window(
    api_client: APIClient, owned_project: Project, mocker: Any, attempts: int
) -> None:
    response = _post(api_client, owned_project, mocker, max_rotation_attempts=attempts)

    assert response.status_code == 201, response.data


@pytest.mark.django_db
@pytest.mark.parametrize("attempts", [0, -1, 10_001, 10_000_000])
def test_the_api_refuses_a_value_outside_the_window_naming_the_field(
    api_client: APIClient, owned_project: Project, mocker: Any, attempts: int
) -> None:
    """The 400 half: the refusal arrives before a row exists."""
    before = Simulation.objects.count()

    response = _post(api_client, owned_project, mocker, max_rotation_attempts=attempts)

    assert response.status_code == 400, response.data
    assert WINDOW_MESSAGE in str(response.data)
    assert Simulation.objects.count() == before


@pytest.mark.django_db
@pytest.mark.parametrize("value", [80.5, "80", True])
def test_the_api_refuses_a_value_that_is_not_a_whole_number(
    api_client: APIClient, owned_project: Project, mocker: Any, value: object
) -> None:
    response = _post(api_client, owned_project, mocker, max_rotation_attempts=value)

    assert response.status_code == 400, response.data
    assert TYPE_MESSAGE in str(response.data)


@pytest.mark.django_db
def test_the_api_still_accepts_a_null(
    api_client: APIClient, owned_project: Project, mocker: Any
) -> None:
    """`null` was accepted before this change and stays accepted: the worker defaults.

    Turning an accepted payload into a 400 would be a contract change nobody approved;
    what was wrong was the worker's answer to it, not the serializer's.
    """
    response = _post(api_client, owned_project, mocker, max_rotation_attempts=None)

    assert response.status_code == 201, response.data
    sim = Simulation.objects.get(id=response.data["id"])
    assert sim.parameters["max_rotation_attempts"] is None
