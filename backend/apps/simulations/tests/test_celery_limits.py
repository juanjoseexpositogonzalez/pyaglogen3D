"""Celery time limits preserve unrelated workloads while bounding tunable-CC."""

from __future__ import annotations

from typing import Any

from django.conf import settings

from config.celery import app


def test_global_hard_limit_preserves_the_existing_hour_ceiling() -> None:
    assert settings.CELERY_TASK_TIME_LIMIT == 3600


def test_global_soft_limit_does_not_preempt_the_projection_contract() -> None:
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT == 3300


def test_soft_limit_fires_before_the_hard_one() -> None:
    """Celery raises the soft limit as an exception; a soft limit above the hard
    one would never be seen, and the worker would kill the task instead."""
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT


def test_the_app_receives_both_global_limits() -> None:
    assert app.conf.task_time_limit == 3600
    assert app.conf.task_soft_time_limit == 3300


def test_tunable_cc_limits_remain_declared() -> None:
    assert settings.CELERY_TUNABLE_CC_TASK_TIME_LIMIT == 600
    assert settings.CELERY_TUNABLE_CC_TASK_SOFT_TIME_LIMIT == 540


def test_tunable_cc_dispatch_uses_the_shorter_limits(mocker: Any) -> None:
    from apps.simulations.tasks import dispatch_simulation_task

    task = mocker.Mock()
    task.apply_async.return_value = mocker.sentinel.async_result

    result = dispatch_simulation_task(task, "simulation-id", "tunable_cc")

    assert result is mocker.sentinel.async_result
    task.apply_async.assert_called_once_with(
        args=["simulation-id"],
        time_limit=600,
        soft_time_limit=540,
    )
    task.delay.assert_not_called()


def test_other_algorithms_keep_the_default_dispatch(mocker: Any) -> None:
    from apps.simulations.tasks import dispatch_simulation_task

    task = mocker.Mock()
    task.delay.return_value = mocker.sentinel.async_result

    result = dispatch_simulation_task(task, "simulation-id", "dla")

    assert result is mocker.sentinel.async_result
    task.delay.assert_called_once_with("simulation-id")
    task.apply_async.assert_not_called()
