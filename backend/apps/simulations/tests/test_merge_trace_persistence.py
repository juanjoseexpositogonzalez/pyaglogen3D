"""Tests for merge_trace persistence + drill-down (cc-tunable-merge-trace P3).

T3.1 — JSONField persists merge_trace transparently
T3.2 — Detail API drill-down returns merge_trace within metrics
T3.3 — Legacy metrics (no merge_trace) serialise without error
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
from rest_framework.test import APIClient

from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus
from apps.simulations.tasks import run_simulation_task


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name="Merge Trace Test Project")


SAMPLE_MERGE_TRACE = [
    {
        "step": 0,
        "n1": 1,
        "n2": 1,
        "merge_type": "tunable",
        "required_distance": 2.0,
        "actual_distance": 1.95,
        "rg_after": 1.2,
        "rg_target": 1.3,
        "retries": 0,
        "bounding_check_passed": True,
    },
    {
        "step": 1,
        "n1": 2,
        "n2": 1,
        "merge_type": "ballistic",
        "required_distance": 3.5,
        "actual_distance": 3.48,
        "rg_after": 1.8,
        "rg_target": 1.9,
        "retries": 3,
        "bounding_check_passed": False,
    },
]


# ---------------------------------------------------------------------------
# T3.1 — JSONField persistence
# ---------------------------------------------------------------------------


class TestMergeTracePersistence:
    """T3.1 — Verify metrics JSONField persists merge_trace transparently."""

    @pytest.mark.django_db
    def test_merge_trace_persists_in_jsonfield(self, project: Project) -> None:
        """merge_trace stored inside metrics survives save + refresh_from_db."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 5},
            seed=42,
            status=SimulationStatus.COMPLETED,
            metrics={
                "fractal_dimension": 1.78,
                "prefactor": 1.4,
                "merge_trace": SAMPLE_MERGE_TRACE,
            },
        )
        sim.refresh_from_db()
        assert "merge_trace" in sim.metrics
        assert len(sim.metrics["merge_trace"]) == 2
        assert sim.metrics["merge_trace"][0]["merge_type"] == "tunable"

    @pytest.mark.django_db
    def test_merge_trace_entry_fields_roundtrip(self, project: Project) -> None:
        """All 10 trace-entry fields survive the JSON round-trip."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 5},
            seed=42,
            status=SimulationStatus.COMPLETED,
            metrics={"merge_trace": SAMPLE_MERGE_TRACE},
        )
        sim.refresh_from_db()
        entry = sim.metrics["merge_trace"][0]
        assert entry["step"] == 0
        assert entry["n1"] == 1
        assert entry["n2"] == 1
        assert entry["required_distance"] == 2.0
        assert entry["actual_distance"] == 1.95
        assert entry["rg_after"] == 1.2
        assert entry["rg_target"] == 1.3
        assert entry["merge_type"] == "tunable"
        assert entry["retries"] == 0
        assert entry["bounding_check_passed"] is True


# ---------------------------------------------------------------------------
# T3.2 — Detail API includes merge_trace
# ---------------------------------------------------------------------------


class TestDrilldownReturnsMergeTrace:
    """T3.2 — SimulationDetailView returns merge_trace in response."""

    @pytest.mark.django_db
    def test_drilldown_returns_merge_trace(self, project: Project) -> None:
        """GET /api/v1/projects/{pk}/simulations/{pk}/ includes merge_trace."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 5},
            seed=42,
            status=SimulationStatus.COMPLETED,
            metrics={
                "fractal_dimension": 1.78,
                "prefactor": 1.4,
                "merge_trace": [SAMPLE_MERGE_TRACE[0]],
            },
        )

        client = APIClient()
        # SimulationViewSet uses IsAuthenticated — bypass via force_authenticate
        from django.contrib.auth import get_user_model

        User = get_user_model()
        user = User.objects.create_user(
            email="trace_tester@test.com", password="test1234"
        )
        project.owner = user
        project.save()
        client.force_authenticate(user)

        url = f"/api/v1/projects/{project.id}/simulations/{sim.id}/"
        response = client.get(url)

        assert response.status_code == 200, response.content
        data = response.json()
        assert "metrics" in data
        assert "merge_trace" in data["metrics"]
        assert len(data["metrics"]["merge_trace"]) == 1
        assert data["metrics"]["merge_trace"][0]["merge_type"] == "tunable"


# ---------------------------------------------------------------------------
# T3.3 — Legacy backward compat
# ---------------------------------------------------------------------------


