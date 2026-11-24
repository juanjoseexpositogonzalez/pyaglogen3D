"""Tests for the box-counting async boundary and job lifecycle (R3 — T3).

Covers spec requirements of `batch-windowed-box-counting`:
- R3.1: work set ≤ 30 → synchronous POST returning the per-sim summary
- R3.2: work set > 30 (geometry-less sims excluded) → 202 {task_id, total}
  + canonical status payload via Celery AsyncResult
- URL contract: name "project-studies-bc-job-status"
"""

from __future__ import annotations

import io
from typing import Any, cast
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


@pytest.fixture(autouse=True)
def bc_result_backend(monkeypatch):  # type: ignore[no-untyped-def]
    """Keep async endpoint tests isolated from configured Celery services."""
    from apps.simulations.tasks import run_box_counting_async

    backend = MagicMock()
    task: Any = run_box_counting_async

    def apply_async(*, args, task_id, expires=None):  # type: ignore[no-untyped-def]
        return task.delay(*args)

    monkeypatch.setattr("apps.simulations.views._bc_result_backend", lambda: backend)
    monkeypatch.setattr("apps.simulations.views.AsyncResult", _fake_async_result_factory({}))
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

    def test_small_work_set_does_not_require_result_backend(self, user: User, project: Project) -> None:
        study = _make_study(project)
        _make_sim(project, study)
        with (
            patch("apps.simulations.views.AsyncResult", side_effect=RuntimeError("result backend unavailable")) as mock_result,
            patch("apps.simulations.tasks.run_box_counting_for_study", return_value={"total": 1, "processed": 1, "skipped": 0, "failed": 0}),
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

    @pytest.mark.parametrize("fail_on_write", [2, 3])
    def test_reservation_failure_never_dispatches_or_persists_params(  # type: ignore[no-untyped-def]
        self, user, project, fail_on_write
    ):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
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
        study.refresh_from_db()
        assert study.box_counting_params is None

    def test_broker_failure_clears_the_complete_reservation(  # type: ignore[no-untyped-def]
        self, user, project
    ):
        study = _make_study(project)
        for _ in range(31):
            _make_sim(project, study, with_geometry=True)
        client = _authed_client(user)
        client.raise_request_exception = False
        states: dict[str, dict[str, Any]] = {}
        backend = _fake_result_backend(states)
        task_id = "task-broker-failure"

        with (
            patch(
                "apps.simulations.views.AsyncResult",
                _fake_async_result_factory(states),
            ),
            patch("apps.simulations.views._bc_result_backend", return_value=backend),
            patch("apps.simulations.views.uuid.uuid4", return_value=task_id),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async",
                side_effect=RuntimeError("broker unavailable"),
            ),
        ):
            response = client.post(
                _run_url(study),
                {"windowed": True},
                format="json",
            )

        assert response.status_code == 500
        for result_id in (
            task_id,
            f"bc-owner-{task_id}",
            f"bc-inflight-{study.id}",
        ):
            assert states[result_id] == {
                "state": "SUCCESS",
                "info": None,
                "result": None,
            }
        study.refresh_from_db()
        assert isinstance(study.box_counting_params, dict)
        assert study.box_counting_params["windowed"] is True

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

    def test_dispatch_reserves_task_owner_and_inflight_marker(
        self, user, project, bc_result_backend
    ):
        """The complete reservation is durable before broker dispatch."""
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
            f"bc-inflight-{study.id}",
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
        marker_meta = stamped[2].args[1]
        assert marker_meta["task_id"] == "task-stamp-1"
        assert marker_meta["study_id"] == str(study.id)
        assert isinstance(marker_meta["dispatched_at"], float)
        assert all(call.kwargs["state"] == "PROGRESS" for call in stamped)
        mock_apply_async.assert_called_once_with(
            args=(str(study.id), 100, 18, False, False),
            task_id="task-stamp-1",
            expires=3600,
        )


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
        marker = MagicMock(
            info={"task_id": marker_task_id, "study_id": str(study.id)}
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
