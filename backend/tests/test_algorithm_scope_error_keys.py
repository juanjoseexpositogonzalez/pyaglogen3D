"""#115, point 5 - an allow-list refusal names the surface that carries the setting.

Measured on develop before this change, with a `fracval` study, which consumes no
sintering at all:

    base_parameters.sintering_type      -> 400 {"sintering_config": [...]}
    parameter_grid.sintering_type       -> 400 {"sintering_config": [...]}
    sintering_config                    -> 400 {"sintering_config": [...]}

The third is right; the first two are not. Every surface of R3 reports under the
key it came from everywhere else (`parameter_grid.sintering_config`,
`base_parameters.sintering_config`), so a client reading `sintering_config` on a
payload that carries no such field cannot tell which field to fix.

The requirement does not choose the key; what it requires is that a client can
point at the offending field.
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
        email=f"scopekeys-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="scopekeys-")
    return Project.objects.create(name="scope keys", owner=user)


def _post(api_client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "scope",
        # `fracval` consumes no sintering, so declaring any is the allow-list
        # refusal and nothing else.
        "base_algorithm": "fracval",
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


@pytest.mark.django_db
def test_a_flat_key_in_base_parameters_names_that_surface(
    api_client: APIClient, project: Project
) -> None:
    before = ParametricStudy.objects.count()

    response = _post(
        api_client,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "sintering_type": "fixed",
            "sintering_coeff": 0.5,
        },
    )

    assert response.status_code == 400, response.data
    assert "base_parameters" in response.data, response.data
    assert "sintering_config" not in response.data, (
        f"the refusal was filed under a field the payload does not carry: {response.data}"
    )
    assert ParametricStudy.objects.count() == before


@pytest.mark.django_db
def test_a_flat_key_in_the_grid_names_the_grid(
    api_client: APIClient, project: Project
) -> None:
    before = ParametricStudy.objects.count()

    response = _post(
        api_client,
        project,
        parameter_grid={"sintering_type": ["fixed"], "sintering_coeff": [0.5]},
    )

    assert response.status_code == 400, response.data
    assert "parameter_grid" in response.data, response.data
    assert ParametricStudy.objects.count() == before


@pytest.mark.django_db
def test_the_top_level_setting_keeps_its_own_key(
    api_client: APIClient, project: Project
) -> None:
    """The regression guard: this surface already named the right field."""
    before = ParametricStudy.objects.count()

    response = _post(
        api_client,
        project,
        sintering_config={"distribution_type": "fixed", "coefficient": 0.5},
    )

    assert response.status_code == 400, response.data
    assert "sintering_config" in response.data, response.data
    assert ParametricStudy.objects.count() == before
