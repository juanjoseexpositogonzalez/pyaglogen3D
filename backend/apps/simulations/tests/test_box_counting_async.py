"""Tests for the box-counting async boundary and job lifecycle (R3 — T3).

Covers spec requirements of `batch-windowed-box-counting`:
- R3.1: work set ≤ 30 → synchronous POST returning the per-sim summary
- R3.2: work set > 30 (geometry-less sims excluded) → 202 {task_id, total}
  + canonical status payload via Celery AsyncResult
- URL contract: name "project-studies-bc-job-status"
"""

from __future__ import annotations

import io
import time
from datetime import timedelta
from typing import Any, cast
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from celery.exceptions import Ignore
from django.test import TestCase as DjangoTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import ParametricStudy, Simulation

#: T18 R5 — the supersede path defers its result-backend cleanup to
#: ``transaction.on_commit``, which a plain (non-transactional)
#: ``@pytest.mark.django_db`` test never actually fires. Wrap the call
#: whose cleanup a test needs to observe in this context manager, which
#: manually runs the queued callbacks without requiring a real commit.
_capture_on_commit = DjangoTestCase.captureOnCommitCallbacks

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


def _task_payload(
    points_per_sphere: int = 100,
    precision: int = 18,
    windowed: bool = False,
) -> dict[str, Any]:
    return {
        "points_per_sphere": points_per_sphere,
        "precision": precision,
        "windowed": windowed,
        "force": False,
    }


def _assert_no_db_dispatch(study: ParametricStudy) -> None:
    study.refresh_from_db()
    assert (
        study.box_counting_task_id,
        study.box_counting_task_state,
        study.box_counting_task_payload,
        study.box_counting_task_reserved_at,
    ) == ("", "", None, None)


@pytest.fixture(autouse=True)
def bc_result_backend(monkeypatch):  # type: ignore[no-untyped-def]
    """Keep async endpoint tests isolated from configured Celery services."""
    from apps.simulations.tasks import run_box_counting_async

    backend = MagicMock()
    task: Any = run_box_counting_async

    def apply_async(*, args, task_id, expires=None):  # type: ignore[no-untyped-def]
        return task.delay(*args)

    monkeypatch.setattr("apps.simulations.views._bc_result_backend", lambda: backend)
    monkeypatch.setattr(
        "apps.simulations.views.AsyncResult", _fake_async_result_factory({})
    )
    monkeypatch.setattr(task, "apply_async", apply_async)
    return backend


# ── R3.1 — synchronous boundary ────────────────────────────────────────


@pytest.mark.django_db
class TestR31SyncPath:
    def test_small_work_set_runs_synchronously(self, user, project):
        study = _make_study(project)
        simulations = [_make_sim(project, study) for _ in range(2)]
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
                fit_window=None,
                window_source="legacy",
            )
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        assert response.data["status"] == "completed"
        assert response.data["results"]["total"] == 2
        assert response.data["results"]["processed"] == 2
        assert "task_id" not in response.data
        for sim in simulations:
            sim.refresh_from_db()
            assert isinstance(sim.metrics, dict)
            box_counting = sim.metrics["box_counting"]
            assert isinstance(box_counting, dict)
            assert box_counting["fit_window"] is None
            assert box_counting["window_source"] == "legacy"

    def test_small_work_set_does_not_require_result_backend(
        self, user: User, project: Project
    ) -> None:
        study = _make_study(project)
        _make_sim(project, study)
        with (
            patch(
                "apps.simulations.views.AsyncResult",
                side_effect=RuntimeError("result backend unavailable"),
            ) as mock_result,
            patch(
                "apps.simulations.tasks.run_box_counting_for_study",
                return_value={"total": 1, "processed": 1, "skipped": 0, "failed": 0},
            ),
        ):
            response = _authed_client(user).post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        assert response.data["results"]["total"] == 1
        mock_result.assert_not_called()

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
                fit_window=None,
                window_source="legacy",
            )
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 200
        assert response.data["results"]["total"] == 30


# ── R3.2 — async boundary and job lifecycle ────────────────────────────


@pytest.mark.django_db
class TestR32AsyncPath:
    @pytest.fixture(autouse=True)
    def allow_legacy_status_fixtures(  # type: ignore[no-untyped-def]
        self, monkeypatch
    ):
        """These payload-shape tests predate task ownership records."""
        monkeypatch.setattr(
            "apps.simulations.views._bc_task_belongs_to_study", lambda *_: True
        )

    def test_large_work_set_returns_202_with_task_id(self, user, project):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        for _ in range(5):
            _make_sim(project, study, with_geometry=False)
        client = _authed_client(user)

        with (
            patch("apps.simulations.views.uuid.uuid4", return_value="task-abc-123"),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        assert response.data["task_id"] == "task-abc-123"
        # Geometry-less sims excluded from the total (R3.2)
        assert response.data["total"] == 31
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, False, False),
            task_id="task-abc-123",
            expires=3600,
        )

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

    def test_foreign_task_owner_is_denied_before_task_metadata_is_read(  # type: ignore[no-untyped-def]
        self, user, project
    ):
        requested_study = _make_study(project)
        owning_study = _make_study(project)
        client = _authed_client(user)
        task_id = "task-owned-by-another-study"
        seen: list[str] = []
        fake_cls = _fake_async_result_factory(
            {
                f"bc-owner-{task_id}": {
                    "state": "PROGRESS",
                    "info": {
                        "task_id": task_id,
                        "study_id": str(owning_study.id),
                    },
                },
                task_id: {
                    "state": "FAILURE",
                    "info": ValueError("private worker failure"),
                },
            },
            seen,
        )

        with patch("apps.simulations.views.AsyncResult", fake_cls):
            response = client.get(_status_url(requested_study, task_id))

        assert response.status_code == 404
        assert response.data == {"detail": "Not found."}
        assert seen == [f"bc-owner-{task_id}"]

    @pytest.mark.parametrize(
        ("task_state", "task_payload", "expected_status"),
        [
            ("SUCCESS", {"result": {"total": 4, "processed": 4}}, "done"),
            ("FAILURE", {"info": ValueError("boom")}, "failed"),
        ],
    )
    def test_matching_owner_preserves_terminal_payloads(  # type: ignore[no-untyped-def]
        self, user, project, task_state, task_payload, expected_status
    ):
        study = _make_study(project)
        task_id = "owned-task"
        states = {
            f"bc-owner-{task_id}": {
                "state": "PROGRESS",
                "info": {"task_id": task_id, "study_id": str(study.id)},
            },
            task_id: {"state": task_state, **task_payload},
        }
        with patch(
            "apps.simulations.views.AsyncResult",
            _fake_async_result_factory(states),
        ):
            response = _authed_client(user).get(_status_url(study, task_id))

        assert response.status_code == 200
        assert response.data["status"] == expected_status
        assert set(response.data) >= {"status", "progress", "current", "total"}

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

        with (
            patch(
                "apps.simulations.views._bc_task_belongs_to_study",
                return_value=True,
            ),
            patch("apps.simulations.views.AsyncResult") as mock_result,
        ):
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
    seen: list[str] | None = None,
) -> type:
    """Build a patchable AsyncResult whose instances dispatch on task id."""

    class _FakeAsyncResult:
        def __init__(self, task_id: str) -> None:
            self._task_id = task_id
            if seen is not None:
                seen.append(task_id)
            spec = states.get(task_id, {"state": "PENDING", "info": None})
            self.state = spec["state"]
            self.info = spec.get("info")
            self.result = spec.get("result")

    return _FakeAsyncResult


