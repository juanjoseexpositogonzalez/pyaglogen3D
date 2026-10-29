"""Core application views."""

from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_safe


@require_safe
def health_check(_: HttpRequest) -> JsonResponse:
    """Return a simple health response for container health checks."""
    return JsonResponse({"status": "ok"})
