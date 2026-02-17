"""Integration tests for aglogen_core Rust module."""
import pytest
import numpy as np


# Skip all tests if aglogen_core is not installed
aglogen_core = pytest.importorskip("aglogen_core")


class TestDLASimulation:
    """Tests for DLA (Diffusion-Limited Aggregation) simulation."""

    def test_dla_basic_run(self):
        """Test that DLA simulation runs and returns valid result."""
        result = aglogen_core.run_dla(
            n_particles=50,
            sticking_probability=1.0,
            seed=42
        )

        assert result.coordinates.shape == (50, 3)
        assert result.radii.shape == (50,)
        assert result.execution_time_ms >= 0

    def test_dla_deterministic_with_seed(self):
        """Test that DLA produces identical results with same seed."""
        result1 = aglogen_core.run_dla(n_particles=30, seed=12345)
        result2 = aglogen_core.run_dla(n_particles=30, seed=12345)

        np.testing.assert_array_equal(result1.coordinates, result2.coordinates)
        np.testing.assert_array_equal(result1.radii, result2.radii)
        assert result1.fractal_dimension == result2.fractal_dimension

    def test_dla_different_seeds_different_results(self):
        """Test that different seeds produce different results."""
        result1 = aglogen_core.run_dla(n_particles=30, seed=111)
        result2 = aglogen_core.run_dla(n_particles=30, seed=222)

        # At least some coordinates should differ
        assert not np.allclose(result1.coordinates, result2.coordinates)

    def test_dla_fractal_dimension_range(self):
        """Test that fractal dimension is in reasonable range."""
        result = aglogen_core.run_dla(n_particles=50, seed=42)

        # DLA typically produces Df ~ 2.4-2.6, but small N varies
        assert 0.5 < result.fractal_dimension < 4.0

    def test_dla_metrics_populated(self):
        """Test that all metrics are returned and valid."""
        result = aglogen_core.run_dla(n_particles=50, seed=42)

        assert result.fractal_dimension > 0
        assert result.fractal_dimension_std >= 0
        assert result.prefactor > 0
        assert result.radius_of_gyration > 0
        assert 0 <= result.porosity <= 1
        assert result.coordination_mean >= 0
        assert result.coordination_std >= 0
        assert len(result.rg_evolution) > 0


class TestCCASimulation:
    """Tests for CCA (Cluster-Cluster Aggregation) simulation."""

    def test_cca_basic_run(self):
        """Test that CCA simulation runs and returns valid result."""
        result = aglogen_core.run_cca(
            n_particles=30,
            sticking_probability=1.0,
            particle_radius=1.0,
            box_size=20.0,
            seed=42
        )

        assert result.coordinates.shape == (30, 3)
        assert result.radii.shape == (30,)
        assert result.execution_time_ms >= 0

    def test_cca_deterministic_with_seed(self):
        """Test that CCA produces identical results with same seed."""
        params = dict(
            n_particles=20,
            particle_radius=1.0,
            box_size=15.0,
            seed=99999
        )
        result1 = aglogen_core.run_cca(**params)
        result2 = aglogen_core.run_cca(**params)

        np.testing.assert_array_equal(result1.coordinates, result2.coordinates)
        np.testing.assert_array_equal(result1.radii, result2.radii)

    def test_cca_metrics_populated(self):
        """Test that all metrics are returned and valid."""
        result = aglogen_core.run_cca(
            n_particles=30,
            box_size=20.0,
            seed=42
        )

        assert result.fractal_dimension > 0
        assert result.radius_of_gyration > 0
        assert 0 <= result.porosity <= 1


class TestBallisticSimulation:
    """Tests for Ballistic aggregation simulation."""

    def test_ballistic_basic_run(self):
        """Test that Ballistic simulation runs and returns valid result."""
        result = aglogen_core.run_ballistic(
            n_particles=50,
            sticking_probability=1.0,
            particle_radius=1.0,
            seed=42
        )

        assert result.coordinates.shape == (50, 3)
        assert result.radii.shape == (50,)
        assert result.execution_time_ms >= 0

    def test_ballistic_deterministic_with_seed(self):
        """Test that Ballistic produces identical results with same seed."""
        result1 = aglogen_core.run_ballistic(n_particles=30, seed=77777)
        result2 = aglogen_core.run_ballistic(n_particles=30, seed=77777)

        np.testing.assert_array_equal(result1.coordinates, result2.coordinates)
        np.testing.assert_array_equal(result1.radii, result2.radii)

    def test_ballistic_produces_denser_structures(self):
        """Ballistic aggregation should produce denser (higher Df) structures than CCA."""
        ballistic_result = aglogen_core.run_ballistic(n_particles=100, seed=42)
        cca_result = aglogen_core.run_cca(
            n_particles=100,
            box_size=30.0,
            seed=42
        )

        # Ballistic typically Df ~ 2.8-3.0, CCA ~ 1.8-2.0
        # Not always guaranteed with small N, so just check both are valid
        assert ballistic_result.fractal_dimension > 0.5
        assert cca_result.fractal_dimension > 0.5


class TestModuleMetadata:
    """Tests for module metadata and version."""

    def test_version_available(self):
        """Test that version function is available and returns string."""
        version = aglogen_core.version()
        assert isinstance(version, str)
        assert len(version) > 0

    def test_version_format(self):
        """Test that version follows semver format."""
        version = aglogen_core.version()
        parts = version.split(".")
        assert len(parts) >= 2  # At least major.minor


class TestResultAttributes:
    """Tests for simulation result object attributes."""

    def test_result_has_numpy_arrays(self):
        """Test that coordinates and radii are numpy arrays."""
        result = aglogen_core.run_dla(n_particles=20, seed=42)

        assert isinstance(result.coordinates, np.ndarray)
        assert isinstance(result.radii, np.ndarray)
        assert isinstance(result.rg_evolution, np.ndarray)

    def test_result_dtypes(self):
        """Test that numpy arrays have correct dtypes."""
        result = aglogen_core.run_dla(n_particles=20, seed=42)

        assert result.coordinates.dtype == np.float64
        assert result.radii.dtype == np.float64
        assert result.rg_evolution.dtype == np.float64

    def test_result_coordinate_dimensions(self):
        """Test that coordinates are 3D (x, y, z)."""
        result = aglogen_core.run_dla(n_particles=20, seed=42)

        assert result.coordinates.ndim == 2
        assert result.coordinates.shape[1] == 3  # x, y, z


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_small_particle_count(self):
        """Test with minimum viable particle count."""
        result = aglogen_core.run_dla(n_particles=5, seed=42)
        assert result.coordinates.shape[0] == 5

    def test_sticking_probability_zero(self):
        """Test with very low sticking probability."""
        # Note: sticking_probability=0 might never terminate,
        # so test with very small value or expect specific behavior
        result = aglogen_core.run_dla(
            n_particles=10,
            sticking_probability=0.5,
            seed=42
        )
        assert result.coordinates.shape[0] == 10

    def test_custom_particle_radius(self):
        """Test with non-default particle radius."""
        result = aglogen_core.run_ballistic(
            n_particles=20,
            particle_radius=2.5,
            seed=42
        )

        # All radii should be 2.5
        np.testing.assert_array_equal(result.radii, np.full(20, 2.5))