def _fake_result_backend(states: dict[str, dict[str, Any]]) -> MagicMock:
    """Return a result backend whose writes are visible to fake AsyncResult."""
    backend = MagicMock()

    def store_result(task_id: str, result: Any, state: str) -> None:
        states[task_id] = {
            "state": state,
            "info": result,
            "result": result,
        }

    backend.store_result.side_effect = store_result
    return backend


@pytest.mark.django_db
class TestDoubleSubmitGuard:
    def test_interleaved_posts_dispatch_once_and_reject_the_second(  # type: ignore[no-untyped-def]
        self, user, project
    ):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        first_client = _authed_client(user)
        second_client = _authed_client(user)
        states: dict[str, dict[str, Any]] = {}
        fake_cls = _fake_async_result_factory(states)
        backend = _fake_result_backend(states)
        dispatches: list[str] = []
        second_responses: list[Any] = []

        def dispatch(*args, **kwargs):  # type: ignore[no-untyped-def]
            dispatches.append(kwargs["task_id"])
            if len(dispatches) == 1:
                second_responses.append(
                    second_client.post(
                        _run_url(study), {"windowed": True}, format="json"
                    )
                )

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.views._bc_result_backend", return_value=backend),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async",
                side_effect=dispatch,
            ),
        ):
            first_response = first_client.post(
                _run_url(study),
                {"windowed": False},
                format="json",
            )

        assert first_response.status_code == 202
        assert [response.status_code for response in second_responses] == [409]
        assert len(dispatches) == 1
        assert second_responses[0].data["task_id"] == first_response.data["task_id"]
        study.refresh_from_db()
        assert isinstance(study.box_counting_params, dict)
        assert study.box_counting_params["windowed"] is False
        assert study.box_counting_task_id == first_response.data["task_id"]
        assert study.box_counting_task_state == "dispatched"
        assert study.box_counting_task_payload == _task_payload()
        assert study.box_counting_task_reserved_at is not None

    # T18 R8 removed `bc-inflight-<study_id>` from a new dispatch's
    # reservation entirely, so it writes exactly two records (the task's
    # own progress stub, then its owner record) instead of three. Write
    # index 3 (the old marker write) can never fail because it never
    # happens; index 1 (the task progress stub, previously untested) now
    # covers the reservation's own first write instead.
    @pytest.mark.parametrize("fail_on_write", [1, 2])
    @pytest.mark.parametrize("previous_task_id", ["", "task-finished"])
    def test_reservation_failure_never_dispatches_or_persists_params(  # type: ignore[no-untyped-def]
        self, user, project, fail_on_write, previous_task_id
    ):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        previous_payload = _task_payload(77, 12, True) if previous_task_id else None
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=previous_task_id,
            box_counting_task_state="finished" if previous_task_id else "",
            box_counting_task_payload=previous_payload,
        )
        client = _authed_client(user)
        backend = MagicMock()
        writes = 0

        def fail_selected_write(*args, **kwargs):  # type: ignore[no-untyped-def]
            nonlocal writes
            writes += 1
            if writes == fail_on_write:
                raise RuntimeError("result backend unavailable")

        backend.store_result.side_effect = fail_selected_write

        with (
            patch("apps.simulations.views._bc_result_backend", return_value=backend),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(
                _run_url(study),
                {"windowed": True},
                format="json",
            )

        assert response.status_code == 503
        mock_apply_async.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_params is None
        assert study.box_counting_task_id == previous_task_id
        assert study.box_counting_task_state == ("finished" if previous_task_id else "")
        assert study.box_counting_task_payload == previous_payload
        assert study.box_counting_task_reserved_at is None

    def test_marker_read_failure_never_dispatches_or_persists_params(  # type: ignore[no-untyped-def]
        self, user, project
    ):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                side_effect=RuntimeError("result backend unavailable"),
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 503
        mock_apply_async.assert_not_called()
        _assert_no_db_dispatch(study)
        assert study.box_counting_params is None

    # T18 R8: a new dispatch's reservation no longer writes
    # `bc-inflight-<study_id>` at all, so this witness now checks only the
    # two records a new dispatch actually stamps (the task's own progress
    # stub and its owner record), not the removed third marker write.
    @pytest.mark.parametrize("worker_claimed", [False, True])
    def test_broker_failure_clears_only_unpublished_reservation(  # type: ignore[no-untyped-def]
        self, user, project, worker_claimed
    ):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)
        client.raise_request_exception = False
        states: dict[str, dict[str, Any]] = {}
        backend = _fake_result_backend(states)
        task_id = "task-broker-failure"

        def publish_then_raise(*args, **kwargs):  # type: ignore[no-untyped-def]
            if worker_claimed:
                ParametricStudy.objects.filter(pk=study.pk).update(
                    box_counting_task_state="running"
                )
            raise RuntimeError("broker unavailable")

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                _fake_async_result_factory(states),
            ),
            patch("apps.simulations.views._bc_result_backend", return_value=backend),
            patch("apps.simulations.views.uuid.uuid4", return_value=task_id),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async",
                side_effect=publish_then_raise,
            ),
        ):
            response = client.post(
                _run_url(study),
                {"windowed": True},
                format="json",
            )

        assert response.status_code == 500
        result_ids = (task_id, f"bc-owner-{task_id}")
        if worker_claimed:
            assert all(
                states[result_id]["state"] == "PROGRESS" for result_id in result_ids
            )
            study.refresh_from_db()
            assert study.box_counting_task_id == task_id
            assert study.box_counting_task_state == "running"
            assert study.box_counting_task_payload == _task_payload(windowed=True)
        else:
            assert all(
                states[result_id]["state"] == "SUCCESS" for result_id in result_ids
            )
            study.refresh_from_db()
            assert study.box_counting_task_id == task_id
            assert study.box_counting_task_state == "cancelled"
            assert study.box_counting_task_payload == _task_payload(windowed=True)
            assert study.box_counting_task_reserved_at is None
        assert isinstance(study.box_counting_params, dict)
        assert study.box_counting_params["windowed"] is True

    def test_pending_dispatch_recovers_with_a_fresh_task_id(
        self, user: User, project: Project, bc_result_backend: MagicMock
    ) -> None:
        """JD-B-001 (product decision superseding T18 R3's same-id reuse):
        Celery enforces `expires` in the worker main process — a drained
        expired original puts its id into the worker's persistent revoked
        set, and every later delivery of that same id is silently dropped
        — so a same-id recovery republish can promise a run nobody
        executes while the study cycles 409 for the queue lease. Recovery
        therefore always retires the expired claim and dispatches under a
        FRESH task id; `recovered: true` now means the caller's parameters
        were recovered (the stored payload governs what runs) and a fresh
        run was dispatched, with the fresh task id disclosed in the 202."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        original_params = {
            "points_per_sphere": 77,
            "precision": 12,
            "windowed": True,
        }
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_params=original_params,
            box_counting_task_id="task-pending",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)

        # The retired claim's result-backend cleanup is deferred to
        # `transaction.on_commit` (T18 R5): the old id may be poisoned
        # worker-side, so its records must not block the fresh dispatch.
        with (
            _capture_on_commit(execute=True),
            patch(
                "apps.simulations.views.uuid.uuid4",
                return_value="task-fresh-recovery",
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        # T18 R3 disclosure preserved: `recovered` + every effective
        # recovered parameter, `force` included — an ordinary unforced
        # request must be able to see that a recovered run's `force`
        # differs from what it asked for, never silently re-analyze
        # under it.
        assert response.data == {
            "task_id": "task-fresh-recovery",
            "total": 31,
            "recovered": True,
            "points_per_sphere": 77,
            "precision": 12,
            "windowed": True,
            "force": False,
        }
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 77, 12, True, False),
            task_id="task-fresh-recovery",
            expires=3600,
        )
        # The retired id's records are released best-effort after commit
        # so they can never block the fresh dispatch (JD-B-001).
        cleared = {
            call.args[0]
            for call in bc_result_backend.store_result.call_args_list
            if call.kwargs.get("state") == "SUCCESS"
        }
        assert cleared == {"bc-owner-task-pending", "task-pending"}
        study.refresh_from_db()
        assert study.box_counting_params == original_params
        assert study.box_counting_task_id == "task-fresh-recovery"
        assert study.box_counting_task_state == "dispatched"
        assert study.box_counting_task_payload == payload
        assert study.box_counting_task_reserved_at is not None
        assert study.box_counting_task_reserved_at > expired_lease

    def test_pending_dispatch_with_conflicting_explicit_params_supersedes_expired_claim(
        self, user: User, project: Project, bc_result_backend: MagicMock
    ) -> None:
        """JD-B-001 (worker-side expiry poisoning: same-id republish can be dropped by the worker): Round 2 regression 2 (product decision): no caller ever retries
        without parameters — the frontend always sends full bodies — so the
        former 409 was a dead end that blocked the study forever. Explicit
        new parameters now supersede an expired pending claim: the stale
        row is retired to a `cancelled` tombstone, its result-backend
        records are released, and a fresh task is reserved and dispatched
        with the caller's own parameters (replaces the old
        ``test_pending_dispatch_with_conflicting_explicit_params_returns_409``
        row, whose 409 assertion encoded the regression itself)."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-pending",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)

        # The superseded claim's result-backend cleanup is deferred to
        # `transaction.on_commit` (T18 R5), which a plain non-transactional
        # test never fires on its own — `captureOnCommitCallbacks` runs the
        # queued callback so this test can observe it.
        with (
            _capture_on_commit(execute=True),
            patch("apps.simulations.views.uuid.uuid4", return_value="task-fresh"),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(
                _run_url(study),
                {"points_per_sphere": 100, "precision": 18, "windowed": False},
                format="json",
            )

        assert response.status_code == 202
        assert response.data == {"task_id": "task-fresh", "total": 31}
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, False, False),
            task_id="task-fresh",
            expires=3600,
        )
        # The superseded task's result-backend records are released (JD
        # round 2 regression 2 step 3) so its stale study marker cannot
        # block the fresh dispatch.
        cleared = {
            call.args[0]
            for call in bc_result_backend.store_result.call_args_list
            if call.kwargs.get("state") == "SUCCESS"
        }
        assert cleared == {"bc-owner-task-pending", "task-pending"}
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-fresh"
        assert study.box_counting_task_state == "dispatched"
        assert study.box_counting_task_payload == _task_payload(100, 18, False)
        assert study.box_counting_params == {
            "points_per_sphere": 100,
            "precision": 18,
            "windowed": False,
        }

    def test_explicit_force_conflict_supersedes_expired_claim(
        self, user: User, project: Project, bc_result_backend: MagicMock
    ) -> None:
        """`force` is never persisted, but it decides whether simulations
        that already hold a block are re-analyzed, so an explicit value
        that differs from the stored payload is a real conflict. The
        forced run offered by the analysis tab posts `windowed: true` with
        `force: true`; against a stored payload that matches on windowed
        but not on force, recovery would otherwise execute the user's
        forced run with `force=False` and silently analyze nothing."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-unforced",
            box_counting_task_state="pending",
            box_counting_task_payload=_task_payload(100, 18, True),
            box_counting_task_reserved_at=timezone.now() - timedelta(seconds=31),
        )
        client = _authed_client(user)

        with (
            patch("apps.simulations.views.uuid.uuid4", return_value="task-forced"),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(
                _run_url(study),
                {"windowed": True, "force": True},
                format="json",
            )

        assert response.status_code == 202
        assert response.data == {"task_id": "task-forced", "total": 31}
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, True, True),
            task_id="task-forced",
            expires=3600,
        )
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-forced"
        assert study.box_counting_task_payload == _task_payload(100, 18, True) | {
            "force": True
        }

    def test_matching_force_still_recovers_the_stored_payload(
        self, user: User, project: Project
    ) -> None:
        """An explicit `force` equal to the stored one is not a conflict:
        the claim is still recovered — under a fresh task id (JD-B-001) —
        executing the stored payload's parameters rather than being
        superseded by the caller's own."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-pending",
            box_counting_task_state="pending",
            box_counting_task_payload=_task_payload(100, 18, True),
            box_counting_task_reserved_at=timezone.now() - timedelta(seconds=31),
        )
        client = _authed_client(user)

        with (
            patch("apps.simulations.views.uuid.uuid4", return_value="task-fresh-force"),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(
                _run_url(study),
                {"windowed": True, "force": False},
                format="json",
            )

        assert response.status_code == 202
        assert response.data["task_id"] == "task-fresh-force"
        assert response.data["recovered"] is True
        # T18 R3: `force` is always disclosed, even when it matches what
        # the caller already asked for.
        assert response.data["force"] is False
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, True, False),
            task_id="task-fresh-force",
            expires=3600,
        )
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-fresh-force"
        assert study.box_counting_task_state == "dispatched"

    def test_recovery_discloses_a_stored_force_to_an_unforced_caller(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001 (fresh-id policy: a same-id republish can be dropped worker-side, so recovery always dispatches under a fresh id): T18 R3 (one of the six frozen situations this redesign exists to
        close): the stored claim already asked for `force=True`, and the
        recovering caller sends no `force` at all. Recovery still executes
        the stored `force=True` — but it must say so in the 202, because an
        ordinary unforced caller must be able to see that this run is about
        to re-analyze simulations that already hold a block, instead of a
        silent overwrite with no visible signal."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        stored_payload = _task_payload(100, 18, True) | {"force": True}
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-stored-force",
            box_counting_task_state="pending",
            box_counting_task_payload=stored_payload,
            box_counting_task_reserved_at=timezone.now() - timedelta(seconds=31),
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.uuid.uuid4",
                return_value="task-fresh-stored-force",
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        assert response.data == {
            "task_id": "task-fresh-stored-force",
            "total": 31,
            "recovered": True,
            "points_per_sphere": 100,
            "precision": 18,
            "windowed": True,
            "force": True,
        }
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, True, True),
            task_id="task-fresh-stored-force",
            expires=3600,
        )

    def test_concurrent_worker_claim_defeats_supersede_and_returns_409(
        self, user: User, project: Project
    ) -> None:
        """A worker that claims the stale task between its lease's expiry
        and our retiring update must win: the matching update affects zero
        rows, and the request answers the existing in-flight 409 instead of
        superseding a claim that is no longer ours to retire."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-stale",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views._release_bc_db_dispatch",
                return_value=False,
            ) as mock_release,
            patch(
                "apps.simulations.views._clear_bc_dispatch_reservation"
            ) as mock_clear,
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(
                _run_url(study),
                {"points_per_sphere": 100, "precision": 18, "windowed": False},
                format="json",
            )

        assert response.status_code == 409
        assert response.data == {
            "detail": "A box-counting run is already in flight for this study",
            "task_id": "task-stale",
        }
        assert mock_release.call_args.args[:2] == (str(study.id), "task-stale")
        mock_clear.assert_not_called()
        mock_apply_async.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-stale"
        assert study.box_counting_task_state == "pending"
        assert study.box_counting_task_payload == payload
        assert study.box_counting_params is None

    def test_concurrent_worker_claim_defeats_recovery_and_returns_409(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001: the concurrent-worker-claim 409 is preserved for the
        fresh-id recovery branch exactly as for supersede — a worker that
        claims the expired task between its lease's expiry and our
        retiring update must win, because the matching update affects zero
        rows and the request answers the existing in-flight 409 instead of
        retiring a claim that is no longer ours to retire."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-stale-recovery",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views._release_bc_db_dispatch",
                return_value=False,
            ) as mock_release,
            patch(
                "apps.simulations.views._clear_bc_dispatch_reservation"
            ) as mock_clear,
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 409
        assert response.data == {
            "detail": "A box-counting run is already in flight for this study",
            "task_id": "task-stale-recovery",
        }
        assert mock_release.call_args.args[:2] == (str(study.id), "task-stale-recovery")
        mock_clear.assert_not_called()
        mock_apply_async.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-stale-recovery"
        assert study.box_counting_task_state == "pending"
        assert study.box_counting_task_payload == payload

    @pytest.mark.parametrize(
        ("durable_state", "lease_seconds", "expected_status"),
        [
            ("pending", 10, 409),
            ("pending", 31, 202),
            ("dispatched", 10, 409),
            ("running", 10, 409),
            ("dispatched", None, 200),
            ("finished", 10, 200),
            ("cancelled", 10, 200),
            # L65: the worker's own burial tombstone is terminal exactly
            # like `cancelled` — a failed run never blocks the study.
            ("failed", 10, 200),
        ],
    )
    def test_durable_claim_governs_small_work_sets_without_a_redis_marker(
        self,
        user: User,
        project: Project,
        durable_state: str,
        lease_seconds: int | None,
        expected_status: int,
    ) -> None:
        """JD-B-001/JD-B-002: durable row governs over an absent Redis
        marker and over the sync/async size boundary. The `dispatched`
        None-lease case needs a duration guaranteed to exceed T18's own
        per-phase `dispatched` bound (`_BC_QUEUED_LEASE_SECONDS`), not the
        pre-T18 composite marker lease this case used to import."""
        from apps.simulations.views import _BC_QUEUED_LEASE_SECONDS

        study = _make_study(project)
        for _ in range(5):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True) if durable_state == "pending" else None
        age = _BC_QUEUED_LEASE_SECONDS + 10 if lease_seconds is None else lease_seconds
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-durable",
            box_counting_task_state=durable_state,
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=timezone.now() - timedelta(seconds=age),
        )
        client = _authed_client(user)

        with (
            patch("apps.simulations.views.AsyncResult", _fake_async_result_factory({})),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == expected_status
        if expected_status == 409:
            assert response.data["task_id"] == "task-durable"
            mock_apply_async.assert_not_called()
        elif durable_state == "pending":
            # JD-B-001: an expired pending claim is recovered under a
            # fresh task id, never the retired original's id.
            assert response.data["task_id"] != "task-durable"
            assert response.data["recovered"] is True
            mock_apply_async.assert_called_once()
        else:
            assert response.data["results"]["total"] == 5

    def test_three_phase_lease_bounds_are_pinned_to_the_t18_contract(
        self, user: User, project: Project
    ) -> None:
        """JD-A-001: every expiry witness derives its age from the same
        constant it exercises, so collapsing the dispatched and running
        bounds into the 30-second pending bound would leave the suite
        green while admission superseded a running claim whose worker was
        still executing. Pin the literal T18 R2 values instead: 30 seconds
        for `pending`, and 3,900 seconds (60-minute queue expiry or hard
        runtime + 5-minute grace) for both `dispatched` and `running`."""
        from apps.simulations.views import (
            _BC_PENDING_LEASE_SECONDS,
            _BC_QUEUED_LEASE_SECONDS,
            _BC_RUNNING_LEASE_SECONDS,
        )

        assert _BC_PENDING_LEASE_SECONDS == 30
        assert _BC_QUEUED_LEASE_SECONDS == 3900
        assert _BC_RUNNING_LEASE_SECONDS == 3900

    @pytest.mark.parametrize(
        ("marker_state", "expected_status"),
        [("PROGRESS", 409), ("PENDING", 200)],
    )
    def test_legacy_adopted_claim_without_a_lease_uses_the_marker_lease(
        self,
        user: User,
        project: Project,
        marker_state: str,
        expected_status: int,
    ) -> None:
        """JD-B-001: a claim adopted from a legacy queued message carries no
        publisher lease, so the bounded marker lease must guard it instead of
        leaving a running study open to a second concurrent dispatch."""
        study = _make_study(project)
        for _ in range(5):
            _make_sim(project, study, with_geometry=True)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-legacy",
            box_counting_task_state="running",
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=None,
        )
        marker_states = {
            f"bc-inflight-{study.id}": {
                "state": marker_state,
                "info": {
                    "task_id": "task-legacy",
                    "study_id": str(study.id),
                    "dispatched_at": time.time(),
                },
            },
            "task-legacy": {"state": "PROGRESS", "info": {}},
        }
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                _fake_async_result_factory(marker_states),
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == expected_status
        if expected_status == 409:
            assert response.data["task_id"] == "task-legacy"
            mock_apply_async.assert_not_called()
        else:
            assert response.data["results"]["total"] == 5

    def test_unreadable_marker_fails_closed_for_a_small_legacy_claim(
        self, user: User, project: Project
    ) -> None:
        """A small work set normally runs without the result backend, but a
        durable claim carrying no publisher lease can only be judged by the
        marker: when that read fails, the request fails closed instead of
        starting a second run over a study that may still be processing."""
        study = _make_study(project)
        for _ in range(5):
            _make_sim(project, study, with_geometry=True)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-legacy",
            box_counting_task_state="running",
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=None,
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                side_effect=RuntimeError("result backend unavailable"),
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
            patch("aglogen_core.box_counting_agglomerate") as mock_bc,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 503
        assert response.data["detail"] == "Unable to verify box-counting run state"
        mock_apply_async.assert_not_called()
        mock_bc.assert_not_called()

    def test_recovery_reservation_failure_restores_the_expired_claim(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001: a failed result-backend reservation for the fresh
        recovery id rolls the durable row back to the expired claim it
        retired, so the next request can retry recovery instead of the
        study sitting on a `cancelled` tombstone with its stored payload
        parameters gone. The retired old id's own record cleanup is
        best-effort (T18 R5) and may fail harmlessly, because no admission
        decision depends on it."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-recover",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)
        backend = MagicMock()
        backend.store_result.side_effect = RuntimeError("result backend unavailable")

        with (
            patch("apps.simulations.views._bc_result_backend", return_value=backend),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 503
        mock_apply_async.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-recover"
        assert study.box_counting_task_state == "pending"
        assert study.box_counting_task_payload == payload
        assert study.box_counting_task_reserved_at == expired_lease

    def test_recovery_broker_failure_does_not_wedge_the_next_request(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001 (fresh-id policy: a same-id republish can be dropped worker-side, so recovery always dispatches under a fresh id): T18 (one of the six frozen situations this redesign exists to
        close): a recovery republish's own `apply_async` fails — a broker
        failure previously had no witness at all. The revert restores the
        lease to its already-expired value instead of leaving the
        just-refreshed stamp in place, so the very next request is not
        wedged behind 409 for a full new lease with nothing actually
        running."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-recover-wedge",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)
        client.raise_request_exception = False

        with patch(
            "apps.simulations.tasks.run_box_counting_async.apply_async",
            side_effect=RuntimeError("broker unavailable"),
        ):
            first_response = client.post(_run_url(study), {}, format="json")

        assert first_response.status_code == 500
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-recover-wedge"
        assert study.box_counting_task_state == "pending"
        assert study.box_counting_task_payload == payload
        assert study.box_counting_task_reserved_at == expired_lease

        with patch(
            "apps.simulations.tasks.run_box_counting_async.apply_async"
        ) as mock_apply_async:
            second_response = client.post(_run_url(study), {}, format="json")

        assert second_response.status_code == 202
        assert second_response.data["recovered"] is True
        # JD-B-001: the retry dispatches under a fresh task id, never the
        # expired original's — which may be poisoned worker-side.
        assert second_response.data["task_id"] != "task-recover-wedge"
        mock_apply_async.assert_called_once()

    def test_publish_claimed_before_failure_keeps_the_live_run_pollable(
        self, user: User, project: Project, bc_result_backend: MagicMock
    ) -> None:
        """Audit finding 1 (ambiguous publish): `apply_async` raising does
        not prove the broker never accepted the message. When the worker
        already flipped the fresh recovery id to `running` before the
        publisher's handler runs, the rollback matches zero rows and the
        live run's task/owner records must NOT be terminalized — the run
        is pollable and its claim valid, even though the POST 500s."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-old-claim",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)
        client.raise_request_exception = False

        def publish_then_worker_claims(*args: Any, **kwargs: Any) -> Any:
            # The broker accepted the message and the worker claimed it
            # before the publisher saw a (connection-drop) exception.
            fresh_id = kwargs.get("task_id")
            assert fresh_id is not None
            ParametricStudy.objects.filter(pk=study.pk).update(
                box_counting_task_state="running",
            )
            raise RuntimeError("broker connection dropped after publish")

        with (
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async",
                side_effect=publish_then_worker_claims,
            ),
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 500
        study.refresh_from_db()
        # The worker's claim survives: task id and running state intact,
        # and its records were NOT terminalized.
        assert study.box_counting_task_id not in ("", "task-old-claim")
        assert study.box_counting_task_state == "running"
        cleared = {
            call.args[0]
            for call in bc_result_backend.store_result.call_args_list
            if call.kwargs.get("state") == "SUCCESS"
        }
        assert cleared == set()

    def test_late_delivery_of_a_retired_old_id_is_ignored(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001: recovery retires the expired claim and dispatches a
        fresh task id, so a late delivery of the retired old id — the
        broker may still hold a genuinely queued copy whose ack was lost,
        or a worker may drain it before its `expires` takes effect — is
        ignored by the worker's claim check instead of executing a second
        run over the same study. The old id may be poisoned worker-side;
        the fresh dispatch owns the study."""
        from apps.simulations.tasks import run_box_counting_async as _producer_task

        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-retired",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.uuid.uuid4",
                return_value="task-fresh-after-retire",
            ),
            patch("apps.simulations.tasks.run_box_counting_async.apply_async"),
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        assert response.data["recovered"] is True
        assert response.data["task_id"] == "task-fresh-after-retire"
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-fresh-after-retire"
        assert study.box_counting_task_state == "dispatched"

        # A late delivery of the RETIRED id never executes: the worker's
        # claim check sees the fresh id on the row and ignores it.
        task_runner = cast(Any, _producer_task)
        task_runner.push_request(id="task-retired")
        try:
            with (
                patch("apps.simulations.tasks.run_box_counting_for_study") as mock_run,
                patch(
                    "celery.app.task.Task.AsyncResult",
                    return_value=MagicMock(info={}),
                ),
                pytest.raises(Ignore),
            ):
                task_runner.run(str(study.id), 77, 12, True, False)
        finally:
            task_runner.pop_request()
        mock_run.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-fresh-after-retire"
        assert study.box_counting_task_state == "dispatched"

    def test_recovery_dispatches_a_claimable_fresh_id(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001: the worker must be able to claim the task a recovery
        dispatched — matching id and `pending`/`dispatched` state — which
        is what makes the fresh-id recovery a real run instead of a 202
        nobody executes (the frozen defect of the same-id policy: a
        drained expired original puts its id in the worker's persistent
        revoked set, so every later delivery of that same id is silently
        dropped by Celery's worker-side `expires` enforcement)."""
        from apps.simulations.tasks import run_box_counting_async as _producer_task

        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-original-claimable",
            box_counting_task_state="pending",
            box_counting_task_payload=_task_payload(100, 18, False),
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.uuid.uuid4",
                return_value="task-fresh-claimable",
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        assert response.data["recovered"] is True
        fresh_id = response.data["task_id"]
        assert fresh_id == "task-fresh-claimable"
        assert fresh_id != "task-original-claimable"
        mock_apply_async.assert_called_once()

        task_runner = cast(Any, _producer_task)
        task_runner.push_request(id=fresh_id)
        try:
            with (
                patch(
                    "apps.simulations.tasks.run_box_counting_for_study",
                    return_value={"total": 31, "processed": 31},
                ),
                patch(
                    "celery.app.task.Task.AsyncResult",
                    return_value=MagicMock(info={}),
                ),
            ):
                summary = task_runner.run(str(study.id), 100, 18, False, False)
        finally:
            task_runner.pop_request()

        assert summary == {"total": 31, "processed": 31}
        study.refresh_from_db()
        assert study.box_counting_task_id == fresh_id
        assert study.box_counting_task_state == "finished"

    def test_superseded_claim_rollback_never_leaves_terminal_backend_records(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001 (fresh-id policy under which this rollback path exists): T18 R5 (one of the six frozen situations this redesign exists to
        close, closed by construction via `transaction.on_commit`): if the
        transaction that retires an expired claim never actually commits,
        the deferred result-backend cleanup must never run, and the
        durable row must still show the original, uncancelled claim —
        never a terminal backend record sitting over a row that still
        looks live."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        expired_lease = timezone.now() - timedelta(seconds=31)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-rollback",
            box_counting_task_state="pending",
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=expired_lease,
        )
        client = _authed_client(user)
        client.raise_request_exception = False

        with (
            patch.object(
                ParametricStudy, "save", side_effect=RuntimeError("disk full")
            ),
            patch(
                "apps.simulations.views._clear_bc_dispatch_reservation"
            ) as mock_clear,
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(
                _run_url(study),
                {"points_per_sphere": 100, "precision": 18, "windowed": False},
                format="json",
            )

        assert response.status_code == 500
        mock_clear.assert_not_called()
        mock_apply_async.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-rollback"
        assert study.box_counting_task_state == "pending"
        assert study.box_counting_task_payload == payload
        assert study.box_counting_task_reserved_at == expired_lease

    @pytest.mark.parametrize(
        ("durable_state", "expect_recovered"),
        [("dispatched", True), ("running", False)],
    )
    def test_expired_claim_resolves_without_reading_an_unreadable_backend(
        self,
        user: User,
        project: Project,
        durable_state: str,
        expect_recovered: bool,
    ) -> None:
        """JD-B-001 (fresh-id policy: a same-id republish can be dropped worker-side, so recovery always dispatches under a fresh id): T18 R1 (one of the six frozen situations this redesign exists to
        close, closed by construction): once the durable row's own phase
        lease has already expired, admission never reads the result
        backend at all for this claim — an already-expired claim must
        never answer 503 because of a result-backend outage. `AsyncResult`
        is patched to raise so that the test fails loudly if admission
        ever touches it for either the recoverable (`dispatched`) or the
        always-superseded (`running`) expired branch."""
        from apps.simulations.views import (
            _BC_QUEUED_LEASE_SECONDS,
            _BC_RUNNING_LEASE_SECONDS,
        )

        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        payload = _task_payload(77, 12, True)
        lease = (
            _BC_QUEUED_LEASE_SECONDS
            if durable_state == "dispatched"
            else _BC_RUNNING_LEASE_SECONDS
        )
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-expired-unreadable",
            box_counting_task_state=durable_state,
            box_counting_task_payload=payload,
            box_counting_task_reserved_at=timezone.now()
            - timedelta(seconds=lease + 10),
        )
        client = _authed_client(user)

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                side_effect=RuntimeError("result backend unavailable"),
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        mock_apply_async.assert_called_once()
        if expect_recovered:
            assert response.data["recovered"] is True
            # JD-B-001: the recovered run is dispatched under a fresh task
            # id, never the expired original's — possibly poisoned — id.
            assert response.data["task_id"] != "task-expired-unreadable"
        else:
            assert "recovered" not in response.data
            assert response.data["task_id"] != "task-expired-unreadable"

    def test_second_post_while_in_flight_returns_409(self, user, project):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        import time as _time

        fake_cls = _fake_async_result_factory(
            {
                f"bc-inflight-{study.id}": {
                    "state": "PROGRESS",
                    "info": {
                        "task_id": "task-real-1",
                        "study_id": str(study.id),
                        # JD-A-002: only a marker carrying a fresh, readable
                        # dispatched_at can prove liveness and block (409);
                        # an undatable marker is released instead.
                        "dispatched_at": _time.time(),
                    },
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

    @pytest.mark.parametrize("task_state", ["PENDING", "PROGRESS"])
    def test_old_nonterminal_marker_still_blocks_within_end_to_end_lease(
        self, user: User, project: Project, task_state: str
    ) -> None:
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        fake_cls = _fake_async_result_factory(
            {
                f"bc-inflight-{study.id}": {
                    "state": "PROGRESS",
                    "info": {
                        "task_id": "task-queued",
                        "study_id": str(study.id),
                        "dispatched_at": 0.0,
                    },
                },
                "task-queued": {"state": task_state, "info": None},
            }
        )

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.views.time.time", return_value=3601.0),
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
        ):
            response = client.post(_run_url(study), {"windowed": True}, format="json")

        assert response.status_code == 409
        assert response.data["task_id"] == "task-queued"
        mock_delay.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_params is None

    def test_nonterminal_marker_past_end_to_end_lease_allows_new_run(
        self, user: User, project: Project
    ) -> None:
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        fake_cls = _fake_async_result_factory(
            {
                f"bc-inflight-{study.id}": {
                    "state": "PROGRESS",
                    "info": {
                        "task_id": "task-expired",
                        "study_id": str(study.id),
                        "dispatched_at": 0.0,
                    },
                },
                "task-expired": {"state": "PENDING", "info": None},
            }
        )

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch("apps.simulations.views.time.time", return_value=7501.0),
            patch("apps.simulations.tasks.run_box_counting_async.delay") as mock_delay,
            patch("aglogen_core.box_counting_agglomerate"),
        ):
            mock_delay.return_value = MagicMock(id="task-new-after-expiry")
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        mock_delay.assert_called_once()

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

    def test_dispatch_reserves_task_owner_records(
        self, user, project, bc_result_backend
    ):
        """JD-B-001 (worker-side expiry poisoning: same-id republish can be dropped by the worker): The complete reservation is durable before broker dispatch. T18
        R8 removed `bc-inflight-<study_id>` from a new dispatch's
        reservation entirely (replaces the former
        ``test_dispatch_reserves_task_owner_and_inflight_marker``, whose
        third stamped record asserted the removed marker write), so only
        the task's own progress stub and its owner record are stamped."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)
        with (
            patch(
                "apps.simulations.views.AsyncResult",
                _fake_async_result_factory({}),
            ),
            patch("apps.simulations.views.uuid.uuid4", return_value="task-stamp-1"),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        stamped = bc_result_backend.store_result.call_args_list
        assert [call.args[0] for call in stamped] == [
            "task-stamp-1",
            "bc-owner-task-stamp-1",
        ]
        task_meta = stamped[0].args[1]
        assert task_meta["current"] == 0
        assert task_meta["total"] == 31
        assert task_meta["progress"] == 0.0
        assert isinstance(task_meta["dispatched_at"], float)
        owner_meta = stamped[1].args[1]
        assert owner_meta == {
            "task_id": "task-stamp-1",
            "study_id": str(study.id),
        }
        assert all(call.kwargs["state"] == "PROGRESS" for call in stamped)
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, False, False),
            task_id="task-stamp-1",
            expires=3600,
        )


# ── Ledger 1b7fb42e — deploy-window and force-typing corrections ──────


@pytest.mark.django_db
class TestDeployWindowAndForceTyping:
    """Corrections for frozen release ledger 1b7fb42e: the deploy-window
    marker must go stale even without `dispatched_at` (JD-A-002), and a
    JSON-string `force` must be rejected, not coerced to True (JD-B-001)."""

    def test_legacy_marker_without_dispatched_at_goes_stale_at_the_bounded_lease(
        self, user: User, project: Project
    ) -> None:
        """JD-A-002: production stamps markers WITHOUT `dispatched_at`.
        An undatable marker cannot prove liveness, so the bridge releases
        it instead of blocking the study with 409 until
        CELERY_RESULT_EXPIRES (86,400 s); only a marker carrying a fresh,
        readable `dispatched_at` may block (its sibling witness in
        TestDoubleSubmitGuard pins that half)."""
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        marker_states = {
            f"bc-inflight-{study.id}": {
                "state": "PROGRESS",
                "info": {"task_id": "task-legacy", "study_id": str(study.id)},
            },
            "task-legacy": {"state": "PROGRESS", "info": {}},
        }
        fake_cls = _fake_async_result_factory(marker_states)
        client = _authed_client(user)

        with (
            patch("apps.simulations.views.AsyncResult", fake_cls),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = client.post(_run_url(study), {}, format="json")

        # El marker huérfano ya no bloquea: la admisión procede.
        assert response.status_code == 202
        mock_apply_async.assert_called_once()

    def test_force_as_json_string_is_rejected_not_coerced(
        self, user: User, project: Project
    ) -> None:
        """JD-B-001: bool("false") is truthy, so a JSON string
        `"force": "false"` would silently force a re-run (or flip a
        matching recovery into a supersede) instead of failing with 400
        the way the sibling key `windowed` does."""
        study = _make_study(project)
        for _ in range(5):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            response = client.post(
                _run_url(study), {"force": "false"}, format="json"
            )

        assert response.status_code == 400
        assert response.data["error"] == "force must be a boolean"
        mock_bc.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_params is None


# ── L65 — the worker's own burial releases the study ──────────────────


@pytest.mark.django_db
class TestFailedClaimNeverBlocks:
    def test_failed_run_buries_its_claim_and_the_next_post_is_admitted(  # type: ignore[no-untyped-def]
        self, user, project, bc_result_backend
    ):
        """L65 amendment to T18: a run that fails buries its own durable
        claim with the `failed` tombstone, and admission — which reads only
        the row — releases the study immediately instead of waiting out
        the 65-minute running lease. The next POST dispatches a fresh run,
        never a recovery of the failed task id, and never reads the result
        backend: `AsyncResult` is patched to raise so any cross-store read
        in admission would fail loudly."""
        from apps.simulations.tasks import run_box_counting_async

        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-failed-run",
            box_counting_task_state="dispatched",
            box_counting_task_payload=_task_payload(),
        )
        task_runner = cast(Any, run_box_counting_async)
        marker = MagicMock(
            info={"task_id": "task-failed-run", "study_id": str(study.id)}
        )
        with (
            patch(
                "apps.simulations.tasks.run_box_counting_for_study",
                side_effect=RuntimeError("worker failed"),
            ),
            patch("celery.app.task.Task.AsyncResult", return_value=marker),
            patch.object(task_runner.backend, "store_result"),
        ):
            result = task_runner.apply(
                args=(str(study.id), 100, 18, False, False),
                task_id="task-failed-run",
                throw=False,
            )

        assert result.state == "FAILURE"
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-failed-run"
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                side_effect=RuntimeError("result backend unavailable"),
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            response = _authed_client(user).post(_run_url(study), {}, format="json")

        assert response.status_code == 202
        assert "recovered" not in response.data
        assert response.data["task_id"] != "task-failed-run"
        mock_apply_async.assert_called_once()
        study.refresh_from_db()
        assert study.box_counting_task_id == response.data["task_id"]
        assert study.box_counting_task_state == "dispatched"


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
                fit_window=None,
                window_source="legacy",
            )
            task_runner = cast(Any, run_box_counting_async)
            summary = task_runner.run(
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

    @pytest.mark.parametrize(
        ("marker_task_id", "task_error", "expected_release"),
        [
            ("task-current", False, True),
            ("task-current", True, True),
            ("task-newer", False, False),
        ],
    )
    def test_task_releases_only_its_matching_study_lock(  # type: ignore[no-untyped-def]
        self,
        user,
        project,
        marker_task_id,
        task_error,
        expected_release,
    ):
        from apps.simulations.tasks import run_box_counting_async

        study = _make_study(project)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-current",
            box_counting_task_state="dispatched",
            box_counting_task_payload=_task_payload(),
        )
        marker = MagicMock(
            state="PROGRESS",
            info={"task_id": marker_task_id, "study_id": str(study.id)},
        )
        task_runner = cast(Any, run_box_counting_async)
        backend = task_runner.backend
        task_runner.push_request(id="task-current")
        try:
            outcome = RuntimeError("worker failed") if task_error else None
            with (
                patch(
                    "apps.simulations.tasks.run_box_counting_for_study",
                    side_effect=outcome,
                    return_value={"total": 0, "processed": 0},
                ),
                patch("celery.app.task.Task.AsyncResult", return_value=marker),
                patch.object(backend, "store_result") as mock_store_result,
            ):
                if task_error:
                    with pytest.raises(RuntimeError, match="worker failed"):
                        task_runner.run(str(study.id), 100, 18, False, False)
                else:
                    summary = task_runner.run(str(study.id), 100, 18, False, False)
                    assert summary == {"total": 0, "processed": 0}
        finally:
            task_runner.pop_request()

        if expected_release:
            mock_store_result.assert_called_once_with(
                f"bc-inflight-{study.id}",
                None,
                state="SUCCESS",
            )
        else:
            mock_store_result.assert_not_called()
