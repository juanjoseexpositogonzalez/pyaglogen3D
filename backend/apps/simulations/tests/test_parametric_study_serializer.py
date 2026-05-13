"""Tests for ``ParametricStudySerializer.validate()`` — grid key validation.

Covers spec requirements:
- R1.1: kf_distribution list of valid configs accepted
- R1.4: malformed kf_distribution entries rejected
- R2.2-R2.3: particle_radius_config std/mean cap
- R3.1-R3.2: sintering_config grid entries validation
- R4.1-R4.2: seed_type enum list validation
- R6.1: >200 projected sims → warning
- R6.2: >1000 projected sims → 400 rejection
- R7.1-R7.2: old grid shape without new keys → backward compat
"""

from __future__ import annotations

from math import prod

import pytest
from rest_framework.exceptions import ValidationError

from apps.simulations.models import ParametricStudy, Simulation
from apps.simulations.serializers import ParametricStudySerializer


def _make_data(**overrides) -> dict:
    """Minimal valid ParametricStudy payload."""
    data = {
        "name": "Test Study",
        "base_algorithm": "tunable_cc",
        "base_parameters": {"n_particles": 100, "target_df": 1.8, "target_kf": 1.3},
        "parameter_grid": {"n_particles": [100, 200]},
        "seeds_per_combination": 1,
    }
    data.update(overrides)
    return data


def _validate(data: dict) -> dict:
    """Run serializer validation, return validated data."""
    serializer = ParametricStudySerializer(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


# ---------------------------------------------------------------------------
# T2.1 — kf_distribution valid configs accepted (R1.1)
# ---------------------------------------------------------------------------


class TestKfDistributionValidation:
    """Validate kf_distribution grid entries via Phase 1 helper."""

    def test_valid_kf_distribution_accepted(self) -> None:
        """R1.1: list of valid distribution configs passes."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "kf_distribution": [
                    {"distribution_type": "fixed", "value": 1.3},
                    {"distribution_type": "normal", "mean": 1.3, "std": 0.1},
                ],
            }
        )
        result = _validate(data)
        assert "kf_distribution" in result["parameter_grid"]

    def test_invalid_kf_distribution_rejected(self) -> None:
        """R1.4: malformed entry in kf_distribution raises ValidationError."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "kf_distribution": [
                    {"distribution_type": "lognormal", "mean": 1.0},
                ],
            }
        )
        with pytest.raises(ValidationError) as exc_info:
            _validate(data)
        # Error should mention kf_distribution
        errors = exc_info.value.detail
        assert any("kf_distribution" in str(v) or "kf_distribution" in str(k) for k, v in (errors.items() if isinstance(errors, dict) else [(None, errors)]))


# ---------------------------------------------------------------------------
# T2.3 — particle_radius_config std/mean cap (R2.2-R2.3)
# ---------------------------------------------------------------------------


class TestParticleRadiusConfigValidation:
    """Validate particle_radius_config with std/mean ≤ 0.3 constraint."""

    def test_valid_particle_radius_accepted(self) -> None:
        """R2.1: normal config within cap passes."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "particle_radius_config": [
                    {"distribution_type": "normal", "mean": 50.0, "std": 10.0},
                ],
            }
        )
        result = _validate(data)
        assert "particle_radius_config" in result["parameter_grid"]

    def test_particle_radius_exceeds_cap_rejected(self) -> None:
        """R2.2: std/mean > 0.3 raises ValidationError."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "particle_radius_config": [
                    {"distribution_type": "normal", "mean": 1.0, "std": 0.5},
                ],
            }
        )
        with pytest.raises(ValidationError) as exc_info:
            _validate(data)
        assert "std/mean" in str(exc_info.value.detail) or "particle_radius" in str(exc_info.value.detail)


# ---------------------------------------------------------------------------
# T2.4 — sintering_config grid entries (R3.1-R3.2)
# ---------------------------------------------------------------------------


