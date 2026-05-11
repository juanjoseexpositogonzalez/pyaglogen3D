"""Tests for polling/download view patches (Phase 4, T4.1–T4.3).

T4.1: projections_status_view exposes current/total/current_sim_id from task meta
T4.2: projections_download_view uses download_filename from result dict
T4.3: Regression — existing single-sim export still works
"""

from __future__ import annotations

import os
import tempfile
import uuid
from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User


def _make_user() -> User:
    return User.objects.create_user(
        email=f"p4-{uuid.uuid4()}@example.com",
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
    def __init__(self, state: str, info=None, result=None):
        self.state = state
        self.info = info
        self.result = result


# ---------------------------------------------------------------------------
# T4.1 — projections_status_view exposes batch progress fields
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestStatusViewBatchProgress:
    def test_progress_includes_current_sim_id(self) -> None:
        """PROGRESS state with current_sim_id in meta → surfaced in response."""
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(
            state="PROGRESS",
            info={
                "progress": 0.4,
                "current": 2,
                "total": 5,
                "current_sim_id": "abc-123",
            },
        )
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True,
        ):
            response = client.get(_status_url("batch-job"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "processing"
        assert body["current"] == 2
        assert body["total"] == 5
        assert body["current_sim_id"] == "abc-123"

    def test_progress_without_current_sim_id_still_works(self) -> None:
        """Single-sim task (no current_sim_id in meta) → field absent or null."""
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(
            state="PROGRESS",
            info={"progress": 0.5, "current": 50, "total": 100},
        )
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True,
        ):
            response = client.get(_status_url("single-job"))

        assert response.status_code == 200
        body = response.json()
        assert body["current"] == 50
        assert body["total"] == 100
        # current_sim_id not present → either absent or null
        assert body.get("current_sim_id") is None


# ---------------------------------------------------------------------------
# T4.2 — projections_download_view uses download_filename
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDownloadViewCustomFilename:
    def test_uses_download_filename_from_result(self) -> None:
        """Result dict has download_filename → Content-Disposition uses it."""
        user = _make_user()
        client = _authed_client(user)

        # Create a temp ZIP file
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            f.write(b"PK\x03\x04fake-zip-content")
            zip_path = f.name

        try:
            fake = _FakeAsyncResult(
                state="SUCCESS",
                result={
                    "zip_path": zip_path,
                    "download_filename": "study_abc_projections_2026-05-11.zip",
                },
            )
            with patch(
                "apps.simulations.views.AsyncResult", return_value=fake, create=True,
            ):
                response = client.get(_download_url("batch-download"))

            assert response.status_code == 200
            cd = response["Content-Disposition"]
            assert "study_abc_projections_2026-05-11.zip" in cd
        finally:
            os.unlink(zip_path)

    def test_falls_back_to_default_filename(self) -> None:
        """Result without download_filename → default projections_{job_id}.zip."""
        user = _make_user()
        client = _authed_client(user)

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            f.write(b"PK\x03\x04fake-zip-content")
            zip_path = f.name

        try:
            fake = _FakeAsyncResult(
                state="SUCCESS",
                result={"zip_path": zip_path},
            )
            with patch(
                "apps.simulations.views.AsyncResult", return_value=fake, create=True,
            ):
                response = client.get(_download_url("legacy-job"))

            assert response.status_code == 200
            cd = response["Content-Disposition"]
            assert "projections_legacy-job.zip" in cd
        finally:
            os.unlink(zip_path)


# ---------------------------------------------------------------------------
# T4.3 — Regression: existing single-sim polling still works
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSingleSimRegression:
    def test_single_sim_success_state_returns_done(self) -> None:
        """Existing single-sim task SUCCESS result → status=done + download_url."""
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(
            state="SUCCESS",
            result={
                "download_url": "/api/v1/projections-status/abc/download/",
                "zip_path": "/tmp/abc.zip",
                "n_generated": 100,
                "mode": "grid",
            },
        )
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True,
        ):
            response = client.get(_status_url("abc"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "done"
        assert body["download_url"] == "/api/v1/projections-status/abc/download/"

    def test_pending_returns_processing(self) -> None:
        """PENDING (single-sim or batch) → processing with zeros."""
        user = _make_user()
        client = _authed_client(user)

        fake = _FakeAsyncResult(state="PENDING")
        with patch(
            "apps.simulations.views.AsyncResult", return_value=fake, create=True,
        ):
            response = client.get(_status_url("unknown"))

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "processing"
        assert body["progress"] == 0.0
