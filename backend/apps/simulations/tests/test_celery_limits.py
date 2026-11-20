"""Celery time limits are a declared safety net (issue #310, T4).

The engine has a deterministic operation budget, so no task should ever reach
these limits. They exist for what the budget cannot see: a pathological merge, a
starved host, or a task that never touches the engine at all. That is why the
assertions here are about the *relationship* between the two numbers and their
propagation to the Celery app, not just about two constants.
"""

from __future__ import annotations

from django.conf import settings

from config.celery import app


def test_hard_limit_is_the_agreed_value() -> None:
    """600 s, four times the worst run the operation budget allows (110-150 s)."""
    assert settings.CELERY_TASK_TIME_LIMIT == 600


def test_soft_limit_is_the_agreed_value() -> None:
    """540 s: it fires first, so the task can record why it stopped."""
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT == 540


def test_soft_limit_fires_before_the_hard_one() -> None:
    """Celery raises the soft limit as an exception; a soft limit above the hard
    one would never be seen, and the worker would kill the task instead."""
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT < settings.CELERY_TASK_TIME_LIMIT


def test_the_app_receives_both_limits() -> None:
    """`config_from_object(namespace="CELERY")` has to carry them to the app.

    This is the assertion that fails if the settings exist but the namespace or
    the key names drift - the failure mode where everything looks configured and
    nothing is enforced.
    """
    assert app.conf.task_time_limit == 600
    assert app.conf.task_soft_time_limit == 540
