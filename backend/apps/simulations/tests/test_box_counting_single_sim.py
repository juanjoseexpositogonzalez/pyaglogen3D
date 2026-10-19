"""Tests for the single-sim windowed box-counting endpoint (R8 — T7b).

Covers spec requirements of `batch-windowed-box-counting`:
- R8: GET .../box-counting/ accepts windowed=true ONLY; the flat dict gains
  box_counting_windowed with the R2 11-key schema
- R8.1: without the flag the response is byte-identical to pre-change
"""

from __future__ import annotations

import io
import uuid
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation

# ── Fixtures / helpers ─────────────────────────────────────────────────


def _geometry_bytes(n: int = 6, radius: float = 0.5) -> bytes:
    coords = np.array(
        [[1.0 * i, 0.1, 0.0, radius] for i in range(n)],
        dtype=np.float64,
    )
    buf = io.BytesIO()
    np.save(buf, coords)
    return buf.getvalue()


def _make_user() -> User:
    return User.objects.create_user(
        email=f"bc-single-{uuid.uuid4()}@example.com",
        password="irrelevant",
    )


def _make_sim(user: User, project: Project) -> Simulation:
    return Simulation.objects.create(
        project=project,
        name=f"sim-{uuid.uuid4()}",
        algorithm="dla",
        parameters={"n_particles": 100},
        seed=42,
        status="completed",
        geometry=_geometry_bytes(),
        metrics={},
    )


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _url(project: Project, sim: Simulation) -> str:
    return reverse(
        "project-simulations-box-counting",
        kwargs={"project_pk": project.id, "pk": sim.id},
    )


def _fake_result(effective_levels: int, dimension: float = 2.5) -> MagicMock:
    return MagicMock(
        dimension=dimension,
        r_squared=0.99,
        std_error=0.01,
        confidence_interval=(dimension - 0.1, dimension + 0.1),
        log_scales=np.array([1.0, 2.0, 3.0, 4.0, 5.0]),
        log_values=np.array([6.9, 5.2, 3.4, 1.7, 0.0]),
        residuals=np.array([0.0, 0.1, 0.0, -0.1, 0.0]),
        execution_time_ms=7,
        linear_region_start=0,
        effective_levels=effective_levels,
    )


_ELEVEN_KEYS = {
    "dimension",
    "r_squared",
    "std_error",
    "confidence_interval",
    "log_scales",
    "log_values",
    "execution_time_ms",
    "parameters",
    "status",
    "fit_window_used",
    "error_message",
}


@pytest.fixture
def user(db):
    return _make_user()


@pytest.fixture
def project(user):
    return Project.objects.create(name="BC Single Project", owner=user)


@pytest.fixture
def sim(user, project):
    return _make_sim(user, project)


# ── R8 — opt-in windowed analysis ──────────────────────────────────────


@pytest.mark.django_db
class TestR8SingleSimWindowed:
    def test_r8_1_response_unchanged_without_flag(self, user, project, sim):
        """Without the windowed param the response is byte-identical to
        pre-change: no box_counting_windowed key (R8.1)."""
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.return_value = _fake_result(5)
            response = client.get(_url(project, sim))

        assert response.status_code == 200
        assert "box_counting_windowed" not in response.data
        # Pre-change flat-dict keys intact
        assert set(response.data.keys()) == {
            "dimension",
            "r_squared",
            "std_error",
            "confidence_interval",
            "log_scales",
            "log_values",
            "residuals",
            "linear_region_start",
            "execution_time_ms",
            "parameters",
        }

    def test_windowed_false_keeps_legacy_response(self, user, project, sim):
        """windowed=false does NOT engage the windowed estimator (R8)."""
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.return_value = _fake_result(5)
            response = client.get(_url(project, sim), {"windowed": "false"})

        assert response.status_code == 200
        assert "box_counting_windowed" not in response.data
        assert mock_bc.call_count == 1

    def test_windowed_true_adds_ok_block(self, user, project, sim):
        """windowed=true adds the R2 11-key block; eff=5 → window [1, 4]."""
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [
                _fake_result(5),
                _fake_result(5, dimension=2.7),
            ]
            response = client.get(_url(project, sim), {"windowed": "true"})

        assert response.status_code == 200
        assert mock_bc.call_count == 2
        block = response.data["box_counting_windowed"]
        assert set(block.keys()) == _ELEVEN_KEYS
        assert block["status"] == "ok"
        assert block["fit_window_used"] == [1, 4]
        assert block["dimension"] == 2.7
        assert block["error_message"] is None
        assert block["parameters"] == {"points_per_sphere": 100, "precision": 18}
        # Legacy flat dict intact
        assert response.data["dimension"] == 2.5

    def test_windowed_true_insufficient_levels(self, user, project, sim):
        """eff < 3 → insufficient_levels with nulls, estimator never called
        for the windowed leg (R2.2/R9)."""
        client = _authed_client(user)

        with patch("aglogen_core.box_counting_agglomerate") as mock_bc:
            mock_bc.side_effect = [_fake_result(2)]
            response = client.get(_url(project, sim), {"windowed": "true"})

        assert response.status_code == 200
        assert mock_bc.call_count == 1
        block = response.data["box_counting_windowed"]
        assert set(block.keys()) == _ELEVEN_KEYS
        assert block["status"] == "insufficient_levels"
        assert block["dimension"] is None
        assert block["fit_window_used"] is None
        assert block["error_message"] is None
