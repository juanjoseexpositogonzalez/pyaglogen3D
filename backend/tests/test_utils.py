"""Tests for simulation utility functions."""
from datetime import datetime, timezone

import pytest

from apps.simulations.utils import (
    ALGORITHM_DISPLAY_NAMES,
    FRAKTAL_MODEL_DISPLAY_NAMES,
    SINTERING_EXTREMES,
    THEORETICAL_EXTREMES,
    apply_sintering_config,
    generate_fraktal_name,
    generate_limiting_cases,
    generate_simulation_name,
    generate_sintering_extreme_cases,
)


class TestGenerateSimulationName:
    """Tests for generate_simulation_name function."""

    def test_dla_algorithm_name(self):
        """Test name generation for DLA algorithm."""
        created_at = datetime(2024, 2, 20, 10, 30, tzinfo=timezone.utc)
        name = generate_simulation_name("dla", created_at)
        assert name == "DLA Simulation - 2024-02-20 10:30"

    def test_tunable_algorithm_name(self):
        """Test name generation for tunable algorithm."""
        created_at = datetime(2024, 5, 15, 14, 45, tzinfo=timezone.utc)
        name = generate_simulation_name("tunable", created_at)
        assert name == "Tunable Simulation - 2024-05-15 14:45"

    def test_all_known_algorithms(self):
        """Test name generation for all known algorithms."""
        created_at = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
        for algo, display in ALGORITHM_DISPLAY_NAMES.items():
            name = generate_simulation_name(algo, created_at)
            assert display in name
            assert "Simulation" in name

    def test_unknown_algorithm_uses_uppercase(self):
        """Test that unknown algorithms are uppercased."""
        created_at = datetime(2024, 3, 10, 8, 0, tzinfo=timezone.utc)
        name = generate_simulation_name("custom_algo", created_at)
        assert "CUSTOM_ALGO Simulation" in name

    def test_with_suffix(self):
        """Test name generation with suffix."""
        created_at = datetime(2024, 2, 20, 10, 30, tzinfo=timezone.utc)
        name = generate_simulation_name("dla", created_at, "(grid: target_df=1.8)")
        assert name == "DLA Simulation - 2024-02-20 10:30 (grid: target_df=1.8)"

    def test_default_timestamp_is_now(self):
        """Test that omitting created_at uses current time."""
        name = generate_simulation_name("dla")
        # Just verify it contains expected parts
        assert "DLA Simulation - " in name
        assert len(name) > len("DLA Simulation - ")


class TestGenerateFraktalName:
    """Tests for generate_fraktal_name function."""

    def test_granulated_2012_model(self):
        """Test name generation for granulated_2012 model."""
        created_at = datetime(2024, 2, 20, 10, 30, tzinfo=timezone.utc)
        name = generate_fraktal_name("granulated_2012", created_at)
        assert name == "FRAKTAL Granulated 2012 - 2024-02-20 10:30"

    def test_voxel_2018_model(self):
        """Test name generation for voxel_2018 model."""
        created_at = datetime(2024, 6, 1, 9, 15, tzinfo=timezone.utc)
        name = generate_fraktal_name("voxel_2018", created_at)
        assert name == "FRAKTAL Voxel 2018 - 2024-06-01 09:15"

    def test_all_known_models(self):
        """Test name generation for all known models."""
        created_at = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
        for model, display in FRAKTAL_MODEL_DISPLAY_NAMES.items():
            name = generate_fraktal_name(model, created_at)
            assert display in name
            assert "FRAKTAL" in name

    def test_unknown_model_uses_title_case(self):
        """Test that unknown models are title-cased."""
        created_at = datetime(2024, 3, 10, 8, 0, tzinfo=timezone.utc)
        name = generate_fraktal_name("new_model", created_at)
        assert "New_Model" in name

    def test_with_suffix(self):
        """Test name generation with suffix."""
        created_at = datetime(2024, 2, 20, 10, 30, tzinfo=timezone.utc)
        name = generate_fraktal_name("voxel_2018", created_at, "(auto-calibrated)")
        assert name == "FRAKTAL Voxel 2018 - 2024-02-20 10:30 (auto-calibrated)"


