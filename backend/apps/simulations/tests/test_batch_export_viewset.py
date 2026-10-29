"""Tests for export_projections action on ParametricStudyViewSet (Phase 3).

T3.2: 202 + correct response shape
T3.3: cross-study sim rejection → 400
T3.4: permissions (unauthenticated → 401)
T3.6: integration test (POST → 202)
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation, SimulationStatus


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(
        email=f"batch-{uuid.uuid4()}@example.com",
        password="testpass123",
    )


@pytest.fixture
def project(user: User) -> Project:
    return Project.objects.create(name="Test Project", owner=user)


@pytest.fixture
def study(project: Project) -> ParametricStudy:
    return ParametricStudy.objects.create(
        project=project,
        name="Test Study",
        base_algorithm="dla",
        base_parameters={"n_particles": 100},
        parameter_grid={"n_particles": [100]},
    )


@pytest.fixture
def completed_sims(project: Project, study: ParametricStudy) -> list[Simulation]:
    """Create 3 completed simulations in the study."""
    sims = []
    for i in range(3):
        sim = Simulation.objects.create(
            project=project,
            algorithm="dla",
            parameters={"n_particles": 100},
            seed=i,
            status=SimulationStatus.COMPLETED,
            is_batch=True,
        )
        study.simulations.add(sim)
        sims.append(sim)
    return sims


@pytest.fixture
def authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _export_url(project_pk: str, study_pk: str) -> str:
    return reverse(
        "project-studies-export-projections",
        kwargs={"project_pk": project_pk, "pk": study_pk},
    )


# ---------------------------------------------------------------------------
# T3.2 — Returns 202 + {job_id, status, total_sims}
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestExportProjectionsAction:
    def test_returns_202_with_correct_shape(
        self,
        authed_client: APIClient,
        project: Project,
        study: ParametricStudy,
        completed_sims: list[Simulation],
    ) -> None:
        sim_ids = [str(s.id) for s in completed_sims]

        with patch(
            "apps.simulations.tasks.build_batch_projections_zip"
        ) as mock_task:
            mock_result = MagicMock()
            mock_result.id = "fake-task-id"
            mock_task.delay.return_value = mock_result

            response = authed_client.post(
                _export_url(str(project.id), str(study.id)),
                data={
                    "simulation_ids": sim_ids,
                    "mode": "grid",
                    "config": {"az_step": 30, "el_step": 30},
                },
                format="json",
            )

        assert response.status_code == 202, response.json()
        body = response.json()
        assert "job_id" in body
        assert body["status"] == "queued"
        assert body["total_sims"] == 3

    # T3.3 — cross-study sim rejection
    def test_cross_study_sim_rejected(
        self,
        authed_client: APIClient,
        project: Project,
        study: ParametricStudy,
        completed_sims: list[Simulation],
    ) -> None:
        """POST with sim from another study → 400."""
        foreign_sim = Simulation.objects.create(
            project=project,
            algorithm="dla",
            parameters={"n_particles": 100},
            seed=999,
            status=SimulationStatus.COMPLETED,
            is_batch=True,
        )
        # foreign_sim NOT added to study

        response = authed_client.post(
            _export_url(str(project.id), str(study.id)),
            data={
                "simulation_ids": [str(foreign_sim.id)],
                "mode": "grid",
                "config": {"az_step": 30, "el_step": 30},
            },
            format="json",
        )

        assert response.status_code == 400
        assert "do not belong" in response.json().get("detail", "").lower()


# ---------------------------------------------------------------------------
# T3.4 — Permissions
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestExportProjectionsPermissions:
    def test_unauthenticated_rejected(
        self, project: Project, study: ParametricStudy
    ) -> None:
        client = APIClient()  # not authenticated
        response = client.post(
            _export_url(str(project.id), str(study.id)),
            data={
                "simulation_ids": [str(uuid.uuid4())],
                "mode": "grid",
                "config": {"az_step": 30, "el_step": 30},
            },
            format="json",
        )
        assert response.status_code in (401, 403)
