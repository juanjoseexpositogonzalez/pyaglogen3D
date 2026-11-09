"""Development settings for pyAgloGen3D."""
from typing import Any, cast

from .base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0"]

# CORS - Allow all in development
CORS_ALLOW_ALL_ORIGINS = True

# Add browsable API in development
# The star import above leaves mypy reading `REST_FRAMEWORK` as `object`; the cast
# names the shape this file knows it has.
_rest_framework = cast("dict[str, list[Any]]", REST_FRAMEWORK)  # noqa: F405
_rest_framework["DEFAULT_RENDERER_CLASSES"].append(
    "rest_framework.renderers.BrowsableAPIRenderer"
)
