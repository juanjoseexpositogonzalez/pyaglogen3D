"""#202 — a non-finite magnitude is refused, and the message says so.

Measured before this module: `_positive` checks `isinstance(raw, (int, float))`
and then `value <= 0`, and `nan <= 0` is `False`, so `NaN` and `Infinity` went
straight through. `1e999` is typable in a number input and parses to `inf` in
Python's JSON, and the issue's concern is the other direction: a payload built
without the interface - the API, a script, the assistant's tool - carries the
non-finite value to the engine, which is where the rest of this family already
lives (#115: values the serializer accepts and the engine cannot run raise a
`PanicException` that derives from `BaseException` and leaves the row `RUNNING`).

The message mattered too: `inf` used to be told it "must be greater than 0",
which is false and sends the reader looking for the wrong problem.
"""

from __future__ import annotations

import math
import uuid

import pytest

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.distribution_shape import validate_shape

NON_FINITE = [math.inf, -math.inf, math.nan]

SHAPES = [
    ("fixed", "value"),
    ("normal", "mean"),
    ("normal", "std"),
    ("uniform", "min"),
    ("uniform", "max"),
]


@pytest.mark.parametrize(("mode", "field"), SHAPES)
@pytest.mark.parametrize("bad", NON_FINITE)
def test_a_non_finite_magnitude_is_refused(mode: str, field: str, bad: float) -> None:
    config: dict[str, object] = {
        "mode": mode,
        "value": 1.0,
        "mean": 1.0,
        "std": 0.1,
        "min": 1.0,
        "max": 2.0,
    }
    config[field] = bad

    with pytest.raises(ValueError) as excinfo:
        validate_shape(config)

    assert "finite" in str(excinfo.value), (
        f"{mode}.{field}={bad!r} was refused, but the message is misleading: {excinfo.value}"
    )


def test_a_finite_shape_still_passes() -> None:
    validate_shape({"mode": "normal", "mean": 1.3, "std": 0.1})
    validate_shape({"mode": "uniform", "min": 1.0, "max": 2.0})
    validate_shape({"mode": "fixed", "value": 1.5})


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"finite-{uuid.uuid4()}@example.com", password="x"
    )
    return created


def test_the_serializer_refuses_a_non_finite_magnitude_from_python(
    user: User,
) -> None:
    """A guard on the writing path, which today blocks it one layer earlier.

    Measured: the model-level `JSONField` accepts the value (its validator runs
    json with nan allowed) and the database constraint refuses it at write. This
    pins the property - a non-finite magnitude cannot be stored - whichever layer
    enforces it, and it asserts the reason, not just falsiness, so it cannot pass
    because some unrelated field was invalid.
    """
    from apps.simulations.serializers import ParametricStudySerializer

    project = Project.objects.create(name="finite", owner=user)
    serializer = ParametricStudySerializer(
        data={
            "name": "p",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {
                "kf_distribution": [{"mode": "fixed", "value": float("inf")}]
            },
            "seeds_per_combination": 1,
        },
        context={"project": project},
    )

    assert serializer.is_valid() is False, (
        "a non-finite magnitude passed the serializer: it reaches the engine"
    )
    assert "parameter_grid" in serializer.errors, (
        f"refused, but not for the parameter grid: {dict(serializer.errors)}"
    )


def test_a_form_encoded_request_gets_a_400_instead_of_a_500(user: User) -> None:
    """The route where this commit changes the answer, and the reason it exists.

    DRF's `JSONField` takes a JSON *string* through `json.loads`, which allows
    `Infinity` by default, so a form-encoded post reached `validate_shape` with
    `inf`. Before this guard the request ended in the database constraint
    (`IntegrityError`, a 500); now it is a refusal the caller can read. A judge
    measured both ends of it.
    """
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=user)
    project = Project.objects.create(name="multipart", owner=user)

    response = client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "p",
            "base_algorithm": "tunable_cc",
            "base_parameters": '{"n_particles": 60, "target_df": 2.0, "target_kf": 1.3}',
            "parameter_grid": '{"kf_distribution": [{"mode": "fixed", "value": 1e999}]}',
            "seeds_per_combination": 1,
        },
        format="multipart",
    )

    assert response.status_code == 400, (
        f"expected a refusal, got {response.status_code}: {getattr(response, 'data', None)}"
    )
    assert "finite" in str(response.data), (
        f"refused, but the message does not say why: {response.data}"
    )


# ---------------------------------------------------------------------------
# The two sibling layers of the same defect, both found by the second judge.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad", NON_FINITE + [10**400])
@pytest.mark.parametrize(
    ("config", "label"),
    [
        ({"mode": "fixed"}, "value"),
        ({"mode": "normal", "std": 0.1}, "mean"),
        ({"mode": "normal", "mean": 1.0}, "std"),
        ({"mode": "uniform", "max": 2.0}, "min"),
        ({"mode": "uniform", "min": 1.0}, "max"),
    ],
)
def test_the_single_simulation_field_refuses_a_non_finite_magnitude(
    config: dict[str, object], label: str, bad: float
) -> None:
    """`DistributionField` had the same broken check as `_positive`.

    It governs the single-simulation endpoint, where the refusal landed one layer
    below as an `IntegrityError` - a 500 the caller cannot read. `10**400` is in
    the matrix because `float()` raises `OverflowError` for it, which the older
    clause did not catch either.
    """
    from rest_framework import serializers

    from apps.simulations.fields import DistributionField

    payload = {**config, label: bad}

    with pytest.raises(serializers.ValidationError) as excinfo:
        DistributionField().to_internal_value(payload)

    assert "finite" in str(excinfo.value), (
        f"{label}={bad!r} was refused, but the message does not say why: {excinfo.value}"
    )


def test_the_csv_import_refuses_a_non_finite_coordinate() -> None:
    """The counterexample to "every path goes through a JSONField".

    `Simulation.geometry` is a `BinaryField`, and the CSV import wrote `NaN` into
    it: `nan <= 0` is False, so the radius check passed, the row was stored and
    the analysis died later with a `LinAlgError`. The `.mat` parser already
    refused it for exactly this reason; the CSV one did not.
    """
    from apps.simulations.utils import CSVParseError, parse_csv_geometry

    with pytest.raises(CSVParseError) as excinfo:
        parse_csv_geometry("x,y,z,radius\n0,0,0,1.0\nnan,0,0,1.0\n1,1,1,1.0\n")

    assert "non-finite" in str(excinfo.value), (
        f"refused, but the message does not say why: {excinfo.value}"
    )
