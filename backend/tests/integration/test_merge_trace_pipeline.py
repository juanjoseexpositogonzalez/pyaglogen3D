"""Cross-cutting integration test for cc-tunable-merge-trace (frente 14, PYA-14 Phase 1).

End-to-end validation of the merge_trace pipeline through the backend:

    API POST (tunable_cc payload)
    → SimulationSerializer validates & creates Simulation
    → run_simulation_task invokes engine (mocked), extracts merge_trace
    → Simulation.metrics["merge_trace"] persisted in JSONField
    → GET detail API returns merge_trace with correct 10-field structure

The engine→binding tier is NOT invoked (mocked). Engine-side correctness is
covered by P1 cargo tests (6 tasks) and P2 binding tests (3 tasks).

This test focuses on the API → task → persistence → drill-down tier (R16.7 + R16.8).
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MERGE_TRACE_10_FIELDS = {
    "step",
    "n1",
    "n2",
    "merge_type",
    "required_distance",
    "actual_distance",
    "rg_after",
    "rg_target",
    "retries",
    "bounding_check_passed",
}


def _make_user() -> User:
    return User.objects.create_user(
        email=f"integ-merge-trace-{uuid.uuid4()}@example.com", password="x"
    )


def _make_project(user: User) -> Project:
    return Project.objects.create(name="merge-trace-integ", owner=user)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _sim_endpoint(project_id: uuid.UUID) -> str:
    return f"/api/v1/projects/{project_id}/simulations/"


def _detail_endpoint(project_id: uuid.UUID, sim_id: uuid.UUID) -> str:
    return f"/api/v1/projects/{project_id}/simulations/{sim_id}/"


def _fake_engine_result_with_trace(n: int = 5) -> SimpleNamespace:
    """Minimal stand-in for aglogen_core.run_tunable_cc with merge_trace.

    N monomers → N-1 merges.  Mix of tunable and ballistic merges.
    """
    n_merges = n - 1
    trace = []
    for i in range(n_merges):
        is_ballistic = i == n_merges - 1  # last merge falls back to ballistic
        trace.append(
            {
                "step": i,
                "n1": i + 1,
                "n2": 1,
                "merge_type": "ballistic" if is_ballistic else "tunable",
                "required_distance": 2.0 + i * 0.5,
                "actual_distance": 1.95 + i * 0.5,
                "rg_after": 1.0 + i * 0.3,
                "rg_target": 1.1 + i * 0.3,
                "retries": 5 if is_ballistic else 0,
                "bounding_check_passed": not is_ballistic,
            }
        )
    return SimpleNamespace(
        coordinates=np.zeros((n, 3), dtype=np.float64),
        radii=np.ones(n, dtype=np.float64),
        fractal_dimension=1.8,
        fractal_dimension_std=0.05,
        prefactor=1.3,
        radius_of_gyration=5.0,
        porosity=0.7,
        coordination_mean=2.5,
        coordination_std=0.8,
        rg_evolution=np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float64),
        anisotropy=1.2,
        asphericity=0.1,
        acylindricity=0.05,
        principal_moments=np.array([1.0, 1.1, 1.2]),
        principal_axes=np.eye(3),
        execution_time_ms=42,
        merge_trace=trace,
    )


def _fake_engine_result_no_trace(n: int = 10) -> SimpleNamespace:
    """Minimal stand-in for a non-CC algorithm result (no merge_trace attr)."""
    return SimpleNamespace(
        coordinates=np.zeros((n, 3), dtype=np.float64),
        radii=np.ones(n, dtype=np.float64),
        fractal_dimension=1.78,
        fractal_dimension_std=0.04,
        prefactor=1.4,
        radius_of_gyration=4.0,
        porosity=0.65,
        coordination_mean=2.2,
        coordination_std=0.7,
        rg_evolution=np.array([1.0, 2.0, 3.0], dtype=np.float64),
        anisotropy=1.1,
        asphericity=0.08,
        acylindricity=0.04,
        principal_moments=np.array([1.0, 1.05, 1.1]),
        principal_axes=np.eye(3),
        execution_time_ms=30,
        merge_trace=[],
    )


# ---------------------------------------------------------------------------
# Cross-cutting integration tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMergeTracePipeline:
    """Full backend pipeline: API POST → task (mocked engine) → GET detail.

    Validates R16.7 (trace propagates engine → API) and R16.8 (backward compat).
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        self.user = _make_user()
        self.project = _make_project(self.user)
        self.client = _authed_client(self.user)

    # -- T4.1a: CC tunable trace propagates engine → tasks.py → metrics → API

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_merge_trace_propagates_engine_to_api(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Cross-cutting: verify merge_trace flows engine → tasks.py → metrics → API."""
        n_particles = 5
        mock_run.return_value = _fake_engine_result_with_trace(n=n_particles)

        # 1. Create simulation via API
        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": n_particles,
                "target_df": 2.0,
                "target_kf": 1.3,
            },
        }
        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201, response.json()
        sim_id = response.json()["id"]

        # 2. Run task synchronously (mocked engine)
        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        # 3. Fetch via detail API
        detail = self.client.get(_detail_endpoint(self.project.id, sim_id))
        assert detail.status_code == 200, detail.content

        data = detail.json()
        assert "metrics" in data
        metrics = data["metrics"]
        assert "merge_trace" in metrics

        trace = metrics["merge_trace"]
        assert len(trace) == n_particles - 1, (
            f"N={n_particles} monomers → {n_particles - 1} merges, got {len(trace)}"
        )

        # 4. Assert each entry has the 10 fields
        for i, entry in enumerate(trace):
            missing = MERGE_TRACE_10_FIELDS - set(entry.keys())
            assert not missing, f"Entry {i} missing fields: {missing}"

            assert isinstance(entry["step"], int)
            assert isinstance(entry["n1"], int)
            assert isinstance(entry["n2"], int)
            assert entry["merge_type"] in ("tunable", "ballistic")
            assert isinstance(entry["required_distance"], (int, float))
            assert isinstance(entry["actual_distance"], (int, float))
            assert isinstance(entry["rg_after"], (int, float))
            assert isinstance(entry["rg_target"], (int, float))
            assert isinstance(entry["retries"], int)
            assert isinstance(entry["bounding_check_passed"], bool)

        # 5. Verify tunable vs ballistic discrimination
        tunable_entries = [e for e in trace if e["merge_type"] == "tunable"]
        ballistic_entries = [e for e in trace if e["merge_type"] == "ballistic"]
        assert len(tunable_entries) == 3  # first 3 merges are tunable
        assert len(ballistic_entries) == 1  # last merge is ballistic

    # -- T4.1b: Non-CC simulation has empty merge_trace

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_ballistic")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_non_cc_simulation_has_empty_merge_trace(
        self, mock_version, mock_run_ballistic, mock_bc, mock_notif
    ) -> None:
        """Non-CC algorithm (e.g. ballistic) produces empty merge_trace."""
        mock_run_ballistic.return_value = _fake_engine_result_no_trace(n=10)

        payload = {
            "algorithm": "ballistic",
            "parameters": {
                "n_particles": 10,
                "sticking_probability": 1.0,
            },
        }
        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201, response.json()
        sim_id = response.json()["id"]

        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        detail = self.client.get(_detail_endpoint(self.project.id, sim_id))
        assert detail.status_code == 200

        metrics = detail.json()["metrics"]
        assert metrics.get("merge_trace", []) == []

    # -- T4.1c: Trace field values are numerically correct (round-trip)

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_trace_field_values_round_trip(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Specific field values from engine result survive the full pipeline."""
        mock_run.return_value = _fake_engine_result_with_trace(n=5)

        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 5,
                "target_df": 2.0,
                "target_kf": 1.3,
            },
        }
        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201
        sim_id = response.json()["id"]

        from apps.simulations.tasks import run_simulation_task

        run_simulation_task(sim_id)

        detail = self.client.get(_detail_endpoint(self.project.id, sim_id))
        trace = detail.json()["metrics"]["merge_trace"]

        # First entry: tunable merge
        first = trace[0]
        assert first["step"] == 0
        assert first["n1"] == 1
        assert first["n2"] == 1
        assert first["merge_type"] == "tunable"
        assert first["required_distance"] == 2.0
        assert first["actual_distance"] == 1.95
        assert first["rg_after"] == 1.0
        assert first["rg_target"] == 1.1
        assert first["retries"] == 0
        assert first["bounding_check_passed"] is True

        # Last entry: ballistic fallback
        last = trace[-1]
        assert last["step"] == 3
        assert last["merge_type"] == "ballistic"
        assert last["retries"] == 5
        assert last["bounding_check_passed"] is False
