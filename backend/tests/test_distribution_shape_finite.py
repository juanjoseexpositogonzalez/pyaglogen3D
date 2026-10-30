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
    config: dict[str, object] = {"mode": mode, "value": 1.0, "mean": 1.0, "std": 0.1,
                                 "min": 1.0, "max": 2.0}
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

    Measured while writing this, and it corrected the issue: POSTing `1e999`
    answers 400, and so does the serializer with a Python `float("inf")` - both
    because the `JSONField` refuses non-finite literals (`Value must be valid
    JSON.`) before any of our validation runs. So nothing stores a non-finite
    magnitude today and #202 is not a live path to the engine.

    This test stays because it pins the property that matters - a non-finite
    magnitude cannot be written - whichever layer enforces it. The validator's
    own witness is the unit tests above: they fail without the guard, this one
    does not.
    """
    from apps.simulations.serializers import ParametricStudySerializer

    project = Project.objects.create(name="finite", owner=user)
    serializer = ParametricStudySerializer(
        data={
            "name": "p",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
            "parameter_grid": {"kf_distribution": [{"mode": "fixed", "value": float("inf")}]},
            "seeds_per_combination": 1,
        },
        context={"project": project},
    )

    assert serializer.is_valid() is False, (
        "a non-finite magnitude passed the serializer: it reaches the engine"
    )
