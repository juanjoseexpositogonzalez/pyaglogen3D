"""Phase 0 probe for `distribution-grid-wiring` — measure, do not assume.

Versioned as the contract's Phase 0 evidence. The explore map is dated 2026-10-21 and
the sintering contract changed the serializer underneath it, so every
claim in section 7.2 is re-measured against today's code before anything
is locked into a contract.

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
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"fase0-{uuid.uuid4()}@example.com", password="testpass123"
    )
    return created


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="Fase 0 DGW", owner=user)


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _post(client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "fase0",
        "base_algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 100, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


def _report(name: str, resp: Any, expected: int | None = None) -> None:
    """Print the measurement and, when the contract quotes it, assert it.

    A spec-review found this file had zero assertions while the contract
    published its "20 passed" as evidence: half of that number could not
    fail. Every case the contract cites now carries its expected status.
    """
    print(f"\n[{name}] status={resp.status_code}")
    if resp.status_code >= 400:
        print(f"    error={resp.data}")
    if expected is not None:
        assert resp.status_code == expected, (
            f"{name}: measured {resp.status_code}, the contract quotes {expected}"
        )


# --- D1: ¿la forma {mode} sigue dando 400 en las otras dos rejillas? -------


def test_d1_kf_distribution_selector_shape(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        parameter_grid={"kf_distribution": [{"mode": "fixed", "value": 1.5}]},
    )
    # Re-pointed by PR 1 of distribution-grid-mode (task T2.4b): the `mode`
    # shape the form emits is now accepted on this key, where it used to be
    # refused for missing `distribution_type`. The measurement stands; what
    # changed is the behaviour it measures.
    _report("D1 kf_distribution {mode}", resp, 201)


def test_d1_particle_radius_selector_shape(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        parameter_grid={"particle_radius_config": [{"mode": "fixed", "value": 10.0}]},
    )
    # Re-pointed by PR 1 (T2.4b), same reason as the kf case above.
    _report("D1 particle_radius_config {mode}", resp, 201)


def test_d1_correct_shape_is_accepted(api_client: APIClient, project: Project) -> None:
    resp = _post(
        api_client,
        project,
        parameter_grid={
            "kf_distribution": [{"distribution_type": "fixed", "value": 1.5}]
        },
    )
    _report("D1 kf_distribution {distribution_type}", resp, 201)
    if resp.status_code == 201:
        study = ParametricStudy.objects.get(id=resp.data["id"])
        for child in study.simulations.all():
            print(
                f"    hijo: kf_distribution={child.parameters.get('kf_distribution')!r}"
            )


# --- #115 punto 1: objeto desnudo barrido en extremos teoricos -------------


def test_p115_1_bare_dict_in_theoretical_extremes(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {"kf_distribution": {"mode": "fixed", "value": 1.5}}
        },
    )
    _report("#115.1 objeto desnudo en extremos", resp, 201)
    if resp.status_code == 201:
        study = ParametricStudy.objects.get(id=resp.data["id"])
        vistos = {
            repr(c.parameters.get("kf_distribution"))
            for c in study.simulations.all()
            if "kf_distribution" in c.parameters
        }
        print(f"    valores guardados: {vistos or 'ninguno'}")


# --- #115 punto 2: lista de tipos mezclados --------------------------------


def test_p115_2_mixed_type_grid_list(api_client: APIClient, project: Project) -> None:
    resp = _post(api_client, project, parameter_grid={"target_df": [1.8, "abc"]})
    _report("#115.2 grid de tipos mezclados", resp, 201)
    if resp.status_code == 201:
        study = ParametricStudy.objects.get(id=resp.data["id"])
        print(
            f"    valores: {[c.parameters.get('target_df') for c in study.simulations.all()]}"
        )


# --- #115 punto 4: 500 con valor inhashable --------------------------------


def test_p115_4_unhashable_seed_type(api_client: APIClient, project: Project) -> None:
    try:
        resp = _post(api_client, project, parameter_grid={"seed_type": [["monomers"]]})
        _report("#115.4 seed_type inhashable", resp)
    except Exception as exc:  # noqa: BLE001 - that is the measurement
        print(f"\n[#115.4 seed_type inhashable] EXCEPCION {type(exc).__name__}: {exc}")


# --- D7: casos limite + dicts -> sorted() sobre dicts ----------------------


def test_d7_limiting_cases_with_dict_grid(
    api_client: APIClient, project: Project
) -> None:
    try:
        resp = _post(
            api_client,
            project,
            include_limiting_cases=True,
            parameter_grid={
                "kf_distribution": [
                    {"distribution_type": "fixed", "value": 1.3},
                    {"distribution_type": "fixed", "value": 1.8},
                ]
            },
        )
    except (RuntimeError, TypeError, ValueError) as exc:
        # D7 is closed today (measured 201). A regression of the
        # `sorted()`-over-dicts crash does NOT surface here: `preview_children`
        # catches TypeError and re-raises ExpansionPreviewError, which DRF
        # turns into a 400, so what goes red is `_report`'s expected status.
        # This branch covers whatever escapes that path, and fails loudly
        # rather than returning into a green run.
        pytest.fail(f"D7 volvio a reventar la expansion: {type(exc).__name__}: {exc}")
    _report("D7 casos limite + dos dicts", resp, 201)


# --- Hallazgo 2: la canonica documenta una TERCERA forma -------------------


def test_canon_r1_type_key(api_client: APIClient, project: Project) -> None:
    """R1 documenta `{type: "fixed", value}`. El codigo exige distribution_type."""
    resp = _post(
        api_client,
        project,
        parameter_grid={"kf_distribution": [{"type": "fixed", "value": 1.5}]},
    )
    _report("canon R1 {type}", resp, 400)


def test_canon_r1_2_scalar_shorthand(api_client: APIClient, project: Project) -> None:
    """R1.2: un escalar se trata como {fixed, value}."""
    resp = _post(api_client, project, parameter_grid={"kf_distribution": [1.3]})
    _report("canon R1.2 escalar", resp, 400)


def test_canon_r2_3_fixed_mean_key(api_client: APIClient, project: Project) -> None:
    """R2.3: particle_radius_config usa la clave `mean`, no `value`."""
    resp = _post(
        api_client,
        project,
        parameter_grid={
            "particle_radius_config": [{"distribution_type": "fixed", "mean": 1.5}]
        },
    )
    _report("canon R2.3 {fixed, mean}", resp, 400)


def test_canon_r2_2_std_over_mean_limit(
    api_client: APIClient, project: Project
) -> None:
    """R2.2: std/mean > 0.3 se rechaza."""
    resp = _post(
        api_client,
        project,
        parameter_grid={
            "particle_radius_config": [
                {"distribution_type": "normal", "mean": 1.0, "std": 0.5}
            ]
        },
    )
    _report("canon R2.2 std/mean=0.5", resp, 400)
