"""#233 - `limiting` refuses `min`/`max`/`std` on the dict surfaces too, not only the flats.

R11 says `limiting` reads `sintering_coeff` and "ignores type, min, max and std". The
allow-list enforces that on the FLAT surfaces and only there, so a `sintering_config`
dict carrying a key the algorithm ignores was accepted on all four dict surfaces:

    parameter_grid.sintering_config          -> 201 and a row written
    sintering_config (the study field)       -> 201
    base_parameters.sintering_config         -> 201
    theoretical_extremes.sintering_config    -> 201
    (the flat `sintering_std` was already 400)

A stored key the worker never reads is the defect class #115 closed everywhere else: the
study says one thing and the run does another.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy

#: The key the algorithm ignores, on each surface that carries a dict.
SURFACES: list[tuple[str, str, Any]] = [
    ("parameter_grid", "std", 0.1),
    ("sintering_config", "std", 0.1),
    ("base_parameters", "min", 0.7),
    ("theoretical_extremes", "max", 0.95),
]


@pytest.fixture
def api_client(db: None) -> APIClient:
    user: User = User.objects.create_user(
        email=f"limiting-shape-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="limiting-shape-")
    return Project.objects.create(name="limiting shape", owner=user)


def _post(api_client: APIClient, project: Project, surface: str, key: str, value: Any) -> Any:
    config = {"distribution_type": "fixed", "coefficient": 0.8, key: value}
    payload: dict[str, Any] = {
        "name": "limiting shape",
        "base_algorithm": "limiting",
        "base_parameters": {"n_particles": 100, "sintering_coeff": 0.8},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    if surface == "parameter_grid":
        payload["parameter_grid"] = {"sintering_config": [config]}
    elif surface == "sintering_config":
        payload["sintering_config"] = config
    elif surface == "base_parameters":
        payload["base_parameters"] = {**payload["base_parameters"], "sintering_config": config}
    else:
        payload["limiting_cases_config"] = {"theoretical_extremes": {"sintering_config": [config]}}
        payload["include_limiting_cases"] = True
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(("surface", "key", "value"), SURFACES)
def test_a_key_the_algorithm_ignores_is_refused(
    api_client: APIClient, project: Project, surface: str, key: str, value: Any
) -> None:
    before = ParametricStudy.objects.count()

    response = _post(api_client, project, surface, key, value)

    assert response.status_code == 400, (
        f"{surface}.sintering_config.{key} was accepted for an algorithm that ignores it: "
        f"{response.status_code} {getattr(response, 'data', '')}"
    )
    assert key in str(response.data), response.data
    assert ParametricStudy.objects.count() == before


@pytest.mark.django_db
def test_the_fixed_shape_itself_still_passes(
    api_client: APIClient, project: Project
) -> None:
    """The regression guard: the shape `limiting` does consume."""
    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "limiting ok",
            "base_algorithm": "limiting",
            "base_parameters": {"n_particles": 100, "sintering_coeff": 0.8},
            "parameter_grid": {
                "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]
            },
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert response.status_code == 201, response.data


@pytest.mark.django_db
def test_an_algorithm_that_reads_std_is_untouched(
    api_client: APIClient, project: Project
) -> None:
    """`tunable_cc` does consume `std` on a `normal` config: no narrowing for it."""
    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "normal ok",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {
                "sintering_config": [
                    {"distribution_type": "normal", "mean": 0.8, "std": 0.05}
                ]
            },
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert response.status_code == 201, response.data
