"""#115, point 3 — the sintering-extremes children ignored their configured seed_type.

Measured by two judges of PR #204 while looking at something else: a study with
`base_parameters.seed_type = "dimers"`, a study-level `sintering_config` and
`include_limiting_cases` produces four `sintering_extreme` children whose
`parameters` still carry `seed_type: "dimers"` while `Simulation.seed_type` - the
field the worker reads - holds the model default `"monomers"`. The child runs with
monomers and its parameters say dimers, which is the family this issue is about:
a stored value that does not describe what runs.

`create_simulation` already does it right: it pops `seed_type` out of the payload
and passes it as the model field. The extremes block, which creates its children
inline, skipped that step.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"seedtype-{uuid.uuid4()}@example.com", password="x"
    )
    return created


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_the_sintering_extreme_children_run_with_the_configured_seed_type(
    api_client: APIClient, user: User
) -> None:
    project = Project.objects.create(name="seed type extremes", owner=user)
    payload: dict[str, Any] = {
        "name": "sweep",
        "base_algorithm": "tunable_cc",
        "base_parameters": {
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "seed_type": "dimers",
        },
        "parameter_grid": {"n_particles": [60]},
        "seeds_per_combination": 1,
        "include_limiting_cases": True,
        "sintering_config": {"distribution_type": "fixed", "coefficient": 0.8},
    }

    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )
    assert response.status_code == 201, response.data

    extremes = [
        sim
        for sim in Simulation.objects.filter(project=project, is_batch=True)
        if (sim.name or "").startswith("Tunable CC Simulation")
        and "sintering_extreme" in (sim.name or "")
    ] or [
        sim
        for sim in Simulation.objects.filter(project=project, is_batch=True)
        if "sintering_extreme" in (sim.name or "")
    ]
    assert extremes, "the study produced no sintering-extreme child"

    for child in extremes:
        assert child.seed_type == "dimers", (
            f"the child runs with {child.seed_type!r} while the study configured "
            f"'dimers': {child.name}"
        )
        assert "seed_type" not in (child.parameters or {}), (
            f"the child keeps seed_type in its parameters, which R4.3 forbids: "
            f"{child.parameters}"
        )
