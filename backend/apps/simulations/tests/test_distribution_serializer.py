"""P4.2 — SimulationSerializer accepts distribution config fields.

Tests that dpo_distribution and target_kf_distribution flow through
the serializer into the persisted parameters JSONField.

Covers spec R11/R12 backward compat: absent distributions → legacy fallback.
"""

from __future__ import annotations

import pytest

from apps.projects.models import Project
from apps.simulations.serializers import SimulationSerializer


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name="P4.2 Distribution Serializer Test")


def _save(project: Project, extra_data: dict | None = None) -> dict:
    """Create a simulation via serializer and return persisted params."""
    data = {
        "algorithm": "tunable_cc",
        "parameters": {
            "n_particles": 100,
            "target_df": 1.8,
            "target_kf": 1.3,
        },
        "seed": 42,
    }
    if extra_data:
        data.update(extra_data)
    serializer = SimulationSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    sim = serializer.save(project=project)
    return sim.parameters


# ── Happy paths: distribution configs stored in parameters ────────────


class TestDistributionSerializerAccepts:
    def test_fixed_dpo_distribution(self, project: Project) -> None:
        params = _save(
            project,
            {
                "dpo_distribution": {"mode": "fixed", "value": 12.5},
            },
        )
        assert params["dpo_distribution"] == {"mode": "fixed", "value": 12.5}

    def test_normal_target_kf_distribution(self, project: Project) -> None:
        params = _save(
            project,
            {
                "target_kf_distribution": {"mode": "normal", "mean": 1.3, "std": 0.1},
            },
        )
        assert params["target_kf_distribution"] == {
            "mode": "normal",
            "mean": 1.3,
            "std": 0.1,
        }

    def test_uniform_dpo_distribution(self, project: Project) -> None:
        params = _save(
            project,
            {
                "dpo_distribution": {"mode": "uniform", "min": 10.0, "max": 15.0},
            },
        )
        assert params["dpo_distribution"] == {
            "mode": "uniform",
            "min": 10.0,
            "max": 15.0,
        }

    def test_both_distributions(self, project: Project) -> None:
        params = _save(
            project,
            {
                "dpo_distribution": {"mode": "fixed", "value": 1.0},
                "target_kf_distribution": {"mode": "uniform", "min": 1.1, "max": 1.5},
            },
        )
        assert params["dpo_distribution"] == {"mode": "fixed", "value": 1.0}
        assert params["target_kf_distribution"] == {
            "mode": "uniform",
            "min": 1.1,
            "max": 1.5,
        }

    def test_null_distribution_accepted(self, project: Project) -> None:
        params = _save(
            project,
            {
                "dpo_distribution": None,
                "target_kf_distribution": None,
            },
        )
        # null distributions should not be stored (or stored as null)
        assert params.get("dpo_distribution") is None
        assert params.get("target_kf_distribution") is None


# ── Backward compat: no distribution fields → legacy scalar ───────────


class TestDistributionSerializerBackwardCompat:
    def test_no_distribution_fields_is_valid(self, project: Project) -> None:
        """Omitting distribution fields produces a valid simulation (legacy)."""
        params = _save(project)
        # Should not crash, legacy scalars (radius_min, target_kf) used at task time
        assert "dpo_distribution" not in params
        assert "target_kf_distribution" not in params


# ── Rejection: invalid distribution configs ───────────────────────────


class TestDistributionSerializerRejects:
    def test_invalid_mode_rejected(self, project: Project) -> None:
        serializer = SimulationSerializer(
            data={
                "algorithm": "tunable_cc",
                "parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "seed": 42,
                "dpo_distribution": {"mode": "gaussian"},
            }
        )
        assert not serializer.is_valid()
        assert "dpo_distribution" in serializer.errors

    def test_negative_fixed_value_rejected(self, project: Project) -> None:
        serializer = SimulationSerializer(
            data={
                "algorithm": "tunable_cc",
                "parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
                "seed": 42,
                "target_kf_distribution": {"mode": "fixed", "value": -1},
            }
        )
        assert not serializer.is_valid()
        assert "target_kf_distribution" in serializer.errors
