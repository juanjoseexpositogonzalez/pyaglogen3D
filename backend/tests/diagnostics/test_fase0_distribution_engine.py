"""Phase 0, round 2 for the distribution rewiring work — measured at the engine.

Round 1 measured only the REST surface, and that is exactly where a wrong
claim slipped through: D8 ("tunable_cc is monodisperse by construction") was
declared refuted by reading that `random_radius` is called per particle,
without reading what it receives. A fresh spec-review caught it.

This file measures the engine itself, plus the two entry doors that neither
the explore map nor round 1 contained.

Run (engine half needs no database):
    cd backend && python -m pytest \\
        tests/diagnostics/fase0_distribution_engine_truth.py -q -s
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy
from apps.simulations.tasks import run_simulation_task

ENGINE_BASE = {"n_particles": 60, "target_df": 2.0, "seed": 7}


# --- A. What the engine boundary really is --------------------------------


def test_engine_boundary_is_flat_kwargs() -> None:
    """The binding takes no dict at all: neither `mode` nor `distribution_type`.

    This is why the child's shape matters only through
    `expand_distribution_kwargs`, which translates it into these names.
    """
    import inspect

    import aglogen_core

    params = set(inspect.signature(aglogen_core.run_tunable_cc).parameters)
    print(f"\n[frontera] kf_*: {sorted(p for p in params if p.startswith('kf_'))}")
    print(f"[frontera] dpo_*: {sorted(p for p in params if p.startswith('dpo_'))}")
    assert "kf_mode" in params and "dpo_mode" in params
    assert not any(p.endswith("_distribution") for p in params)


def test_engine_kf_distribution_changes_the_run() -> None:
    """A declared kf distribution has a physical effect once it arrives."""
    import aglogen_core

    default = aglogen_core.run_tunable_cc(**ENGINE_BASE)
    declared = aglogen_core.run_tunable_cc(**ENGINE_BASE, kf_mode="fixed", kf_value=1.9)
    print(
        f"\n[kf] default target_kf_used={default.target_kf_used:.4f} "
        f"-> declared {declared.target_kf_used:.4f}"
    )
    assert default.target_kf_used == pytest.approx(1.3, abs=1e-9)
    assert declared.target_kf_used == pytest.approx(1.9, abs=1e-9), (
        "a declared kf no longer reaches the engine: the premise of this contract"
    )


def test_engine_dpo_is_one_radius_per_run_not_polydispersity() -> None:
    """D8 stands, and this is the measurement the earlier reading lacked.

    A `uniform` dpo does not give a spread of particle radii: every particle
    in the run shares the single sampled value. Calling it *polydispersity*
    in the UI is wrong; it is run-level variation.
    """
    import aglogen_core

    cases = {
        "default": {},
        "uniform 0.5-2.0": {"dpo_mode": "uniform", "dpo_min": 0.5, "dpo_max": 2.0},
        "normal 1.5+-0.3": {"dpo_mode": "normal", "dpo_mean": 1.5, "dpo_std": 0.3},
    }
    for name, kwargs in cases.items():
        result = aglogen_core.run_tunable_cc(**ENGINE_BASE, **kwargs)
        radii = np.asarray(result.radii, dtype=float).ravel()
        distinct = len(set(np.round(radii, 9)))
        print(
            f"\n[dpo] {name:16s} dpo_used={result.dpo_used:.4f} "
            f"n={radii.size} distinct={distinct} min={radii.min():.4f} max={radii.max():.4f}"
        )
        assert distinct == 1, "a run with more than one radius would refute D8"


def test_engine_ignores_radius_max_for_tunable_cc() -> None:
    """Sweeping `radius_max` in a grid does nothing for this algorithm."""
    import aglogen_core

    result = aglogen_core.run_tunable_cc(**ENGINE_BASE, radius_min=0.5, radius_max=2.0)
    radii = np.asarray(result.radii, dtype=float).ravel()
    print(
        f"\n[legacy] radius_min=0.5 radius_max=2.0 -> dpo_used={result.dpo_used:.4f} "
        f"distinct={len(set(np.round(radii, 9)))}"
    )
    assert result.dpo_used == pytest.approx(0.5, abs=1e-9), (
        "radius_max started to matter: sweeping it would stop being a no-op"
    )


def test_engine_panics_on_inverted_uniform_and_it_is_not_an_exception() -> None:
    """Found by the spec-review: this escapes `except Exception` in the worker."""
    import aglogen_core

    with pytest.raises(BaseException) as excinfo:  # noqa: B017 - that is the point
        aglogen_core.run_tunable_cc(
            **ENGINE_BASE, dpo_mode="uniform", dpo_min=2.0, dpo_max=1.0
        )
    raised = excinfo.value
    print(
        f"\n[panic] {type(raised).__name__}, es Exception: {isinstance(raised, Exception)}"
    )
    assert not isinstance(raised, Exception), (
        "the panic became an ordinary Exception; the worker guard would now catch it"
    )


# --- B. The two entry doors the map did not contain -----------------------


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"fase0b-{uuid.uuid4()}@example.com", password="testpass123"
    )
    return created


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="Fase 0 engine truth", owner=user)


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _post(client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "fase0b",
        "base_algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


def _kwargs_reaching_engine(child_id: Any) -> dict[str, Any]:
    with patch("aglogen_core.run_tunable_cc") as engine:
        engine.return_value = MagicMock(
            coordinates=np.zeros((1, 3)),
            radii=np.ones(1),
            fractal_dimension=2.0,
            fractal_dimension_std=0.0,
            radius_of_gyration=1.0,
            prefactor=1.3,
            coordination_mean=0.0,
            coordination_std=0.0,
            porosity=0.0,
            execution_time_ms=1,
            seed=1,
            dpo_used=1.0,
            target_kf_used=1.3,
            anisotropy=0.0,
            asphericity=0.0,
            acylindricity=0.0,
            principal_moments=[1.0, 1.0, 1.0],
            principal_axes=np.eye(3),
            rg_evolution=[],
            merge_trace=[],
        )
        try:
            run_simulation_task(str(child_id))
        except Exception as exc:  # noqa: BLE001 - the measurement, not a gate
            print(f"    (worker lanzo {type(exc).__name__}: {exc})")
        if not engine.called:
            return {}
        _, kwargs = engine.call_args
        return {k: v for k, v in kwargs.items() if k.startswith(("kf_", "dpo_"))}


@pytest.mark.parametrize(
    ("door", "overrides"),
    [
        (
            "puerta A: parameter_grid.target_kf_distribution",
            {
                "parameter_grid": {
                    "target_kf_distribution": [{"mode": "fixed", "value": 1.8}]
                }
            },
        ),
        (
            "puerta A invalida: {'mode':'lognormal'}",
            {
                "parameter_grid": {
                    "target_kf_distribution": [{"mode": "lognormal", "value": 1.8}]
                }
            },
        ),
        (
            "puerta B: base_parameters.target_kf_distribution",
            {
                "base_parameters": {
                    "n_particles": 60,
                    "target_df": 2.0,
                    "target_kf_distribution": {"mode": "fixed", "value": 1.8},
                }
            },
        ),
    ],
)
def test_undocumented_doors(
    api_client: APIClient, project: Project, door: str, overrides: dict[str, Any]
) -> None:
    resp = _post(api_client, project, **overrides)
    print(f"\n[{door}] status={resp.status_code}")
    if resp.status_code != 201:
        print(f"    error={resp.data}")
        return
    study = ParametricStudy.objects.get(id=resp.data["id"])
    child = study.simulations.first()
    assert child is not None
    print(f"    hijo guarda: {child.parameters.get('target_kf_distribution')!r}")
    print(f"    kwargs al engine: {_kwargs_reaching_engine(child.id)}")