class TestLegacyResultWithoutMergeTrace:
    """T3.3 — Legacy metrics without merge_trace serialise gracefully."""

    @pytest.mark.django_db
    def test_legacy_result_without_merge_trace_serialises(
        self, project: Project
    ) -> None:
        """GET detail on a simulation with NO merge_trace in metrics succeeds."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="dla",
            parameters={"n_particles": 100},
            seed=42,
            status=SimulationStatus.COMPLETED,
            metrics={
                "fractal_dimension": 1.78,
                "prefactor": 1.4,
                # NO merge_trace key — legacy data
            },
        )

        client = APIClient()
        from django.contrib.auth import get_user_model

        User = get_user_model()
        user = User.objects.create_user(
            email="legacy_tester@test.com", password="test1234"
        )
        project.owner = user
        project.save()
        client.force_authenticate(user)

        url = f"/api/v1/projects/{project.id}/simulations/{sim.id}/"
        response = client.get(url)

        assert response.status_code == 200, response.content
        data = response.json()
        assert "metrics" in data
        # merge_trace should be absent (not injected) — no error
        trace = data["metrics"].get("merge_trace", [])
        assert trace == [] or trace is None or "merge_trace" not in data["metrics"]

    @pytest.mark.django_db
    def test_legacy_null_metrics_serialises(self, project: Project) -> None:
        """GET detail on a simulation with metrics=None succeeds."""
        sim = Simulation.objects.create(
            project=project,
            algorithm="dla",
            parameters={"n_particles": 100},
            seed=42,
            status=SimulationStatus.QUEUED,
            metrics=None,
        )

        client = APIClient()
        from django.contrib.auth import get_user_model

        User = get_user_model()
        user = User.objects.create_user(
            email="null_metrics_tester@test.com", password="test1234"
        )
        project.owner = user
        project.save()
        client.force_authenticate(user)

        url = f"/api/v1/projects/{project.id}/simulations/{sim.id}/"
        response = client.get(url)

        assert response.status_code == 200, response.content
        data = response.json()
        assert data["metrics"] is None


# ---------------------------------------------------------------------------
# T3.1 supplement — task-level wiring (merge_trace flows from engine → metrics)
# ---------------------------------------------------------------------------


def _fake_engine_result_with_trace() -> SimpleNamespace:
    """Minimal stand-in for aglogen_core.run_tunable_cc with merge_trace."""
    coordinates = np.zeros((3, 3), dtype=np.float64)
    radii = np.ones(3, dtype=np.float64)
    trace = [
        {
            "step": 0,
            "n1": 1,
            "n2": 1,
            "merge_type": "tunable",
            "required_distance": 2.0,
            "actual_distance": 1.95,
            "rg_after": 1.2,
            "rg_target": 1.3,
            "retries": 0,
            "bounding_check_passed": True,
        },
        {
            "step": 1,
            "n1": 2,
            "n2": 1,
            "merge_type": "ballistic",
            "required_distance": 3.5,
            "actual_distance": 3.48,
            "rg_after": 1.8,
            "rg_target": 1.9,
            "retries": 3,
            "bounding_check_passed": False,
        },
    ]
    return SimpleNamespace(
        coordinates=coordinates,
        radii=radii,
        fractal_dimension=1.8,
        fractal_dimension_std=0.05,
        prefactor=1.3,
        radius_of_gyration=1.0,
        porosity=0.5,
        coordination_mean=2.0,
        coordination_std=0.0,
        rg_evolution=np.array([], dtype=np.float64),
        anisotropy=1.0,
        asphericity=0.0,
        acylindricity=0.0,
        principal_moments=np.array([1.0, 1.0, 1.0]),
        principal_axes=np.eye(3),
        execution_time_ms=1,
        merge_trace=trace,
    )


@pytest.fixture
def _silence_task_side_effects():
    """Stub post-run side-effects not relevant to merge_trace wiring."""
    with (
        patch("apps.simulations.tasks.create_simulation_notification"),
        patch(
            "apps.simulations.tasks.run_box_counting_if_configured",
            return_value=None,
        ),
    ):
        yield


class TestMergeTraceTaskWiring:
    """T3.1 supplement — run_simulation_task persists merge_trace in metrics."""

    @pytest.mark.django_db
    @pytest.mark.usefixtures("_silence_task_side_effects")
    @patch("aglogen_core.version", return_value="0.0.0-test")
    @patch("aglogen_core.run_tunable_cc")
    def test_task_persists_merge_trace_in_metrics(
        self, mock_run_cc, _mock_version, project: Project
    ) -> None:
        """run_simulation_task stores merge_trace inside simulation.metrics."""
        mock_run_cc.return_value = _fake_engine_result_with_trace()
        sim = Simulation.objects.create(
            project=project,
            algorithm="tunable_cc",
            parameters={"n_particles": 3},
            seed=42,
        )
        run_simulation_task(str(sim.id))
        sim.refresh_from_db()

        assert sim.status == SimulationStatus.COMPLETED
        assert "merge_trace" in sim.metrics, (
            "merge_trace must be persisted in metrics by run_simulation_task"
        )
        assert len(sim.metrics["merge_trace"]) == 2
        assert sim.metrics["merge_trace"][0]["merge_type"] == "tunable"
        assert sim.metrics["merge_trace"][1]["merge_type"] == "ballistic"
