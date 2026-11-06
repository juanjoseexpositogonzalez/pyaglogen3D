"""#115, point 8 - the child's name must not promise a value it does not run with.

Measured on develop: a study declaring `sintering_config={"distribution_type":
"fixed", "coefficient": 0.8}` together with `parameter_grid={"sintering_coeff":
[0.6]}` created a child named

    (boundary_min: sintering_coeff=0.6)

whose parameters carried 0.8. The dict wins over the flat projection - that is
R3's documented precedence, pinned by
`test_r12_a_dict_setting_still_wins_over_the_flat_projection`, and #97 forbids
changing it. What is fixed here is the name: when the config writes over a swept
value, the name says both, so a reader can see what was asked for and what ran.

Decided by the maintainer on 2026-11-05: the alternative - refusing the
contradiction - turned out to require changing that precedence, which is a
contract change nobody approved.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy

STUDY_CONFIG = {"distribution_type": "fixed", "coefficient": 0.8}


@pytest.fixture
def api_client(db: None) -> APIClient:
    user: User = User.objects.create_user(
        email=f"truthfulname-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="truthfulname-")
    return Project.objects.create(name="truthful name", owner=user)


def _post(api_client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "sweep",
        "base_algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


@pytest.mark.django_db
def test_an_overwritten_sweep_says_both_values(
    api_client: APIClient, project: Project
) -> None:
    response = _post(
        api_client,
        project,
        parameter_grid={"sintering_coeff": [0.6]},
        sintering_config=STUDY_CONFIG,
    )

    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])
    child = study.simulations.get()

    # What runs is the config's value, and the precedence is untouched.
    assert child.parameters["sintering_coeff"] == 0.8
    # What the name says must agree with that, and keep what was asked for.
    assert "sintering_coeff=0.6" in child.name, child.name
    assert "0.8" in child.name, child.name
    assert "→" in child.name, child.name


@pytest.mark.django_db
def test_an_untouched_sweep_keeps_its_plain_name(
    api_client: APIClient, project: Project
) -> None:
    """The regression guard: no config, no override, no arrow."""
    response = _post(api_client, project, parameter_grid={"sintering_coeff": [0.6]})

    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])
    child = study.simulations.get()

    assert child.parameters["sintering_coeff"] == 0.6
    assert "sintering_coeff=0.6" in child.name, child.name
    assert "→" not in child.name, child.name


@pytest.mark.django_db
def test_a_sweep_of_something_else_is_untouched(
    api_client: APIClient, project: Project
) -> None:
    response = _post(
        api_client,
        project,
        parameter_grid={"target_df": [1.8]},
        sintering_config=STUDY_CONFIG,
    )

    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])
    for child in study.simulations.all():
        assert "→" not in child.name, child.name
