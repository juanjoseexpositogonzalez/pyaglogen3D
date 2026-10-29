"""Cross-cutting integration test for parametric-values-dpo-and-kf (frente 13, PYA-15 P6.1).

End-to-end validation of the distribution pipeline through the backend:

    API payload (top-level dpo_distribution / target_kf_distribution fields)
    → SimulationSerializer validates via DistributionField
    → create() merges into parameters JSONField
    → run_simulation_task reads from parameters, calls expand_distribution_kwargs
    → engine kwargs include mode/mean/std/min/max

The engine→binding tier is NOT invoked (mocked). Engine-side correctness is
covered by P1+P2 cargo tests (25 tests) and P3 binding tests (22 tests).

This test focuses on the serialize → store → expand → plumb tier, which is
where the feature actually surfaces to the user through the API.

NOTE: Distribution configs are sent as TOP-LEVEL serializer fields (not inside
parameters). The SimulationSerializer.create() merges them into the parameters
JSONField. This matches the frontend DistributionSelector payload shape.
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
from apps.simulations.models import Simulation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    return User.objects.create_user(
        email=f"integ-parametric-{uuid.uuid4()}@example.com", password="x"
    )


def _make_project(user: User) -> Project:
    return Project.objects.create(name="parametric-values-integ", owner=user)


def _authed_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _fake_engine_result(
    n: int = 50,
    dpo_used: float | None = None,
    target_kf_used: float | None = None,
) -> SimpleNamespace:
    """Minimal stand-in for aglogen_core.run_tunable_cc result."""
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
        rg_evolution=np.array([1.0, 2.0, 3.0], dtype=np.float64),
        anisotropy=1.2,
        asphericity=0.1,
        acylindricity=0.05,
        principal_moments=np.array([1.0, 1.1, 1.2]),
        principal_axes=np.eye(3),
        execution_time_ms=42,
        dpo_used=dpo_used,
        target_kf_used=target_kf_used,
    )


def _sim_endpoint(project_id: uuid.UUID) -> str:
    return f"/api/v1/projects/{project_id}/simulations/"


# ---------------------------------------------------------------------------
# Cross-cutting integration tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestParametricValuesPipeline:
    """Full backend pipeline: API POST → serializer → parameters → task plumbing.

    Distribution configs are sent as top-level serializer fields, validated
    by DistributionField, then merged into parameters JSONField by create().
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        self.user = _make_user()
        self.project = _make_project(self.user)
        self.client = _authed_client(self.user)

    # -- P6.1.1: Normal dpo distribution propagates through pipeline -------

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_normal_dpo_distribution_propagates_to_engine(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Form-shaped payload with Normal dpo distribution must propagate to
        engine as dpo_mode/dpo_mean/dpo_std kwargs."""
        mock_run.return_value = _fake_engine_result(dpo_used=12.1)

        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "dpo_distribution": {"mode": "normal", "mean": 12.5, "std": 1.5},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201, response.json()
        sim_id = response.json()["id"]

        # Verify distribution config merged into parameters JSONField
        sim = Simulation.objects.get(id=sim_id)
        stored_dist = sim.parameters.get("dpo_distribution")
        assert stored_dist is not None
        assert stored_dist["mode"] == "normal"
        assert stored_dist["mean"] == 12.5
        assert stored_dist["std"] == 1.5

        # Run the task synchronously (mocked engine)
        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        # Verify engine was called with distribution kwargs
        _, engine_kwargs = mock_run.call_args
        assert engine_kwargs["dpo_mode"] == "normal"
        assert engine_kwargs["dpo_mean"] == 12.5
        assert engine_kwargs["dpo_std"] == 1.5

    # -- P6.1.2: Uniform kf distribution propagates through pipeline -------

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_uniform_kf_distribution_propagates_to_engine(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Payload with Uniform target_kf distribution must propagate to
        engine as kf_mode/kf_min/kf_max kwargs."""
        mock_run.return_value = _fake_engine_result(target_kf_used=1.5)

        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "target_kf_distribution": {"mode": "uniform", "min": 1.0, "max": 2.0},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201, response.json()
        sim_id = response.json()["id"]

        # Verify kf distribution stored in parameters
        sim = Simulation.objects.get(id=sim_id)
        stored_dist = sim.parameters.get("target_kf_distribution")
        assert stored_dist is not None
        assert stored_dist["mode"] == "uniform"
        assert stored_dist["min"] == 1.0
        assert stored_dist["max"] == 2.0

        # Run the task synchronously (mocked engine)
        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        # Verify engine was called with kf distribution kwargs
        _, engine_kwargs = mock_run.call_args
        assert engine_kwargs["kf_mode"] == "uniform"
        assert engine_kwargs["kf_min"] == 1.0
        assert engine_kwargs["kf_max"] == 2.0

    # -- P6.1.3: Legacy scalar payload (backward compat) -------------------

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_legacy_scalar_payload_unchanged(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Backward compat: payload without distribution keys uses scalar fallback."""
        mock_run.return_value = _fake_engine_result()

        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201, response.json()
        sim_id = response.json()["id"]

        # Verify no distribution config stored
        sim = Simulation.objects.get(id=sim_id)
        assert sim.parameters.get("dpo_distribution") is None
        assert sim.parameters.get("target_kf_distribution") is None

        # Run the task
        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        # Verify engine was NOT called with distribution kwargs
        _, engine_kwargs = mock_run.call_args
        assert "dpo_mode" not in engine_kwargs
        assert "kf_mode" not in engine_kwargs
        # Legacy scalars still present
        assert engine_kwargs["target_kf"] == 1.3

    # -- P6.1.4: Invalid distribution mode rejected with 400 ---------------

    def test_invalid_distribution_mode_rejected(self) -> None:
        """Validation: invalid mode rejected with 400 by DistributionField."""
        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "dpo_distribution": {"mode": "invalid_mode"},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 400
        assert "dpo_distribution" in response.json()

    # -- P6.1.5: Normal std must be positive -------------------------------

    def test_normal_distribution_negative_std_rejected(self) -> None:
        """Validation: negative std rejected with 400."""
        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "dpo_distribution": {"mode": "normal", "mean": 12.5, "std": -1.0},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 400
        assert "dpo_distribution" in response.json()

    # -- P6.1.6: Uniform max > min enforced --------------------------------

    def test_uniform_distribution_max_less_than_min_rejected(self) -> None:
        """Validation: max <= min rejected with 400."""
        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "target_kf_distribution": {"mode": "uniform", "min": 2.0, "max": 1.0},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 400
        assert "target_kf_distribution" in response.json()

    # -- P6.1.7: Both distributions present simultaneously -----------------

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_both_distributions_propagated(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """Both dpo and kf distributions present → all 6 kwargs forwarded."""
        mock_run.return_value = _fake_engine_result(dpo_used=12.1, target_kf_used=1.5)

        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "dpo_distribution": {"mode": "normal", "mean": 12.5, "std": 1.5},
            "target_kf_distribution": {"mode": "uniform", "min": 1.0, "max": 2.0},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201
        sim_id = response.json()["id"]

        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        _, engine_kwargs = mock_run.call_args
        # dpo distribution
        assert engine_kwargs["dpo_mode"] == "normal"
        assert engine_kwargs["dpo_mean"] == 12.5
        assert engine_kwargs["dpo_std"] == 1.5
        # kf distribution
        assert engine_kwargs["kf_mode"] == "uniform"
        assert engine_kwargs["kf_min"] == 1.0
        assert engine_kwargs["kf_max"] == 2.0

    # -- P6.1.8: Fixed mode produces same behavior as legacy scalar --------

    @patch("apps.simulations.tasks.create_simulation_notification")
    @patch("apps.simulations.tasks.run_box_counting_if_configured", return_value=None)
    @patch("aglogen_core.run_tunable_cc")
    @patch("aglogen_core.version", return_value="test-0.1.0")
    def test_fixed_mode_produces_fixed_kwargs(
        self, mock_version, mock_run, mock_bc, mock_notif
    ) -> None:
        """mode=fixed → engine receives dpo_mode='fixed', dpo_value=X."""
        mock_run.return_value = _fake_engine_result(dpo_used=12.5)

        payload = {
            "algorithm": "tunable_cc",
            "parameters": {
                "n_particles": 50,
                "target_df": 1.8,
                "target_kf": 1.3,
            },
            "dpo_distribution": {"mode": "fixed", "value": 12.5},
        }

        response = self.client.post(
            _sim_endpoint(self.project.id), payload, format="json"
        )
        assert response.status_code == 201
        sim_id = response.json()["id"]

        from apps.simulations.tasks import run_simulation_task

        result = run_simulation_task(sim_id)
        assert result["status"] == "completed"

        _, engine_kwargs = mock_run.call_args
        assert engine_kwargs["dpo_mode"] == "fixed"
        assert engine_kwargs["dpo_value"] == 12.5
