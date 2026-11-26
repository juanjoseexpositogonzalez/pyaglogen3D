"""Test settings for the real-PostgreSQL lock witnesses (JD-A-004).

``select_for_update()`` is a documented no-op on SQLite, so
``config.settings.test`` cannot exercise it as a real cross-process lock.
This reuses every other test setting unchanged and points
``DATABASES["default"]`` at a real PostgreSQL instance, env-configured with
defaults mirroring ``docker-compose.yml``'s ``db`` service. It exists only
to host ``test_box_counting_dispatch_locks.py``; everything else still runs
against SQLite via ``config.settings.test``.
"""

from decouple import config

from .test import *  # noqa: F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("TEST_PG_NAME", default="pyaglogen3d_test"),
        "USER": config("TEST_PG_USER", default="pyaglogen3d"),
        "PASSWORD": config("TEST_PG_PASSWORD", default="pyaglogen3d_dev"),
        "HOST": config("TEST_PG_HOST", default="localhost"),
        "PORT": config("TEST_PG_PORT", default="5432"),
    }
}
