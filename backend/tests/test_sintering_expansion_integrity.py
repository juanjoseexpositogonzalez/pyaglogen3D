"""R12 — an invalid sintering setting creates nothing.

Contract: openspec/changes/sintering-reaches-engine, T5.

Validation must run before the first write. The system must not lean on
`apply_sintering_config` raising during expansion: by then the study row
exists and some children are already queued, and `perform_create`
(`views.py:1750`) wraps the expansion in neither `try/except` nor
`transaction.atomic`. The project defines no `ATOMIC_REQUESTS`, and
`run_simulation_task.delay` is called inside the per-seed loop, so a
dispatched task would not be undone by a database rollback either.

Each case therefore counts rows **and** dispatches, before and after.
"""

from __future__ import annotations

import time
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"t5-{uuid.uuid4()}@example.com",
        password="testpass123",
    )
    return created


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="T5 Expansion Integrity", owner=user)


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def dispatch() -> Any:
    """The seam that a database rollback would not undo."""
    with patch("apps.simulations.views.run_simulation_task") as mock_task:
        mock_task.delay.return_value = MagicMock(id="fake-celery-task-id")
        yield mock_task


def _post(api_client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "R12 study",
        "base_algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


#: Every invalid setting R12.1 and R12.2 name, one per input surface.
INVALID: dict[str, dict[str, Any]] = {
    "R12.1 — a grid whose second entry is the selector shape": {
        "parameter_grid": {
            "n_particles": [100, 200],
            "sintering_config": [
                {"distribution_type": "fixed", "coefficient": 0.9},
                {"mode": "normal", "mean": 0.8, "std": 0.05},
            ],
        }
    },
    "R12.2 — base_parameters dict without min/max": {
        "base_parameters": {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "sintering_config": {"distribution_type": "uniform"},
        }
    },
    "R12.2 — a flat coefficient out of range": {
        "base_parameters": {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "sintering_coeff": 42.0,
        }
    },
    "R12.2 — the legacy key nothing reads, swept": {
        "include_limiting_cases": True,
        "limiting_cases_config": {"theoretical_extremes": {"sintering_mean": [0.9]}},
    },
    "R12.2 — surface 2: the study field with an out-of-range std": {
        "sintering_config": {"distribution_type": "normal", "mean": 0.8, "std": 0.3}
    },
    "R12.2 — surface 5: a swept coefficient out of range": {
        "parameter_grid": {"sintering_coeff": [0.6, 42.0]}
    },
    "R12.2 — surface 7: the selector shape, swept": {
        "include_limiting_cases": True,
        "limiting_cases_config": {
            "theoretical_extremes": {
                "sintering_config": [{"mode": "normal", "mean": 0.8, "std": 0.05}]
            }
        },
    },
}


@pytest.mark.parametrize("case", sorted(INVALID))
def test_r12_an_invalid_setting_writes_nothing(
    api_client: APIClient, project: Project, dispatch: Any, case: str
) -> None:
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(api_client, project, **INVALID[case])

    assert resp.status_code == 400, f"{case} was accepted: {resp.data}"
    assert "sintering" in str(resp.data).lower(), (
        f"{case} was rejected, but not for its sintering setting: {resp.data}"
    )
    assert (ParametricStudy.objects.count(), Simulation.objects.count()) == before, (
        f"{case} wrote rows before rejecting"
    )
    assert dispatch.delay.call_count == 0, (
        f"{case} queued {dispatch.delay.call_count} task(s); a rollback would not undo them"
    )


def test_r12_a_valid_setting_still_writes_and_queues(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """Without this, a serializer that rejected everything would pass above."""
    resp = _post(
        api_client,
        project,
        parameter_grid={
            "n_particles": [100, 200],
            "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.9}],
        },
    )

    assert resp.status_code == 201, resp.data
    study = ParametricStudy.objects.get(id=resp.data["id"])
    assert study.simulations.count() == 2
    assert dispatch.delay.call_count == 2


# --- The three R12 violations Judgment Day found alive in the code ----------


@pytest.mark.parametrize(
    ("case", "overrides"),
    [
        (
            "surface 5: a flat key that is not a list",
            {"parameter_grid": {"sintering_coeff": 0.7}},
        ),
        (
            "surface 6: a flat key that is not a list",
            {
                "include_limiting_cases": True,
                "limiting_cases_config": {
                    "theoretical_extremes": {"sintering_coeff": 0.7}
                },
            },
        ),
    ],
)
def test_r12_a_scalar_on_a_swept_surface_writes_nothing(
    api_client: APIClient,
    project: Project,
    dispatch: Any,
    case: str,
    overrides: dict[str, Any],
) -> None:
    """Surfaces 5 and 6 are swept: their values arrive as lists, one child per
    element. A bare scalar passed validation and blew up mid-expansion -
    `itertools.product` for the grid, the `for val in extreme_values` loop at
    `utils.py:202` for the extremes - after the study row existed and, for
    surface 6, after a child had been created and its task queued.
    """
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(api_client, project, **overrides)

    assert resp.status_code == 400, f"{case} was accepted: {resp.data}"
    assert "sintering" in str(resp.data).lower(), (
        f"{case} was rejected, but not for its sintering setting: {resp.data}"
    )
    assert (ParametricStudy.objects.count(), Simulation.objects.count()) == before, (
        f"{case} left an orphan study behind"
    )
    assert dispatch.delay.call_count == 0, f"{case} queued a task before failing"


def test_r12_a_sweep_whose_later_element_is_invalid_writes_nothing(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """The required-key check read only the first element of each swept key,
    so this returned 201 and stored a child as uniform with no min/max. The
    worker then ran it as uniform 0.85-0.95 (`tasks.py:1596-1598`): stored
    parameters that do not describe what ran, which is the harm this contract
    exists to close.
    """
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(
        api_client,
        project,
        parameter_grid={
            "sintering_type": ["fixed", "uniform"],
            "sintering_coeff": [0.6],
        },
    )

    assert resp.status_code == 400, (
        f"a child would run as uniform 0.85-0.95: {resp.data}"
    )
    assert "sintering" in str(resp.data).lower(), resp.data
    assert (ParametricStudy.objects.count(), Simulation.objects.count()) == before
    assert dispatch.delay.call_count == 0


def test_r12_a_fully_specified_sweep_is_still_accepted(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """The guard above must not reject a sweep that gives every element the
    shape its own type requires."""
    resp = _post(
        api_client,
        project,
        parameter_grid={
            "sintering_type": ["fixed", "uniform"],
            "sintering_coeff": [0.6],
            "sintering_min": [0.7],
            "sintering_max": [0.9],
        },
    )

    assert resp.status_code == 201, resp.data
    assert dispatch.delay.call_count > 0


def test_r12_a_valid_swept_extreme_is_still_accepted(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """Surface 6 with a proper list keeps working, as R11.5 requires."""
    resp = _post(
        api_client,
        project,
        include_limiting_cases=True,
        limiting_cases_config={"theoretical_extremes": {"sintering_coeff": [0.7, 0.9]}},
    )

    assert resp.status_code == 201, resp.data


# --- Round 2: what the first fix broke, and what it made expensive ---------


def test_r12_an_empty_sweep_does_not_disable_the_required_check(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """An empty list is still a swept key, so the first fix took the base
    projection down the product branch, where `product()` yields nothing and
    the check never ran. This payload returned 400 before that fix and 201
    after it: the guard disappeared in silence."""
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(
        api_client,
        project,
        base_parameters={
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "sintering_type": "uniform",
            "sintering_min": 0.8,
        },
        parameter_grid={"n_particles": [100, 200], "sintering_coeff": []},
    )

    assert resp.status_code == 400, f"the required-key guard vanished: {resp.data}"
    assert "sintering_max" in str(resp.data), resp.data
    assert (ParametricStudy.objects.count(), Simulation.objects.count()) == before
    assert dispatch.delay.call_count == 0


@pytest.mark.parametrize(
    ("surface", "overrides"),
    [
        (
            "study field",
            {
                "base_parameters": {
                    "n_particles": 100,
                    "target_df": 1.8,
                    "target_kf": 1.3,
                    "sintering_coeff": 0.6,
                },
                "sintering_config": {
                    "distribution_type": "uniform",
                    "min": 0.8,
                    "max": 0.9,
                },
                "parameter_grid": {"sintering_type": ["fixed", "uniform"]},
            },
        ),
        (
            "grid dict",
            {
                "parameter_grid": {
                    "sintering_type": ["fixed", "uniform"],
                    "sintering_config": [
                        {"distribution_type": "uniform", "min": 0.8, "max": 0.9}
                    ],
                },
            },
        ),
    ],
)
def test_r12_a_dict_setting_still_wins_over_the_flat_projection(
    api_client: APIClient, project: Project, surface: str, overrides: dict[str, Any]
) -> None:
    """R3 keeps the precedence this contract does not change: any dict wins
    over any flat key, and `apply_sintering_config` overwrites the flats
    before the child is stored. Projecting the flats as if the dict were not
    there rejected payloads whose every child is shape-valid."""
    resp = _post(api_client, project, **overrides)

    assert resp.status_code == 201, f"{surface}: {resp.data}"


def test_r12_validating_a_sweep_cannot_cost_more_than_the_batch_cap_allows(
    api_client: APIClient, project: Project
) -> None:
    """The projection ran before the batch cap, so a ~1 KB body could ask for
    millions of combinations and spend minutes inside validation - on a
    request the cap was always going to reject. The cap needs only the
    product of the lengths, so it is cheap and must come first."""
    start = time.monotonic()

    resp = _post(
        api_client,
        project,
        parameter_grid={
            "sintering_coeff": [0.6] * 40,
            "sintering_min": [0.7] * 40,
            "sintering_max": [0.9] * 40,
            "sintering_std": [0.05] * 40,
        },
    )

    elapsed = time.monotonic() - start
    assert resp.status_code == 400, resp.data
    assert "batch size" in str(resp.data).lower(), resp.data
    assert elapsed < 2.0, f"validation took {elapsed:.1f}s for a request the cap rejects"


# --- Round 2, second judge: the dict sibling of the same surface -----------


def test_r12_a_bare_dict_on_the_swept_dict_surface_writes_nothing(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """Surface 7 is swept too, and the first guard only covered the flat keys:
    it skipped `sintering_config`, its dict sibling. A bare dict there was
    accepted, and the expansion then iterated the dict's own keys
    (`utils.py:201-202`), writing `sintering_config="distribution_type"` into
    each child until `apply_sintering_config` raised - after the study, four
    children and four queued tasks already existed.
    """
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(
        api_client,
        project,
        parameter_grid={"n_particles": [100, 200]},
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {
                "sintering_config": {"distribution_type": "fixed", "coefficient": 0.9}
            }
        },
    )

    assert resp.status_code == 400, f"500 with four queued tasks: {resp.data}"
    assert "sintering" in str(resp.data).lower(), resp.data
    assert (ParametricStudy.objects.count(), Simulation.objects.count()) == before
    assert dispatch.delay.call_count == 0


def test_r12_a_swept_dict_in_a_list_is_still_accepted(
    api_client: APIClient, project: Project
) -> None:
    """R3.9 requires the well-formed swept dict to keep working."""
    resp = _post(
        api_client,
        project,
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {
                "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.9}]
            }
        },
    )

    assert resp.status_code == 201, resp.data


@pytest.mark.parametrize(
    ("case", "overrides"),
    [
        (
            "a dict where a type belongs",
            {
                "base_parameters": {
                    "n_particles": 100,
                    "target_df": 1.8,
                    "target_kf": 1.3,
                    "sintering_type": {"a": 1},
                }
            },
        ),
        (
            "a nested list where a type belongs",
            {"parameter_grid": {"sintering_type": [["fixed"]]}},
        ),
    ],
)
def test_r12_an_unhashable_sintering_type_is_rejected_not_crashed(
    api_client: APIClient, project: Project, case: str, overrides: dict[str, Any]
) -> None:
    """The membership test raised TypeError on an unhashable value, so the
    caller got a 500 where R12 requires a 400. No row was written, but a 500
    is not a useful rejection."""
    resp = _post(api_client, project, **overrides)

    assert resp.status_code == 400, f"{case} crashed instead of being rejected"
    assert "sintering_type" in str(resp.data), resp.data


def test_r12_a_later_invalid_element_on_the_extremes_surface_is_rejected(
    api_client: APIClient, project: Project
) -> None:
    """Surface 6 expands one child per value (`utils.py:199-203`), so its
    second element gets the same treatment as the grid's. Deleting the
    extremes branch of the projection left every test green before this."""
    resp = _post(
        api_client,
        project,
        base_parameters={
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "sintering_coeff": 0.6,
        },
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {"sintering_type": ["fixed", "uniform"]}
        },
    )

    assert resp.status_code == 400, resp.data
    assert "sintering_min" in str(resp.data) or "sintering_max" in str(resp.data), resp.data

