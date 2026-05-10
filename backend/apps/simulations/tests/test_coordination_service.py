"""Unit tests for coordination service (per-particle contacts + distribution).

Strict TDD: each test written BEFORE the production code it exercises.
"""

from __future__ import annotations

import numpy as np
import pytest


# ── T1.1: skeleton imports ─────────────────────────────────────────────
class TestCoordinationSkeleton:
    """Verify dataclass and function exist with correct signatures."""

    def test_import_coordination_data(self):
        from apps.simulations.services.coordination import CoordinationData

        data = CoordinationData(
            per_particle=[],
            distribution={},
            mean=0.0,
            std=0.0,
            threshold_strategy="unified_r_sum_with_tolerance",
            tolerance=0.01,
        )
        assert data.mean == 0.0
        assert data.threshold_strategy == "unified_r_sum_with_tolerance"

    def test_import_particle_coordination(self):
        from apps.simulations.services.coordination import ParticleCoordination

        pc = ParticleCoordination(particle_id=0, n_contacts=3, contact_neighbors=[1, 2, 3])
        assert pc.particle_id == 0
        assert pc.n_contacts == 3

    def test_compute_signature_exists(self):
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0]])
        radii = np.array([1.0])
        result = compute_coordination_data(coords, radii)
        assert hasattr(result, "per_particle")
        assert hasattr(result, "distribution")


# ── T1.2: 1-particle case (R9.1) ──────────────────────────────────────
class TestOneParticle:
    def test_single_particle_zero_contacts(self):
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0]])
        radii = np.array([1.0])
        result = compute_coordination_data(coords, radii)

        assert len(result.per_particle) == 1
        assert result.per_particle[0].n_contacts == 0
        assert result.per_particle[0].contact_neighbors == []
        assert result.mean == 0.0
        assert result.std == 0.0

    def test_single_particle_distribution(self):
        """Triangulate: distribution must sum to n_particles."""
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[5.0, -3.0, 2.0]])
        radii = np.array([2.5])
        result = compute_coordination_data(coords, radii)

        assert result.distribution == {"0": 1}
        assert sum(result.distribution.values()) == 1


# ── T1.3: 2 touching particles ────────────────────────────────────────
class TestTwoTouching:
    def test_two_touching_each_has_one_contact(self):
        """Two particles at exactly r_i + r_j distance → 1 contact each."""
        from apps.simulations.services.coordination import compute_coordination_data

        # radius=1.0, distance=2.0 → threshold = 2.0 * 1.01 = 2.02 → contact
        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])
        result = compute_coordination_data(coords, radii)

        assert result.per_particle[0].n_contacts == 1
        assert result.per_particle[1].n_contacts == 1
        assert 0 in result.per_particle[1].contact_neighbors
        assert 1 in result.per_particle[0].contact_neighbors
        assert result.mean == 1.0
        assert result.std == 0.0

    def test_two_touching_distribution(self):
        """Triangulate: distribution = {"1": 2}."""
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0], [1.5, 0.0, 0.0]])
        radii = np.array([1.0, 0.5])  # sum=1.5, threshold=1.515, dist=1.5 → contact
        result = compute_coordination_data(coords, radii)

        assert result.distribution["1"] == 2
        # Key "0" may exist with count 0 (full range 0..max)
        assert sum(result.distribution.values()) == 2


# ── T1.4: 2 far particles ─────────────────────────────────────────────
class TestTwoFar:
    def test_two_far_zero_contacts(self):
        """Two particles far apart → 0 contacts each."""
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0], [100.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])
        result = compute_coordination_data(coords, radii)

        assert result.per_particle[0].n_contacts == 0
        assert result.per_particle[1].n_contacts == 0
        assert result.mean == 0.0

    def test_two_far_distribution(self):
        """Triangulate: distribution = {"0": 2}."""
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0], [50.0, 50.0, 50.0]])
        radii = np.array([0.5, 0.5])
        result = compute_coordination_data(coords, radii)

        assert result.distribution == {"0": 2}
        assert sum(result.distribution.values()) == 2


# ── T1.5: symmetry invariant (R1.5) ───────────────────────────────────
class TestSymmetry:
    def test_contact_symmetry(self):
        """If particle i contacts j, then j contacts i."""
        from apps.simulations.services.coordination import compute_coordination_data

        # 3 particles in a line: 0--1--2
        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [4.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0, 1.0])
        result = compute_coordination_data(coords, radii)

        for pc in result.per_particle:
            for neighbor_id in pc.contact_neighbors:
                neighbor = result.per_particle[neighbor_id]
                assert pc.particle_id in neighbor.contact_neighbors, (
                    f"Particle {neighbor_id} contacts {pc.particle_id} "
                    f"but reverse not found"
                )

    def test_permutation_invariant(self):
        """Shuffling particle order produces same n_contacts per particle_id."""
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
        radii = np.array([1.0, 1.0, 1.0])

        result_orig = compute_coordination_data(coords, radii)
        # Shuffle order: [2, 0, 1]
        perm = [2, 0, 1]
        coords_shuffled = coords[perm]
        radii_shuffled = radii[perm]
        result_shuf = compute_coordination_data(coords_shuffled, radii_shuffled)

        # Same set of contact counts (sorted)
        orig_counts = sorted(p.n_contacts for p in result_orig.per_particle)
        shuf_counts = sorted(p.n_contacts for p in result_shuf.per_particle)
        assert orig_counts == shuf_counts


