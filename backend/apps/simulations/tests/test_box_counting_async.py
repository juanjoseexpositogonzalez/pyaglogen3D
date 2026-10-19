"""Tests for the box-counting async boundary and job lifecycle (R3 — T3).

Covers spec requirements of `batch-windowed-box-counting`:
- R3.1: work set ≤ 30 → synchronous POST returning the per-sim summary
- R3.2: work set > 30 (geometry-less sims excluded) → 202 {task_id, total}
  + canonical status payload via Celery AsyncResult
- URL contract: name "project-studies-bc-job-status"
"""

from __future__ import annotations

import io
from typing import Any
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

    def test_status_endpoint_reports_unknown_task_as_failed(self, user, project):
        """JD-B-004: a bare PENDING (unknown / never-dispatched task id) maps
        to ``failed`` with a clear error instead of processing/total-0
        forever. Dispatch stamps PROGRESS meta immediately, so PENDING can
        only mean a task that was never dispatched (F2 reconciliation)."""
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "PENDING"
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "failed"
        assert "never-dispatched" in response.data["error"]
        # Canonical shape: all R3 fields present
        assert set(response.data) == {"status", "progress", "current", "total", "error"}
        assert response.data["progress"] == 0.0
        assert response.data["current"] == 0
        assert response.data["total"] == 0

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
        # F2: FAILURE carries the full canonical shape, not just error
        assert set(response.data) == {
            "status",
            "progress",
            "current",
            "total",
            "error",
        }
        assert response.data["status"] == "failed"
        assert "boom" in response.data["error"]

    def test_status_endpoint_maps_revoked_to_failed(self, user, project):
        """F2: a revoked task must terminate the poller — the verbatim
        'revoked' state must NOT leak outside the canonical union."""
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "REVOKED"
            mock_result.return_value.info = None
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "failed"
        assert "REVOKED" in response.data["error"]
        assert set(response.data) == {
            "status",
            "progress",
            "current",
            "total",
            "error",
        }

    def test_status_endpoint_maps_retry_to_failed(self, user, project):
        """F2: non-terminal Celery states never echo verbatim."""
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "RETRY"
            mock_result.return_value.info = None
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "failed"
        assert "RETRY" in response.data["error"]

    def test_status_success_surfaces_windowed_counters(self, user, project):
        """JD-B-009: the async run stores the windowed refusal/error counters
        in its return value (task meta); the status endpoint surfaces them."""
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "SUCCESS"
            mock_result.return_value.result = {
                "total": 31,
                "processed": 29,
                "skipped": 0,
                "failed": 2,
                "errors": [],
                "windowed": True,
                "windowed_insufficient_levels": 7,
                "windowed_errors": 1,
            }
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "done"
        assert response.data["windowed_insufficient_levels"] == 7
        assert response.data["windowed_errors"] == 1

    def test_status_success_without_windowed_keys_stays_canonical(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "SUCCESS"
            mock_result.return_value.result = {"total": 5, "processed": 5}
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data == {
            "status": "done",
            "progress": 1.0,
            "current": 5,
            "total": 5,
        }


# ── F1 — job-status endpoint is object-permission gated ───────────────


@pytest.mark.django_db
class TestJobStatusObjectPermission:
    """F1/BOLA: the status endpoint must run ``get_object()`` so
    ``IsProjectOwnerOrShared`` rejects cross-project task ids BEFORE any
    ``AsyncResult`` metadata is read or echoed."""

    def test_foreign_user_gets_denied(self, user, project):
        other = _make_user(1)
        study = _make_study(project)
        client = _authed_client(other)

        response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code in (403, 404)

    def test_get_object_is_on_the_path(self, user, project):
        study = _make_study(project)
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.ParametricStudyViewSet.get_object",
                autospec=True,
            ) as mock_get_object,
            patch("apps.simulations.views.AsyncResult") as mock_result,
        ):
            mock_result.return_value.state = "SUCCESS"
            mock_result.return_value.result = {"total": 0}
            client.get(_status_url(study, "task-abc-123"))

        mock_get_object.assert_called_once()

    def test_read_only_share_can_poll(self, user, project):
        """A read-only share keeps GET access (SAFE_METHODS) — the F1 fix
        must not break legitimate shared-read polling."""
        from apps.accounts.sharing import ProjectShare

        reader = _make_user(2)
        ProjectShare.objects.create(
            project=project,
            user=reader,
            permission=ProjectShare.Permission.VIEW,
        )
        study = _make_study(project)
        client = _authed_client(reader)

        with patch("apps.simulations.views.AsyncResult") as mock_result:
            mock_result.return_value.state = "PROGRESS"
            mock_result.return_value.info = {
                "current": 3,
                "total": 31,
                "progress": 3 / 31,
            }
            response = client.get(_status_url(study, "task-abc-123"))

        assert response.status_code == 200
        assert response.data["status"] == "processing"