class TestGenerateLimitingCases:
    """Tests for generate_limiting_cases function."""

    def test_boundary_cases_from_grid(self):
        """Test generating boundary cases from parameter grid."""
        base_params = {"n_particles": 1000}
        param_grid = {"target_df": [1.5, 1.8, 2.0]}

        cases = generate_limiting_cases(
            base_params, param_grid, "tunable",
            {"include_boundaries": True, "include_theoretical": False}
        )

        # Should have min and max boundary cases
        assert len(cases) == 2

        case_types = [c[0] for c in cases]
        assert "boundary_min" in case_types
        assert "boundary_max" in case_types

        # Check values
        descriptions = {c[1] for c in cases}
        assert "target_df=1.5" in descriptions
        assert "target_df=2.0" in descriptions

    def test_theoretical_extremes_for_tunable(self):
        """Test generating theoretical extreme cases for tunable algorithm."""
        base_params = {"n_particles": 1000}
        param_grid = {}

        cases = generate_limiting_cases(
            base_params, param_grid, "tunable",
            {"include_boundaries": False, "include_theoretical": True}
        )

        # Should have extremes for target_df and target_kf
        descriptions = {c[1] for c in cases}

        # Check that theoretical extremes are included
        assert any("target_df=1.0" in d for d in descriptions)
        assert any("target_df=3.0" in d for d in descriptions)
        assert any("target_kf=1.0" in d for d in descriptions)

    def test_both_boundaries_and_theoretical(self):
        """Test generating both boundary and theoretical cases."""
        base_params = {"n_particles": 1000}
        param_grid = {"target_df": [1.5, 2.0]}

        cases = generate_limiting_cases(
            base_params, param_grid, "tunable",
            {"include_boundaries": True, "include_theoretical": True}
        )

        case_types = [c[0] for c in cases]
        assert "boundary_min" in case_types
        assert "boundary_max" in case_types
        assert "theoretical" in case_types

    def test_deduplication_of_cases(self):
        """Test that duplicate parameter values are not repeated."""
        base_params = {"n_particles": 1000}
        # Grid includes 1.0 which is also a theoretical extreme
        param_grid = {"target_df": [1.0, 1.8, 2.5]}

        cases = generate_limiting_cases(
            base_params, param_grid, "tunable",
            {"include_boundaries": True, "include_theoretical": True}
        )

        # target_df=1.0 should only appear once
        df_1_cases = [c for c in cases if "target_df=1.0" in c[1]]
        assert len(df_1_cases) == 1

    def test_custom_theoretical_extremes(self):
        """Test providing custom theoretical extremes via config."""
        base_params = {"n_particles": 1000}
        param_grid = {}

        config = {
            "include_boundaries": False,
            "include_theoretical": True,
            "theoretical_extremes": {
                "custom_param": [0.1, 0.5, 0.9],
            }
        }

        cases = generate_limiting_cases(base_params, param_grid, "dla", config)

        descriptions = {c[1] for c in cases}
        assert "custom_param=0.1" in descriptions
        assert "custom_param=0.5" in descriptions
        assert "custom_param=0.9" in descriptions

    def test_default_config_includes_both(self):
        """Test that default config includes both boundaries and theoretical."""
        base_params = {"n_particles": 1000}
        param_grid = {"target_df": [1.5, 2.0]}

        # No config passed (defaults)
        cases = generate_limiting_cases(base_params, param_grid, "tunable", None)

        case_types = [c[0] for c in cases]
        assert "boundary_min" in case_types or "boundary_max" in case_types
        assert "theoretical" in case_types

    def test_empty_grid_only_theoretical(self):
        """Test with empty grid only produces theoretical cases."""
        base_params = {"n_particles": 1000}
        param_grid = {}

        cases = generate_limiting_cases(base_params, param_grid, "tunable", None)

        # Should only have theoretical cases
        case_types = set(c[0] for c in cases)
        assert "boundary_min" not in case_types
        assert "boundary_max" not in case_types
        assert "theoretical" in case_types

    def test_algorithm_without_theoretical_extremes(self):
        """Test algorithm with no defined theoretical extremes."""
        base_params = {"n_particles": 1000}
        param_grid = {"param": [1, 2, 3]}

        cases = generate_limiting_cases(
            base_params, param_grid, "unknown_algo",
            {"include_boundaries": True, "include_theoretical": True}
        )

        # Should only have boundaries (no theoretical for unknown algo)
        case_types = set(c[0] for c in cases)
        assert "boundary_min" in case_types
        assert "boundary_max" in case_types
        assert "theoretical" not in case_types


