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


def _post(
    api_client: APIClient, project: Project, **overrides: Any
) -> Any:
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
}


@pytest.mark.parametrize("case", sorted(INVALID))
def test_r12_an_invalid_setting_writes_nothing(
    api_client: APIClient, project: Project, dispatch: Any, case: str
) -> None:
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(api_client, project, **INVALID[case])

    assert resp.status_code == 400, f"{case} was accepted: {resp.data}"
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


def test_r12_1_the_first_entry_alone_would_have_been_accepted(
    api_client: APIClient, project: Project, dispatch: Any
) -> None:
    """R12.1's grid is rejected for its second entry, not its shape: the
    first one on its own creates the study, so the scenario really does
    pin 'one invalid entry is enough'."""
    resp = _post(
        api_client,
        project,
        parameter_grid={
            "n_particles": [100, 200],
            "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.9}],
        },
    )

    assert resp.status_code == 201, resp.data
