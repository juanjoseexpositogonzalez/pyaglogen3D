"""Django config package."""
# Import Celery app to ensure it's loaded when Django starts.
# This ensures @shared_task decorators bind to the correct app.
from .celery import app as celery_app

__all__ = ("celery_app",)
