"""A non-scalar value must answer 400, never 500 (#231).

Three surfaces compared or tested membership with a value the client chooses,
so a list reached `10 <= [100]` or `[["monomers"]] not in {...}` and Python
raised `TypeError`. DRF does not translate that, so the caller read a 500 for
a payload that is simply wrong.

`#115` point 4 closed this class once, in `parameter_grid.seed_type`, by
checking `isinstance` first. These tests pin the same rule on the three
surfaces that kept it, and they go through the HTTP boundary because that is
where the 500 was measured:

1. `box_counting_params` (the study serializer; the validator it shares with
   the run-box-counting action is the same function, though that action already
   coerced with `int()` and answered 400 before this change);
2. a nested `parameters.seed_type` lifted in `SimulationSerializer.create`;
3. `dpo_distribution.mode`, read by the custom distribution field.

Each case also asserts that nothing was written: a payload that is refused
must not leave a row behind.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation


def _setup() -> tuple[Project, APIClient]:
    """A user, a project and a client that reports a 500 instead of raising."""
    user = User.objects.create_user(
        email=f"non-scalar-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )
    project = Project.objects.create(name="Non-scalar payloads", owner=user)
    client = APIClient()
    client.force_authenticate(user=user)
    # The defect is a 500, so the test must be able to see one: without this
    # the exception propagates and the failure reads as a test error.
    client.raise_request_exception = False
    return project, client


def _simulations_url(project: Project) -> str:
    return reverse("project-simulations-list", kwargs={"project_pk": project.id})


def _studies_url(project: Project) -> str:
    return reverse("project-studies-list", kwargs={"project_pk": project.id})


def _study_payload(**overrides: object) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Box counting study",
        "base_algorithm": "tunable_cc",
        "base_parameters": {},
        "parameter_grid": {"kf": [1.0]},
        "seeds_per_combination": 1,
        "include_box_counting": True,
    }
    payload.update(overrides)
    return payload


def _simulation_payload(**overrides: object) -> dict[str, Any]:
    payload: dict[str, Any] = {"algorithm": "tunable_cc", "parameters": {}}
    payload.update(overrides)
    return payload


# --- 1. box_counting_params: a range comparison with a non-number ------------


@pytest.mark.django_db
@pytest.mark.parametrize("key", ["points_per_sphere", "precision"])
def test_box_counting_rejects_a_non_number_with_400(key: str) -> None:
    """`10 <= [100] <= 1000` raises TypeError; the contract wants a 400."""
    project, client = _setup()

    response = client.post(
        _studies_url(project),
        _study_payload(box_counting_params={key: [100]}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert f"{key} must be" in str(response.data)
    assert ParametricStudy.objects.count() == 0


@pytest.mark.django_db
def test_box_counting_still_refuses_an_out_of_range_number() -> None:
    """The fix narrows the type check; the range rule itself is unchanged."""
    project, client = _setup()

    response = client.post(
        _studies_url(project),
        _study_payload(box_counting_params={"points_per_sphere": 5}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "points_per_sphere must be between 10 and 1000" in str(response.data)
    assert ParametricStudy.objects.count() == 0


# --- 2. nested seed_type: membership in a set of choices ---------------------


@pytest.mark.django_db
def test_nested_seed_type_rejects_a_non_string_with_400() -> None:
    """`[["monomers"]] not in <set>` raises TypeError; the contract wants a 400."""
    project, client = _setup()

    response = client.post(
        _simulations_url(project),
        _simulation_payload(parameters={"seed_type": [["monomers"]]}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "is not a valid seed type" in str(response.data)
    assert Simulation.objects.count() == 0


@pytest.mark.django_db
def test_nested_seed_type_still_refuses_an_unknown_choice() -> None:
    """The fix narrows the type check; an unknown string is still refused."""
    project, client = _setup()

    response = client.post(
        _simulations_url(project),
        _simulation_payload(parameters={"seed_type": "quadrimers"}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "is not a valid seed type" in str(response.data)
    assert Simulation.objects.count() == 0


# --- 3. distribution mode: membership in the set of known modes --------------


@pytest.mark.django_db
def test_distribution_mode_rejects_a_non_string_with_400() -> None:
    """`["fixed"] not in VALID_MODES` raises TypeError; the contract wants a 400."""
    project, client = _setup()

    response = client.post(
        _simulations_url(project),
        _simulation_payload(dpo_distribution={"mode": ["fixed"], "value": 1.0}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "mode must be one of" in str(response.data)
    assert Simulation.objects.count() == 0


@pytest.mark.django_db
def test_distribution_mode_still_refuses_an_unknown_mode() -> None:
    """The fix narrows the type check; an unknown string is still refused."""
    project, client = _setup()

    response = client.post(
        _simulations_url(project),
        _simulation_payload(dpo_distribution={"mode": "weibull", "value": 1.0}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "mode must be one of" in str(response.data)
    assert Simulation.objects.count() == 0


# --- 4. n_particles: the same class, fifteen lines above the seed_type fix ---
#
# Neither landed in #231's contract: judgment day found it while trying to break
# the three that did. Same file, same endpoint, same mechanism, so it is closed
# here rather than left for a reader to find it as a 500.


@pytest.mark.django_db
@pytest.mark.parametrize("algorithm", ["dla", "limiting"])
@pytest.mark.parametrize("value", [[10], "10", {"count": 10}])
def test_n_particles_rejects_a_non_number_with_400(
    algorithm: str, value: object
) -> None:
    """`[10] < 10` raises TypeError in `validate_parameters`."""
    project, client = _setup()

    response = client.post(
        _simulations_url(project),
        _simulation_payload(algorithm=algorithm, parameters={"n_particles": value}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "n_particles must be a number" in str(response.data)
    assert Simulation.objects.count() == 0


@pytest.mark.django_db
def test_n_particles_still_refuses_a_number_below_the_floor() -> None:
    """The fix narrows the type check; the floor itself is unchanged."""
    project, client = _setup()

    response = client.post(
        _simulations_url(project),
        _simulation_payload(algorithm="dla", parameters={"n_particles": 5}),
        format="json",
    )

    assert response.status_code == 400, getattr(response, "data", response.content)
    assert "n_particles must be at least 10" in str(response.data)
    assert Simulation.objects.count() == 0
