"""R11 — sintering is rejected for the algorithms that do not consume it.

Contract: openspec/changes/sintering-reaches-engine, T4 (D6).

The model has eleven algorithms (`models.py:8-21`) and only six consume
sintering. `limiting` reads `sintering_coeff` (`tasks.py:1800`) and ignores
type, min, max and std, so it accepts the fixed shape only. The remaining four
consume nothing at all: a study that declares sintering for them stores
parameters that do not describe what ran, which is the harm this contract
exists to close.

Every scenario here goes through the API, because the rule belongs to
validation and must produce a 400 before anything is written (R12).
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation

#: The four algorithms that consume no sintering at all (R11).
NO_SINTERING = ("fracval", "gcca", "box_rfa", "imported")

#: A setting on each of the seven input surfaces of R3, as POST overrides.
SURFACES: dict[str, dict[str, Any]] = {
    "surface 1: parameter_grid.sintering_config": {
        "parameter_grid": {
            "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]
        }
    },
    "surface 2: study-level sintering_config": {
        "sintering_config": {"distribution_type": "fixed", "coefficient": 0.8}
    },
    "surface 3: base_parameters dict": {
        "base_parameters": {
            "n_particles": 100,
            "sintering_config": {"distribution_type": "fixed", "coefficient": 0.8},
        }
    },
    "surface 4: base_parameters flat": {
        "base_parameters": {"n_particles": 100, "sintering_coeff": 0.8}
    },
    "surface 5: parameter_grid flat sweep": {
        "parameter_grid": {"sintering_coeff": [0.8]}
    },
    "surface 6: theoretical_extremes flat sweep": {
        "include_limiting_cases": True,
        "limiting_cases_config": {"theoretical_extremes": {"sintering_coeff": [0.8]}},
    },
    "surface 7: theoretical_extremes dict sweep": {
        "include_limiting_cases": True,
        "limiting_cases_config": {
            "theoretical_extremes": {
                "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]
            }
        },
    },
}


@pytest.fixture
def user(db: None) -> User:
    created: User = User.objects.create_user(
        email=f"t4-{uuid.uuid4()}@example.com",
        password="testpass123",
    )
    return created


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="T4 Allow-list Project", owner=user)


@pytest.fixture
def api_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture(autouse=True)
def _mock_celery_dispatch() -> Any:
    """No child task may be queued by any of these requests."""
    mock_result = MagicMock(id="fake-celery-task-id")
    with patch("apps.simulations.views.run_simulation_task") as mock_task:
        mock_task.delay.return_value = mock_result
        yield mock_task


def _post(
    api_client: APIClient, project: Project, algorithm: str, **overrides: Any
) -> Any:
    payload: dict[str, Any] = {
        "name": "T4 study",
        "base_algorithm": algorithm,
        "base_parameters": {"n_particles": 100},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(overrides)
    return api_client.post(
        f"/api/v1/projects/{project.id}/studies/", data=payload, format="json"
    )


# --- R11.4 — rejected for the algorithms that consume nothing --------------


@pytest.mark.parametrize("algorithm", NO_SINTERING)
@pytest.mark.parametrize("surface", sorted(SURFACES))
def test_r11_4_sintering_is_rejected_for_non_consuming_algorithms(
    api_client: APIClient, project: Project, algorithm: str, surface: str
) -> None:
    before = ParametricStudy.objects.count(), Simulation.objects.count()

    resp = _post(api_client, project, algorithm, **SURFACES[surface])

    assert resp.status_code == 400, f"{algorithm} accepted sintering on {surface}"
    assert "sintering" in str(resp.data).lower()
    assert (ParametricStudy.objects.count(), Simulation.objects.count()) == before


def test_r11_4_fracval_rejects_the_two_surfaces_the_scenario_names(
    api_client: APIClient, project: Project
) -> None:
    """The scenario names these two explicitly, so they get their own test."""
    flat = _post(
        api_client,
        project,
        "fracval",
        base_parameters={"n_particles": 100, "sintering_coeff": 0.8},
    )
    assert flat.status_code == 400, flat.data

    extreme = _post(
        api_client,
        project,
        "fracval",
        include_limiting_cases=True,
        limiting_cases_config={"theoretical_extremes": {"sintering_coeff": [0.8]}},
    )
    assert extreme.status_code == 400, extreme.data


def test_r11_4_the_six_consuming_algorithms_still_accept_sintering(
    api_client: APIClient, project: Project
) -> None:
    """The allow-list must not close the door on the algorithms that read it."""
    for algorithm in (
        "dla",
        "cca",
        "ballistic",
        "ballistic_cc",
        "tunable",
        "tunable_cc",
    ):
        resp = _post(
            api_client,
            project,
            algorithm,
            sintering_config={"distribution_type": "normal", "mean": 0.8, "std": 0.05},
        )
        assert resp.status_code == 201, f"{algorithm}: {resp.data}"


# --- R11.5 — limiting accepts the fixed shape only -------------------------


def test_r11_5_limiting_rejects_the_normal_shape(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        "limiting",
        sintering_config={"distribution_type": "normal", "mean": 0.8, "std": 0.05},
    )

    assert resp.status_code == 400, resp.data
    assert "fixed" in str(resp.data).lower()


def test_r11_5_limiting_rejects_the_uniform_shape(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        "limiting",
        sintering_config={"distribution_type": "uniform", "min": 0.7, "max": 0.95},
    )

    assert resp.status_code == 400, resp.data


def test_r11_5_limiting_accepts_the_fixed_dict(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        "limiting",
        sintering_config={"distribution_type": "fixed", "coefficient": 0.9},
    )

    assert resp.status_code == 201, resp.data


def test_r11_5_limiting_accepts_the_flat_sweep(
    api_client: APIClient, project: Project
) -> None:
    """The batch form's only sintering input for limiting."""
    resp = _post(
        api_client,
        project,
        "limiting",
        parameter_grid={"sintering_coeff": [0.7, 0.9]},
    )

    assert resp.status_code == 201, resp.data


