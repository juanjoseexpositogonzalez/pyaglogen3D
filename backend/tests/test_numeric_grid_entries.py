"""#115, point 2 - a numeric grid entry the engine cannot take is a 400, not a stored string.

Measured on develop before this change, with the same payloads:

    target_df [1.8, "abc"]          201   child stores 'abc'   (str)
    target_df ["1.5"]              201   child stores '1.5'   (str)
    target_df [None]               201   child stores None
    target_kf [1.3, "x"]           201   child stores 'x'     (str)
    particle_radius [1.0, "1.5"]   201   child stores '1.5'   (str)
    n_particles [60, "80"]         201   child stores 80      (int)   <- this one casted

`create_simulation` cast `n_particles` and nothing else, so every float
parameter reached the engine binding as whatever the client sent. `run_tunable_cc` answers `TypeError: argument 'target_df': must be real
number, not str`, and the worker's own range checks (`0.1 <= target_kf <= 2.7`)
raise the same TypeError before the binding is even reached.

The rule is the same one `n_particles` already followed: cast what can be cast,
refuse with a 400 what cannot.
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
        email=f"numericgrid-{uuid.uuid4()}@example.com", password="x"
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(api_client: APIClient) -> Project:
    user = User.objects.get(email__startswith="numericgrid-")
    return Project.objects.create(name="numeric grid", owner=user)


def _post(api_client: APIClient, project: Project, **grid: Any) -> Any:
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "sweep",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": grid,
            "seeds_per_combination": 1,
        },
        format="json",
    )


def _stored(study_id: Any, key: str) -> list[Any]:
    study = ParametricStudy.objects.get(id=study_id)
    return [child.parameters.get(key) for child in study.simulations.all()]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("target_df", "abc"),
        ("target_df", None),
        ("target_kf", "x"),
        ("particle_radius", "abc"),
        # `float()` accepts these and a JSONField cannot hold them: casting them
        # wrote the study row and then answered 500 with a `running` study and
        # no children (JD-B-001 on PR #221).
        ("target_df", "nan"),
        ("target_df", "inf"),
        ("target_df", "-inf"),
        ("target_df", "1e400"),
        # `True` would store as 1.0, the same rule `_coerce_positive_finite`
        # follows in `services/params.py`.
        ("target_df", True),
        ("n_particles", True),
    ],
)
def test_a_value_that_is_not_a_number_is_refused(
    api_client: APIClient, project: Project, key: str, value: Any
) -> None:
    before = ParametricStudy.objects.count()

    response = _post(api_client, project, **{key: [value]})

    assert response.status_code == 400, (
        f"{key}={value!r} was not refused: {response.status_code} {getattr(response, 'data', '')}"
    )
    assert ParametricStudy.objects.count() == before, "a refused study was written"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("key", "value", "expected", "expected_type"),
    [
        ("target_df", "1.5", 1.5, float),
        ("target_df", 1.8, 1.8, float),
        ("target_kf", "1.4", 1.4, float),
        ("particle_radius", "1.5", 1.5, float),
        # The cast that already existed: it must keep working exactly as before.
        ("n_particles", "80", 80, int),
    ],
)
def test_a_numeric_string_is_cast_before_it_is_stored(
    api_client: APIClient,
    project: Project,
    key: str,
    value: Any,
    expected: Any,
    expected_type: type,
) -> None:
    response = _post(api_client, project, **{key: [value]})

    assert response.status_code == 201, response.data
    stored = _stored(response.data["id"], key)
    assert stored == [expected], (
        f"{key} was stored as {stored!r}, expected {expected!r}"
    )
    assert isinstance(stored[0], expected_type), (
        f"{key} was stored as {type(stored[0]).__name__}, the engine binding "
        f"needs a {expected_type.__name__}"
    )


@pytest.mark.django_db
def test_the_mixed_list_from_the_issue_no_longer_stores_a_string(
    api_client: APIClient, project: Project
) -> None:
    """The exact payload the issue quotes."""
    before = ParametricStudy.objects.count()

    response = _post(api_client, project, target_df=[1.8, "abc"])

    assert response.status_code == 400, response.data
    assert ParametricStudy.objects.count() == before


@pytest.mark.django_db
def test_the_refusal_names_the_key_the_value_and_the_surface(
    api_client: APIClient, project: Project
) -> None:
    """A 400 a client cannot act on is only half the guard.

    Measured by JD-B-008 on PR #221: dropping the message left every test green,
    because they all asserted the status alone.

    The key is `non_field_errors` and that is deliberate: an existing test pins
    a shape fault under `parameter_grid` and a cast fault under this one, as a
    client-visible contract.
    """
    response = _post(api_client, project, target_df=["abc"])

    assert response.status_code == 400, response.data
    message = str(response.data["non_field_errors"])
    assert "target_df" in message, message
    assert "abc" in message, message
