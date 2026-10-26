"""R11 at the two boundaries study expansion actually crosses.

Contract: openspec/changes/sintering-reaches-engine, T3.3, T3.4, T3.0c.

The unit-level half of R11 lives in `backend/tests/test_sintering_reaches_engine.py`,
which calls the helper directly. This file closes the other half: what a study
POST really writes into its children, and what the worker really hands to the
engine binding.

- T3.3 / R11.1: the declared mean reaches `aglogen_core.run_ballistic` as
  `sintering_coeff=0.8`, not as the 1.0 default that means *no sintering*.
- T3.4 / R11.2: `fixed` and `uniform` still arrive, unchanged by the fix.
- T3.4 / R11.3: no sintering key outside the set the worker reads
  (`tasks.py:1592-1598`) is written into a child, from **each of the seven
  input surfaces of R3**, named by number so a failing case names the surface
  it really exercises. Surfaces 6 and 7 carry the risk: their keys are written
  verbatim into the child (`utils.py:199-203`) with no guard at that write
  site, so the only thing keeping an out-of-set key out of a child is
  `check_flat_keys` in the serializer.
- T3.0c / R11.3: the same holds in one expansion that produces all four kinds
  of child at once - grid, range boundary, theoretical extreme and sintering
  extreme.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation
from apps.simulations.sintering_shape import FLAT_KEYS
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def user(db: None) -> User:
    # `UserManager.create_user` is unannotated, so bind the result before
    # returning it: mypy flags `no-any-return` otherwise.
    created: User = User.objects.create_user(
        email=f"r11-{uuid.uuid4()}@example.com",
        password="testpass123",
    )
    return created


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="R11 Expansion Test Project", owner=user)


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture(autouse=True)
def _mock_celery_dispatch() -> Iterator[MagicMock]:
    """The expansion queues one task per child; none of them must run here."""
    mock_result = MagicMock(id="fake-celery-task-id")
    with patch("apps.simulations.views.run_simulation_task") as mock_task:
        mock_task.delay.return_value = mock_result
        yield mock_task


@pytest.fixture(autouse=True)
def _silence_side_effects() -> Iterator[None]:
    """Post-run side-effects of the worker need richer fixtures than R11 does."""
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured", return_value=None
        ),
    ):
        yield


def _fake_engine_result(n: int = 2) -> SimpleNamespace:
    """Minimal stand-in for any engine result (same shape as the PYA-11 harness)."""
    return SimpleNamespace(
        coordinates=np.zeros((n, 3), dtype=np.float64),
        radii=np.ones(n, dtype=np.float64),
        fractal_dimension=1.8,
        fractal_dimension_std=0.0,
        prefactor=1.0,
        radius_of_gyration=1.0,
        porosity=0.5,
        coordination_mean=2.0,
        coordination_std=0.0,
        rg_evolution=np.array([], dtype=np.float64),
        anisotropy=1.0,
        asphericity=0.0,
        acylindricity=0.0,
        principal_moments=np.array([1.0, 1.0, 1.0]),
        principal_axes=np.eye(3),
        execution_time_ms=1,
    )


def _post_study(
    api_client: APIClient, project: Project, **overrides: Any
) -> ParametricStudy:
    """POST a ballistic study and return it, so expansion is production code."""
    payload: dict[str, Any] = {
        "name": "R11 study",
        "base_algorithm": "ballistic",
        "base_parameters": {"n_particles": 100, "sticking_probability": 1.0},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)

    resp = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data=payload,
        format="json",
    )
    assert resp.status_code == 201, resp.data
    return ParametricStudy.objects.get(id=resp.data["id"])


def _only_child(study: ParametricStudy) -> Simulation:
    children = list(study.simulations.all())
    assert len(children) == 1, [c.name for c in children]
    return children[0]


def _engine_kwargs(mock_fn: MagicMock) -> dict[str, Any]:
    assert mock_fn.called, "the engine binding was never invoked"
    _, kwargs = mock_fn.call_args
    return dict(kwargs)


def _sintering_keys(params: dict[str, Any]) -> set[str]:
    return {key for key in params if key.startswith("sintering")}


# --- T3.3 / R11.1 — the mean reaches the binding, and it is not 1.0 ---------


@patch("aglogen_core.run_ballistic")
def test_r11_1_normal_mean_reaches_the_engine_binding(
    mock_run: MagicMock, api_client: APIClient, project: Project
) -> None:
    """A study declared `normal` with mean 0.8 must not run at 1.0."""
    mock_run.return_value = _fake_engine_result()
    study = _post_study(
        api_client,
        project,
        parameter_grid={
            "sintering_config": [
                {"distribution_type": "normal", "mean": 0.8, "std": 0.05}
            ]
        },
    )

    run_simulation_task(str(_only_child(study).id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["sintering_type"] == "normal"
    assert kwargs["sintering_coeff"] == 0.8, (
        "the declared mean never reached the engine"
    )
    assert kwargs["sintering_coeff"] != 1.0, "1.0 is the default: no sintering at all"
    assert kwargs["sintering_std"] == 0.05


# --- T3.4 / R11.2 — fixed and uniform still arrive -------------------------


@patch("aglogen_core.run_ballistic")
def test_r11_2_fixed_reaches_the_engine_binding(
    mock_run: MagicMock, api_client: APIClient, project: Project
) -> None:
    mock_run.return_value = _fake_engine_result()
    study = _post_study(
        api_client,
        project,
        sintering_config={"distribution_type": "fixed", "coefficient": 0.9},
    )

    run_simulation_task(str(_only_child(study).id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["sintering_type"] == "fixed"
    assert kwargs["sintering_coeff"] == 0.9


@patch("aglogen_core.run_ballistic")
def test_r11_2_uniform_reaches_the_engine_binding(
    mock_run: MagicMock, api_client: APIClient, project: Project
) -> None:
    mock_run.return_value = _fake_engine_result()
    study = _post_study(
        api_client,
        project,
        sintering_config={"distribution_type": "uniform", "min": 0.7, "max": 0.95},
    )

    run_simulation_task(str(_only_child(study).id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["sintering_type"] == "uniform"
    assert kwargs["sintering_min"] == 0.7
    assert kwargs["sintering_max"] == 0.95


# --- T3.4 / R11.3 — no sintering key without a reader, surface by surface ---


@pytest.mark.parametrize(
    ("surface", "overrides"),
    [
        (
            "surface 2: study-level sintering_config",
            {
                "sintering_config": {
                    "distribution_type": "normal",
                    "mean": 0.8,
                    "std": 0.05,
                }
            },
        ),
        (
            "surface 1: parameter_grid.sintering_config entry",
            {
                "parameter_grid": {
                    "sintering_config": [
                        {"distribution_type": "normal", "mean": 0.8, "std": 0.05}
                    ]
                }
            },
        ),
        (
            "surface 3: base_parameters dict",
            {
                "base_parameters": {
                    "n_particles": 100,
                    "sticking_probability": 1.0,
                    "sintering_config": {
                        "distribution_type": "normal",
                        "mean": 0.8,
                        "std": 0.05,
                    },
                }
            },
        ),
        (
            "surface 4: base_parameters flat keys",
            {
                "base_parameters": {
                    "n_particles": 100,
                    "sticking_probability": 1.0,
                    "sintering_type": "normal",
                    "sintering_coeff": 0.8,
                    "sintering_std": 0.05,
                }
            },
        ),
        (
            "surface 5: parameter_grid flat sweep",
            {
                "parameter_grid": {"sintering_coeff": [0.7, 0.9]},
            },
        ),
        (
            "surface 6: theoretical_extremes flat sweep",
            {
                "include_limiting_cases": True,
                "limiting_cases_config": {
                    "theoretical_extremes": {"sintering_coeff": [0.7, 0.9]}
                },
            },
        ),
        (
            "surface 7: theoretical_extremes dict sweep",
            {
                "include_limiting_cases": True,
                "limiting_cases_config": {
                    "theoretical_extremes": {
                        "sintering_config": [
                            {"distribution_type": "fixed", "coefficient": 0.8}
                        ]
                    }
                },
            },
        ),
    ],
)
def test_r11_3_children_only_carry_keys_the_worker_reads(
    api_client: APIClient, project: Project, surface: str, overrides: dict[str, Any]
) -> None:
    study = _post_study(api_client, project, **overrides)

    children = list(study.simulations.all())
    assert children, f"{surface} produced no child"
    for child in children:
        written = _sintering_keys(child.parameters)
        assert written <= FLAT_KEYS, f"{surface} wrote {written - FLAT_KEYS}"
        assert "sintering_mean" not in child.parameters
        assert "sintering_config" not in child.parameters


# --- T3.0c / R11.3 — the four kinds of child in one expansion ---------------


def test_r11_3_holds_across_a_full_expansion(
    api_client: APIClient, project: Project
) -> None:
    """Grid, range boundary, theoretical extreme and sintering extreme at once.

    `base_parameters` carries the dict as well, so the sintering-extreme
    children inherit it and R11.7 is exercised through the API, not only
    against the helper.
    """
    study = _post_study(
        api_client,
        project,
        base_parameters={
            "n_particles": 100,
            "sticking_probability": 1.0,
            "sintering_config": {
                "distribution_type": "fixed",
                "coefficient": 0.7,
            },
        },
        parameter_grid={"n_particles": [100, 200]},
        include_limiting_cases=True,
        sintering_config={"distribution_type": "normal", "mean": 0.8, "std": 0.05},
    )

    children = list(study.simulations.all())
    names = " | ".join(child.name for child in children)
    for case_type in (
        "grid:",
        "boundary_min:",
        "boundary_max:",
        "theoretical:",
        "sintering_extreme:",
    ):
        assert case_type in names, f"no {case_type} child in this expansion: {names}"

    for child in children:
        written = _sintering_keys(child.parameters)
        assert written <= FLAT_KEYS, f"{child.name} wrote {written - FLAT_KEYS}"
        assert "sintering_mean" not in child.parameters
        assert "sintering_config" not in child.parameters

    sintering_extremes = [
        child for child in children if "sintering_extreme:" in child.name
    ]
    assert sorted(c.parameters["sintering_coeff"] for c in sintering_extremes) == [
        0.5,
        0.75,
        0.9,
        1.0,
    ]


# --- Closing review — two canonical promises that had no witness -----------
#
# The closing judgment found that the canonical spec states two properties
# which no test pins. Both are about a *value*, and both were "covered" by
# tests that only assert the request was accepted. A regression storing the
# wrong coefficient would have left the suite green - the exact silent
# failure this whole contract exists to close.


def test_r3_9_swept_well_formed_dict_child_really_runs_at_0_8(
    api_client: APIClient, project: Project
) -> None:
    """R3.9 promises the child *runs at 0.8*, not merely that the POST is 201.

    The two existing witnesses assert `201` / `is_valid()` and stop there.
    """
    study = _post_study(
        api_client,
        project,
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {
                "sintering_config": [
                    {"distribution_type": "fixed", "coefficient": 0.8}
                ]
            }
        },
    )

    swept = [
        child
        for child in study.simulations.all()
        if child.parameters.get("sintering_coeff") == 0.8
    ]
    assert swept, (
        "no child ran at the swept coefficient 0.8; "
        f"saw {[c.parameters.get('sintering_coeff') for c in study.simulations.all()]}"
    )
    for child in swept:
        assert child.parameters.get("sintering_coeff") != 1.0


def test_r3_precedence_base_parameters_dict_beats_the_study_dict(
    api_client: APIClient, project: Project
) -> None:
    """The middle rung of R3's precedence, which only prose asserted.

    `test_sintering_precedence_regression` pins dict-over-flat on both
    paths and says in its own docstring that the ordering *among* dicts
    "needs an API-level test". The canonical states that order as
    unchanged fact; this is the missing rung, so inverting it at grid
    expansion can no longer pass a green suite.
    """
    study = _post_study(
        api_client,
        project,
        base_parameters={
            "n_particles": 100,
            "sticking_probability": 1.0,
            "sintering_config": {"distribution_type": "fixed", "coefficient": 0.6},
        },
        sintering_config={"distribution_type": "fixed", "coefficient": 0.9},
    )

    child = _only_child(study)
    assert child.parameters.get("sintering_coeff") == 0.6, (
        "the study-level dict overrode the base_parameters dict; "
        "R3 states base_parameters wins over the study field"
    )
