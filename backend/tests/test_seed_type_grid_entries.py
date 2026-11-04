"""#115, point 4 — a `seed_type` entry that is not a string is a 400, not a 500.

Measured on develop: `parameter_grid = {"seed_type": [["monomers"]]}` answers 500
because the validator asks `entry not in valid_seed_types`, and a list is not
hashable, so the set membership raises `TypeError`. The same class #97 closed for
`sintering_type` and `distribution_type`, and the same one the fix for point 3
already closed on the `base_parameters` side.

The check must not depend on the value being hashable: the type comes first.
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
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"seedgrid-{uuid.uuid4()}@example.com", password="x"
    )
    return created


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


#: Every one of these is unhashable, or not a string at all, or a string the
#: model does not offer - and none of them may reach the membership test raw.
BAD_ENTRIES: list[Any] = [["monomers"], {"a": 1}, 7, None, "quadrimers"]


@pytest.mark.django_db
@pytest.mark.parametrize("entry", BAD_ENTRIES)
def test_a_non_string_entry_is_refused_with_400(
    api_client: APIClient, user: User, entry: Any
) -> None:
    project = Project.objects.create(name="grid seed type", owner=user)
    before = ParametricStudy.objects.count()

    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "sweep",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {"seed_type": [entry]},
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert response.status_code == 400, (
        f"{entry!r} was not refused with a 400: {response.status_code} {getattr(response, 'data', '')}"
    )
    assert ParametricStudy.objects.count() == before, "a refused study was written"
    assert "seed_type" in str(response.data)


@pytest.mark.django_db
@pytest.mark.parametrize("entry", ["monomers", "dimers", "trimers"])
def test_a_valid_entry_is_still_accepted(
    api_client: APIClient, user: User, entry: str
) -> None:
    project = Project.objects.create(name="valid seed type", owner=user)

    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "sweep",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {"seed_type": [entry]},
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert response.status_code == 201, response.data
