"""#115, point 5 - an allow-list refusal names the surface that carries the setting.

Measured on develop before this change, with a `fracval` study, which consumes no
sintering at all:

    base_parameters.sintering_type      -> 400 {"sintering_config": [...]}
    parameter_grid.sintering_type       -> 400 {"sintering_config": [...]}
    sintering_config                    -> 400 {"sintering_config": [...]}

The third is right; the first two are not: a client reading `sintering_config` on
a payload that carries no such field cannot tell which field to fix.

On a partial update the surfaces judged are *effective*: a row that already
carries a setting is refused when the request changes the algorithm, and the key
then names the surface where the setting really lives, which may be one the
request did not carry. That is R11.6 working as specified, and it is still better
than a fixed key that may name a field the row does not even have - but this file
asserts what a refusal names, not that the field was sent.

This covers the **allow-list** family only. The shape family is out of this
point's scope and is not uniformly actionable: `parameter_grid={"sintering_type":
["fixed"]}` answers under `non_field_errors`, because the required-key check runs
on the child projection rather than on a surface. Saying "every surface of R3
reports under the key it came from" would be false; a judge measured exactly
that (JD-B-003 on PR #222) and it is declared in #115 instead.
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


@pytest.mark.django_db
def test_an_update_names_the_surface_it_touched(
    api_client: APIClient, project: Project
) -> None:
    """R11.6 and R11.8 guard the update path, and nothing pinned it.

    JD-B-005 on PR #222: every PATCH case had to be measured by hand. A study
    created before the allow-list existed carries no sintering; adding it in a
    PATCH is the bypass #97 closed, and the refusal must name what the request
    carried.
    """
    created = _post(api_client, project)
    assert created.status_code == 201, created.data

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{created.data['id']}/",
        data={
            "base_parameters": {
                "n_particles": 60,
                "target_df": 2.0,
                "target_kf": 1.3,
                "sintering_coeff": 0.5,
            }
        },
        format="json",
    )

    assert response.status_code == 400, response.data
    assert "base_parameters" in response.data, response.data


@pytest.mark.django_db
def test_a_stored_unknown_algorithm_names_the_algorithm(
    api_client: APIClient, project: Project
) -> None:
    """The row was written outside the serializer, so `base_algorithm` is empty.

    JD-B-002 on PR #222: this branch answered under `sintering_config` while the
    only field the client can change is `base_algorithm`.
    """
    created = _post(api_client, project)
    assert created.status_code == 201, created.data
    study = ParametricStudy.objects.get(id=created.data["id"])
    # The admin and the AI assistant tool both write these JSON fields directly.
    ParametricStudy.objects.filter(id=study.id).update(base_algorithm="")
    study.refresh_from_db()

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"base_parameters": {**study.base_parameters, "sintering_coeff": 0.8}},
        format="json",
    )

    assert response.status_code == 400, response.data
    assert "base_algorithm" in response.data, response.data


def test_the_three_scope_sets_cover_the_model(db: None) -> None:
    """The residual branch is only unreachable while this union is complete.

    Nothing pinned it: a twelfth algorithm added to the model without touching
    `sintering_shape.py` would reopen the misfiling silently (JD-B-002).
    """
    from apps.simulations.models import SimulationAlgorithm
    from apps.simulations.sintering_shape import (
        FIXED_ONLY_ALGORITHMS,
        NO_SINTERING_ALGORITHMS,
        SINTERING_ALGORITHMS,
    )

    covered = SINTERING_ALGORITHMS | FIXED_ONLY_ALGORITHMS | NO_SINTERING_ALGORITHMS
    assert covered == set(SimulationAlgorithm.values), (
        "the scope sets no longer cover the model: "
        f"{sorted(set(SimulationAlgorithm.values) - covered)} uncovered"
    )
    assert not (
        SINTERING_ALGORITHMS & NO_SINTERING_ALGORITHMS
    ), "an algorithm is both allowed and denied sintering"


# --- the dict surfaces: revert any of their labels and these go red ---------


@pytest.mark.django_db
def test_a_grid_dict_names_the_grid(api_client: APIClient, project: Project) -> None:
    response = _post(
        api_client,
        project,
        parameter_grid={
            "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.5}]
        },
    )

    assert response.status_code == 400, response.data
    assert "parameter_grid.sintering_config" in response.data, response.data


@pytest.mark.django_db
def test_a_base_dict_names_base_parameters(
    api_client: APIClient, project: Project
) -> None:
    response = _post(
        api_client,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "sintering_config": {"distribution_type": "fixed", "coefficient": 0.5},
        },
    )

    assert response.status_code == 400, response.data
    assert "base_parameters.sintering_config" in response.data, response.data


# --- the two other refusal kinds, on `limiting`, which nothing exercised ----


def _post_limiting(api_client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "limiting",
        "base_algorithm": "limiting",
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


@pytest.mark.django_db
def test_a_non_fixed_dict_names_its_surface(
    api_client: APIClient, project: Project
) -> None:
    """`limiting` accepts the fixed shape only (R11.5)."""
    response = _post_limiting(
        api_client,
        project,
        parameter_grid={
            "sintering_config": [
                {"distribution_type": "normal", "mean": 0.8, "std": 0.05}
            ]
        },
    )

    assert response.status_code == 400, response.data
    assert "parameter_grid.sintering_config" in response.data, response.data
    assert "fixed" in str(response.data).lower(), response.data


@pytest.mark.django_db
def test_a_non_fixed_flat_names_its_key(api_client: APIClient, project: Project) -> None:
    response = _post_limiting(
        api_client,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "sintering_type": "normal",
            "sintering_coeff": 0.8,
            "sintering_std": 0.05,
        },
    )

    assert response.status_code == 400, response.data
    assert "base_parameters.sintering_type" in response.data, response.data


@pytest.mark.django_db
def test_a_shape_only_key_names_that_key(
    api_client: APIClient, project: Project
) -> None:
    """`limiting` ignores type, min, max and std: naming the key says which."""
    response = _post_limiting(
        api_client,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "sintering_type": "fixed",
            "sintering_coeff": 0.8,
            "sintering_std": 0.05,
        },
    )

    assert response.status_code == 400, response.data
    assert "base_parameters.sintering_std" in response.data, response.data
