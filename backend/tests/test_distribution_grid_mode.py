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
        return {"base_parameters": {"n_particles": 60, "target_df": 2.0, key: config}}
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
        api_client,
        project,
        **_on_surface(key, carrier, {"mode": "lognormal", "value": 1.8}),
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
    api_client: APIClient,
    project: Project,
    key: str,
    label: str,
    config: dict[str, Any],
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
    """R13.7. A bare object swept through extremes stored key names as values.

    On the two parity keys the 400 still comes from the legacy validator,
    which answers first and says "Distribution config must be a dict." Only
    the engine-named keys exercise R13.7's own message here; that asymmetry
    disappears in PR 2, when the legacy spelling goes.
    """
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

    assert resp.status_code == 400, (
        f"PATCH slipped {key} past the allow-list: {resp.data}"
    )


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


def test_an_unrelated_update_still_works(
    api_client: APIClient, project: Project
) -> None:
    """R13.12's last clause: a stored row stays editable in its other fields."""
    created = _post(
        api_client, project, **_on_surface("kf_distribution", "parameter_grid", GOOD)
    )
    assert created.status_code == 201, created.data

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{created.data['id']}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, (
        f"renaming a study froze because it carries a distribution key: {resp.data}"
    )


# --- What the first round of judges found the tests could not see ---------
#
# The 104 cases below passed while three measured defects were live, because
# of what they did not parametrize: the carrier axis on the rules where the
# swept carrier differs, the legacy spelling on the engine-named keys, and a
# row that already carries the key when the request touches neither it nor
# the algorithm.


@pytest.mark.parametrize("key", ENGINE_KEYS)
@pytest.mark.parametrize("carrier", CARRIERS)
def test_the_legacy_spelling_is_refused_on_the_engine_named_keys(
    api_client: APIClient, project: Project, key: str, carrier: str
) -> None:
    """R1/R13: `expand_distribution_kwargs` reads `mode` and nothing else.

    Accepting `distribution_type` here stores a config the translator hands
    to the engine as `{}` - the silent default this contract exists to close.
    """
    resp = _post(
        api_client,
        project,
        **_on_surface(key, carrier, {"distribution_type": "fixed", "value": 1.8}),
    )

    assert resp.status_code == 400, (
        f"{carrier}.{key} accepted the legacy spelling; the engine would receive "
        f"no kwargs at all: {resp.data}"
    )


@pytest.mark.parametrize("key", ALL_KEYS)
def test_a_bare_object_on_the_swept_carrier_is_refused(
    api_client: APIClient, project: Project, key: str
) -> None:
    """R13.7: the sweep needs a list; an object makes children store key names."""
    resp = _post(
        api_client,
        project,
        include_limiting_cases=True,
        limiting_cases_config={"theoretical_extremes": {key: GOOD}},
    )

    assert resp.status_code == 400, (
        f"theoretical_extremes.{key} accepted a bare object; its children would "
        f"store the strings 'mode' and 'value' as the configuration: {resp.data}"
    )
    # Asserting the message, not only the status: removing the "a sweep needs
    # a list" rule left the whole suite green, because a Mapping enumerates to
    # its keys and `validate_shape` then rejects the strings. The 400 was
    # overdetermined, so nothing distinguished the rule from an accident.
    assert f"limiting_cases_config.theoretical_extremes.{key}" in resp.data, (
        f"the error does not name the surface that carried it: {resp.data}"
    )
    assert "must be a list" in str(resp.data), (
        f"refused for some other reason than the missing list: {resp.data}"
    )


