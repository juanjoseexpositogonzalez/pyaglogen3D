"""Tests for adjacency graph calculations."""
import numpy as np
import pytest


def calculate_adjacency_graph(
    coords: np.ndarray, radii: np.ndarray, tolerance: float = 0.01
) -> list[list[int]]:
    """Calculate adjacency list for particle neighbor graph.

    This is a copy of the function from views.py for isolated testing.
    """
    n = len(coords)
    adjacency = [[] for _ in range(n)]

    for i in range(n):
        for j in range(i + 1, n):
            dist = np.linalg.norm(coords[i] - coords[j])
            contact_dist = radii[i] + radii[j]
            if dist <= contact_dist * (1 + tolerance):
                adjacency[i].append(j)
                adjacency[j].append(i)

    return adjacency


class TestAdjacencyGraph:
    """Tests for adjacency graph calculation."""

    def test_touching_particles(self):
        """Two particles touching at distance r1+r2."""
        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])

        adj = calculate_adjacency_graph(coords, radii)

        assert adj[0] == [1]  # Particle 0 connected to particle 1
        assert adj[1] == [0]  # Particle 1 connected to particle 0

    def test_sintered_particles(self):
        """Two sintered particles at distance 1.8 (90% of r1+r2=2.0)."""
        coords = np.array([[0.0, 0.0, 0.0], [1.8, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])

        adj = calculate_adjacency_graph(coords, radii)

        # Sintered particles (closer than r1+r2) should be detected as neighbors
        assert adj[0] == [1]
        assert adj[1] == [0]

    def test_non_touching_particles(self):
        """Two particles far apart."""
        coords = np.array([[0.0, 0.0, 0.0], [5.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])

        adj = calculate_adjacency_graph(coords, radii)

        # Non-touching particles should have no connections
        assert adj[0] == []
        assert adj[1] == []

    def test_linear_chain(self):
        """Linear chain of 4 touching particles."""
        coords = np.array([
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [6.0, 0.0, 0.0],
        ])
        radii = np.array([1.0, 1.0, 1.0, 1.0])

        adj = calculate_adjacency_graph(coords, radii)

        # End particles have 1 neighbor, middle particles have 2
        assert len(adj[0]) == 1  # [1]
        assert len(adj[1]) == 2  # [0, 2]
        assert len(adj[2]) == 2  # [1, 3]
        assert len(adj[3]) == 1  # [2]

    def test_tolerance_boundary(self):
        """Test particles just outside tolerance."""
        # Particles at distance 2.03 with tolerance 0.01 (threshold = 2.02)
        coords = np.array([[0.0, 0.0, 0.0], [2.03, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])

        adj = calculate_adjacency_graph(coords, radii, tolerance=0.01)

        # Should NOT be detected as neighbors (2.03 > 2.02)
        assert adj[0] == []
        assert adj[1] == []

    def test_polydisperse_particles(self):
        """Test with different particle sizes."""
        coords = np.array([[0.0, 0.0, 0.0], [2.5, 0.0, 0.0]])
        radii = np.array([1.0, 1.5])  # Contact distance = 2.5

        adj = calculate_adjacency_graph(coords, radii)

        assert adj[0] == [1]
        assert adj[1] == [0]

    def test_numpy_array_input(self):
        """Verify function works correctly with NumPy arrays (addresses #23)."""
        # This test ensures coords is handled as NumPy array
        coords = np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]])
        radii = np.array([1.0, 1.0])

        # Should not raise TypeError
        adj = calculate_adjacency_graph(coords, radii)
        assert len(adj) == 2
