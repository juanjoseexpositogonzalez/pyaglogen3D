"""Regression tests for engine-input mapping in ``tasks.py``.

The Rust engine is dimensionless: it consumes per-particle sizes
(``radius_min`` / ``radius_max`` from the stored parameters) unchanged. The
primary-particle diameter (v2 ``primary_particle_diameter_nm`` / v1
``primary_particle_radius_nm``) is a DISPLAY/EXPORT scale, never an engine
input.

These tests freeze that contract by asserting that for both schema versions,
``run_simulation_task`` forwards the same ``radius_min`` / ``radius_max``
values to ``aglogen_core.run_dla`` regardless of whether the stored
parameters carry the v1 legacy key or the v2 key.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.services.params import (
    PARAM_KEY_DIAMETER,
    PARAM_KEY_RADIUS_LEGACY,
    PARAM_KEY_SCHEMA_VERSION,
)
from apps.simulations.tasks import run_simulation_task


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name="T6b Test Project")


@pytest.fixture(autouse=True)
def _silence_side_effects():
    """Stub out post-run side-effects that require richer DB fixtures.

    These paths are well tested elsewhere; here we only care about the
    engine-input kwargs.
    """
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured",
            return_value=None,
        ),
    ):
        yield


def _fake_engine_result() -> SimpleNamespace:
    """Minimal stand-in for the `aglogen_core.run_dla` return value.

    The downstream path in ``run_simulation_task`` reads engine-result
    attributes flatly (not nested); this mirrors that shape just enough to
    persist a simulation and let the test assert on the call kwargs.
    """
    coordinates = np.zeros((2, 3), dtype=np.float64)
    radii = np.ones(2, dtype=np.float64)
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


def _make_sim(project: Project, parameters: dict) -> Simulation:
    return Simulation.objects.create(
        project=project,
        algorithm="dla",
        parameters=parameters,
        seed=42,
    )


def _engine_kwargs(mock_run_dla) -> dict:
    """Return the kwargs that tasks.py passed into `aglogen_core.run_dla`."""
    assert mock_run_dla.called, "aglogen_core.run_dla was not invoked"
    _, kwargs = mock_run_dla.call_args
    return kwargs


@patch("aglogen_core.run_dla")
def test_v1_params_produce_expected_engine_inputs(mock_run_dla, project) -> None:
    """A v1 simulation forwards radius_min/radius_max to the engine unchanged.

    The legacy ``primary_particle_radius_nm`` key is NOT an engine input and
    MUST NOT leak into the ``run_dla`` kwargs.
    """
    mock_run_dla.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            "radius_min": 1.0,
            "radius_max": 1.0,
            # v1 schema: legacy key present, no schema version
            PARAM_KEY_RADIUS_LEGACY: 25.0,
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run_dla)
    assert kwargs["radius_min"] == 1.0
    assert kwargs["radius_max"] == 1.0
    # The schema keys must never be forwarded to the engine.
    assert PARAM_KEY_RADIUS_LEGACY not in kwargs
    assert PARAM_KEY_DIAMETER not in kwargs


@patch("aglogen_core.run_dla")
def test_v2_params_produce_expected_engine_inputs(mock_run_dla, project) -> None:
    """A v2 simulation produces numerically identical engine inputs to v1."""
    mock_run_dla.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            "radius_min": 1.0,
            "radius_max": 1.0,
            PARAM_KEY_DIAMETER: 50.0,
            PARAM_KEY_SCHEMA_VERSION: "v2",
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run_dla)
    assert kwargs["radius_min"] == 1.0
    assert kwargs["radius_max"] == 1.0
    assert PARAM_KEY_RADIUS_LEGACY not in kwargs
    assert PARAM_KEY_DIAMETER not in kwargs


@patch("aglogen_core.run_dla")
def test_v1_and_v2_produce_identical_engine_inputs(mock_run_dla, project) -> None:
    """Schema version is invisible to the engine: same engine-kwargs for both."""
    mock_run_dla.return_value = _fake_engine_result()

    v1_sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            "radius_min": 1.5,
            "radius_max": 1.5,
            PARAM_KEY_RADIUS_LEGACY: 25.0,
        },
    )
    run_simulation_task(str(v1_sim.id))
    v1_kwargs = dict(_engine_kwargs(mock_run_dla))

    mock_run_dla.reset_mock()
    mock_run_dla.return_value = _fake_engine_result()

    v2_sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "sticking_probability": 1.0,
            "radius_min": 1.5,
            "radius_max": 1.5,
            PARAM_KEY_DIAMETER: 50.0,
            PARAM_KEY_SCHEMA_VERSION: "v2",
        },
    )
    run_simulation_task(str(v2_sim.id))
    v2_kwargs = dict(_engine_kwargs(mock_run_dla))

    # Engine inputs are invariant under schema version — the whole point of
    # keeping the unit scaling at the read boundary.
    assert v1_kwargs["radius_min"] == v2_kwargs["radius_min"]
    assert v1_kwargs["radius_max"] == v2_kwargs["radius_max"]
