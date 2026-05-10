"""Tests for tasks.py coordination refactor — unified service layer.

Strict TDD: ensures tasks.py uses compute_coordination_data instead of
inline loops, and stores all 6 fields in metrics["coordination"].
"""

from __future__ import annotations

import io
import math
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

from apps.simulations.services.coordination import (
    CoordinationData,
    ParticleCoordination,
    compute_coordination_data,
)


# ── Helpers ────────────────────────────────────────────────────────────

def _make_chain_coords(n: int, radius: float = 1.0) -> np.ndarray:
    """Create n particles in a touching chain along x-axis."""
    return np.array([[2 * radius * i, 0.0, 0.0] for i in range(n)])


COORDINATION_6_FIELDS = {
    "mean", "std", "per_particle", "distribution",
    "threshold_strategy", "tolerance",
}


# ── T2.1 / T2.2: monodisperse path (compute_limiting_metrics) ─────────
class TestMonodisperseRefactor:
    def test_limiting_metrics_coordination_has_6_fields(self):
        """compute_limiting_metrics must produce all 6 coordination fields."""
        from apps.simulations.tasks import compute_limiting_metrics

        coords = _make_chain_coords(5, radius=1.0)
        result = compute_limiting_metrics(coords, n_particles=5, radius=1.0)

        coord = result["coordination"]
        assert COORDINATION_6_FIELDS == set(coord.keys()), (
            f"Missing fields: {COORDINATION_6_FIELDS - set(coord.keys())}"
        )

    def test_limiting_metrics_per_particle_length(self):
        """per_particle list must have exactly n_particles entries."""
        from apps.simulations.tasks import compute_limiting_metrics

        coords = _make_chain_coords(3, radius=1.0)
        result = compute_limiting_metrics(coords, n_particles=3, radius=1.0)

        per_particle = result["coordination"]["per_particle"]
        assert len(per_particle) == 3

    def test_limiting_metrics_mean_matches_per_particle(self):
        """Mean from per_particle must equal the mean field (single source of truth)."""
        from apps.simulations.tasks import compute_limiting_metrics

        coords = _make_chain_coords(5, radius=1.0)
        result = compute_limiting_metrics(coords, n_particles=5, radius=1.0)

        coord = result["coordination"]
        per_particle = coord["per_particle"]
        computed_mean = np.mean([p["n_contacts"] for p in per_particle])
        assert abs(coord["mean"] - computed_mean) < 1e-10


# ── T2.3 / T2.4: polydisperse path (compute_import_metrics) ──────────
class TestPolydisperseRefactor:
    def test_import_metrics_coordination_has_6_fields(self):
        """compute_import_metrics must produce all 6 coordination fields."""
        from apps.simulations.tasks import compute_import_metrics

        coords = _make_chain_coords(5, radius=1.0)
        radii = np.ones(5)
        result = compute_import_metrics(coords, radii)

        coord = result["coordination"]
        assert COORDINATION_6_FIELDS == set(coord.keys()), (
            f"Missing fields: {COORDINATION_6_FIELDS - set(coord.keys())}"
        )

    def test_import_metrics_per_particle_symmetry(self):
        """per_particle contacts must be symmetric."""
        from apps.simulations.tasks import compute_import_metrics

        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [4.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0, 1.0])
        result = compute_import_metrics(coords, radii)

        per_particle = result["coordination"]["per_particle"]
        for p in per_particle:
            for neighbor_id in p["contact_neighbors"]:
                neighbor = per_particle[neighbor_id]
                assert p["particle_id"] in neighbor["contact_neighbors"]


# ── T2.5: no inline loops remain ─────────────────────────────────────
class TestNoInlineLoops:
    def test_no_coordinations_variable_in_limiting_metrics(self):
        """The old 'coordinations = []' inline loop must be removed."""
        import inspect
        from apps.simulations.tasks import compute_limiting_metrics

        source = inspect.getsource(compute_limiting_metrics)
        assert "coordinations = []" not in source, (
            "compute_limiting_metrics still has inline coordination loop"
        )

    def test_no_coordinations_variable_in_import_metrics(self):
        """The old 'coordinations = []' inline loop must be removed."""
        import inspect
        from apps.simulations.tasks import compute_import_metrics

        source = inspect.getsource(compute_import_metrics)
        assert "coordinations = []" not in source, (
            "compute_import_metrics still has inline coordination loop"
        )


# ── T2.6: integration test — all 6 fields valid ─────────────────────
class TestIntegration:
    def test_chain_simulation_all_6_fields(self):
        """5-particle chain: all 6 fields present, mean consistent."""
        from apps.simulations.tasks import compute_limiting_metrics

        coords = _make_chain_coords(5, radius=1.0)
        result = compute_limiting_metrics(coords, n_particles=5, radius=1.0)

        coord = result["coordination"]
        # All fields present and typed correctly
        assert isinstance(coord["mean"], float)
        assert isinstance(coord["std"], float)
        assert isinstance(coord["per_particle"], list)
        assert isinstance(coord["distribution"], dict)
        assert coord["threshold_strategy"] == "unified_r_sum_with_tolerance"
        assert isinstance(coord["tolerance"], float)

        # Distribution sum == n
        dist_sum = sum(coord["distribution"].values())
        assert dist_sum == 5

        # Mean from per_particle equals mean field
        pp_mean = np.mean([p["n_contacts"] for p in coord["per_particle"]])
        assert abs(coord["mean"] - pp_mean) < 1e-10


# ── T2.7: backward compat — drift from legacy 2.1*r ─────────────────
class TestBackwardCompat:
    def test_drift_from_legacy_documented(self):
        """New unified threshold vs old 2.1*radius: drift is small (~1-4%).

        Old: threshold = 2.1 * radius (monodisperse, radius=1.0) = 2.1
        New: threshold = (1.0 + 1.0) * 1.01 = 2.02

        For a chain of touching particles (dist=2.0), both detect contacts.
        The drift matters only at boundary distances between 2.02 and 2.1.
        """
        from apps.simulations.tasks import compute_limiting_metrics

        # 10-particle chain: all touching at dist=2.0
        # Both old (2.1) and new (2.02) thresholds detect these contacts
        coords = _make_chain_coords(10, radius=1.0)
        result = compute_limiting_metrics(coords, n_particles=10, radius=1.0)

        coord = result["coordination"]
        # Chain: endpoints have 1 contact, interior have 2
        # Expected mean = (2*1 + 8*2) / 10 = 1.8
        assert abs(coord["mean"] - 1.8) < 0.01, (
            f"Chain mean coordination should be ~1.8, got {coord['mean']}"
        )
