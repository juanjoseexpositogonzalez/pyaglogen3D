"""Worker claim and duplicate-delivery tests for async box-counting dispatch."""

from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Ignore

from apps.projects.models import Project
from apps.simulations.models import ParametricStudy
from apps.simulations.tasks import run_box_counting_async

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
            ("task-newer", "dispatched", "task-stale", _task_payload(77, 12, True), None),
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

    @pytest.mark.parametrize("initial_state", ["pending", "dispatched"])
    @pytest.mark.parametrize(
        ("marker_task_id", "task_error", "expected_release"),
        [
            ("task-current", False, True),
            ("task-current", True, True),
            ("task-newer", False, False),
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
    ) -> None:
        study = _make_study(project)
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id="task-current",
            box_counting_task_state=initial_state,
            box_counting_task_payload=_task_payload(),
        )
        marker = MagicMock(info={"task_id": marker_task_id, "study_id": str(study.id)})
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
        study.refresh_from_db()
        assert study.box_counting_task_id == "task-current"
        assert study.box_counting_task_state == "finished"
        assert study.box_counting_task_payload == _task_payload()
        assert study.box_counting_task_reserved_at is None
