"""Celery configuration for pyAgloGen3D."""
import os
from typing import Any

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("pyaglogen3d")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


# `app.task` is an untyped decorator: the ignore is on the decorator, not on the
# function, so the def keeps its real signature checked.
@app.task(bind=True, ignore_result=True)  # type: ignore[untyped-decorator]
def debug_task(self: Any) -> None:
    """Debug task for testing Celery."""
    print(f"Request: {self.request!r}")