@pytest.mark.parametrize("key", ALL_KEYS)
@pytest.mark.parametrize("value", ["1.8", True])
@pytest.mark.parametrize(
    "shape",
    [
        {"mode": "fixed", "value": "@"},
        {"mode": "normal", "mean": "@", "std": 0.1},
        {"mode": "normal", "mean": 1.5, "std": "@"},
        {"mode": "uniform", "min": "@", "max": 9.0},
        {"mode": "uniform", "min": 0.5, "max": "@"},
    ],
)
def test_a_non_numeric_magnitude_is_refused(
    api_client: APIClient,
    project: Project,
    key: str,
    value: Any,
    shape: dict[str, Any],
) -> None:
    """A string reaches the binding and fails there; a bool is silently 1.0.

    Crossing the *mode* axis as well as the key axis: the first version of
    this witness only parametrized `{mode: fixed, value}`, so `max` went
    unguarded and a string bound shipped - a regression this very PR had
    introduced by making the legacy validator yield on `mode` entries.
    """
    config = {field: (value if raw == "@" else raw) for field, raw in shape.items()}
    resp = _post(api_client, project, **_on_surface(key, "parameter_grid", config))

    assert resp.status_code == 400, f"{key} accepted {config}: {resp.data}"


@pytest.mark.parametrize("key", ("particle_radius_config", "dpo_distribution"))
@pytest.mark.parametrize("carrier", CARRIERS)
def test_the_std_over_mean_cap_follows_the_magnitude_not_the_spelling(
    api_client: APIClient, project: Project, key: str, carrier: str
) -> None:
    """R2: the cap exists to prevent negative radii and MUST NOT be weakened.

    Both names carry the same magnitude into the same engine input, so
    guarding one and not the other weakens it by renaming.
    """
    resp = _post(
        api_client,
        project,
        **_on_surface(key, carrier, {"mode": "normal", "mean": 1.0, "std": 0.5}),
    )

    assert resp.status_code == 400, (
        f"{carrier}.{key} accepted std/mean = 0.5: {resp.data}"
    )


@pytest.mark.parametrize(
    ("label", "grid", "limiting"),
    [
        (
            "legacy spelling on a parity key",
            {"kf_distribution": [{"distribution_type": "fixed", "value": 1.3}]},
            None,
        ),
        ("unknown mode", {"target_kf_distribution": [{"mode": "lognormal"}]}, None),
        (
            "legacy spelling on an engine key",
            {"target_kf_distribution": [{"distribution_type": "fixed", "value": 1.3}]},
            None,
        ),
        (
            "over the std/mean cap",
            {"dpo_distribution": [{"mode": "normal", "mean": 1.0, "std": 0.5}]},
            None,
        ),
        (
            "a bare object swept",
            {},
            {
                "theoretical_extremes": {
                    "kf_distribution": {"mode": "fixed", "value": 1.8}
                }
            },
        ),
        (
            "a non-numeric bound",
            {"target_kf_distribution": [{"mode": "uniform", "min": 0.5, "max": "3.0"}]},
            None,
        ),
        (
            "a negative value",
            {"kf_distribution": [{"mode": "fixed", "value": -1.0}]},
            None,
        ),
        (
            "a non-object entry swept",
            {},
            {"theoretical_extremes": {"dpo_distribution": ["1.8"]}},
        ),
    ],
)
@pytest.mark.parametrize("algorithm", (CONSUMES, "fracval"))
def test_every_shape_develop_used_to_store_stays_editable(
    api_client: APIClient,
    project: Project,
    label: str,
    grid: dict[str, Any],
    limiting: dict[str, Any] | None,
    algorithm: str,
) -> None:
    """R13.12's last clause, across the shapes this change starts refusing.

    Each of these was accepted by the API before this contract **on the key
    it is declared under here**, so rows holding them exist. A judge measured
    that two of them answered 400 on a parity key even then, because the
    legacy validator covered that lane: they are declared on the
    engine-named key, which did answer 201. Gating only the allow-list left the shape checks
    reading the stored values, and a rename answered 400 - a row editable
    in no field at all, which R7.2 promises against. The batch page shows
    no submit error (#115 point 6), so the user would see a dead button.
    """
    stored = ParametricStudy.objects.create(
        project=project,
        name=f"historical: {label}",
        base_algorithm=algorithm,
        base_parameters={"n_particles": 60},
        parameter_grid=grid,
        limiting_cases_config=limiting or {},
        include_limiting_cases=limiting is not None,
        seeds_per_combination=1,
    )

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{stored.id}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, (
        f"a {algorithm} study storing {label} can no longer be renamed: {resp.data}"
    )


