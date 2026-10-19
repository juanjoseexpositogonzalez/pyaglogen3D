"""Tests for the box-counting async boundary and job lifecycle (R3 — T3).

Covers spec requirements of `batch-windowed-box-counting`:
- R3.1: work set ≤ 30 → synchronous POST returning the per-sim summary
- R3.2: work set > 30 (geometry-less sims excluded) → 202 {task_id, total}
  + canonical status payload via Celery AsyncResult
- URL contract: name "project-studies-bc-job-status"
"""

from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation

# ── Fixtures / helpers ─────────────────────────────────────────────────


def _geometry_bytes() -> bytes:
    coords = np.array(
        [[1.0 * i, 0.0, 0.0, 0.5] for i in range(3)],
        dtype=np.float64,
    )
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _make_user(idx: int) -> User:
    return User.objects.create_user(
        email=f"bc-async-{idx}-{np.random.randint(1 << 30)}@example.com",
        password="irrelevant",
    )


def _make_study(project: Project) -> ParametricStudy:
    return ParametricStudy.objects.create(
        project=project,
        name="BC Async Study",
        base_algorithm="tunable_cc",
        base_parameters={"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
        parameter_grid={"n_particles": [100]},
        include_box_counting=True,
    )


def _make_sim(
    project: Project,
    study: ParametricStudy,
    *,
    with_geometry: bool = True,
) -> Simulation:
    sim = Simulation.objects.create(
        project=project,
        name=f"sim-{np.random.randint(1 << 30)}",
        algorithm="dla",
        parameters={"n_particles": 100},
        seed=42,
        status="completed",
        geometry=_geometry_bytes() if with_geometry else None,
        metrics={},
    )
    study.simulations.add(sim)
    return sim


@pytest.fixture
def user(db):
    return _make_user(0)


@pytest.fixture
def project(user):
    return Project.objects.create(name="BC Async Project", owner=user)


def _run_url(study: ParametricStudy) -> str:
    return reverse(
        "project-studies-run-box-counting",
        kwargs={"project_pk": study.project_id, "pk": study.id},
    )


def _status_url(study: ParametricStudy, task_id: str) -> str:
    return reverse(
        "project-studies-bc-job-status",
        kwargs={"project_pk": study.project_id, "pk": study.id, "task_id": task_id},
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ── R3.1 — synchronous boundary ────────────────────────────────────────


@pytest.mark.django_db
class TestR31SyncPath:
    def test_small_work_set_runs_synchronously(self, user, project):
        study = _make_study(project)
        for _ in range(2):
            _make_sim(project, study)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.return_value = MagicMock(
                dimension=2.5,
                r_squared=0.99,
                std_error=0.01,
                confidence_interval=(2.4, 2.6),
                log_scales=np.array([1.0, 2.0, 3.0]),
                log_values=np.array([3.0, 2.0, 1.0]),
                execution_time_ms=1,
                linear_region_start=0,
                effective_levels=5,
            )
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        assert response.data["status"] == "completed"
        assert response.data["results"]["total"] == 2
        assert response.data["results"]["processed"] == 2
        assert "task_id" not in response.data

    def test_geometry_less_sims_do_not_count_toward_boundary(self, user, project):
        """≤30 sims WITH geometry plus geometry-less sims stay synchronous
        and the geometry-less sims are not processed (M8)."""
        study = _make_study(project)
        for _ in range(30):
            _make_sim(project, study, with_geometry=True)
        for _ in range(5):
            _make_sim(project, study, with_geometry=False)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.return_value = MagicMock(
                dimension=2.5,
                r_squared=0.99,
                std_error=0.01,
                confidence_interval=(2.4, 2.6),
                log_scales=np.array([1.0, 2.0, 3.0]),
                log_values=np.array([3.0, 2.0, 1.0]),
                execution_time_ms=1,
                linear_region_start=0,
                effective_levels=5,
            )
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        assert response.data["results"]["total"] == 30


# ── R3.2 — async boundary and job lifecycle ────────────────────────────


@pytest.mark.django_db
class TestR32AsyncPath:
    def test_large_work_set_returns_202_with_task_id(self, user, project):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        for _ in range(5):
            _make_sim(project, study, with_geometry=False)
        client = _authed_client(user)

        with (
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            mock_delay.return_value = MagicMock(id="task-abc-123")
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        assert response.data["task_id"] == "task-abc-123"
        # Geometry-less sims excluded from the total (R3.2)
        assert response.data["total"] == 31
        mock_delay.assert_called_once()
        args = mock_delay.call_args.args
        assert args[0] == str(study.id)
        assert args[3] is False  # windowed
        assert args[4] is False  # force

    def test_status_endpoint_reports_processing(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "PROGRESS"
            mock_result.return_value.info = {
                "current": 7,
                "total": 31,
                "progress": 7 / 31,
            }
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data == {
            "status": "processing",
            "progress": 7 / 31,
            "current": 7,
            "total": 31,
        }

    def test_status_endpoint_reports_pending_as_processing(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "PENDING"
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "processing"
        assert response.data["progress"] == 0.0

    def test_status_endpoint_reports_done(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "SUCCESS"
            mock_result.return_value.result = {"total": 31, "processed": 31}
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data == {
            "status": "done",
            "progress": 1.0,
            "current": 31,
            "total": 31,
        }

    def test_status_endpoint_reports_failed_with_error(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "FAILURE"
            mock_result.return_value.info = ValueError("boom")
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "failed"
        assert "boom" in response.data["error"]


# ── Async task producer behavior ───────────────────────────────────────


@pytest.mark.django_db
class TestAsyncTaskProducer:
    def test_task_reports_progress_and_returns_summary(self, user, project):
        from apps.simulations.tasks import run_box_counting_async

        study = _make_study(project)
        for _ in range(2):
            _make_sim(project, study)

        updates: list[tuple[str, dict]] = []

        def _capture(state, meta=None, **kwargs):
            # MagicMock patched at class level receives no bound self.
            updates.append((state, meta or {}))

        # For a bound task, run() binds the real task instance as self; patch
        # Task.update_state at the class level so no real result backend is
        # contacted while we capture the published job state.
        with (
            patch("aglogen_core.box_counting_agglomerate") as mock_bc,
            patch("celery.app.task.Task.update_state", side_effect=_capture),
        ):
            mock_bc.return_value = MagicMock(
                dimension=2.5,
                r_squared=0.99,
                std_error=0.01,
                confidence_interval=(2.4, 2.6),
                log_scales=np.array([1.0, 2.0, 3.0]),
                log_values=np.array([3.0, 2.0, 1.0]),
                execution_time_ms=1,
                linear_region_start=0,
                effective_levels=5,
            )
            summary = run_box_counting_async.run(
                str(study.id),
                100,
                18,
                False,
                False,
            )

        assert summary["total"] == 2
        assert summary["processed"] == 2
        # One PROGRESS update per sim, canonical meta shape
        assert len(updates) == 2
        state, meta = updates[-1]
        assert state == "PROGRESS"
        assert meta == {"current": 2, "total": 2, "progress": 1.0}
