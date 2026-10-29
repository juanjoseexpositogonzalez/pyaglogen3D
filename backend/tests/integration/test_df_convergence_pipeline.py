"""Backend integration test for PYA-14 Phase 3 Df convergence (T5.3).

End-to-end validation that a tunable_cc simulation created via Django ORM,
run through ``run_simulation_task`` (with mocked engine returning a
realistic Df=1.7 result), produces ``metrics.fractal_dimension`` within
±10% of the target.

The engine is mocked — engine-side convergence is validated exhaustively in
Rust integration tests (``parametric_sweep_df_range_kf_1_3``).  This test
confirms the backend pipeline correctly propagates Df from engine → metrics.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from apps.accounts.models import User
from apps.projects.models import Project
from apps.simulations.models import Simulation, SimulationStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"integ-df-conv-{uuid.uuid4()}@example.com", password="x"
    )


def _make_project(user: User) -> Project:
    return Project.objects.create(name="df-convergence-integ", owner=user)


def _fake_engine_result_converged(
    n: int = 350,
    measured_df: float = 1.707,
) -> SimpleNamespace:
    """Simulate a tunable_cc engine result with realistic convergence.

    Returns a result where fractal_dimension is close to the target (1.7),
    mimicking the actual Phase 3 algorithm behaviour.  merge_trace includes
    a mix of tunable, adaptive, and no ballistic merges (typical Phase 3).
    """
    n_merges = n - 1
    trace = []
    for i in range(min(n_merges, 10)):  # truncate trace for test brevity
        if i % 7 == 0:
            mtype = "adaptive"
        else:
            mtype = "tunable"
        trace.append(
            {
                "step": i,
                "n1": i + 1,
                "n2": 1,
                "merge_type": mtype,
                "required_distance": 2.0 + i * 0.1,
                "actual_distance": 2.0 + i * 0.1 - 0.02,
                "rg_after": 1.0 + i * 0.2,
                "rg_target": 1.0 + i * 0.2 + 0.05,
                "retries": 0,
                "bounding_check_passed": True,
                "overshoot_pct": 1.0 if mtype == "adaptive" else None,
            }
        )

    return SimpleNamespace(
        coordinates=np.random.default_rng(42).standard_normal((n, 3)),
        radii=np.ones(n, dtype=np.float64),
        fractal_dimension=measured_df,
        fractal_dimension_std=0.05,
        prefactor=1.3,
        radius_of_gyration=12.5,
        porosity=0.7,
        coordination_mean=2.5,
        coordination_std=0.8,
        rg_evolution=np.linspace(1.0, 12.5, 50),
        anisotropy=1.15,
        asphericity=0.08,
        acylindricity=0.04,
        principal_moments=np.array([1.0, 1.1, 1.2]),
        principal_axes=np.eye(3),
        execution_time_ms=320,
        merge_trace=trace,
    )


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDfConvergencePipeline:
    """T5.3: Verify Df convergence propagates through backend pipeline.

    Creates a Simulation via Django ORM with target_df=1.7 + dimers,
    runs ``run_simulation_task`` (engine mocked), and asserts
    ``metrics.fractal_dimension`` is within ±10% of target.
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        self.user = _make_user()
        self.project = _make_project(self.user)

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch(
        "apps.simulations.tasks.run_box_counting_if_configured", return_value=None
    )
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_df_convergence_within_10_percent(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Simulation with target_df=1.7 + dimers → metrics.fractal_dimension ±10%."""
        target_df = 1.7
        measured_df = 1.707  # realistic Phase 3 result

        mock_run.return_value = _fake_engine_result_converged(
            n=350, measured_df=measured_df
        )

        # 1. Create simulation via ORM (mirrors API creation)
        sim = Simulation.objects.create(
            project=self.project,
            algorithm="tunable_cc",
            seed_type="dimers",
            parameters={
                "n_particles": 350,
                "target_df": target_df,
                "target_kf": 1.3,
            },
            seed=42,
        )

        # 2. Run task synchronously (mocked engine)
        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(str(sim.id))
        assert result["status"] == "completed", f"Task failed: {result}"

        # 3. Reload and verify metrics
        sim.refresh_from_db()
        assert sim.status == SimulationStatus.COMPLETED

        metrics = sim.metrics
        assert metrics is not None, "metrics should be populated after task"
        assert "fractal_dimension" in metrics

        df_measured = metrics["fractal_dimension"]
        df_error = abs(df_measured - target_df) / target_df

        assert df_error < 0.10, (
            f"Df convergence failed: target={target_df}, "
            f"measured={df_measured}, error={df_error:.1%} (must be <10%)"
        )

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch(
        "apps.simulations.tasks.run_box_counting_if_configured", return_value=None
    )
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_merge_trace_includes_adaptive_type(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Phase 3 merge_trace should include 'adaptive' merge_type entries."""
        mock_run.return_value = _fake_engine_result_converged(n=350)

        sim = Simulation.objects.create(
            project=self.project,
            algorithm="tunable_cc",
            seed_type="dimers",
            parameters={
                "n_particles": 350,
                "target_df": 1.7,
                "target_kf": 1.3,
            },
            seed=42,
        )

        from apps.simulations.tasks import run_simulation_task

        run_simulation_task(str(sim.id))

        sim.refresh_from_db()
        metrics = sim.metrics
        trace = metrics.get("merge_trace", [])
        assert len(trace) > 0, "merge_trace should not be empty"

        merge_types = {e["merge_type"] for e in trace}
        assert "adaptive" in merge_types, (
            f"Phase 3 should produce adaptive merges, got types: {merge_types}"
        )
        # Verify adaptive entries have overshoot_pct field
        adaptive_entries = [e for e in trace if e["merge_type"] == "adaptive"]
        for entry in adaptive_entries:
            assert "overshoot_pct" in entry, (
                "adaptive merge_trace entries must include overshoot_pct"
            )