# ── JD-B-006 — double-submit guard ────────────────────────────────────


def _fake_async_result_factory(
    states: dict[str, dict[str, Any]],
) -> type:
    """Build a patchable AsyncResult whose instances dispatch on task id."""

    class _FakeAsyncResult:
        def __init__(self, task_id: str) -> None:
            self._task_id = task_id
            spec = states.get(task_id, {"state": "PENDING", "info": None})
            self.state = spec["state"]
            self.info = spec.get("info")

    return _FakeAsyncResult


@pytest.mark.django_db
class TestDoubleSubmitGuard:
    def test_second_post_while_in_flight_returns_409(self, user, project):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        fake_cls = _fake_async_result_factory(
            {
                f"bc-inflight-{study.id}": {
                    "state": "PROGRESS",
                    "info": {"task_id": "task-real-1", "study_id": str(study.id)},
                },
                "task-real-1": {"state": "PROGRESS", "info": None},
            }
        )

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
        ):
            mock_delay.return_value = MagicMock(id="task-new-2")
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 409
        assert response.data["task_id"] == "task-real-1"
        mock_delay.assert_not_called()

    def test_stale_marker_with_terminal_task_allows_new_run(self, user, project):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        fake_cls = _fake_async_result_factory(
            {
                f"bc-inflight-{study.id}": {
                    "state": "PROGRESS",
                    "info": {"task_id": "task-old", "study_id": str(study.id)},
                },
                "task-old": {"state": "SUCCESS", "info": None},
            }
        )

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            mock_delay.return_value = MagicMock(id="task-new-2")
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        mock_delay.assert_called_once()

    def test_no_marker_allows_dispatch(self, user, project):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        fake_cls = _fake_async_result_factory({})

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            mock_delay.return_value = MagicMock(id="task-new-3")
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202

    def test_dispatch_stamps_total_and_inflight_marker(self, user, project):
        """F2: the 202-time total is stamped into the task meta right after
        dispatch; JD-B-006: the in-flight marker is stamped too."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        fake_cls = _fake_async_result_factory({})

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            task = MagicMock(id="task-stamp-1")
            mock_delay.return_value = task
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        stamped = task.backend.store_result.call_args_list
        # First stamp: the dispatch meta carrying the 202-time total (F2)
        # + the wall-clock dispatch time (fix round 2, JD-B-NEW-002).
        assert stamped[0].args[0] == "task-stamp-1"
        stamp_meta = stamped[0].args[1]
        assert stamp_meta["current"] == 0
        assert stamp_meta["total"] == 31
        assert stamp_meta["progress"] == 0.0
        assert isinstance(stamp_meta["dispatched_at"], float)
        assert stamped[0].kwargs["state"] == "PROGRESS"
        # Second stamp: the per-study in-flight marker (JD-B-006)
        assert stamped[1].args[0] == f"bc-inflight-{study.id}"
        assert stamped[1].args[1] == {
            "task_id": "task-stamp-1",
            "study_id": str(study.id),
        }
        assert stamped[1].kwargs["state"] == "PROGRESS"


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
