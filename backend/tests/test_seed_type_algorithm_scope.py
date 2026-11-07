"""#115, point 14 - `seed_type` has algorithm scope, like sintering and the grids.

Measured on develop: every algorithm accepted `seed_type: "dimers"` and stored it
on the child, while the worker reads `simulation.seed_type` in exactly one place
- the `tunable_cc` branch of `run_simulation_task` (`tasks.py:1676`). No other
`run_*` in the binding declares the parameter:

    fracval       201   child stores dimers   <- never read
    tunable       201   child stores dimers   <- never read
    tunable_cc    201   child stores dimers   <- read
    ballistic_cc  201   child stores dimers   <- never read
    limiting      201   child stores dimers   <- never read

This is the third row of the same dropdown, after the sintering setting (#97) and
the two distribution grids (#141), and the canonical R4 has no per-algorithm
scope. The lesson written in #115 is the point of this test: fixing one instance
does not vaccinate against the class.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy


@pytest.fixture
def api_client(db: None) -> APIClient:
    user: User = User.objects.create_user(
        email=f"seedscope-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="seedscope-")
    return Project.objects.create(name="seed scope", owner=user)


def _post(api_client: APIClient, project: Project, algo: str, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "scope",
        "base_algorithm": algo,
        "base_parameters": {
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "seed_type": "dimers",
        },
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


#: The algorithms whose engine binding never declares `seed_type`.
DOES_NOT_READ_IT = ["fracval", "tunable", "ballistic_cc", "limiting"]


@pytest.mark.django_db
@pytest.mark.parametrize("algo", DOES_NOT_READ_IT)
def test_a_seed_type_the_algorithm_never_reads_is_refused(
    api_client: APIClient, project: Project, algo: str
) -> None:
    before = ParametricStudy.objects.count()

    response = _post(api_client, project, algo)

    assert response.status_code == 400, (
        f"{algo} accepted a seed_type its binding never reads: "
        f"{response.status_code} {getattr(response, 'data', '')}"
    )
    assert "seed_type" in str(response.data), response.data
    assert ParametricStudy.objects.count() == before, "a refused study was written"


@pytest.mark.django_db
def test_the_swept_surface_is_refused_too(
    api_client: APIClient, project: Project
) -> None:
    response = _post(
        api_client,
        project,
        "fracval",
        base_parameters={"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        parameter_grid={"seed_type": ["dimers", "trimers"]},
    )

    assert response.status_code == 400, response.data
    assert "seed_type" in str(response.data), response.data


@pytest.mark.django_db
def test_the_algorithm_that_reads_it_still_works(
    api_client: APIClient, project: Project
) -> None:
    """The regression guard: no narrowing for the one that consumes it."""
    response = _post(api_client, project, "tunable_cc")

    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])
    child = study.simulations.get()
    assert child.seed_type == "dimers"
    assert "seed_type" not in child.parameters


@pytest.mark.django_db
def test_a_rename_does_not_freeze_a_row_stored_before_the_rule(
    api_client: APIClient, project: Project
) -> None:
    """R11.8's lesson, applied here: judge only what the request touches."""
    created = _post(api_client, project, "tunable_cc")
    assert created.status_code == 201, created.data
    study = ParametricStudy.objects.get(id=created.data["id"])
    # A row written before this rule: the algorithm changes, the seed_type stays.
    ParametricStudy.objects.filter(id=study.id).update(base_algorithm="fracval")

    renamed = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"name": "renamed"},
        format="json",
    )

    assert renamed.status_code == 200, renamed.data


@pytest.mark.django_db
def test_adding_the_algorithm_that_changes_the_verdict_is_judged(
    api_client: APIClient, project: Project
) -> None:
    """The other half: touching the algorithm does judge the stored setting."""
    created = _post(api_client, project, "tunable_cc")
    assert created.status_code == 201, created.data
    study = ParametricStudy.objects.get(id=created.data["id"])

    moved = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert moved.status_code == 400, moved.data
    assert "seed_type" in str(moved.data), moved.data
