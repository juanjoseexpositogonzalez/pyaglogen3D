"""R13 — a declared distribution reaches the engine, or the study is refused.

Contract: openspec/changes/distribution-grid-mode, T2.1 and T2.1e (PR 1).

The harm this closes was measured before the contract was written
(`tests/diagnostics/test_fase0_distribution_engine.py`): a grid declaring
`target_kf_distribution` with an unrecognised `mode` answers `201`, the child
stores it, and `expand_distribution_kwargs` hands the engine nothing at all,
so the simulation runs at the `1.3` default and nobody is told. Out-of-range
values are worse: `kf_value=-1`, `kf_mean=-1` and an inverted `uniform` raise
a Rust `PanicException`, which derives from `BaseException` and escapes the
worker's only `except Exception`, leaving the row stuck in `RUNNING`.

Every scenario goes through the API, because the rule belongs to validation
and must produce a 400 before anything is written.

The twelve surfaces of R13 are the four distribution keys — the two parity
ones (`kf_distribution`, `particle_radius_config`) and the two the worker
reads (`target_kf_distribution`, `dpo_distribution`) — on three carriers:
`parameter_grid`, `base_parameters` and `limiting_cases_config.theoretical_extremes`.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy

#: The only algorithm whose worker branch expands these keys (R13.12).
CONSUMES = "tunable_cc"

#: The ten that do not, named rather than derived: an enumeration of the
#: excluded is what silently lost `limiting` and `imported` in round 5.
REFUSES = (
    "dla",
    "cca",
    "ballistic",
    "ballistic_cc",
    "tunable",
    "fracval",
    "gcca",
    "box_rfa",
    "limiting",
    "imported",
)

PARITY_KEYS = ("kf_distribution", "particle_radius_config")
ENGINE_KEYS = ("target_kf_distribution", "dpo_distribution")
ALL_KEYS = PARITY_KEYS + ENGINE_KEYS

GOOD = {"mode": "fixed", "value": 1.8}


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"dgm-{uuid.uuid4()}@example.com", password="testpass123"
    )
    return created


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="R13 project", owner=user)


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _post(client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "R13 study",
        "base_algorithm": CONSUMES,
        "base_parameters": {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


def _on_surface(key: str, carrier: str, config: Any) -> dict[str, Any]:
    """The same configuration placed on one of the three carriers."""
    if carrier == "parameter_grid":
        return {"parameter_grid": {key: [config]}}
    if carrier == "base_parameters":
        return {
            "base_parameters": {"n_particles": 60, "target_df": 2.0, key: config}
        }
    return {
        "include_limiting_cases": True,
        "limiting_cases_config": {"theoretical_extremes": {key: [config]}},
    }


CARRIERS = ("parameter_grid", "base_parameters", "theoretical_extremes")


# --- R13.1, R13.2, R13.5 — an unrecognised mode is refused, not defaulted ---


@pytest.mark.parametrize("key", ALL_KEYS)
@pytest.mark.parametrize("carrier", CARRIERS)
def test_unknown_mode_is_refused_on_every_surface(
    api_client: APIClient, project: Project, key: str, carrier: str
) -> None:
    """Twelve surfaces, one rule. Today ten of them answer 201."""
    resp = _post(
        api_client, project, **_on_surface(key, carrier, {"mode": "lognormal", "value": 1.8})
    )

    assert resp.status_code == 400, (
        f"{carrier}.{key} accepted an unrecognised mode; the engine would receive "
        "no kwargs and the simulation would run at the default"
    )
    assert "mode" in str(resp.data).lower(), (
        f"{carrier}.{key}: the error must name the accepted modes, so the caller "
        f"can fix it: {resp.data}"
    )


# --- R13.8, R13.6 — out of range, including the shapes that panic ----------


@pytest.mark.parametrize(
    ("label", "config"),
    [
        ("fixed value <= 0", {"mode": "fixed", "value": -1.0}),
        ("fixed value == 0", {"mode": "fixed", "value": 0.0}),
        ("normal mean <= 0", {"mode": "normal", "mean": -1.0, "std": 0.1}),
        ("normal std <= 0", {"mode": "normal", "mean": 1.5, "std": 0.0}),
        ("uniform min <= 0", {"mode": "uniform", "min": 0.0, "max": 1.0}),
        ("uniform inverted", {"mode": "uniform", "min": 2.0, "max": 1.0}),
    ],
)
@pytest.mark.parametrize("key", ALL_KEYS)
def test_out_of_range_is_refused(
    api_client: APIClient, project: Project, key: str, label: str, config: dict[str, Any]
) -> None:
    """R13.8. Three of these panic the worker with a non-Exception."""
    resp = _post(api_client, project, **_on_surface(key, "parameter_grid", config))

    assert resp.status_code == 400, f"{key}: accepted {label}: {resp.data}"


# --- R13.7 — a config that is not an object --------------------------------


@pytest.mark.parametrize("key", ALL_KEYS)
@pytest.mark.parametrize("value", [1.8, "fixed", [1.8], None])
def test_non_object_config_is_refused(
    api_client: APIClient, project: Project, key: str, value: Any
) -> None:
    """R13.7. A bare object swept through extremes stored key names as values."""
    resp = _post(api_client, project, **_on_surface(key, "parameter_grid", value))

    assert resp.status_code == 400, f"{key}: accepted {value!r}: {resp.data}"


# --- R13.12 — the allow-list, on create and on update ----------------------


@pytest.mark.parametrize("algorithm", REFUSES)
@pytest.mark.parametrize("key", ALL_KEYS)
def test_keys_are_refused_where_the_engine_cannot_receive_them(
    api_client: APIClient, project: Project, algorithm: str, key: str
) -> None:
    """R13.12 on create: only `tunable_cc` expands these into engine kwargs."""
    resp = _post(
        api_client,
        project,
        base_algorithm=algorithm,
        **_on_surface(key, "parameter_grid", GOOD),
    )

    assert resp.status_code == 400, (
        f"{algorithm} accepted {key}, which its worker branch never reads: {resp.data}"
    )
    assert CONSUMES in str(resp.data), (
        f"the error must name the algorithm that does consume it: {resp.data}"
    )


@pytest.mark.parametrize("key", ALL_KEYS)
def test_the_key_cannot_be_added_by_update(
    api_client: APIClient, project: Project, key: str
) -> None:
    """R13.12: the bypass that was CRITICAL in the sintering contract."""
    created = _post(api_client, project, base_algorithm="fracval")
    assert created.status_code == 201, created.data

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{created.data['id']}/",
        data={"parameter_grid": {key: [GOOD]}},
        format="json",
    )

    assert resp.status_code == 400, f"PATCH slipped {key} past the allow-list: {resp.data}"


@pytest.mark.parametrize("key", ALL_KEYS)
def test_the_algorithm_cannot_be_moved_out_of_the_allow_list(
    api_client: APIClient, project: Project, key: str
) -> None:
    """R13.12, the mismatch reached from the other side."""
    created = _post(api_client, project, **_on_surface(key, "parameter_grid", GOOD))
    assert created.status_code == 201, created.data

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{created.data['id']}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert resp.status_code == 400, (
        f"the algorithm moved out of the allow-list while {key} was stored: {resp.data}"
    )


def test_an_unrelated_update_still_works(api_client: APIClient, project: Project) -> None:
    """R13.12's last clause: a stored row stays editable in its other fields."""
    created = _post(api_client, project, **_on_surface("kf_distribution", "parameter_grid", GOOD))
    assert created.status_code == 201, created.data

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{created.data['id']}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, (
        f"renaming a study froze because it carries a distribution key: {resp.data}"
    )


# --- R13.10 — a well-formed config is delivered, not discarded -------------


@pytest.mark.parametrize("carrier", CARRIERS)
def test_a_well_formed_config_is_accepted_where_it_is_consumed(
    api_client: APIClient, project: Project, carrier: str
) -> None:
    """R13.10: refusing it would be the other half of the same defect."""
    resp = _post(api_client, project, **_on_surface("kf_distribution", carrier, GOOD))

    assert resp.status_code == 201, (
        f"{carrier}.kf_distribution refused a well-formed config: {resp.data}"
    )
    study = ParametricStudy.objects.get(id=resp.data["id"])
    children = list(study.simulations.all())
    assert children, "accepted the study and created no child"