# ── T1.6: distribution sum invariant (R2.2) ───────────────────────────
class TestDistributionSum:
    @pytest.mark.parametrize("n", [5, 10, 50])
    def test_distribution_sum_equals_n_particles(self, n):
        """sum(distribution.values()) must always equal N."""
        from apps.simulations.services.coordination import compute_coordination_data

        rng = np.random.default_rng(42 + n)
        coords = rng.uniform(-10, 10, (n, 3))
        radii = rng.uniform(0.5, 2.0, n)
        result = compute_coordination_data(coords, radii)

        assert sum(result.distribution.values()) == n


# ── T1.7: polydisperse case ───────────────────────────────────────────
class TestPolydisperse:
    def test_polydisperse_threshold_uses_sum_radii(self):
        """Different radii: threshold = (r_i + r_j) * 1.01."""
        from apps.simulations.services.coordination import compute_coordination_data

        # Particle 0: r=1.0 at origin
        # Particle 1: r=1.5 at (2.5, 0, 0)  → dist=2.5, threshold=(1+1.5)*1.01=2.525 → CONTACT
        # Particle 2: r=2.0 at (0, 3.6, 0)  → dist to 0 = 3.6, threshold=(1+2)*1.01=3.03 → NO
        #                                    → dist to 1 = sqrt(2.5^2+3.6^2)=4.38, threshold=(1.5+2)*1.01=3.535 → NO
        coords = np.array([
            [0.0, 0.0, 0.0],
            [2.5, 0.0, 0.0],
            [0.0, 3.6, 0.0],
        ])
        radii = np.array([1.0, 1.5, 2.0])
        result = compute_coordination_data(coords, radii)

        assert result.per_particle[0].n_contacts == 1  # contacts particle 1
        assert result.per_particle[1].n_contacts == 1  # contacts particle 0
        assert result.per_particle[2].n_contacts == 0  # too far from both

    def test_polydisperse_all_touching(self):
        """Triangulate: 3 particles all within threshold of each other."""
        from apps.simulations.services.coordination import compute_coordination_data

        # Particle 0: r=1.0 at origin
        # Particle 1: r=0.5 at (1.5, 0, 0)  → dist=1.5, threshold=(1+0.5)*1.01=1.515 → CONTACT
        # Particle 2: r=0.5 at (0, 1.5, 0)  → dist to 0=1.5, threshold=1.515 → CONTACT
        #                                    → dist to 1=sqrt(1.5^2+1.5^2)=2.12, threshold=(0.5+0.5)*1.01=1.01 → NO
        coords = np.array([
            [0.0, 0.0, 0.0],
            [1.5, 0.0, 0.0],
            [0.0, 1.5, 0.0],
        ])
        radii = np.array([1.0, 0.5, 0.5])
        result = compute_coordination_data(coords, radii)

        assert result.per_particle[0].n_contacts == 2  # contacts 1 and 2
        assert result.per_particle[1].n_contacts == 1  # contacts 0 only
        assert result.per_particle[2].n_contacts == 1  # contacts 0 only
        assert result.distribution["1"] == 2
        assert result.distribution["2"] == 1


# ── T1.8: vectorized implementation correctness ──────────────────────
class TestVectorized:
    def test_vectorized_matches_loop(self):
        """Vectorized numpy implementation matches naive loop."""
        from apps.simulations.services.coordination import compute_coordination_data

        rng = np.random.default_rng(123)
        n = 100
        coords = rng.uniform(-5, 5, (n, 3))
        radii = rng.uniform(0.5, 1.5, n)
        tol = 0.01

        result = compute_coordination_data(coords, radii, tolerance=tol)

        # Naive loop for reference
        for i in range(n):
            count = 0
            neighbors = []
            for j in range(n):
                if i != j:
                    dist = np.linalg.norm(coords[i] - coords[j])
                    thresh = (radii[i] + radii[j]) * (1 + tol)
                    if dist <= thresh:
                        count += 1
                        neighbors.append(j)
            assert result.per_particle[i].n_contacts == count, (
                f"Particle {i}: vectorized={result.per_particle[i].n_contacts}, loop={count}"
            )
            assert sorted(result.per_particle[i].contact_neighbors) == sorted(neighbors)


# ── T1.9: performance N=1000 < 2s ────────────────────────────────────
class TestPerformance:
    def test_n1000_under_2_seconds(self):
        """compute_coordination_data with N=1000 must complete in < 2 seconds."""
        import time
        from apps.simulations.services.coordination import compute_coordination_data

        rng = np.random.default_rng(999)
        coords = rng.uniform(-50, 50, (1000, 3))
        radii = rng.uniform(0.5, 1.5, 1000)

        start = time.perf_counter()
        result = compute_coordination_data(coords, radii)
        elapsed = time.perf_counter() - start

        assert elapsed < 2.0, f"Took {elapsed:.2f}s, expected < 2.0s"
        assert len(result.per_particle) == 1000
        assert sum(result.distribution.values()) == 1000


# ── T1.10: metadata fields ───────────────────────────────────────────
class TestMetadataFields:
    def test_threshold_strategy_field(self):
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])
        result = compute_coordination_data(coords, radii)

        assert result.threshold_strategy == "unified_r_sum_with_tolerance"
        assert result.tolerance == 0.01

    def test_custom_tolerance(self):
        from apps.simulations.services.coordination import compute_coordination_data

        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])
        result = compute_coordination_data(coords, radii, tolerance=0.05)

        assert result.tolerance == 0.05