class TestGenerateSinteringExtremeCases:
    """Tests for generate_sintering_extreme_cases function."""

    def test_generates_all_extreme_coefficients(self):
        """Test that all sintering extreme coefficients are generated."""
        base_params = {"n_particles": 1000, "target_df": 1.8}

        cases = generate_sintering_extreme_cases(base_params)

        assert len(cases) == len(SINTERING_EXTREMES["coefficients"])

        coeffs = {c[1] for c in cases}
        for expected_coeff in SINTERING_EXTREMES["coefficients"]:
            assert f"coeff={expected_coeff}" in coeffs

    def test_case_structure(self):
        """Test the structure of returned cases."""
        base_params = {"n_particles": 1000}

        cases = generate_sintering_extreme_cases(base_params)

        for case_type, description, params in cases:
            assert case_type == "sintering_extreme"
            assert "coeff=" in description
            assert params["sintering_type"] == "fixed"
            assert "sintering_coeff" in params
            # Base params preserved
            assert params["n_particles"] == 1000

    def test_does_not_modify_base_params(self):
        """Test that base params are not modified."""
        base_params = {"n_particles": 1000}
        original = base_params.copy()

        generate_sintering_extreme_cases(base_params)

        assert base_params == original


class TestApplySinteringConfig:
    """Tests for apply_sintering_config function."""

    def test_fixed_sintering(self):
        """Test applying fixed sintering configuration."""
        params = {"n_particles": 1000}
        config = {
            "distribution_type": "fixed",
            "coefficient": 0.9,
        }

        result = apply_sintering_config(params, config)

        assert result["sintering_type"] == "fixed"
        assert result["sintering_coeff"] == 0.9
        assert result["n_particles"] == 1000

    def test_uniform_sintering(self):
        """Test applying uniform sintering configuration."""
        params = {"n_particles": 1000}
        config = {
            "distribution_type": "uniform",
            "min": 0.85,
            "max": 0.95,
        }

        result = apply_sintering_config(params, config)

        assert result["sintering_type"] == "uniform"
        assert result["sintering_min"] == 0.85
        assert result["sintering_max"] == 0.95

    def test_normal_sintering(self):
        """Test applying normal distribution sintering configuration."""
        params = {"n_particles": 1000}
        config = {
            "distribution_type": "normal",
            "mean": 0.9,
            "std": 0.05,
        }

        result = apply_sintering_config(params, config)

        assert result["sintering_type"] == "normal"
        assert result["sintering_mean"] == 0.9
        assert result["sintering_std"] == 0.05

    def test_none_config_returns_unchanged(self):
        """Test that None config returns parameters unchanged."""
        params = {"n_particles": 1000}

        result = apply_sintering_config(params, None)

        assert result == params

    def test_empty_config_returns_unchanged(self):
        """Test that empty config returns parameters unchanged."""
        params = {"n_particles": 1000}

        result = apply_sintering_config(params, {})

        # Empty dict is falsy but not None - returns params without sintering
        assert "sintering_type" not in result

    def test_default_values_used(self):
        """Test that default values are used when not specified."""
        params = {"n_particles": 1000}
        config = {"distribution_type": "uniform"}  # No min/max specified

        result = apply_sintering_config(params, config)

        assert result["sintering_min"] == 0.85  # Default
        assert result["sintering_max"] == 0.95  # Default

    def test_does_not_modify_original_params(self):
        """Test that original parameters are not modified."""
        params = {"n_particles": 1000}
        original = params.copy()
        config = {"distribution_type": "fixed", "coefficient": 0.9}

        apply_sintering_config(params, config)

        assert params == original


class TestConstants:
    """Tests for module constants."""

    def test_theoretical_extremes_structure(self):
        """Test that THEORETICAL_EXTREMES has expected structure."""
        assert isinstance(THEORETICAL_EXTREMES, dict)

        # Should have at least tunable algorithm
        assert "tunable" in THEORETICAL_EXTREMES
        assert "target_df" in THEORETICAL_EXTREMES["tunable"]
        assert isinstance(THEORETICAL_EXTREMES["tunable"]["target_df"], list)

    def test_sintering_extremes_structure(self):
        """Test that SINTERING_EXTREMES has expected structure."""
        assert isinstance(SINTERING_EXTREMES, dict)
        assert "coefficients" in SINTERING_EXTREMES
        assert len(SINTERING_EXTREMES["coefficients"]) >= 4

        # All coefficients should be in valid range
        for coeff in SINTERING_EXTREMES["coefficients"]:
            assert 0.5 <= coeff <= 1.0

    def test_algorithm_display_names_complete(self):
        """Test that common algorithms have display names."""
        required = ["dla", "cca", "ballistic", "tunable"]
        for algo in required:
            assert algo in ALGORITHM_DISPLAY_NAMES

    def test_fraktal_model_display_names_complete(self):
        """Test that known models have display names."""
        required = ["granulated_2012", "voxel_2018"]
        for model in required:
            assert model in FRAKTAL_MODEL_DISPLAY_NAMES
