"""PYA-11 T3.2 — Verify sintering_coeff plumbing from API to engine.

Asserts that ``run_simulation_task`` forwards sintering parameters from
the ``Simulation.parameters`` JSONField to ``aglogen_core.run_tunable_cc``
(and ``run_dla`` as a control), with correct defaults when the caller
does not supply sintering fields.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name="PYA-11 Sintering Test")


@pytest.fixture(autouse=True)
def _silence_side_effects():
    """Stub out post-run side-effects that require richer DB fixtures."""
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured",
            return_value=None,
        ),
    ):
        yield


def _fake_engine_result(n: int = 2) -> SimpleNamespace:
    """Minimal stand-in for any engine result."""
    coordinates = np.zeros((n, 3), dtype=np.float64)
    radii = np.ones(n, dtype=np.float64)
    return SimpleNamespace(
        coordinates=coordinates,
        radii=radii,
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


def _make_sim(project: Project, algorithm: str, parameters: dict) -> Simulation:
    return Simulation.objects.create(
        project=project,
        algorithm=algorithm,
        parameters=parameters,
        seed=42,
    )


def _engine_kwargs(mock_fn) -> dict:
    """Return kwargs that tasks.py passed into the mocked engine call."""
    assert mock_fn.called, f"{mock_fn._mock_name} was not invoked"
    _, kwargs = mock_fn.call_args
    return kwargs


# ── tunable_cc sintering plumbing ─────────────────────────────────────


@patch("aglogen_core.run_tunable_cc")
def test_tunable_cc_with_sintering_coeff(mock_run, project) -> None:
    """POST with sintering_coeff=0.9 → engine receives sintering_coeff=0.9."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        "tunable_cc",
        {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "sintering_coeff": 0.9,
            "sintering_type": "fixed",
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["sintering_coeff"] == 0.9
    assert kwargs["sintering_type"] == "fixed"


@patch("aglogen_core.run_tunable_cc")
def test_tunable_cc_without_sintering_coeff_defaults(mock_run, project) -> None:
    """POST without sintering_coeff → engine receives default 1.0."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        "tunable_cc",
        {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            # no sintering_coeff — must default to 1.0
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["sintering_coeff"] == 1.0
    assert kwargs["sintering_type"] == "fixed"


# ── control: DLA also receives sintering ──────────────────────────────


@patch("aglogen_core.run_dla")
def test_dla_with_sintering_coeff(mock_run, project) -> None:
    """DLA also receives sintering_coeff — shared sintering pipeline."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        "dla",
        {
            "n_particles": 50,
            "sintering_coeff": 0.85,
            "sintering_type": "uniform",
            "sintering_min": 0.8,
            "sintering_max": 0.9,
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["sintering_coeff"] == 0.85
    assert kwargs["sintering_type"] == "uniform"
    assert kwargs["sintering_min"] == 0.8
    assert kwargs["sintering_max"] == 0.9
