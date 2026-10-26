"""Phase 0, round 2 for the distribution rewiring work — measured at the engine.

Round 1 measured only the REST surface, and that is exactly where a wrong
claim slipped through: D8 ("tunable_cc is monodisperse by construction") was
declared refuted by reading that `random_radius` is called per particle,
without reading what it receives. A fresh spec-review caught it.

This file measures the engine itself, plus the two entry doors that neither
the explore map nor round 1 contained.

Run (engine half needs no database):
    cd backend && python -m pytest \\
        tests/diagnostics/test_fase0_distribution_engine.py -q -s
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
    # The contract and issue #141 cite this pair of prefactors as evidence, so the
    # figure is asserted here rather than only printed: a number quoted in the gate
    # artifact has to be reproducible by the command that artifact publishes.
    print(f"[kf] prefactor {default.prefactor:.4f} -> {declared.prefactor:.4f}")
    assert default.prefactor == pytest.approx(1.2204, abs=5e-4)
    assert declared.prefactor == pytest.approx(1.0435, abs=5e-4)


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


def test_engine_panics_on_every_out_of_range_kf_the_contract_rejects() -> None:
    """The three panics R13 quotes as evidence, asserted instead of quoted.

    A number cited in the gate artifact has to be reproducible by the command
    that artifact publishes. Note the boundary: `kf_mean=0.0` does NOT panic
    (it runs at target_kf_used ~0.075), so rejecting `mean <= 0` rests on
    cc-tunable-aggregation R11/R12, not on a crash.
    """
    import aglogen_core

    casos = {
        "fixed value=-1": {"kf_mode": "fixed", "kf_value": -1.0},
        "normal mean=-1": {"kf_mode": "normal", "kf_mean": -1.0, "kf_std": 0.1},
        "uniform 2..1": {"kf_mode": "uniform", "kf_min": 2.0, "kf_max": 1.0},
    }
    for nombre, kwargs in casos.items():
        with pytest.raises(BaseException) as excinfo:  # noqa: B017 - that is the point
            aglogen_core.run_tunable_cc(**ENGINE_BASE, **kwargs)
        print(f"\n[panic kf] {nombre}: {type(excinfo.value).__name__}")
        assert not isinstance(excinfo.value, Exception), (
            f"{nombre} stopped being a BaseException: the worker guard would now catch it"
        )

    runs = aglogen_core.run_tunable_cc(
        **ENGINE_BASE, kf_mode="normal", kf_mean=0.0, kf_std=0.1
    )
    print(f"[panic kf] normal mean=0 does NOT panic: target_kf_used={runs.target_kf_used:.4f}")
    assert runs.target_kf_used == pytest.approx(0.0752, abs=5e-4), (
        "the mean=0 boundary moved: rejecting mean <= 0 rests on R11/R12, not on a crash"
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


def _kwargs_reaching_engine(child_id: Any) -> dict[str, Any] | None:
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
            # Distinct from "called with no kf_* kwargs": the contract's claim
            # is that the mode is dropped, not that dispatch never happened.
            return None
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
    if "lognormal" in door:
        # Re-pointed by PR 1 (T2.4b): this door used to answer 201 and hand the
        # engine nothing at all, which is the silent failure the contract
        # exists to close. It is a 400 now, and the kwargs assertion below no
        # longer applies because no child is created.
        assert resp.status_code == 400, (
            f"{door}: the unknown mode is accepted again, and the simulation "
            f"would run at the engine default: {resp.status_code}"
        )
        print("    refused, as R13.1 requires")
        return
    if resp.status_code != 201:
        print(f"    error={resp.data}")
        pytest.fail(f"{door}: respondio {resp.status_code}, se esperaba 201")
    study = ParametricStudy.objects.get(id=resp.data["id"])
    child = study.simulations.first()
    assert child is not None
    print(f"    hijo guarda: {child.parameters.get('target_kf_distribution')!r}")
    kwargs = _kwargs_reaching_engine(child.id)
    print(f"    kwargs al engine: {kwargs}")
    # The contract's central premise is measured here, so it is asserted: a
    # well-formed mode reaches the engine, an unknown one reaches it as
    # nothing at all and the simulation silently runs at the default.
    assert kwargs is not None, f"{door}: el worker nunca llamo al engine"
    # The lognormal door returns before reaching this point, because it is a
    # 400 now and creates no child. Keeping a branch for it here would be
    # unreachable code claiming to assert something - the shape this file's
    # own lessons are about.
    assert kwargs.get("kf_mode") == "fixed" and kwargs.get("kf_value") == 1.8, (
        f"{door}: the declared distribution no longer reaches the engine: {kwargs}"
    )