@pytest.mark.parametrize(
    "stored",
    [
        {"kf_distribution": "1.8"},
        {"kf_distribution": [{"mode": "fixed", "value": 1.3}]},
        {"dpo_distribution": {"mode": "normal", "mean": 1.0, "std": 0.5}},
        {"target_kf_distribution": {"distribution_type": "fixed", "value": 1.3}},
    ],
)
def test_a_malformed_config_stored_in_base_parameters_stays_editable(
    api_client: APIClient, project: Project, stored: dict[str, Any]
) -> None:
    """The carrier the previous witness never crossed.

    `base_parameters` is read by the same `_effective` fallback, so leaving
    it out of the witness left a third of the clause unpinned.
    """
    row = ParametricStudy.objects.create(
        project=project,
        name="historical base_parameters",
        base_algorithm="fracval",
        base_parameters={"n_particles": 60, **stored},
        parameter_grid={},
        seeds_per_combination=1,
    )

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, (
        f"a row storing {stored} in base_parameters can no longer be renamed: {resp.data}"
    )


@pytest.mark.parametrize("stored", [["x"], "nope", 5])
def test_a_mistyped_limiting_container_does_not_turn_a_rename_into_a_500(
    api_client: APIClient, project: Project, stored: Any
) -> None:
    """Found in round 3: `.get` on a stored list raised instead of answering.

    Only ORM writers reach this - the payload guard rejects a non-object -
    and the AI assistant's study tool is one of them, which the contract
    names as a door it does not govern.
    """
    row = ParametricStudy.objects.create(
        project=project,
        name="mistyped container",
        base_algorithm=CONSUMES,
        base_parameters={"n_particles": 60},
        parameter_grid={},
        limiting_cases_config=stored,
        seeds_per_combination=1,
    )

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, f"stored {stored!r} broke a rename: {resp.data}"


def test_a_row_stored_before_this_change_stays_editable(
    api_client: APIClient, project: Project
) -> None:
    """R13.12's last clause, on a row the check would otherwise freeze.

    Written through the ORM on purpose: the API refuses this shape now, and
    the clause is about rows that already exist. The previous witness created
    its study on `tunable_cc`, where the scope check is a no-op, so it could
    not fail.
    """
    stored = ParametricStudy.objects.create(
        project=project,
        name="historical",
        base_algorithm="tunable",
        base_parameters={"n_particles": 60},
        parameter_grid={
            "kf_distribution": [{"distribution_type": "fixed", "value": 1.3}]
        },
        seeds_per_combination=1,
    )

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{stored.id}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, (
        "a study stored before this change can no longer be renamed, which "
        f"R13.12 forbids and R7.2 promises against: {resp.data}"
    )


# --- R13.10 — a well-formed config is delivered, not discarded -------------


@pytest.mark.parametrize("carrier", CARRIERS)
def test_a_well_formed_config_is_accepted_where_it_is_consumed(
    api_client: APIClient, project: Project, carrier: str
) -> None:
    """Acceptance, which is this PR's half of R13.10.

    Delivery under the engine-facing name is the other half and belongs to
    PR 2, so this witness does not assert it: the child carries the grid key
    today and `target_kf_distribution` only after the translation lands.
    """
    resp = _post(api_client, project, **_on_surface("kf_distribution", carrier, GOOD))

    assert resp.status_code == 201, (
        f"{carrier}.kf_distribution refused a well-formed config: {resp.data}"
    )
    study = ParametricStudy.objects.get(id=resp.data["id"])
    children = list(study.simulations.all())
    assert children, "accepted the study and created no child"


