"""#115, point 16 - a non-numeric limit is a 400, not a 500.

Measured on develop:

    parameter_grid = {'particle_radius_config': [
        {'distribution_type': 'uniform', 'min': 0.5, 'max': '3.0'}]}
    -> 500   TypeError: '>' not supported between instances of 'float' and 'str'

`validate_distribution_config` compares `config["min"] > config["max"]` without
checking the types, so a string in a numeric slot blows up *inside validation*.
It is the same family as point 4 of this issue - user input producing a server
error instead of a refusal - and it survives on `particle_radius_config` because
`target_kf_distribution` is caught first by R13's newer validator.

The point also records that this 500 disappears by construction once the old
spelling is retired. It has not been retired, so it is fixed here - and for every
numeric field of the three shapes, not just the one that was measured.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project

CONFIGS: list[tuple[str, dict[str, Any]]] = [
    ("uniform max", {"distribution_type": "uniform", "min": 0.5, "max": "3.0"}),
    ("uniform min", {"distribution_type": "uniform", "min": "0.5", "max": 3.0}),
    ("normal std", {"distribution_type": "normal", "mean": 1.0, "std": "0.1"}),
    ("normal mean", {"distribution_type": "normal", "mean": "1.0", "std": 0.1}),
    ("fixed value", {"distribution_type": "fixed", "value": "1.0"}),
    ("uniform none", {"distribution_type": "uniform", "min": 0.5, "max": None}),
    ("normal bool", {"distribution_type": "normal", "mean": True, "std": 0.1}),
]


@pytest.fixture
def api_client(db: None) -> APIClient:
    user: User = User.objects.create_user(
        email=f"typecheck-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="typecheck-")
    return Project.objects.create(name="type check", owner=user)


@pytest.mark.django_db
@pytest.mark.parametrize(("label", "config"), CONFIGS)
def test_a_non_numeric_field_is_refused_with_400(
    api_client: APIClient, project: Project, label: str, config: dict[str, Any]
) -> None:
    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "type check",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {"particle_radius_config": [config]},
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert response.status_code == 400, (
        f"{label} answered {response.status_code} instead of refusing: "
        f"{getattr(response, 'data', '')}"
    )
    assert "particle_radius_config" in str(response.data), response.data


@pytest.mark.django_db
def test_the_valid_shape_still_passes(api_client: APIClient, project: Project) -> None:
    """The regression guard: numbers keep working."""
    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "type check",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {
                "particle_radius_config": [
                    {"mode": "uniform", "min": 0.5, "max": 3.0}
                ]
            },
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert response.status_code == 201, response.data