def test_r11_5_limiting_accepts_the_server_side_default_extremes(
    api_client: APIClient, project: Project
) -> None:
    """utils.py:72 sweeps sintering_coeff for limiting with no payload at all."""
    resp = _post(
        api_client,
        project,
        "limiting",
        include_limiting_cases=True,
    )

    assert resp.status_code == 201, resp.data


# --- R11.6 — a partial update evaluates against the stored algorithm -------


def test_r11_6_patch_evaluates_against_the_instance_algorithm(
    api_client: APIClient, project: Project
) -> None:
    created = _post(api_client, project, "fracval")
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"base_parameters": {"n_particles": 100, "sintering_coeff": 0.8}},
        format="json",
    )

    assert resp.status_code == 400, (
        "the rule was evaluated against an absent base_algorithm"
    )


def test_r11_6_switching_to_a_non_consuming_algorithm_is_rejected(
    api_client: APIClient, project: Project
) -> None:
    """The direction the first version missed: the payload carries no
    sintering, the stored study does, and the update changes the algorithm
    to one that cannot run it. Evaluating only the payload returns 200 and
    persists exactly the combination R11.4 forbids."""
    created = _post(
        api_client,
        project,
        "tunable",
        sintering_config={"distribution_type": "fixed", "coefficient": 0.9},
    )
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert resp.status_code == 400, (
        "a study was stored as fracval while keeping its sintering_config"
    )
    stored = ParametricStudy.objects.get(id=study_id)
    assert stored.base_algorithm == "tunable"


def test_r11_6_switching_to_limiting_with_a_normal_shape_is_rejected(
    api_client: APIClient, project: Project
) -> None:
    created = _post(
        api_client,
        project,
        "tunable",
        sintering_config={"distribution_type": "normal", "mean": 0.8, "std": 0.05},
    )
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"base_algorithm": "limiting"},
        format="json",
    )

    assert resp.status_code == 400, resp.data


def test_r11_6_switching_algorithm_with_stored_flat_keys_is_rejected(
    api_client: APIClient, project: Project
) -> None:
    """The same bypass through surface 4 instead of the study field."""
    created = _post(
        api_client,
        project,
        "tunable",
        base_parameters={"n_particles": 100, "sintering_coeff": 0.8},
    )
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"base_algorithm": "box_rfa"},
        format="json",
    )

    assert resp.status_code == 400, resp.data


def test_r11_6_put_cannot_launder_the_algorithm_either(
    api_client: APIClient, project: Project
) -> None:
    created = _post(
        api_client,
        project,
        "tunable",
        sintering_config={"distribution_type": "fixed", "coefficient": 0.9},
    )
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.put(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={
            "name": "laundered",
            "base_algorithm": "gcca",
            "base_parameters": {"n_particles": 100},
            "parameter_grid": {},
            "seeds_per_combination": 1,
        },
        format="json",
    )

    assert resp.status_code == 400, resp.data