class TestSinteringConfigGridValidation:
    """Validate sintering_config grid entries."""

    def test_valid_sintering_config_accepted(self) -> None:
        """R3.1: valid sintering config list passes."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "sintering_config": [
                    {"distribution_type": "fixed", "coefficient": 0.9},
                    {"distribution_type": "uniform", "min": 0.85, "max": 0.95},
                ],
            }
        )
        result = _validate(data)
        assert "sintering_config" in result["parameter_grid"]

    def test_invalid_sintering_config_rejected(self) -> None:
        """R3.2: invalid sintering config entry raises ValidationError."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "sintering_config": [
                    {"distribution_type": "invalid_type"},
                ],
            }
        )
        with pytest.raises(ValidationError):
            _validate(data)


# ---------------------------------------------------------------------------
# T2.5 — seed_type enum list (R4.1-R4.2)
# ---------------------------------------------------------------------------


class TestSeedTypeGridValidation:
    """Validate seed_type grid entries."""

    def test_valid_seed_types_accepted(self) -> None:
        """R4.1: list of valid seed_type values passes."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "seed_type": ["monomers", "dimers"],
            }
        )
        result = _validate(data)
        assert result["parameter_grid"]["seed_type"] == ["monomers", "dimers"]

    def test_invalid_seed_type_rejected(self) -> None:
        """R4.2: unknown seed_type value raises ValidationError."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100],
                "seed_type": ["monomers", "hexamers"],
            }
        )
        with pytest.raises(ValidationError) as exc_info:
            _validate(data)
        assert "seed_type" in str(exc_info.value.detail)


# ---------------------------------------------------------------------------
# T2.6 — backward compat (R7.1-R7.2)
# ---------------------------------------------------------------------------


class TestBackwardCompat:
    """Old grid shapes without new keys still pass validation."""

    def test_old_grid_shape_accepted(self) -> None:
        """R7.1: grid with only scalar param lists passes."""
        data = _make_data(
            parameter_grid={"n_particles": [100, 200, 300]}
        )
        result = _validate(data)
        assert result["parameter_grid"] == {"n_particles": [100, 200, 300]}

    def test_old_grid_multiple_params_accepted(self) -> None:
        """R7.2: multiple scalar param lists pass."""
        data = _make_data(
            parameter_grid={
                "n_particles": [100, 200],
                "target_df": [1.6, 1.8, 2.0],
            }
        )
        result = _validate(data)
        assert len(result["parameter_grid"]) == 2


# ---------------------------------------------------------------------------
# T2.7 — batch size >1000 rejection (R6.2)
# ---------------------------------------------------------------------------


class TestBatchSizeValidation:
    """Batch size limits: >1000 reject, >200 warn."""

    def test_over_1000_rejected(self) -> None:
        """R6.2: projected sim count >1000 raises ValidationError."""
        # 11 × 11 × 3 seeds = 363 × 3 = 1089 > 1000
        data = _make_data(
            parameter_grid={
                "n_particles": list(range(100, 1200, 100)),  # 11 values
                "target_df": [1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6],  # 11 values
            },
            seeds_per_combination=9,
        )
        # 11 × 11 × 9 = 1089
        with pytest.raises(ValidationError) as exc_info:
            _validate(data)
        assert "1000" in str(exc_info.value.detail)

    def test_under_1000_accepted(self) -> None:
        """Batch under 1000 passes without error."""
        data = _make_data(
            parameter_grid={"n_particles": [100, 200]},
            seeds_per_combination=2,
        )
        # 2 × 2 = 4 sims — fine
        result = _validate(data)
        assert result is not None

    def test_over_200_warning(self) -> None:
        """R6.1: projected sim count >200 sets warning in context."""
        # 21 × 10 seeds = 210 > 200
        data = _make_data(
            parameter_grid={
                "n_particles": list(range(100, 2200, 100)),  # 21 values
            },
            seeds_per_combination=10,
        )
        # 21 × 10 = 210 > 200
        serializer = ParametricStudySerializer(data=data)
        serializer.is_valid(raise_exception=True)
        # Warning stored in serializer context or a special attribute
        assert hasattr(serializer, "batch_warning") and serializer.batch_warning is not None
