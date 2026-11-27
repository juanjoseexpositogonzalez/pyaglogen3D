from __future__ import annotations

import csv
import io
import uuid
from typing import Any

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation


def _make_user() -> User:
    return User.objects.create_user(
        email=f"partial-study-{uuid.uuid4()}@example.com", password="irrelevant"
    )


def _make_study(project: Project) -> ParametricStudy:
    return ParametricStudy.objects.create(
        project=project,
        name="Partial outputs study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100},
        parameter_grid={"n_particles": [100, 200]},
    )


def _make_completed_simulation(
    project: Project,
    study: ParametricStudy,
    *,
    n_particles: int,
    metrics: dict[str, Any],
) -> Simulation:
    simulation = Simulation.objects.create(
        project=project,
        name=f"sim-{uuid.uuid4()}",
        algorithm="dla",
        parameters={"n_particles": n_particles},
        seed=42,
        status="completed",
        metrics=metrics,
    )
    study.simulations.add(simulation)
    return simulation


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _url(study: ParametricStudy, action: str) -> str:
    return reverse(
        f"project-studies-{action}",
        kwargs={"project_pk": study.project_id, "pk": study.id},
    )


@pytest.fixture
def user(db: Any) -> User:
    return _make_user()


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="Partial outputs project", owner=user)


@pytest.mark.django_db
def test_results_marks_partial_rows_without_changing_completed_progress(
    user: User, project: Project
) -> None:
    study = _make_study(project)
    complete = _make_completed_simulation(
        project, study, n_particles=100, metrics={"fractal_dimension": 1.8}
    )
    partial = _make_completed_simulation(
        project,
        study,
        n_particles=100,
        metrics={"fractal_dimension": 1.9, "budget_exhausted": True},
    )

    response = _client(user).get(_url(study, "results"))

    assert response.status_code == 200
    rows = {row["simulation_id"]: row for row in response.data["results"]}
    assert set(rows) == {str(complete.id), str(partial.id)}
    assert rows[str(complete.id)]["status"] == "completed"
    assert rows[str(partial.id)]["status"] == "completed"
    assert rows[str(complete.id)]["partial"] is False
    assert rows[str(partial.id)]["partial"] is True
    assert response.data["progress"] == {
        "total": 2,
        "completed": 2,
        "failed": 0,
        "running": 0,
        "partial": 1,
    }


@pytest.mark.django_db
def test_fractal_summary_reports_partial_ids_without_changing_estimator_values(
    user: User, project: Project
) -> None:
    study = _make_study(project)
    partial = _make_completed_simulation(
        project,
        study,
        n_particles=100,
        metrics={"fractal_dimension": 1.9, "budget_exhausted": True},
    )
    _make_completed_simulation(
        project, study, n_particles=100, metrics={"fractal_dimension": 1.8}
    )
    _make_completed_simulation(
        project, study, n_particles=200, metrics={"fractal_dimension": 2.1}
    )

    response = _client(user).get(_url(study, "fractal-analysis"))

    assert response.status_code == 200
    configs = {item["config"]["n_particles"]: item for item in response.data["configs"]}
    partial_config = configs[100]
    assert partial_config["config"] == {
        "n_particles": 100,
        "partial_count": 1,
        "partial_simulation_ids": [str(partial.id)],
    }
    assert partial_config["estimators"]["rg"]["n"] == 2
    assert partial_config["estimators"]["rg"]["values"] == [1.9, 1.8]

    all_complete_config = configs[200]
    assert all_complete_config["config"]["partial_count"] == 0
    assert all_complete_config["config"]["partial_simulation_ids"] == []
    assert all_complete_config["estimators"]["rg"]["values"] == [2.1]


@pytest.mark.django_db
def test_study_csv_appends_partial_column_with_exact_boolean_values(
    user: User, project: Project
) -> None:
    study = _make_study(project)
    _make_completed_simulation(
        project, study, n_particles=100, metrics={"fractal_dimension": 1.8}
    )
    _make_completed_simulation(
        project,
        study,
        n_particles=200,
        metrics={"fractal_dimension": 1.9, "budget_exhausted": True},
    )

    response = _client(user).get(_url(study, "export"))

    assert response.status_code == 200
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8"))))
    legacy_header = [
        "Simulation ID",
        "Name",
        "Seed",
        "n_particles",
        "Df",
        "Df_std",
        "kf",
        "Rg_nm",
        "radius_nm",
        "Porosity",
        "Coord_Mean",
        "Coord_Std",
        "Anisotropy",
        "Asphericity",
        "Acylindricity",
        "Execution_ms",
        "Coord_Mode",
        "Coord_Max",
    ]
    assert rows[0][:-1] == legacy_header
    assert rows[0][-1] == "Partial"
    assert len(rows) == 3
    assert [row[-1] for row in rows[1:]] == ["false", "true"]
