"""#230 - every numeric key the worker reads is cast, not stored as a string.

Measured on develop, each of these answered 201 and stored a **string**:

    sticking_probability   "0.5"   ballistic_cc
    geometric_mean         "1.4"   fracval
    geometric_std          "1.2"   fracval          <- not in the issue's list
    n_levels               "5"     box_rfa
    radius_min             "1.2"   gcca
    radius_max             "3.0"   gcca             <- not in the issue's list
    seed_cluster_size      "8"     tunable_cc
    max_rotation_attempts  "80"    tunable_cc

The issue named six; enumerating the binding's numeric readers found eight. That is
the lesson #115 kept teaching, so this file takes the set from the engine's own
surface rather than from the list.

Two of them are **optional**: measured, `seed_cluster_size: null` and
`max_rotation_attempts: null` are accepted with 201, and the worker passes `None`
through to the engine, where it means "choose for me". Casting must therefore leave a
`null` alone instead of turning an unset option into a refusal.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy

#: (key, string value, algorithm, expected python type)
CASTS: list[tuple[str, str, str, type]] = [
    ("sticking_probability", "0.5", "ballistic_cc", float),
    ("geometric_mean", "1.4", "fracval", float),
    ("geometric_std", "1.2", "fracval", float),
    ("n_levels", "5", "box_rfa", int),
    ("radius_min", "1.2", "gcca", float),
    ("radius_max", "3.0", "gcca", float),
    ("seed_cluster_size", "8", "tunable_cc", int),
    ("max_rotation_attempts", "80", "tunable_cc", int),
]

#: The two the engine accepts as absent.
OPTIONAL: list[tuple[str, str]] = [
    ("seed_cluster_size", "tunable_cc"),
    ("max_rotation_attempts", "tunable_cc"),
]


@pytest.fixture
def api_client(db: None) -> APIClient:
    user: User = User.objects.create_user(
        email=f"keys-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="keys-")
    return Project.objects.create(name="keys", owner=user)


def _post(api_client: APIClient, project: Project, algo: str, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "keys",
        "base_algorithm": algo,
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(("key", "value", "algo", "expected_type"), CASTS)
def test_a_numeric_key_is_cast_before_it_is_stored(
    api_client: APIClient,
    project: Project,
    key: str,
    value: str,
    algo: str,
    expected_type: type,
) -> None:
    response = _post(api_client, project, algo, parameter_grid={key: [value]})

    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])
    stored = study.simulations.get().parameters.get(key)
    assert isinstance(stored, expected_type), (
        f"{key} was stored as {stored!r} ({type(stored).__name__}); the worker needs "
        f"a {expected_type.__name__}"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(("key", "algo"), OPTIONAL)
def test_an_absent_optional_key_stays_absent(
    api_client: APIClient, project: Project, key: str, algo: str
) -> None:
    """A `null` means "choose for me": casting it would refuse an unset option."""
    response = _post(
        api_client,
        project,
        algo,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            key: None,
        },
    )

    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])
    assert study.simulations.get().parameters.get(key) is None


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("key", "algo"),
    [
        ("sticking_probability", "ballistic_cc"),
        ("n_levels", "box_rfa"),
        ("radius_min", "gcca"),
        ("seed_cluster_size", "tunable_cc"),
    ],
)
def test_a_value_that_is_not_a_number_is_refused(
    api_client: APIClient, project: Project, key: str, algo: str
) -> None:
    """The other half of the cast: what cannot be cast is a 400, not a stored string."""
    before = ParametricStudy.objects.count()

    response = _post(api_client, project, algo, parameter_grid={key: ["abc"]})

    assert response.status_code == 400, response.data
    assert ParametricStudy.objects.count() == before
