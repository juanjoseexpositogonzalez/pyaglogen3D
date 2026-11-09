"""#229 - the assistant's study tool builds children like the study path, or it lies.

Measured on develop: `create_parametric_study_handler` merged the base parameters
with the combination and created the child straight from that dict:

    params = {**base_parameters, **combo}
    Simulation.objects.create(parameters=params, ...)

No numeric cast, no distribution aliases, and `seed_type` left inside the blob while
the model field took its default - the three defects this session closed on the
study path, all alive on the tool's own door:

    parameter_grid={"target_df": ["1.5"]}  -> 201, child stores '1.5' (str),
                                              worker: argument 'target_df': must be
                                              real number, not str
    base_parameters={"seed_type": "dimers"} -> child.parameters keeps it, the field
                                              says 'monomers'

The study path does all three through `cast_numeric_params`,
`complete_distribution_aliases` and the `seed_type` pop. The tool now does the same
by calling the same functions, rather than a fourth implementation.
"""

from __future__ import annotations

import uuid

import pytest

from apps.accounts.models import User
from apps.ai_assistant.tools.study_tools import create_parametric_study_tool
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy


@pytest.fixture
def owned_project(db: None) -> tuple[User, Project]:
    user: User = User.objects.create_user(
        email=f"tool-child-{uuid.uuid4()}@example.com", password="x"
    )
    return user, Project.objects.create(name="tool child", owner=user)


def _child(user: User, project: Project, **overrides: object):
    """Call the handler with the defaults, letting a test replace any of them."""
    payload: dict[str, object] = {
        "name": "tool study",
        "algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {"n_particles": [60]},
        "project_id": str(project.id),
        "user": user,
    }
    payload.update(overrides)
    # The module exports the `ToolDefinition`; its `.handler` is the function the
    # runner calls, and the one the other tests exercise.
    result = create_parametric_study_tool.handler(**payload)
    study = ParametricStudy.objects.get(id=result["study_id"])
    return study.simulations.get()


def test_a_numeric_string_is_cast_before_it_is_stored(owned_project) -> None:
    user, project = owned_project

    child = _child(
        user,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": "1.5",
            "target_kf": 1.3,
        },
    )

    value = child.parameters["target_df"]
    assert isinstance(value, float), (
        f"the tool stored {value!r} ({type(value).__name__}); the binding takes a "
        "real number"
    )
    assert value == 1.5


def test_seed_type_goes_to_the_field_not_to_the_blob(owned_project) -> None:
    user, project = owned_project

    child = _child(
        user,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "seed_type": "dimers",
        },
    )

    assert "seed_type" not in child.parameters, (
        "the child carries a seed_type the run ignores: "
        f"{child.parameters.get('seed_type')!r}"
    )
    assert child.seed_type == "dimers", (
        f"the child runs with {child.seed_type!r} while the payload said dimers"
    )


def test_a_declared_distribution_reaches_the_engine_name(owned_project) -> None:
    """The alias step: the name the worker reads, not the name the client sent."""
    user, project = owned_project

    child = _child(
        user,
        project,
        base_parameters={
            "n_particles": 60,
            "target_df": 2.0,
            "target_kf": 1.3,
            "target_kf_distribution": {"mode": "fixed", "value": 1.3},
        },
    )

    assert "target_kf_distribution" in child.parameters, child.parameters