def test_r11_6_dropping_the_sintering_while_switching_is_allowed(
    api_client: APIClient, project: Project
) -> None:
    """The rule must not trap a study: clearing the setting in the same
    request makes the new algorithm legitimate."""
    created = _post(
        api_client,
        project,
        "tunable",
        sintering_config={"distribution_type": "fixed", "coefficient": 0.9},
    )
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"base_algorithm": "fracval", "sintering_config": None},
        format="json",
    )

    assert resp.status_code == 200, resp.data


def test_r11_6_patch_of_a_dict_surface_on_a_non_consuming_study(
    api_client: APIClient, project: Project
) -> None:
    """The update path was pinned only through flat keys on surface 4."""
    created = _post(api_client, project, "fracval")
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"sintering_config": {"distribution_type": "fixed", "coefficient": 0.8}},
        format="json",
    )

    assert resp.status_code == 400, resp.data


def test_r11_6_patch_of_a_grid_dict_surface_is_rejected_too(
    api_client: APIClient, project: Project
) -> None:
    created = _post(api_client, project, "gcca")
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={
            "parameter_grid": {
                "sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]
            }
        },
        format="json",
    )

    assert resp.status_code == 400, resp.data


def test_r11_5_the_batch_forms_real_limiting_payload_still_works(
    api_client: APIClient, project: Project
) -> None:
    """The payload BatchSimulationForm.tsx:214-221 actually builds for
    limiting. The flat half of the fixed-only rule must not break it."""
    resp = _post(
        api_client,
        project,
        "limiting",
        base_parameters={
            "n_particles": 100,
            "geometry_type": "sphere",
            "configuration_type": "cuboctaedro",
            "packing": "HC",
            "sintering_coeff": 0.9,
        },
    )

    assert resp.status_code == 201, resp.data


# --- R11.5 beyond surface 2, and the flat shape (JD-A-003, JD-A-004) ------


@pytest.mark.parametrize(
    ("surface", "overrides"),
    [
        (
            "surface 1: parameter_grid.sintering_config",
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
                    "sintering_config": {
                        "distribution_type": "uniform",
                        "min": 0.7,
                        "max": 0.95,
                    },
                }
            },
        ),
        (
            "surface 7: theoretical_extremes dict sweep",
            {
                "include_limiting_cases": True,
                "limiting_cases_config": {
                    "theoretical_extremes": {
                        "sintering_config": [
                            {"distribution_type": "normal", "mean": 0.8, "std": 0.05}
                        ]
                    }
                },
            },
        ),
    ],
)
def test_r11_5_limiting_rejects_non_fixed_on_every_surface(
    api_client: APIClient, project: Project, surface: str, overrides: Any
) -> None:
    resp = _post(api_client, project, "limiting", **overrides)

    assert resp.status_code == 400, f"{surface} let a non-fixed shape through"


def test_r11_5_limiting_rejects_a_flat_non_fixed_type(
    api_client: APIClient, project: Project
) -> None:
    """The flat half of the fixed-only rule, declared in Log L33."""
    resp = _post(
        api_client,
        project,
        "limiting",
        base_parameters={
            "n_particles": 100,
            "sintering_type": "normal",
            "sintering_coeff": 0.8,
            "sintering_std": 0.05,
        },
    )

    assert resp.status_code == 400, resp.data
    assert "fixed" in str(resp.data).lower()


def test_r11_5_limiting_rejects_a_flat_non_fixed_type_when_swept(
    api_client: APIClient, project: Project
) -> None:
    resp = _post(
        api_client,
        project,
        "limiting",
        base_parameters={"n_particles": 100, "sintering_std": 0.05},
        parameter_grid={"sintering_type": ["normal"], "sintering_coeff": [0.8]},
    )

    assert resp.status_code == 400, resp.data


def test_r11_5_limiting_rejects_the_keys_the_worker_ignores(
    api_client: APIClient, project: Project
) -> None:
    """tasks.py:1800 reads sintering_coeff and nothing else on this path, so
    accepting sintering_std would store a parameter that did not run."""
    resp = _post(
        api_client,
        project,
        "limiting",
        base_parameters={
            "n_particles": 100,
            "sintering_coeff": 0.8,
            "sintering_std": 0.05,
        },
    )

    assert resp.status_code == 400, resp.data
    assert "sintering_std" in str(resp.data)


