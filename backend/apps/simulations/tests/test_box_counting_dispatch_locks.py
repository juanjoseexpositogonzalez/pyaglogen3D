"""Real cross-process lock witnesses for the box-counting dispatch (JD-A-004).

Django documents ``select_for_update()`` as having no effect on SQLite, and
``test_box_counting_dispatch_worker.py``/``test_box_counting_async.py`` run on
SQLite with one connection per test, so none of their "duplicate delivery"
checks can fail from a lost row lock — no real lock is ever taken there.

These witnesses run genuine concurrent threads, each with its own real
PostgreSQL connection, proving: (1) two simultaneous producers cannot both
create a pending dispatch for one study; (2) a worker claim and a producer
cleanup cannot both win; (3) a duplicate delivery of one task id executes
exactly once; (4) a ``finished``/``cancelled`` tombstone blocks a late
duplicate. They skip themselves cleanly on SQLite; run against real
PostgreSQL via ``config.settings.test_postgres``.
"""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Ignore
from django.db import connection, connections
from django.utils import timezone

from apps.projects.models import Project
from apps.simulations import views as bc_views
from apps.simulations.models import ParametricStudy
from apps.simulations.tasks import BC_ASYNC_THRESHOLD, run_box_counting_async

from .test_box_counting_async import (
    _authed_client,
    _fake_async_result_factory,
    _make_sim,
    _make_study,
    _make_user,
    _run_url,
    _task_payload,
)

# A run made entirely of skips exits 0 and proves nothing, so any caller
# that exists to prove these locks — CI — sets this flag and gets a hard
# failure instead of a silent green when the database is not PostgreSQL.
if (
    os.environ.get("REQUIRE_PG_LOCK_WITNESSES") == "1"
    and connection.vendor != "postgresql"
):
    raise RuntimeError(
        "REQUIRE_PG_LOCK_WITNESSES=1 but DATABASES['default'] uses "
        f"{connection.vendor!r}; these witnesses need real PostgreSQL "
        "row locks. Check DJANGO_SETTINGS_MODULE and the TEST_PG_* values."
    )

pytestmark = [
    pytest.mark.pg_lock_witness,
    pytest.mark.skipif(
        connection.vendor != "postgresql",
        reason=(
            "select_for_update() has no effect on SQLite; run with "
            "DJANGO_SETTINGS_MODULE=config.settings.test_postgres against a "
            "real PostgreSQL database to exercise these witnesses."
        ),
    ),
]


@contextmanager
def _stall_claim_commit(seconds: float = 0.3) -> Iterator[None]:
    """Hold the row lock a little longer right as a locked claim/dispatch
    commits (both producer and worker saves pass ``box_counting_task_state``
    in ``update_fields`` while still holding the lock), so a genuinely
    concurrent competitor is forced to actually block on the row lock
    instead of winning by Python scheduling luck.
    """
    original_save = ParametricStudy.save

    def delayed_save(self: ParametricStudy, *args: Any, **kwargs: Any) -> Any:
        update_fields = kwargs.get("update_fields")
        if update_fields and "box_counting_task_state" in update_fields:
            time.sleep(seconds)
        return original_save(self, *args, **kwargs)

    with patch.object(ParametricStudy, "save", delayed_save):
        yield


