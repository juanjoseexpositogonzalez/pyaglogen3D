"""#115, point 17(a) - a PATCH validates the shape of what it carries, not of the row.

Measured on develop: a study storing a `kf_distribution` in its swept extremes,
where that stored value is not even a list, answers 400 to a PATCH that touches a
completely different key:

    PATCH {"parameter_grid": {"dpo_distribution": [<valid>]}}
    -> 400  limiting_cases_config.theoretical_extremes.kf_distribution:
            must be a list of distribution configs, got dict

The request never mentioned that surface. It is a cross-lane freeze: the row is
recoverable by replacing that key, and only API clients can hit it because the
client does not expose PATCH on studies.

The rule the point prescribes: the *scope* (the allow-list) must read **effective**
surfaces - a stored setting has to be judged when the algorithm changes, which is
R11.6 - but the *shape* of a config is validated only where the request supplies
one.
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
        email=f"crossfreeze-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user: User = User.objects.get(email__startswith="crossfreeze-")
    return Project.objects.create(name="cross freeze", owner=user)


def _legacy_study(project: Project) -> ParametricStudy:
    """A row whose stored extremes value is not a list: the measured case."""
    return ParametricStudy.objects.create(
        project=project,
        name="legacy",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        parameter_grid={},
        seeds_per_combination=1,
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {"kf_distribution": {"mode": "fixed", "value": 1.8}}
        },
        status="completed",
    )


@pytest.mark.django_db
def test_a_patch_touching_a_valid_key_is_not_refused_for_another_surface(
    api_client: APIClient, project: Project
) -> None:
    study = _legacy_study(project)

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"parameter_grid": {"dpo_distribution": [{"mode": "fixed", "value": 1.0}]}},
        format="json",
    )

    assert response.status_code == 200, (
        "a valid PATCH was refused for a surface it never mentioned: "
        f"{getattr(response, 'data', '')}"
    )


@pytest.mark.django_db
def test_a_patch_that_carries_the_malformed_value_is_refused(
    api_client: APIClient, project: Project
) -> None:
    """The other half: shape is still validated where the request supplies it."""
    study = _legacy_study(project)

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={
            "limiting_cases_config": {
                "theoretical_extremes": {
                    "kf_distribution": {"mode": "fixed", "value": 1.8}
                }
            }
        },
        format="json",
    )

    assert response.status_code == 400, response.data
    assert "kf_distribution" in str(response.data), response.data


@pytest.mark.django_db
def test_the_scope_still_judges_a_stored_setting(
    api_client: APIClient, project: Project
) -> None:
    """The half that must keep reading effective surfaces (R11.6/R13.12)."""
    study: ParametricStudy = _legacy_study(project)
    ParametricStudy.objects.filter(id=study.id).update(
        limiting_cases_config={
            "theoretical_extremes": {"kf_distribution": [{"mode": "fixed", "value": 1.8}]}
        },
        base_algorithm="fracval",
    )

    # No distribution key in the payload: this is the case R11.6 names - a stored
    # setting judged when the algorithm changes - and the one a payload-carried key
    # would mask, because then the refusal comes from the payload itself (measured
    # by a judge on PR #261).
    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert response.status_code == 400, response.data
    # The scope's own message, not the shape one: an older version of this test
    # looked for the word "consumes" and the message says "is only consumed by".
    assert "only consumed by" in str(response.data).lower(), response.data
    assert "fracval" in str(response.data), response.data


@pytest.mark.django_db
def test_a_create_with_the_malformed_value_is_still_refused(
    api_client: APIClient, project: Project
) -> None:
    """Creation has no stored surfaces: payload and effective are the same thing."""
    payload: dict[str, Any] = {
        "name": "new",
        "base_algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "include_limiting_cases": True,
        "limiting_cases_config": {
            "theoretical_extremes": {"kf_distribution": {"mode": "fixed", "value": 1.8}}
        },
        "seeds_per_combination": 1,
    }

    response = api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )

    assert response.status_code == 400, response.data


@pytest.mark.django_db
def test_a_valid_stored_key_still_judges_an_algorithm_change(
    api_client: APIClient, project: Project
) -> None:
    """One uncollectable carrier must not excuse the others.

    Measured by a judge on PR #261: the first version of the fallback replaced the
    whole effective set with the payload's, so a row whose *other* carrier held a
    perfectly collectable key let `PATCH {"base_algorithm": "fracval"}` through with
    200 - the "stored setting no engine reads" state R13.12 exists to forbid.
    """
    study = ParametricStudy.objects.create(
        project=project,
        name="legacy mixed",
        base_algorithm="tunable_cc",
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            # Collectable and valid, on a different carrier than the malformed one.
            "kf_distribution": {"mode": "fixed", "value": 1.8},
        },
        parameter_grid={},
        seeds_per_combination=1,
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {"dpo_distribution": {"mode": "fixed", "value": 1.0}}
        },
        status="completed",
    )

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert response.status_code == 400, (
        "an algorithm change slipped past the allow-list because another carrier "
        f"was uncollectable: {getattr(response, 'data', '')}"
    )
    study.refresh_from_db()
    assert study.base_algorithm == "tunable_cc", "the refused change was persisted"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("carrier", "stored"),
    [
        ("extremes", [{"mode": "bogus", "value": 1.8}]),
        ("extremes", [{"mode": "fixed", "value": -1}]),
        ("base", {"mode": "bogus"}),
    ],
)
def test_a_collectable_but_unrunnable_stored_value_does_not_freeze(
    api_client: APIClient, project: Project, carrier: str, stored: Any
) -> None:
    """The case that distinguishes the two implementations.

    A *collectable* stored value - a valid list, a runnable shape, nonsense inside -
    used to be SHAPE-validated on a PATCH that never mentioned it. With the split it
    is not, which is the half no test could see: the non-list store the other tests
    use is collapsed by the collection itself.
    """
    study = ParametricStudy.objects.create(
        project=project,
        name="legacy runnable",
        base_algorithm="tunable_cc",
        base_parameters=(
            {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3, "kf_distribution": stored}
            if carrier == "base"
            else {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3}
        ),
        parameter_grid={},
        seeds_per_combination=1,
        include_limiting_cases=True,
        limiting_cases_config=(
            {"theoretical_extremes": {"kf_distribution": stored}}
            if carrier == "extremes"
            else {}
        ),
        status="completed",
    )

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"parameter_grid": {"dpo_distribution": [{"mode": "fixed", "value": 1.0}]}},
        format="json",
    )

    assert response.status_code == 200, (
        f"a PATCH that did not mention the stored {carrier} surface was refused "
        f"for it: {getattr(response, 'data', '')}"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("carrier", "good", "bad"),
    [
        ("grid", "dpo_distribution", "kf_distribution"),
        ("grid", "kf_distribution", "dpo_distribution"),
        ("extremes", "dpo_distribution", "kf_distribution"),
        ("extremes", "kf_distribution", "dpo_distribution"),
    ],
)
def test_a_malformed_sibling_does_not_excuse_a_valid_declaration(
    api_client: APIClient, project: Project, carrier: str, good: str, bad: str
) -> None:
    """The granularity the round-2 fix got wrong.

    Measured by a judge on PR #261: collecting per CARRIER was still too coarse,
    because `collect_surfaces` raises on the first non-list entry and the handler
    discarded everything already collected from that carrier. A row holding a valid
    declaration beside a non-list sibling therefore lost *both*, and
    `PATCH {"base_algorithm": "fracval"}` answered 200 and persisted it - the state
    R13.12 forbids, reached one grouping level lower.
    """
    valid = [{"mode": "fixed", "value": 1.0}]
    malformed = {"mode": "fixed", "value": 1.0}  # an object where a list is required
    carrier_value = {good: valid, bad: malformed}

    study = ParametricStudy.objects.create(
        project=project,
        name="mixed carrier",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        parameter_grid=carrier_value if carrier == "grid" else {},
        seeds_per_combination=1,
        include_limiting_cases=carrier == "extremes",
        limiting_cases_config=(
            {"theoretical_extremes": carrier_value} if carrier == "extremes" else {}
        ),
        status="completed",
    )

    response = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study.id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert response.status_code == 400, (
        f"the valid {good} declaration in {carrier} was excused by its malformed "
        f"sibling {bad}: {getattr(response, 'data', '')}"
    )
    study.refresh_from_db()
    assert study.base_algorithm == "tunable_cc", "the refused change was persisted"