@pytest.mark.parametrize(
    ("label", "payload", "expected"),
    [
        # Scope answers first in the first four rows and in the two key
        # rows below; the last five break the tidy rule.
        (
            "mode spelling in the grid",
            {
                "parameter_grid": {
                    "kf_distribution": [{"mode": "nonsense", "value": 1.8}]
                }
            },
            "only consumed by",
        ),
        (
            "mode spelling in base_parameters",
            {
                "base_parameters": {
                    "n_particles": 60,
                    "kf_distribution": {"mode": "nonsense", "value": 1.8},
                }
            },
            "only consumed by",
        ),
        (
            "legacy spelling in base_parameters",
            {
                "base_parameters": {
                    "n_particles": 60,
                    "kf_distribution": {
                        "distribution_type": "uniform",
                        "min": 1.5,
                        "max": 1.0,
                    },
                }
            },
            "only consumed by",
        ),
        # The key dimension, which the first version of this table missed:
        # the legacy grid loop iterates _DISTRIBUTION_GRID_KEYS, which holds
        # only the two parity keys, so an engine key answers scope first in
        # the very carrier and spelling where kf_distribution does not.
        (
            "legacy spelling, engine key in the grid",
            {"parameter_grid": {"target_kf_distribution": [{"distribution_type": "uniform", "min": 1.5, "max": 1.0}]}},
            "only consumed by",
        ),
        (
            "legacy spelling, dpo key in the grid",
            {"parameter_grid": {"dpo_distribution": [{"distribution_type": "uniform", "min": 1.5, "max": 1.0}]}},
            "only consumed by",
        ),
        (
            "legacy spelling in a swept carrier",
            {
                "include_limiting_cases": True,
                "limiting_cases_config": {
                    "theoretical_extremes": {
                        "kf_distribution": [
                            {"distribution_type": "uniform", "min": 1.5, "max": 1.0}
                        ]
                    }
                },
            },
            "only consumed by",
        ),
        # The exceptions. The first is the carrier's own shape. The other
        # two are the legacy grid loop, which runs before the allow-list and
        # skips only entries carrying `mode`, so in parameter_grid alone the
        # precedence depends on the spelling.
        (
            "swept container that is not a list",
            {
                "include_limiting_cases": True,
                "limiting_cases_config": {
                    "theoretical_extremes": {
                        "kf_distribution": {"mode": "fixed", "value": 1.8}
                    }
                },
            },
            "must be a list",
        ),
        (
            "legacy spelling in the grid",
            {
                "parameter_grid": {
                    "kf_distribution": [
                        {"distribution_type": "uniform", "min": 1.5, "max": 1.0}
                    ]
                }
            },
            "must be <=",
        ),
        (
            "legacy non-dict entry in the grid",
            {"parameter_grid": {"kf_distribution": [1.3]}},
            "must be a dict",
        ),
        # And the carrier's own container shape, which a judge measured
        # after the fifth version of the sentence still called the swept
        # carrier the only container that answers first. It is not.
        ("grid that is not an object", {"parameter_grid": []}, "must be an object"),
        (
            "base_parameters that is not an object",
            {"base_parameters": []},
            "must be an object",
        ),
    ],
)
def test_the_measured_precedence_between_scope_and_shape(
    api_client: APIClient,
    project: Project,
    label: str,
    payload: dict[str, Any],
    expected: str,
) -> None:
    """The measured order, pinned here because the contract does not state it.

    Every committed draft of R11's precedence paragraph was false, and each
    survived a round. The spec no longer describes the order at all: it is
    a property of which validator happens to run first, and this table is
    where it belongs, because a table fails when the order changes and a
    paragraph does not.

    Carrier x spelling x key. The key dimension is what falsified the last
    draft: `_DISTRIBUTION_GRID_KEYS` holds only the two parity keys, so in
    the same carrier and the same spelling, `kf_distribution` is answered
    by the legacy loop and `target_kf_distribution` by the allow-list.
    """
    resp = _post(api_client, project, base_algorithm="fracval", **payload)

    assert resp.status_code == 400, f"{label} was accepted: {resp.data}"
    assert expected in str(resp.data), (
        f"{label} answered with another precedence than R11 states: {resp.data}"
    )
