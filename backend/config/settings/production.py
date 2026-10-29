"""Production settings for pyAgloGen3D."""
from decouple import Csv, config

from .base import *  # noqa: F403

# Temporarily enable DEBUG to see OAuth errors
DEBUG = config("DEBUG", default=False, cast=bool)

# Logging for debugging OAuth issues
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
        "allauth": {
            "handlers": ["console"],
            "level": "DEBUG",
            "propagate": False,
        },
    },
}
ALLOWED_HOSTS = config("ALLOWED_HOSTS", cast=Csv())

# Security
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SECURE = True

# Trust proxy headers (Fly.io reverse proxy)
# This makes Django generate https:// URLs for OAuth callbacks
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# CSRF trusted origins (required for OAuth callbacks)
CSRF_TRUSTED_ORIGINS = config(
    "CSRF_TRUSTED_ORIGINS",
    cast=Csv(),
    default="https://pyaglogen3d-api.fly.dev,https://pyaglogen3d-frontend-7a41282f9465.herokuapp.com",
)

# CORS
CORS_ALLOWED_ORIGINS = config("CORS_ORIGINS", cast=Csv(), default="")
CORS_ALLOW_CREDENTIALS = True
