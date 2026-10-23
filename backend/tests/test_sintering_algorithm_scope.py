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
