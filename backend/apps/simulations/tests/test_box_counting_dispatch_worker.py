"""Worker claim and duplicate-delivery tests for async box-counting dispatch."""

from datetime import timedelta
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Ignore, SoftTimeLimitExceeded
from celery.signals import task_revoked
from django.utils import timezone

from apps.projects.models import Project
from apps.simulations.models import ParametricStudy
from apps.simulations.tasks import (
    run_box_counting_async,
    run_simulation_task,
)

from .test_box_counting_async import _make_study, _make_user, _task_payload


@pytest.fixture
def user(db):  # type: ignore[no-untyped-def]
    return _make_user(1)


@pytest.fixture
def project(user):  # type: ignore[no-untyped-def]
    return Project.objects.create(name="BC Worker Project", owner=user)


@pytest.mark.django_db
class TestDurableAsyncTaskClaim:
    @pytest.mark.parametrize(
        (
            "claimed_task_id",
            "claimed_state",
            "delivery_task_id",
            "payload",
            "owner_state",
        ),
        [
            ("task-current", "running", "task-current", _task_payload(), None),
            ("task-current", "finished", "task-current", _task_payload(), None),
            ("task-current", "cancelled", "task-current", _task_payload(), None),
            # L65: the worker's own burial tombstone is terminal exactly
            # like `cancelled` — a late duplicate of a failed run must be
            # ignored, never executed.
            ("task-current", "failed", "task-current", _task_payload(), None),
            (
                "task-newer",
                "dispatched",
                "task-stale",
                _task_payload(77, 12, True),
                None,
            ),
            ("", "", "task-unpublished", None, "SUCCESS"),
        ],
    )
    def test_duplicate_or_stale_worker_message_is_ignored(
        self,
        user: Any,
        project: Project,
        claimed_task_id: str,
        claimed_state: str,
        delivery_task_id: str,
        payload: dict[str, Any] | None,
        owner_state: str | None,
    ) -> None:
        study = _make_study(project)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=claimed_task_id,
            box_counting_task_state=claimed_state,
            box_counting_task_payload=payload,
        )
        task_runner = cast(Any, run_box_counting_async)
        task_runner.push_request(id=delivery_task_id)
        try:
            with (
                patch("apps.simulations.tasks.run_box_counting_for_study") as mock_run,
                patch(
                    "celery.app.task.Task.AsyncResult",
                    return_value=MagicMock(state=owner_state, info={}),
                ),
                pytest.raises(Ignore),
            ):
                task_runner.run(str(study.id), 100, 18, False, False)
        finally:
            task_runner.pop_request()

        mock_run.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == claimed_task_id
        assert study.box_counting_task_state == claimed_state
        assert study.box_counting_task_payload == payload

    def test_matching_progress_owner_allows_legacy_claim(
        self, project: Project
    ) -> None:
        study = _make_study(project)
        owner = MagicMock(
            state="PROGRESS",
            info={"task_id": "task-legacy", "study_id": str(study.id)},
        )
        task_runner = cast(Any, run_box_counting_async)
        backend = task_runner.backend
        task_runner.push_request(id="task-legacy")
        try:
            with (
                patch(
                    "apps.simulations.tasks.run_box_counting_for_study",
                    return_value={"total": 0, "processed": 0},
                ) as mock_run,
                patch("celery.app.task.Task.AsyncResult", return_value=owner),
                patch.object(backend, "store_result") as mock_store_result,
            ):
                summary = task_runner.run(str(study.id), 100, 18, False, False)
        finally:
            task_runner.pop_request()

        assert summary == {"total": 0, "processed": 0}
        mock_run.assert_called_once()
        mock_store_result.assert_called_once_with(
            f"bc-inflight-{study.id}", None, state="SUCCESS"
        )
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-legacy"
        assert study.box_counting_task_state == "finished"
        assert study.box_counting_task_payload == _task_payload()
        assert study.box_counting_task_reserved_at is None

    def test_worker_claim_stamp_is_strictly_greater_than_the_publisher_stamp(
        self, user: Any, project: Project
    ) -> None:
        """JD-A-002 (mid-run capture): the claim block stamps
        `box_counting_task_reserved_at` at claim time, and the run's
        terminal `finished` tombstone clears it. Capture the stamp while
        the run is in flight — the mocked study runner reads it — and
        assert it is strictly greater than the stale publisher stamp it
        replaced."""
        study = _make_study(project)
        publisher_stamp = timezone.now() - timedelta(minutes=45)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-claim-stamp",
            box_counting_task_state="dispatched",
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=publisher_stamp,
        )
        observed: dict[str, Any] = {}

        def _capture_stamp(study_id: str, *args: Any, **kwargs: Any) -> dict[str, Any]:
            study.refresh_from_db()
            observed["state"] = study.box_counting_task_state
            observed["reserved_at"] = study.box_counting_task_reserved_at
            return {"total": 0, "processed": 0}

        task_runner = cast(Any, run_box_counting_async)
        task_runner.push_request(id="task-claim-stamp")
        try:
            with (
                patch(
                    "apps.simulations.tasks.run_box_counting_for_study",
                    side_effect=_capture_stamp,
                ),
                patch(
                    "celery.app.task.Task.AsyncResult",
                    return_value=MagicMock(info={}),
                ),
                patch.object(task_runner.backend, "store_result"),
            ):
                task_runner.run(str(study.id), 100, 18, False, False)
        finally:
            task_runner.pop_request()

        assert observed["state"] == "running"
        assert observed["reserved_at"] is not None
        assert observed["reserved_at"] > publisher_stamp

    @pytest.mark.parametrize("initial_state", ["pending", "dispatched"])
    @pytest.mark.parametrize(
        ("marker_task_id", "task_error", "expected_release", "expected_state"),
        [
            ("task-current", False, True, "finished"),
            # L65: a failure no longer terminalizes its own claim as
            # `finished` — Celery's failure handling buries it with the
            # distinct `failed` tombstone (see TestWorkerClaimBurial).
            ("task-current", True, True, "failed"),
            ("task-newer", False, False, "finished"),
        ],
    )
    def test_task_terminalizes_only_its_matching_claim(
        self,
        user: Any,
        project: Project,
        initial_state: str,
        marker_task_id: str,
        task_error: bool,
        expected_release: bool,
        expected_state: str,
    ) -> None:
        """Driven through ``apply(throw=False)`` so the run exercises the
        real Celery tracer: the failure path records FAILURE and invokes
        the task's failure handling — the layer that owns the L65 burial —
        exactly as a production worker does."""
        study = _make_study(project)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-current",
            box_counting_task_state=initial_state,
            box_counting_task_payload=_task_payload(),
        )
        marker = MagicMock(info={"task_id": marker_task_id, "study_id": str(study.id)})
        task_runner = cast(Any, run_box_counting_async)
        backend = task_runner.backend
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
            result = task_runner.apply(
                args=(str(study.id), 100, 18, False, False),
                task_id="task-current",
                throw=False,
            )
        if task_error:
            assert result.state == "FAILURE"
            with pytest.raises(RuntimeError, match="worker failed"):
                result.get()
        else:
            assert result.get() == {"total": 0, "processed": 0}

        if expected_release:
            mock_store_result.assert_called_once_with(
                f"bc-inflight-{study.id}",
                None,
                state="SUCCESS",
            )
        else:
            mock_store_result.assert_not_called()
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-current"
        assert study.box_counting_task_state == expected_state
        assert study.box_counting_task_payload == _task_payload()
        assert study.box_counting_task_reserved_at is None