def test_r11_4_the_message_says_the_algorithm_does_not_consume_sintering(
    api_client: APIClient, project: Project
) -> None:
    """R11.4 requires the 400 to say so, not merely to mention sintering."""
    resp = _post(
        api_client,
        project,
        "fracval",
        sintering_config={"distribution_type": "fixed", "coefficient": 0.8},
    )

    assert resp.status_code == 400
    assert "does not consume sintering" in str(resp.data)
    assert "fracval" in str(resp.data)


def test_r11_5_the_default_extremes_really_reach_the_children(
    api_client: APIClient, project: Project
) -> None:
    """The first version only asserted 201, which any implementation gives
    for an empty sintering payload."""
    resp = _post(api_client, project, "limiting", include_limiting_cases=True)
    assert resp.status_code == 201, resp.data

    study = ParametricStudy.objects.get(id=resp.data["id"])
    coeffs = {
        child.parameters.get("sintering_coeff")
        for child in study.simulations.all()
        if "sintering_coeff" in child.parameters
    }
    assert {0.5, 0.75, 0.9, 1.0} <= coeffs, coeffs


def test_r11_6_patch_on_a_consuming_algorithm_still_works(
    api_client: APIClient, project: Project
) -> None:
    created = _post(api_client, project, "tunable_cc")
    assert created.status_code == 201, created.data
    study_id = created.data["id"]

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{study_id}/",
        data={"base_parameters": {"n_particles": 100, "sintering_coeff": 0.8}},
        format="json",
    )

    assert resp.status_code == 200, resp.data


# --- The freeze R11 never asked for -----------------------------------------