def _run_concurrently(
    named_targets: list[tuple[str, Callable[[], Any]]],
) -> tuple[list[Any], list[BaseException | None]]:
    """Run each target on its own real thread with its own DB connection,
    synchronized to start together; each thread closes its own connection.
    """
    results: list[Any] = [None] * len(named_targets)
    errors: list[BaseException | None] = [None] * len(named_targets)
    barrier = threading.Barrier(len(named_targets))

    def _runner(index: int, fn: Callable[[], Any]) -> None:
        try:
            barrier.wait(timeout=10)
            results[index] = fn()
        except BaseException as exc:  # noqa: BLE001 — captured for assertions
            errors[index] = exc
        finally:
            connections.close_all()

    threads = [
        threading.Thread(target=_runner, args=(index, fn), name=name)
        for index, (name, fn) in enumerate(named_targets)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
        assert not thread.is_alive(), f"{thread.name} did not finish in time"
    return results, errors


def _setup_project_and_user(idx: int) -> tuple[Project, Any]:
    user = _make_user(idx)
    project = Project.objects.create(name="BC Lock Witness Project", owner=user)
    return project, user


def _call_tracker() -> tuple[list[str], Callable[..., dict[str, int]]]:
    """A ``run_box_counting_for_study`` stand-in recording which thread
    actually ran it, so a test can assert exactly who executed (if anyone)."""
    calls: list[str] = []
    lock = threading.Lock()

    def fake(*_args: Any, **_kwargs: Any) -> dict[str, int]:
        with lock:
            calls.append(threading.current_thread().name)
        return {"total": 0, "processed": 0}

    return calls, fake


def _invoke_worker(study_id: str, task_id: str, **run_patch_kwargs: Any) -> Any:
    """Call the real ``run_box_counting_async`` body for ``task_id``, with
    ``run_box_counting_for_study`` patched per ``run_patch_kwargs`` and the
    finally-block's ``AsyncResult`` lookup stubbed out."""
    task_runner = cast(Any, run_box_counting_async)
    task_runner.push_request(id=task_id)
    try:
        with (
            patch(
                "apps.simulations.tasks.run_box_counting_for_study",
                **run_patch_kwargs,
            ),
            patch("celery.app.task.Task.AsyncResult", return_value=MagicMock(info={})),
        ):
            return task_runner.run(study_id, 100, 18, False, False)
    finally:
        task_runner.pop_request()


@pytest.mark.django_db(transaction=True)
class TestConcurrentProducersCannotBothDispatch:
    def test_two_simultaneous_producers_create_exactly_one_pending_dispatch(
        self,
    ) -> None:
        project, user = _setup_project_and_user(1)
        study = _make_study(project)
        for _ in range(BC_ASYNC_THRESHOLD + 1):
            _make_sim(project, study, with_geometry=True)

        backend = MagicMock()

        def post_once() -> Any:
            client = _authed_client(user)
            return client.post(_run_url(study), {}, format="json")

        with (
            _stall_claim_commit(),
            patch("apps.simulations.views._bc_result_backend", return_value=backend),
            patch(
                "apps.simulations.views.AsyncResult",
                _fake_async_result_factory({}),
            ),
            patch(
                "apps.simulations.tasks.run_box_counting_async.apply_async"
            ) as mock_apply_async,
        ):
            (resp_a, resp_b), errors = _run_concurrently(
                [("bc-producer-a", post_once), ("bc-producer-b", post_once)]
            )

        assert errors == [None, None], errors
        statuses = sorted((resp_a.status_code, resp_b.status_code))
        assert statuses == [202, 409]
        mock_apply_async.assert_called_once()

        winner, loser = (
            (resp_a, resp_b) if resp_a.status_code == 202 else (resp_b, resp_a)
        )
        assert loser.data["task_id"] == winner.data["task_id"]

        study.refresh_from_db()
        assert study.box_counting_task_id == winner.data["task_id"]
        assert study.box_counting_task_state == "dispatched"


@pytest.mark.django_db(transaction=True)
class TestWorkerClaimVsProducerCleanup:
    def test_worker_claim_and_producer_cleanup_cannot_both_win(self) -> None:
        project, _user = _setup_project_and_user(2)
        study = _make_study(project)
        task_id = "task-cleanup-race"
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=task_id,
            box_counting_task_state="pending",
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=timezone.now(),
        )
        study.refresh_from_db()
        lease_started_at = study.box_counting_task_reserved_at

        def worker_claim() -> bool:
            _invoke_worker(
                str(study.id), task_id, return_value={"total": 0, "processed": 0}
            )
            return True

        def producer_release() -> bool:
            return bool(
                bc_views._release_bc_db_dispatch(
                    str(study.id), task_id, lease_started_at
                )
            )

        with _stall_claim_commit():
            results, errors = _run_concurrently(
                [
                    ("bc-worker-claim", worker_claim),
                    ("bc-release", producer_release),
                ]
            )

        assert errors[1] is None, errors[1]
        worker_claimed = errors[0] is None
        if worker_claimed:
            assert results[0] is True
        else:
            assert isinstance(errors[0], Ignore), errors[0]
        release_succeeded = bool(results[1])

        # The two outcomes are mutually exclusive: exactly one side wins.
        assert worker_claimed != release_succeeded

        study.refresh_from_db()
        assert study.box_counting_task_id == task_id
        assert study.box_counting_task_reserved_at is None
        if worker_claimed:
            assert study.box_counting_task_state == "finished"
        else:
            assert study.box_counting_task_state == "cancelled"


@pytest.mark.django_db(transaction=True)
class TestDuplicateDeliveryExecutesExactlyOnce:
    def test_duplicate_delivery_of_one_task_id_executes_exactly_once(self) -> None:
        project, _user = _setup_project_and_user(3)
        study = _make_study(project)
        task_id = "task-duplicate-delivery"
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=task_id,
            box_counting_task_state="pending",
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=timezone.now(),
        )
        run_calls, fake_run_for_study = _call_tracker()

        def deliver() -> bool:
            _invoke_worker(str(study.id), task_id, side_effect=fake_run_for_study)
            return True

        with _stall_claim_commit():
            results, errors = _run_concurrently(
                [("bc-delivery-1", deliver), ("bc-delivery-2", deliver)]
            )

        executed = [i for i, err in enumerate(errors) if err is None]
        ignored = [i for i, err in enumerate(errors) if isinstance(err, Ignore)]
        assert len(executed) == 1, errors
        assert len(ignored) == 1, errors
        assert results[executed[0]] is True
        assert run_calls == [("bc-delivery-1", "bc-delivery-2")[executed[0]]]

        study.refresh_from_db()
        assert study.box_counting_task_state == "finished"
        assert study.box_counting_task_id == task_id


@pytest.mark.django_db(transaction=True)
class TestTerminalTombstoneBlocksLateDuplicate:
    @pytest.mark.parametrize("terminal_state", ["finished", "cancelled"])
    def test_terminal_tombstone_blocks_concurrent_late_duplicates(
        self, terminal_state: str
    ) -> None:
        project, _user = _setup_project_and_user(4)
        study = _make_study(project)
        task_id = "task-late-duplicate"
        ParametricStudy.objects.filter(pk=study.pk).update(
            box_counting_task_id=task_id,
            box_counting_task_state=terminal_state,
            box_counting_task_payload=_task_payload(),
            box_counting_task_reserved_at=None,
        )
        run_calls, fake_run_for_study = _call_tracker()

        def late_duplicate() -> None:
            _invoke_worker(str(study.id), task_id, side_effect=fake_run_for_study)

        _results, errors = _run_concurrently(
            [("bc-late-1", late_duplicate), ("bc-late-2", late_duplicate)]
        )

        assert all(isinstance(err, Ignore) for err in errors), errors
        assert run_calls == []

        study.refresh_from_db()
        assert study.box_counting_task_state == terminal_state
        assert study.box_counting_task_id == task_id
