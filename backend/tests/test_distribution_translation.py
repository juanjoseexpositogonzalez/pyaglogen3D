"""R13.9 and R13.10 - a declared distribution reaches the engine under its name.

Contract: openspec/changes/distribution-grid-mode, T2.2/T2.3 (PR 2).

Measured before writing this module, on the commit that merged PR #170:

| Declared | Child carried | Engine received |
| --- | --- | --- |
| `grid.kf_distribution` 1.5 + `base.target_kf_distribution` 1.8 | both | **1.8** — the grid lost |
| `grid.kf_distribution` alone | the grid key only | **{}**, so the run used 1.3 |
| `base.kf_distribution` alone | that key only | **{}** |
| swept `kf_distribution` | that key only | **{}** |
| `grid.particle_radius_config` 1.1 + `base.dpo_distribution` 0.9 | both | **0.9** — the grid lost |

Two failures in one: the magnitude the study sweeps can lose to the base it
was meant to override (R13.9), and a parity key that never gets translated
reaches the engine as nothing at all, so the run silently uses the default
(R13.10, R1).

The child keeps the grid key. R5.2 and R13.3 require it, four result views
read it, and the three expansion tests in `test_grid_expansion.py` pin it.
Translation adds the engine name; it never replaces the grid-facing one.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.expansion_preview import preview_children
from apps.simulations.models import ParametricStudy, Simulation
from apps.simulations.tasks import expand_distribution_kwargs

BASE: dict[str, Any] = {"n_particles": 60, "target_df": 2.0, "target_kf": 1.3}

#: One value per name so a mixed-up child is visible: whichever value reaches
#: the engine says which carrier won.
GRID_KF = {"mode": "fixed", "value": 1.5}
BASE_KF = {"mode": "fixed", "value": 1.8}
GRID_DPO = {"mode": "fixed", "value": 1.1}
BASE_DPO = {"mode": "fixed", "value": 0.9}

#: The pairs R13.9 governs: the grid-facing name and the one the worker reads.
PAIRS = (
    ("kf_distribution", "target_kf_distribution", "kf", GRID_KF, BASE_KF),
    ("particle_radius_config", "dpo_distribution", "dpo", GRID_DPO, BASE_DPO),
)


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"translation-{uuid.uuid4()}@example.com", password="x"
    )
    return created


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _post(client: APIClient, project: Project, **overrides: Any) -> Any:
    payload: dict[str, Any] = {
        "name": "translation study",
        "base_algorithm": "tunable_cc",
        "base_parameters": dict(BASE),
        "parameter_grid": {"n_particles": [60]},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


def _children(project: Project) -> list[Simulation]:
    return list(Simulation.objects.filter(project=project, is_batch=True))


def _child_params(project: Project) -> dict[str, Any]:
    """The parameters of the study's only child, as stored.

    Counted rather than taken with `.first()`: `Meta.ordering` is
    `-created_at`, so `.first()` is the LAST child created, and a study with
    limiting cases produces several. A judge measured that a swept witness was
    passing only because its child happened to be the last one written.
    """
    children = _children(project)
    assert len(children) == 1, f"expected one child, got {len(children)}"
    params: dict[str, Any] = children[0].parameters
    return params


def _child_carrying(project: Project, key: str) -> dict[str, Any]:
    """The only child that carries `key`, which is what a sweep produces."""
    carrying = [
        child.parameters
        for child in _children(project)
        if key in (child.parameters or {})
    ]
    assert len(carrying) == 1, f"expected one child carrying {key}, got {len(carrying)}"
    params: dict[str, Any] = carrying[0]
    return params


# --- R13.9 - the grid wins over base_parameters, in either direction ---


@pytest.mark.parametrize("grid_name,engine_name,prefix,grid_value,base_value", PAIRS)
def test_the_grid_value_wins_when_the_grid_uses_the_grid_name(
    api_client: APIClient,
    user: User,
    grid_name: str,
    engine_name: str,
    prefix: str,
    grid_value: dict[str, Any],
    base_value: dict[str, Any],
) -> None:
    """GIVEN the grid declares the parity name and base_parameters the engine one."""
    project = Project.objects.create(name="direction 1", owner=user)
    response = _post(
        api_client,
        project,
        parameter_grid={"n_particles": [60], grid_name: [grid_value]},
        base_parameters={**BASE, engine_name: base_value},
    )

    assert response.status_code == 201, response.data
    params = _child_params(project)
    assert params[grid_name] == grid_value
    assert params[engine_name] == grid_value, (
        f"the engine name kept the base value {params[engine_name]} instead of the "
        f"grid's {grid_value}: the magnitude the study sweeps loses to the one it "
        f"overrides"
    )
    assert expand_distribution_kwargs(prefix, params[engine_name]) == (
        expand_distribution_kwargs(prefix, grid_value)
    )


@pytest.mark.parametrize("grid_name,engine_name,prefix,grid_value,base_value", PAIRS)
def test_the_grid_value_wins_when_the_grid_uses_the_engine_name(
    api_client: APIClient,
    user: User,
    grid_name: str,
    engine_name: str,
    prefix: str,
    grid_value: dict[str, Any],
    base_value: dict[str, Any],
) -> None:
    """GIVEN the grid declares the engine name and base_parameters the parity one."""
    project = Project.objects.create(name="direction 2", owner=user)
    response = _post(
        api_client,
        project,
        parameter_grid={"n_particles": [60], engine_name: [grid_value]},
        base_parameters={**BASE, grid_name: base_value},
    )

    assert response.status_code == 201, response.data
    params = _child_params(project)
    assert params[engine_name] == grid_value
    assert params[grid_name] == grid_value, (
        "the child must keep the grid-facing name carrying the winning value, "
        "because four result views read it"
    )


# --- R13.10 - a parity key outside the grid is delivered, not discarded ---


@pytest.mark.parametrize("grid_name,engine_name,prefix,value,base_value", PAIRS)
def test_a_base_parameters_parity_key_reaches_the_engine(
    api_client: APIClient,
    user: User,
    grid_name: str,
    engine_name: str,
    prefix: str,
    value: dict[str, Any],
    base_value: dict[str, Any],
) -> None:
    """GIVEN base_parameters declares the grid-facing name and the grid omits it."""
    project = Project.objects.create(name="base surface", owner=user)
    response = _post(
        api_client,
        project,
        base_parameters={**BASE, grid_name: value},
    )

    assert response.status_code == 201, response.data
    params = _child_params(project)
    assert params[engine_name] == value
    assert expand_distribution_kwargs(prefix, params[engine_name]) != {}


@pytest.mark.parametrize("grid_name,engine_name,prefix,value,base_value", PAIRS)
def test_a_swept_parity_key_reaches_the_engine(
    api_client: APIClient,
    user: User,
    grid_name: str,
    engine_name: str,
    prefix: str,
    value: dict[str, Any],
    base_value: dict[str, Any],
) -> None:
    """GIVEN the parity key is swept through theoretical_extremes."""
    project = Project.objects.create(name="swept surface", owner=user)
    response = _post(
        api_client,
        project,
        include_limiting_cases=True,
        limiting_cases_config={"theoretical_extremes": {grid_name: [value]}},
    )

    assert response.status_code == 201, response.data
    params = _child_carrying(project, grid_name)
    assert params[engine_name] == value
    assert expand_distribution_kwargs(prefix, params[engine_name]) != {}


@pytest.mark.parametrize("grid_name,engine_name,prefix,value,base_value", PAIRS)
def test_an_engine_named_key_alone_in_base_parameters_reaches_both_names(
    api_client: APIClient,
    user: User,
    grid_name: str,
    engine_name: str,
    prefix: str,
    value: dict[str, Any],
    base_value: dict[str, Any],
) -> None:
    """GIVEN base_parameters declares only the name the worker reads.

    R13.10's third carrier. It worked before this change because the grid name
    was the missing one and `run_simulation_task` reads the engine name, so no
    test noticed; a judge measured that disabling the translation left this
    surface green.
    """
    project = Project.objects.create(name="engine surface", owner=user)
    response = _post(api_client, project, base_parameters={**BASE, engine_name: value})

    assert response.status_code == 201, response.data
    params = _child_params(project)
    assert params[engine_name] == value
    assert params[grid_name] == value, (
        "the grid-facing name must appear too, because four result views read it"
    )
    assert expand_distribution_kwargs(prefix, params[engine_name]) != {}


@pytest.mark.parametrize("grid_name,engine_name,prefix,value,base_value", PAIRS)
def test_a_grid_parity_key_reaches_the_engine(
    api_client: APIClient,
    user: User,
    grid_name: str,
    engine_name: str,
    prefix: str,
    value: dict[str, Any],
    base_value: dict[str, Any],
) -> None:
    """GIVEN the grid sweeps the parity name and nothing else declares it."""
    project = Project.objects.create(name="grid surface", owner=user)
    response = _post(
        api_client,
        project,
        parameter_grid={"n_particles": [60], grid_name: [value]},
    )

    assert response.status_code == 201, response.data
    params = _child_params(project)
    assert params[engine_name] == value
    assert expand_distribution_kwargs(prefix, params[engine_name]) != {}


def test_a_sintering_extreme_child_carries_the_engine_name(
    api_client: APIClient, user: User
) -> None:
    """GIVEN sintering extremes are generated alongside a parity key.

    The extremes are the one path that builds children without going through
    `create_simulation`'s sintering branch, so it is the one where the preview
    and the real expansion can drift apart. Found by reading, not by a judge:
    the real path translated there and the preview did not.
    """
    project = Project.objects.create(name="sintering extremes", owner=user)
    response = _post(
        api_client,
        project,
        base_parameters={**BASE, "kf_distribution": GRID_KF},
        include_limiting_cases=True,
        sintering_config={"distribution_type": "fixed", "coefficient": 0.8},
    )

    assert response.status_code == 201, response.data
    children = Simulation.objects.filter(project=project, is_batch=True)
    assert children.exists()
    for child in children:
        params = child.parameters or {}
        assert params.get("target_kf_distribution") == GRID_KF, (
            f"a child of this study carries no engine name: {params}"
        )


# --- R1 - the discriminator the engine pipeline speaks is `mode` ---


@pytest.mark.parametrize("grid_name", ("kf_distribution", "particle_radius_config"))
def test_the_legacy_discriminator_is_refused_on_the_parity_keys(
    api_client: APIClient, user: User, grid_name: str
) -> None:
    """GIVEN the legacy `distribution_type` spelling on a parity key.

    R1 refuses any discriminator other than `mode`, and the tolerance that let
    this through existed only until the translation landed - which is this
    change. `type` is tested too: the two legacy spellings are the same defect.

    R1 requires the refusal, not a message, so this asserts what the contract
    asserts. Measured today: the `distribution_type` payload is refused by the
    shape validator ("mode must be one of ['fixed', 'normal', 'uniform']") and
    the `type` payload by the older validator, which answers "distribution_type
    is required in distribution config." - a refusal that names the wrong key.
    It is a message defect in a validator this change does not own, and it is
    written down in the pull request rather than fixed here.
    """
    project = Project.objects.create(name="legacy spelling", owner=user)
    for legacy in ("distribution_type", "type"):
        response = _post(
            api_client,
            project,
            parameter_grid={
                "n_particles": [60],
                grid_name: [{legacy: "fixed", "value": 1.5}],
            },
        )
        assert response.status_code == 400, (
            f"{legacy} was accepted on {grid_name}: {response.data}"
        )
    assert not Simulation.objects.filter(project=project).exists(), (
        "a refused request stored a child"
    )


def test_the_preview_and_the_stored_children_agree(
    api_client: APIClient, user: User
) -> None:
    """The preview runs the real expansion, not a model of it.

    A judge measured that removing the translation from the preview's
    sintering-extreme branch turned no test red: the preview had drifted from
    `views.py` and nothing noticed, which is the failure mode this module
    exists to prevent. This compares the two, child for child.
    """
    project = Project.objects.create(name="preview parity", owner=user)
    response = _post(
        api_client,
        project,
        base_parameters={**BASE, "kf_distribution": GRID_KF},
        parameter_grid={"n_particles": [60, 120]},
        include_limiting_cases=True,
        sintering_config={"distribution_type": "fixed", "coefficient": 0.8},
    )
    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])

    previewed = preview_children(
        algorithm=study.base_algorithm,
        base_parameters=study.base_parameters,
        parameter_grid=study.parameter_grid,
        study_sintering_config=study.sintering_config,
        include_limiting_cases=study.include_limiting_cases,
        limiting_cases_config=study.limiting_cases_config,
        max_children=1000,
    )

    def fingerprint(params: dict[str, Any]) -> str:
        return json.dumps(params, sort_keys=True, default=str)

    assert Counter(map(fingerprint, previewed)) == Counter(
        map(fingerprint, (child.parameters for child in _children(project)))
    ), "the preview and the stored children disagree"


def test_a_grid_declaring_both_names_keeps_each_entry_verbatim(
    api_client: APIClient, user: User
) -> None:
    """GIVEN one grid holds both spellings of the same magnitude.

    R1 requires each child to carry its distribution object verbatim under the
    grid-facing name. A judge measured this as a regression introduced by the
    translation: syncing the sibling name overwrote the entries of one spelling,
    so two sweeps of `kf_distribution` reached no consumer while the child that
    was labelled 1.5 stored 1.8.

    Both names in one grid is two independent dimensions, and neither R1 nor
    R13.9 chooses between them. Each child keeps its own entry; the worker reads
    the engine name, which is what that key swept.
    """
    project = Project.objects.create(name="both spellings", owner=user)
    first, second = {"mode": "fixed", "value": 1.5}, {"mode": "fixed", "value": 1.6}
    engine = {"mode": "fixed", "value": 1.8}

    response = _post(
        api_client,
        project,
        parameter_grid={
            "kf_distribution": [first, second],
            "target_kf_distribution": [engine],
        },
    )

    assert response.status_code == 201, response.data
    stored = [child.parameters for child in _children(project)]
    assert sorted(
        json.dumps(params["kf_distribution"], sort_keys=True) for params in stored
    ) == sorted(json.dumps(entry, sort_keys=True) for entry in (first, second)), (
        "a swept entry did not survive verbatim under the grid-facing name"
    )
    assert all(params["target_kf_distribution"] == engine for params in stored)


def test_a_carrier_declaring_both_names_keeps_both(api_client: APIClient, user: User) -> None:
    """GIVEN base_parameters declares one magnitude under both names.

    Translation adds and never replaces, so the child keeps what the study
    declared and the worker reads the engine name. This is the case R13.9 does
    not govern, now pinned instead of left to whichever line ran last.
    """
    project = Project.objects.create(name="both in base", owner=user)
    response = _post(
        api_client,
        project,
        base_parameters={
            **BASE,
            "kf_distribution": GRID_KF,
            "target_kf_distribution": BASE_KF,
        },
    )

    assert response.status_code == 201, response.data
    params = _child_params(project)
    assert params["kf_distribution"] == GRID_KF
    assert params["target_kf_distribution"] == BASE_KF


def test_a_swept_extreme_beats_the_base_engine_value(api_client: APIClient, user: User) -> None:
    """GIVEN a theoretical extreme sweeps the parity name and base declares the engine one.

    R13.9 governs `parameter_grid` against `base_parameters`. What a *swept
    extreme* does to the same magnitude is not fixed by the contract, and this
    pins the choice the implementation makes: the value the request sweeps wins,
    because sweeping it is what the study varies.

    A judge measured this path as unpinned - reverting the translation at the
    sweep point changed the value the engine receives from 1.5 to 1.8 and no
    test noticed. `complete_distribution_aliases` rescues the other swept cases,
    so this is the one that can see it.
    """
    project = Project.objects.create(name="swept precedence", owner=user)
    response = _post(
        api_client,
        project,
        base_parameters={**BASE, "target_kf_distribution": BASE_KF},
        include_limiting_cases=True,
        limiting_cases_config={"theoretical_extremes": {"kf_distribution": [GRID_KF]}},
    )

    assert response.status_code == 201, response.data
    swept = [
        child.parameters
        for child in _children(project)
        if (child.parameters or {}).get("kf_distribution") == GRID_KF
    ]
    assert len(swept) == 1, f"expected one swept child, got {len(swept)}"
    assert swept[0]["target_kf_distribution"] == GRID_KF, (
        "the value the request swept did not reach the engine"
    )


def test_the_preview_keeps_each_entry_when_a_grid_names_both(
    api_client: APIClient, user: User
) -> None:
    """GIVEN one grid holds both spellings, the preview must not pick a winner.

    The `declared` guard has three call sites and only one had a witness. A
    judge measured this one: dropping it from the preview's grid loop left the
    suite green, and the preview then returned the engine value for both
    children while the stored ones kept their own entries - the exact drift
    between preview and reality this change claims to have closed.
    """
    project = Project.objects.create(name="preview both", owner=user)
    first, second = {"mode": "fixed", "value": 1.5}, {"mode": "fixed", "value": 1.6}
    engine = {"mode": "fixed", "value": 1.8}

    response = _post(
        api_client,
        project,
        parameter_grid={
            "kf_distribution": [first, second],
            "target_kf_distribution": [engine],
        },
    )
    assert response.status_code == 201, response.data
    study = ParametricStudy.objects.get(id=response.data["id"])

    previewed = preview_children(
        algorithm=study.base_algorithm,
        base_parameters=study.base_parameters,
        parameter_grid=study.parameter_grid,
        study_sintering_config=study.sintering_config,
        include_limiting_cases=study.include_limiting_cases,
        limiting_cases_config=study.limiting_cases_config,
        max_children=1000,
    )

    kept = sorted(json.dumps(child["kf_distribution"], sort_keys=True) for child in previewed)
    assert kept == sorted(json.dumps(entry, sort_keys=True) for entry in (first, second)), (
        "the preview chose a winner between two swept spellings"
    )


def test_a_swept_extreme_of_two_spellings_keeps_the_base_engine_value(
    api_client: APIClient, user: User
) -> None:
    """GIVEN theoretical_extremes names both spellings of one magnitude.

    The third `declared` call site. Dropping it left the suite green and the
    behaviour moves: the extreme child for `kf_distribution` kept the base
    engine value with the guard and silently overwrote it without.
    """
    project = Project.objects.create(name="extremes both", owner=user)
    response = _post(
        api_client,
        project,
        base_parameters={**BASE, "target_kf_distribution": BASE_KF},
        include_limiting_cases=True,
        limiting_cases_config={
            "theoretical_extremes": {
                "kf_distribution": [GRID_KF],
                "target_kf_distribution": [{"mode": "fixed", "value": 1.9}],
            }
        },
    )

    assert response.status_code == 201, response.data
    swept = [
        child.parameters
        for child in _children(project)
        if (child.parameters or {}).get("kf_distribution") == GRID_KF
    ]
    assert len(swept) == 1, f"expected one swept child, got {len(swept)}"
    assert swept[0]["target_kf_distribution"] == BASE_KF, (
        "the sweep overwrote a spelling the same request declares"
    )