@pytest.mark.django_db
class TestWorkerClaimBurial:
    """L65 amendment to T18: when Celery reports the task failed or was
    revoked, the worker buries its own durable claim with a `failed`
    tombstone, so the single admission authority — which reads only the
    row — releases the study immediately instead of waiting out the
    65-minute running lease. The lease remains the bound only for a
    worker death no handler witnesses (SIGKILL)."""

    def _dispatched_claim(self, study: ParametricStudy, task_id: str) -> None:
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=task_id,
            box_counting_task_state="dispatched",
            box_counting_task_payload=_task_payload(),
        )

    def _running_claim(self, study: ParametricStudy, task_id: str) -> None:
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=task_id,
            box_counting_task_state="running",
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=timezone.now(),
        )

    def _apply_failing_run(
        self, study: ParametricStudy, task_id: str, exc: Exception
    ) -> Any:
        task_runner = cast(Any, run_box_counting_async)
        marker = MagicMock(info={"task_id": task_id, "study_id": str(study.id)})
        with (
            patch(
                "apps.simulations.tasks.run_box_counting_for_study",
                side_effect=exc,
            ),
            patch("celery.app.task.Task.AsyncResult", return_value=marker),
            patch.object(task_runner.backend, "store_result"),
        ):
            # throw=False: a production worker never propagates the task
            # exception out of the tracer — it records FAILURE and invokes
            # the failure handling that must bury the claim.
            return task_runner.apply(
                args=(str(study.id), 100, 18, False, False),
                task_id=task_id,
                throw=False,
            )

    def test_failed_run_buries_its_claim(self, user: Any, project: Project) -> None:
        study = _make_study(project)
        self._dispatched_claim(study, "task-fail")

        result = self._apply_failing_run(study, "task-fail", RuntimeError("boom"))

        assert result.state == "FAILURE"
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-fail"
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

    def test_soft_time_limit_failure_buries_its_claim(
        self, user: Any, project: Project
    ) -> None:
        """Celery hard time limits raise `SoftTimeLimitExceeded` first; the
        soft limit surfaces as a normal exception, so Celery reports it
        through the failure handler — and the burial must cover it."""
        study = _make_study(project)
        self._dispatched_claim(study, "task-soft")

        result = self._apply_failing_run(study, "task-soft", SoftTimeLimitExceeded())

        assert result.state == "FAILURE"
        study.refresh_from_db()
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

    def test_revoked_run_buries_its_claim(self, user: Any, project: Project) -> None:
        """Revocation handling buries the claim the same way failure does:
        the `task_revoked` signal is what a terminate-revoke of a running
        task dispatches in the worker process."""
        study = _make_study(project)
        self._running_claim(study, "task-revoked")

        task_revoked.send(
            sender=run_box_counting_async,
            request={
                "id": "task-revoked",
                "args": (str(study.id), 100, 18, False, False),
            },
            terminated=True,
            signum=None,
            expired=False,
        )

        study.refresh_from_db()
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

    def test_revoked_queued_run_buries_its_dispatched_claim(
        self, user: Any, project: Project
    ) -> None:
        """JD-B-002: Celery dispatches the same `task_revoked` signal for a
        revoke of a task still QUEUED — and that revoke inserts the id into
        the worker's persistent revoked set, so every later delivery of
        that id is dropped worker-side. Without burying the `dispatched`
        claim too, the study answers 409 with nothing running for the
        rest of the ~65-minute queue lease. The revoke hook must therefore
        bury both `dispatched` and `running` claims (on_failure keeps
        burying only `running`: a FAILED run can only be running-side)."""
        study = _make_study(project)
        self._dispatched_claim(study, "task-revoke-queued")

        task_revoked.send(
            sender=run_box_counting_async,
            request={
                "id": "task-revoke-queued",
                "args": (str(study.id), 100, 18, False, False),
            },
            terminated=False,
            signum=None,
            expired=False,
        )

        study.refresh_from_db()
        assert study.box_counting_task_id == "task-revoke-queued"
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

    def test_revoked_expired_message_buries_its_dispatched_claim(
        self, user: Any, project: Project
    ) -> None:
        """JD-B-002: the `expired=True` flavor of `task_revoked` (a worker
        drains a message whose `expires` already lapsed) must bury the
        `dispatched` claim as well — the queued run it stood for will
        never execute."""
        study = _make_study(project)
        self._dispatched_claim(study, "task-revoke-expired")

        task_revoked.send(
            sender=run_box_counting_async,
            request={
                "id": "task-revoke-expired",
                "args": (str(study.id), 100, 18, False, False),
            },
            terminated=False,
            signum=None,
            expired=True,
        )

        study.refresh_from_db()
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

    def test_revocation_of_another_task_never_buries(
        self, user: Any, project: Project
    ) -> None:
        """The revocation hook is scoped to the box-counting task name, so
        a revoke of any other task in the module never touches a claim."""
        study = _make_study(project)
        self._running_claim(study, "task-mine")

        task_revoked.send(
            sender=run_simulation_task,
            request={
                "id": "task-other",
                "args": (str(study.id), 100, 18, False, False),
            },
            terminated=True,
            signum=None,
            expired=False,
        )

        study.refresh_from_db()
        assert study.box_counting_task_state == "running"
        assert study.box_counting_task_reserved_at is not None

    def test_failed_run_still_propagates_to_celery(
        self, user: Any, project: Project
    ) -> None:
        """The burial must not swallow the original exception: the failure
        is still recorded in the result and re-raised on retrieval."""
        study = _make_study(project)
        self._dispatched_claim(study, "task-propagate")

        result = self._apply_failing_run(
            study, "task-propagate", RuntimeError("worker failed")
        )

        assert result.state == "FAILURE"
        with pytest.raises(RuntimeError, match="worker failed"):
            result.get()

    def test_successful_run_still_ends_finished(
        self, user: Any, project: Project
    ) -> None:
        study = _make_study(project)
        self._dispatched_claim(study, "task-ok")
        task_runner = cast(Any, run_box_counting_async)
        marker = MagicMock(info={"task_id": "task-ok", "study_id": str(study.id)})

        with (
            patch(
                "apps.simulations.tasks.run_box_counting_for_study",
                return_value={"total": 0, "processed": 0},
            ),
            patch("celery.app.task.Task.AsyncResult", return_value=marker),
            patch.object(task_runner.backend, "store_result"),
        ):
            result = task_runner.apply(
                args=(str(study.id), 100, 18, False, False),
                task_id="task-ok",
                throw=False,
            )

        assert result.state == "SUCCESS"
        assert result.get() == {"total": 0, "processed": 0}
        study.refresh_from_db()
        assert study.box_counting_task_state == "finished"
        assert study.box_counting_task_reserved_at is None

    def test_burial_never_touches_a_claim_owned_by_a_newer_dispatch(
        self, user: Any, project: Project
    ) -> None:
        """The burial is matching-only — task id plus the `running` state
        only this worker's claim can hold — so a newer dispatch (its own
        task id, or a recovery republish that re-queued this same id below
        `running`) is never buried."""
        study = _make_study(project)
        args = (str(study.id), 100, 18, False, False)
        task_runner = cast(Any, run_box_counting_async)

        # Control: the worker's own running claim is buried by its failure.
        self._running_claim(study, "task-old")
        task_runner.on_failure(
            RuntimeError("worker failed"), "task-old", args, {}, None
        )
        study.refresh_from_db()
        assert study.box_counting_task_state == "failed"
        assert study.box_counting_task_reserved_at is None

        # A newer dispatch already replaced the claim with its own task id.
        self._running_claim(study, "task-new")
        task_runner.on_failure(
            RuntimeError("worker failed"), "task-old", args, {}, None
        )
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-new"
        assert study.box_counting_task_state == "running"

        # A recovery republish re-queued the SAME task id below `running`:
        # the stale failure must not bury the queued copy's claim either.
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-old",
            box_counting_task_state="dispatched",
            box_counting_task_reserved_at=timezone.now(),
        )
        task_runner.on_failure(
            RuntimeError("worker failed"), "task-old", args, {}, None
        )
        study.refresh_from_db()
        assert study.box_counting_task_state == "dispatched"

    def test_burial_outage_never_breaks_celery_failure_handling(
        self, user: Any, project: Project
    ) -> None:
        """The burial's own failure is logged and swallowed: Celery's
        failure handling still records the ORIGINAL exception, never the
        burial outage, and the claim falls back to the running lease."""
        study = _make_study(project)
        self._dispatched_claim(study, "task-bury-outage")

        with patch.object(
            ParametricStudy.objects,
            "filter",
            side_effect=RuntimeError("db outage"),
        ):
            result = self._apply_failing_run(
                study, "task-bury-outage", RuntimeError("worker failed")
            )

        assert result.state == "FAILURE"
        with pytest.raises(RuntimeError, match="worker failed"):
            result.get()
