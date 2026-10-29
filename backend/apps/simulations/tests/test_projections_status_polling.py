"""Tests for the async projection-export polling endpoint (R6).

The polling view maps Celery ``AsyncResult`` states onto the contract
shape. We mock ``AsyncResult`` so the tests don't depend on a running
worker — the contract is what we lock in here:

- PENDING   → ``{status: "processing", progress: 0.0, current: 0, total: 0}``
- PROGRESS  → ``{status: "processing", progress: 0..1, current, total}``
- SUCCESS   → ``{status: "done", download_url: <str>}``
- FAILURE   → ``{status: "failed", error: <str>}``

Authentication: the endpoint requires ``IsAuthenticated``; unauthenticated
callers get 401/403.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User


def _make_user() -> User:
    return User.objects.create_user(
        email=f"poll-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _status_url(job_id: str) -> str:
    return reverse("projections-status", kwargs={"job_id": job_id})


def _download_url(job_id: str) -> str:
    return reverse("projections-download", kwargs={"job_id": job_id})


class _FakeAsyncResult:
    """Minimal Celery AsyncResult stand-in used across the mock patches."""

    def __init__(self, state: str, info=None, result=None):
        self.state = state
        self.info = info
        self.result = result


@pytest.mark.django_db
class TestProjectionsStatusPolling:
    def test_unauthenticated_rejected(self) -> None:
        client = APIClient()
        response = client.get(_status_url("anything"))
        assert response.status_code in (401, 403)

    def test_pending_state_returns_processing_with_zero_progress(self) -> None:
        """Unknown / just-queued job IDs surface as ``PENDING`` from Celery."""
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(state="PENDING")
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True
        ):
            response = client.get(_status_url("nonexistent-job"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "processing"
        assert body["progress"] == 0.0
        assert body["current"] == 0
        assert body["total"] == 0

    def test_progress_state_surfaces_meta(self) -> None:
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(
            state="PROGRESS",
            info={"progress": 0.42, "current": 42, "total": 100},
        )
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True
        ):
            response = client.get(_status_url("running-job"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "processing"
        assert body["progress"] == pytest.approx(0.42)
        assert body["current"] == 42
        assert body["total"] == 100

    def test_success_state_returns_done_with_download_url(self) -> None:
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(
            state="SUCCESS",
            result={
                "download_url": "/api/v1/projections-status/done-job/download/",
                "zip_path": "/tmp/done-job.zip",
            },
        )
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True
        ):
            response = client.get(_status_url("done-job"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "done"
        assert body["download_url"] == "/api/v1/projections-status/done-job/download/"

    def test_failure_state_surfaces_error(self) -> None:
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(state="FAILURE", info=RuntimeError("boom"))
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True
        ):
            response = client.get(_status_url("failed-job"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "failed"
        assert "boom" in body["error"]


@pytest.mark.django_db
class TestProjectionsDownload:
    def test_unauthenticated_rejected(self) -> None:
        client = APIClient()
        response = client.get(_download_url("anything"))
        assert response.status_code in (401, 403)

    def test_download_when_not_complete_returns_404(self) -> None:
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(state="PENDING")
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True
        ):
            response = client.get(_download_url("not-done-yet"))
        assert response.status_code == 404

    def test_download_streams_zip_when_complete(self, tmp_path) -> None:
        user = _make_user()
        client = _authed_client(user)

        zip_path = tmp_path / "done.zip"
        zip_path.write_bytes(b"PK\x03\x04fake-zip-bytes")

        fake = _FakeAsyncResult(
            state="SUCCESS",
            result={
                "download_url": "/api/v1/projections-status/done/download/",
                "zip_path": str(zip_path),
            },
        )
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True
        ):
            response = client.get(_download_url("done"))

        assert response.status_code == 200
        assert response["Content-Type"] == "application/zip"
        assert response.content == b"PK\x03\x04fake-zip-bytes"
        assert "attachment" in response["Content-Disposition"]
