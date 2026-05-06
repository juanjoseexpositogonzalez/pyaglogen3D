"""P4.3 — expand_distribution_kwargs helper + task plumbing.

Tests:
1. expand_distribution_kwargs pure function: each mode → correct kwargs
2. Task plumbing: run_simulation_task forwards distribution kwargs to engine

Follows test_sintering_plumbing.py pattern for mock-based plumbing tests.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from apps.projects.models import Project
from apps.simulations.models import Simulation
from apps.simulations.tasks import expand_distribution_kwargs, run_simulation_task


# ── Pure function tests: expand_distribution_kwargs ───────────────────


class TestExpandDistributionKwargs:
    def test_none_returns_empty(self) -> None:
        assert expand_distribution_kwargs("dpo", None) == {}

    def test_fixed_mode(self) -> None:
        result = expand_distribution_kwargs("dpo", {"mode": "fixed", "value": 12.5})
        assert result == {
            "dpo_mode": "fixed",
            "dpo_value": 12.5,
        }

    def test_normal_mode(self) -> None:
        result = expand_distribution_kwargs(
            "kf", {"mode": "normal", "mean": 1.3, "std": 0.1}
        )
        assert result == {
            "kf_mode": "normal",
            "kf_mean": 1.3,
            "kf_std": 0.1,
        }

    def test_uniform_mode(self) -> None:
        result = expand_distribution_kwargs(
            "dpo", {"mode": "uniform", "min": 10.0, "max": 15.0}
        )
        assert result == {
            "dpo_mode": "uniform",
            "dpo_min": 10.0,
            "dpo_max": 15.0,
        }

    def test_unknown_mode_returns_empty(self) -> None:
        """Safety: unknown mode doesn't crash — returns empty dict."""
        result = expand_distribution_kwargs("dpo", {"mode": "unsupported"})
        assert result == {}

    def test_empty_dict_returns_empty(self) -> None:
        result = expand_distribution_kwargs("dpo", {})
        assert result == {}


# ── Plumbing tests: distribution kwargs forwarded to engine ───────────


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name="P4.3 Distribution Plumbing Test")


@pytest.fixture(autouse=True)
def _silence_side_effects():
    """Stub post-run side-effects that require richer DB fixtures."""
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured",
            return_value=None,
        ),
    ):
        yield


def _fake_engine_result(n: int = 2) -> SimpleNamespace:
    """Minimal stand-in for engine result."""
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


def _make_sim(project: Project, parameters: dict) -> Simulation:
    return Simulation.objects.create(
        project=project,
        algorithm="tunable_cc",
        parameters=parameters,
        seed=42,
    )


def _engine_kwargs(mock_fn) -> dict:
    """Return kwargs that tasks.py passed into the mocked engine call."""
    assert mock_fn.called, f"{mock_fn._mock_name} was not invoked"
    _, kwargs = mock_fn.call_args
    return kwargs


@patch("aglogen_core.run_tunable_cc")
def test_task_plumbs_normal_dpo_distribution(mock_run, project) -> None:
    """Simulation with dpo_distribution=normal → engine receives dpo_mode/mean/std."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "dpo_distribution": {"mode": "normal", "mean": 1.0, "std": 0.05},
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["dpo_mode"] == "normal"
    assert kwargs["dpo_mean"] == 1.0
    assert kwargs["dpo_std"] == 0.05


@patch("aglogen_core.run_tunable_cc")
def test_task_plumbs_fixed_kf_distribution(mock_run, project) -> None:
    """Simulation with target_kf_distribution=fixed → engine receives kf_mode/value."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "target_kf_distribution": {"mode": "fixed", "value": 1.3},
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["kf_mode"] == "fixed"
    assert kwargs["kf_value"] == 1.3


@patch("aglogen_core.run_tunable_cc")
def test_task_plumbs_uniform_both_distributions(mock_run, project) -> None:
    """Both distributions present → engine receives all 6 kwargs."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
            "dpo_distribution": {"mode": "uniform", "min": 0.8, "max": 1.2},
            "target_kf_distribution": {"mode": "normal", "mean": 1.3, "std": 0.1},
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    assert kwargs["dpo_mode"] == "uniform"
    assert kwargs["dpo_min"] == 0.8
    assert kwargs["dpo_max"] == 1.2
    assert kwargs["kf_mode"] == "normal"
    assert kwargs["kf_mean"] == 1.3
    assert kwargs["kf_std"] == 0.1


@patch("aglogen_core.run_tunable_cc")
def test_task_without_distribution_no_extra_kwargs(mock_run, project) -> None:
    """Legacy simulation (no distribution config) → no dpo_mode/kf_mode kwargs."""
    mock_run.return_value = _fake_engine_result()
    sim = _make_sim(
        project,
        {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
        },
    )

    run_simulation_task(str(sim.id))

    kwargs = _engine_kwargs(mock_run)
    # Legacy: no distribution kwargs should be present
    assert "dpo_mode" not in kwargs
    assert "kf_mode" not in kwargs
    # Legacy scalars still present
    assert kwargs["target_kf"] == 1.3
    assert kwargs["radius_min"] == 1.0  # default