@pytest.mark.parametrize(
    ("label", "stored"),
    [
        ("grid dict", {"parameter_grid": {"sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]}}),
        ("study field", {"sintering_config": {"distribution_type": "fixed", "coefficient": 0.8}}),
        ("base_parameters dict", {"base_parameters": {"n_particles": 100, "sintering_config": {"distribution_type": "fixed", "coefficient": 0.8}}}),
        ("base_parameters flat", {"base_parameters": {"n_particles": 100, "sintering_coeff": 0.8}}),
        ("grid flat sweep", {"parameter_grid": {"sintering_coeff": [0.8]}}),
        ("extremes flat sweep", {"include_limiting_cases": True, "limiting_cases_config": {"theoretical_extremes": {"sintering_coeff": [0.8]}}}),
        ("extremes dict sweep", {"include_limiting_cases": True, "limiting_cases_config": {"theoretical_extremes": {"sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]}}}),
        ("grid stored as a list", {"parameter_grid": [1, 2, 3], "base_parameters": {"n_particles": 100, "sintering_coeff": 0.8}}),
        ("base_parameters stored as a string", {"base_parameters": "oops", "parameter_grid": {"sintering_coeff": [0.8]}}),
        ("limiting stored as a list", {"limiting_cases_config": [1, 2], "parameter_grid": {"sintering_coeff": [0.8]}}),
    ],
)
def test_a_stored_row_outside_the_allow_list_stays_editable(
    api_client: APIClient, project: Project, label: str, stored: dict[str, Any]
) -> None:
    """R11 fixes *which* algorithm the rule is evaluated against, not *when*.

    R11.6's own scenario is a PATCH that supplies a sintering key: it says
    such a request is evaluated against the stored algorithm. Nothing in R11
    asks for the rule to run on a request that touches no sintering key and
    no algorithm - and running it there froze every row stored before the
    allow-list existed, so renaming one answered 400 with no way out but
    deleting it. R13.12 states the gate explicitly for its own four keys;
    this is the same gate for R11's.
    """
    payload: dict[str, Any] = {
        "name": f"historical: {label}",
        "base_algorithm": "fracval",
        "base_parameters": {"n_particles": 100},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    payload.update(stored)
    row = ParametricStudy.objects.create(project=project, **payload)

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/",
        data={"name": "renamed"},
        format="json",
    )

    assert resp.status_code == 200, (
        f"a stored study carrying {label} can no longer be renamed: {resp.data}"
    )
    # Not only the status: a plausible "repair" of this gate is to heal the
    # row by stripping the stored setting, which would keep every assertion
    # above green while destroying what the user configured.
    row.refresh_from_db()
    for field, expected in stored.items():
        assert getattr(row, field) == expected, (
            f"the rename rewrote {field}: {getattr(row, field)!r} instead of {expected!r}"
        )


def test_the_bypass_that_was_critical_in_97_stays_closed(
    api_client: APIClient, project: Project
) -> None:
    """Gating must not reopen what the sintering contract closed.

    Creating without the setting and adding it by PATCH touches the key, so
    the rule still runs; changing the algorithm of a row that already carries
    it touches the algorithm, so it runs there too.
    """
    created = ParametricStudy.objects.create(
        project=project,
        name="clean",
        base_algorithm="fracval",
        base_parameters={"n_particles": 100},
        parameter_grid={},
        seeds_per_combination=1,
    )

    added = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{created.id}/",
        data={"sintering_config": {"distribution_type": "fixed", "coefficient": 0.8}},
        format="json",
    )
    assert added.status_code == 400, f"PATCH slipped sintering past the allow-list: {added.data}"
    created.refresh_from_db()
    assert not created.sintering_config, (
        f"refused with 400 and persisted it anyway: {created.sintering_config!r}"
    )

    consuming = ParametricStudy.objects.create(
        project=project,
        name="consuming",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100},
        parameter_grid={"sintering_coeff": [0.8]},
        seeds_per_combination=1,
    )
    moved = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{consuming.id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )
    assert moved.status_code == 400, (
        f"the algorithm moved out of the allow-list while sintering was stored: {moved.data}"
    )


@pytest.mark.parametrize(
    ("label", "payload"),
    [
        ("extremes flat sweep", {"limiting_cases_config": {"theoretical_extremes": {"sintering_coeff": [0.8]}}}),
        ("extremes dict sweep", {"limiting_cases_config": {"theoretical_extremes": {"sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]}}}),
    ],
)
@pytest.mark.parametrize("algorithm", NO_SINTERING)
def test_the_swept_surfaces_cannot_slip_sintering_past_the_allow_list(
    api_client: APIClient, project: Project, label: str, payload: dict[str, Any], algorithm: str
) -> None:
    """Surfaces 6 and 7 of R3, which the first version of this guard missed.

    A judge measured that dropping the swept carrier from the gate left the
    whole suite green while a PATCH persisted sintering on `fracval` - the
    exact bypass #97 closed as CRITICAL. The code was right; the witness did
    not exist, and a witness that cannot fail is what this file keeps
    learning about.
    """
    row = ParametricStudy.objects.create(
        project=project,
        name="clean",
        base_algorithm=algorithm,
        base_parameters={"n_particles": 100},
        parameter_grid={},
        seeds_per_combination=1,
    )

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/",
        data={"include_limiting_cases": True, **payload},
        format="json",
    )

    assert resp.status_code == 400, (
        f"{label} slipped sintering onto an algorithm that ignores it: {resp.data}"
    )
    # The message, not only the status: shrinking NO_SINTERING_ALGORITHMS left
    # all 8 cases of this sweep green - and the 28 of the surface matrix too,
    # which assert only that "sintering" appears - because it falls to a generic
    # "unknown algorithm" - which is also wrong in front of a user, since the
    # model accepts every one of these names. R11.4 promises a 400 stating
    # that *this algorithm* does not consume sintering.
    mensaje = str(resp.data)
    assert algorithm in mensaje and "does not consume" in mensaje, (
        f"the error does not say that {algorithm} ignores sintering: {resp.data}"
    )
    row.refresh_from_db()
    assert not (row.limiting_cases_config or {}).get("theoretical_extremes"), (
        f"{label} persisted despite the 400: {row.limiting_cases_config!r}"
    )


def test_a_full_representation_is_judged_even_when_the_algorithm_is_unchanged(
    api_client: APIClient, project: Project
) -> None:
    """R11.8's second clause: echoing the algorithm counts as touching it.

    The thaw covers requests that leave the algorithm alone. A PUT must carry
    `base_algorithm`, so a stored row stays refused there - decided rather
    than left implicit, because a full representation asserting "this
    algorithm with this sintering setting" asserts a combination the
    allow-list forbids. The same holds for a PATCH that echoes it, which is
    what a GET-then-write client sends.
    """
    row = ParametricStudy.objects.create(
        project=project,
        name="historical",
        base_algorithm="fracval",
        base_parameters={"n_particles": 100},
        parameter_grid={"sintering_coeff": [0.8]},
        seeds_per_combination=1,
    )
    url = f"/api/v1/projects/{project.id}/studies/{row.id}/"

    echoed = api_client.patch(url, data={"base_algorithm": "fracval"}, format="json")
    assert echoed.status_code == 400, (
        f"echoing the algorithm skipped the allow-list: {echoed.data}"
    )

    replaced = api_client.put(
        url,
        data={
            "name": "historical",
            "base_algorithm": "fracval",
            "base_parameters": {"n_particles": 100},
            "parameter_grid": {"sintering_coeff": [0.8]},
            "seeds_per_combination": 1,
        },
        format="json",
    )
    assert replaced.status_code == 400, (
        f"a full representation of an invalid combination was accepted: {replaced.data}"
    )

    renamed = api_client.patch(url, data={"name": "renamed"}, format="json")
    assert renamed.status_code == 200, (
        f"the rename that the thaw exists for stopped working: {renamed.data}"
    )

    # The PUT above carries the setting, so its 400 arrives through the
    # ordinary carrier and would survive the echo clause being deleted. These
    # two leave the setting out of the body, so the stored one plus the
    # echoed algorithm are the only thing left to judge.
    for field, stored in (
        ("sintering_config", {"distribution_type": "fixed", "coefficient": 0.8}),
        ("limiting_cases_config", {"theoretical_extremes": {"sintering_coeff": [0.8]}}),
    ):
        carrier = ParametricStudy.objects.create(
            project=project,
            name=f"stored {field}",
            base_algorithm="fracval",
            base_parameters={"n_particles": 100},
            parameter_grid={},
            seeds_per_combination=1,
            **{field: stored},
        )
        echo_only = api_client.put(
            f"/api/v1/projects/{project.id}/studies/{carrier.id}/",
            data={
                "name": f"stored {field}",
                "base_algorithm": "fracval",
                "base_parameters": {"n_particles": 100},
                "parameter_grid": {},
                "seeds_per_combination": 1,
            },
            format="json",
        )
        assert echo_only.status_code == 400, (
            f"the echoed algorithm alone did not judge the stored {field}: {echo_only.data}"
        )


@pytest.mark.parametrize(
    ("label", "stored"),
    [
        ("grid stored as a list", {"parameter_grid": [1, 2, 3]}),
        ("base_parameters stored as a string", {"base_parameters": "oops"}),
        ("limiting stored as a list", {"limiting_cases_config": [1, 2]}),
        ("extremes stored as a list", {"limiting_cases_config": {"theoretical_extremes": [1, 2]}}),
    ],
)
def test_a_mistyped_stored_container_answers_a_status_not_a_crash(
    api_client: APIClient, project: Project, label: str, stored: dict[str, Any]
) -> None:
    """The guard, exercised on a request that actually reaches it.

    The first version of this witness renamed the study, which touches
    neither a sintering setting nor the algorithm - so the gate short-circuits
    and the guard is never reached. Reverting any of the four guards left it
    green. Touching the algorithm forces the dereference that used to raise.
    """
    campos: dict[str, Any] = {
        "project": project,
        "name": f"historical: {label}",
        "base_algorithm": "fracval",
        "base_parameters": {"n_particles": 100},
        "parameter_grid": {},
        "seeds_per_combination": 1,
    }
    campos.update(stored)
    row = ParametricStudy.objects.create(**campos)

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/",
        data={"base_algorithm": "tunable_cc"},
        format="json",
    )

    # Not `in (200, 400)`: R11.8 says a stored non-mapping is **ignored**,
    # so the request must be answered on what it carries. Accepting either
    # status would pass just as well if the row were judged instead.
    assert resp.status_code == 200, (
        f"{label} was judged on its stored garbage instead of ignored: "
        f"{resp.status_code} {resp.data}"
    )


@pytest.mark.parametrize(
    ("surface", "payload"),
    [
        ("1 grid dict", {"parameter_grid": {"sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]}}),
        ("3 base_parameters dict", {"base_parameters": {"n_particles": 100, "sintering_config": {"distribution_type": "fixed", "coefficient": 0.8}}}),
        ("4 base_parameters flat", {"base_parameters": {"n_particles": 100, "sintering_coeff": 0.8}}),
        ("5 grid flat sweep", {"parameter_grid": {"sintering_coeff": [0.8]}}),
    ],
)
def test_no_surface_persists_sintering_on_an_algorithm_that_ignores_it(
    api_client: APIClient, project: Project, surface: str, payload: dict[str, Any]
) -> None:
    """The #97 bypass, by PATCH, with the row re-read on every surface.

    A judge measured that surface 3 had no witness at all and that surfaces
    1, 4 and 5 asserted the status without re-reading: deleting
    `data.get("base_parameters")` from the gate left the suite green except
    one test of another surface, while a PATCH persisted the setting. The
    CRITICAL this guards was about persistence, so persistence is what is
    asserted.
    """
    row = ParametricStudy.objects.create(
        project=project,
        name="clean",
        base_algorithm="fracval",
        base_parameters={"n_particles": 100},
        parameter_grid={},
        seeds_per_combination=1,
    )
    # A snapshot by value: holding the dicts themselves compares equal against
    # the row even after a write in place, which is the shape of witness this
    # file has spent three rounds removing.
    before = json.loads(json.dumps([row.base_parameters, row.parameter_grid, row.sintering_config]))

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/", data=payload, format="json"
    )

    assert resp.status_code == 400, f"surface {surface} was accepted: {resp.data}"
    row.refresh_from_db()
    after = json.loads(json.dumps([row.base_parameters, row.parameter_grid, row.sintering_config]))
    assert after == before, (
        f"surface {surface} answered 400 and wrote anyway: "
        f"{row.base_parameters} {row.parameter_grid} {row.sintering_config}"
    )


def test_a_full_update_of_an_allowed_study_still_succeeds(
    api_client: APIClient, project: Project
) -> None:
    """The clause that unblocked the previous round, which had no witness.

    R11.8 says a PUT is judged and refused only when the combination it
    asserts is not allowed. Nothing in the suite asserted the other half, so
    a regression refusing every full update would have stayed green - which
    is how the false absolute got written in the first place.
    """
    created = api_client.post(
        f"/api/v1/projects/{project.id}/studies/",
        data={
            "name": "allowed",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 100},
            "parameter_grid": {"n_particles": [100, 200]},
            "seeds_per_combination": 1,
            "sintering_config": {"distribution_type": "fixed", "coefficient": 0.9},
        },
        format="json",
    )
    assert created.status_code == 201, created.data

    replaced = api_client.put(
        f"/api/v1/projects/{project.id}/studies/{created.data['id']}/",
        data={
            "name": "renamed by a full update",
            "base_algorithm": "tunable_cc",
            "base_parameters": {"n_particles": 100},
            "parameter_grid": {"n_particles": [100, 200]},
            "seeds_per_combination": 1,
            "sintering_config": {"distribution_type": "fixed", "coefficient": 0.9},
        },
        format="json",
    )

    assert replaced.status_code == 200, (
        f"a full update of an allowed combination was refused: {replaced.data}"
    )
    # A 200 is not the same as having written: an `update()` that validates
    # and returns the instance without saving keeps every 400 in place and
    # the whole suite green. "Succeeds" means the row changed.
    stored = ParametricStudy.objects.get(id=created.data["id"])
    assert stored.name == "renamed by a full update", (
        f"the full update answered 200 and wrote nothing: {stored.name!r}"
    )


def test_the_stored_grid_dict_is_judged_when_only_the_algorithm_moves(
    api_client: APIClient, project: Project
) -> None:
    """Surface 1 read from the row, which no witness covered.

    A judge measured that swapping `eff_grid` for the payload `grid` in the
    allow-list call left all 82 cases green, while a PATCH that moves the
    algorithm persisted a sintering dict onto `fracval` - the #97 CRITICAL
    reopened from the other side. The existing update witness for this
    surface sends `parameter_grid` in the body, so it cannot tell the stored
    value from the payload one.
    """
    row = ParametricStudy.objects.create(
        project=project,
        name="stored grid dict",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100},
        parameter_grid={"sintering_config": [{"distribution_type": "fixed", "coefficient": 0.8}]},
        seeds_per_combination=1,
    )

    resp = api_client.patch(
        f"/api/v1/projects/{project.id}/studies/{row.id}/",
        data={"base_algorithm": "fracval"},
        format="json",
    )

    assert resp.status_code == 400, (
        f"the stored grid dict was not judged when the algorithm moved: {resp.data}"
    )
    row.refresh_from_db()
    assert row.base_algorithm == "tunable_cc", (
        f"the algorithm moved anyway, leaving sintering unread: {row.base_algorithm}"
    )
