"""Tests for ``validate_distribution_config`` — pure validation helper.

Covers spec requirements:
- R1.1-R1.3: fixed/normal/uniform valid configs
- R1.4: invalid type, missing field, negative std
- R2.1: particle_radius_config valid
- R2.2-R2.3: std/mean cap enforcement (≤ 0.3)
"""

from __future__ import annotations

import pytest
from rest_framework.exceptions import ValidationError

from apps.simulations.services.distribution_validation import (
    validate_distribution_config,
)

# ---------------------------------------------------------------------------
# Valid configs — R1.1-R1.3, R2.1
# ---------------------------------------------------------------------------

ALLOWED_TYPES = ("fixed", "uniform", "normal")


class TestValidConfigs:
    """T1.2 — valid distribution configs accepted without error."""

    def test_fixed_config_accepted(self) -> None:
        """R1.1: fixed distribution with a value passes."""
        config = {"distribution_type": "fixed", "value": 1.3}
        validate_distribution_config(config, ALLOWED_TYPES)

    def test_normal_config_accepted(self) -> None:
        """R1.2: normal distribution with mean+std passes."""
        config = {"distribution_type": "normal", "mean": 1.3, "std": 0.1}
        validate_distribution_config(config, ALLOWED_TYPES)

    def test_uniform_config_accepted(self) -> None:
        """R1.3: uniform distribution with min+max passes."""
        config = {"distribution_type": "uniform", "min": 1.0, "max": 1.5}
        validate_distribution_config(config, ALLOWED_TYPES)


# ---------------------------------------------------------------------------
# Invalid configs — R1.4
# ---------------------------------------------------------------------------


class TestInvalidConfigs:
    """T1.3 — invalid distribution configs raise ValidationError."""

    def test_invalid_type_rejected(self) -> None:
        """R1.4: unknown distribution_type raises ValidationError."""
        config = {"distribution_type": "lognormal", "mean": 1.0, "std": 0.1}
        with pytest.raises(ValidationError, match="distribution_type"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_missing_distribution_type_rejected(self) -> None:
        """Missing distribution_type key raises ValidationError."""
        config = {"value": 1.3}
        with pytest.raises(ValidationError, match="distribution_type"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_fixed_missing_value_rejected(self) -> None:
        """R1.4: fixed config without 'value' raises ValidationError."""
        config = {"distribution_type": "fixed"}
        with pytest.raises(ValidationError, match="value"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_normal_missing_mean_rejected(self) -> None:
        """Normal config without 'mean' raises ValidationError."""
        config = {"distribution_type": "normal", "std": 0.1}
        with pytest.raises(ValidationError, match="mean"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_normal_missing_std_rejected(self) -> None:
        """Normal config without 'std' raises ValidationError."""
        config = {"distribution_type": "normal", "mean": 1.3}
        with pytest.raises(ValidationError, match="std"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_normal_negative_std_rejected(self) -> None:
        """Negative std raises ValidationError."""
        config = {"distribution_type": "normal", "mean": 1.3, "std": -0.1}
        with pytest.raises(ValidationError, match="std"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_uniform_missing_min_rejected(self) -> None:
        """Uniform config without 'min' raises ValidationError."""
        config = {"distribution_type": "uniform", "max": 1.5}
        with pytest.raises(ValidationError, match="min"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_uniform_missing_max_rejected(self) -> None:
        """Uniform config without 'max' raises ValidationError."""
        config = {"distribution_type": "uniform", "min": 1.0}
        with pytest.raises(ValidationError, match="max"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_uniform_min_greater_than_max_rejected(self) -> None:
        """Uniform with min > max raises ValidationError."""
        config = {"distribution_type": "uniform", "min": 2.0, "max": 1.0}
        with pytest.raises(ValidationError, match="min"):
            validate_distribution_config(config, ALLOWED_TYPES)

    def test_not_a_dict_rejected(self) -> None:
        """Non-dict config raises ValidationError."""
        with pytest.raises(ValidationError, match="must be a dict"):
            validate_distribution_config("fixed", ALLOWED_TYPES)


# ---------------------------------------------------------------------------
# Constraints — R2.2-R2.3 (std/mean cap)
# ---------------------------------------------------------------------------


class TestConstraints:
    """Constraints kwargs: max_std_over_mean, min_mean."""

    def test_std_over_mean_within_cap_accepted(self) -> None:
        """R2.1: normal config with std/mean ≤ 0.3 passes."""
        config = {"distribution_type": "normal", "mean": 1.0, "std": 0.3}
        validate_distribution_config(
            config, ALLOWED_TYPES, max_std_over_mean=0.3
        )

    def test_std_over_mean_exceeds_cap_rejected(self) -> None:
        """R2.2: std/mean > 0.3 raises ValidationError."""
        config = {"distribution_type": "normal", "mean": 1.0, "std": 0.4}
        with pytest.raises(ValidationError, match="std/mean"):
            validate_distribution_config(
                config, ALLOWED_TYPES, max_std_over_mean=0.3
            )

    def test_std_over_mean_at_boundary_accepted(self) -> None:
        """R2.3: std/mean == 0.3 exactly is accepted."""
        config = {"distribution_type": "normal", "mean": 2.0, "std": 0.6}
        validate_distribution_config(
            config, ALLOWED_TYPES, max_std_over_mean=0.3
        )

    def test_min_mean_enforced(self) -> None:
        """min_mean constraint rejects mean below threshold."""
        config = {"distribution_type": "normal", "mean": 0.001, "std": 0.0001}
        with pytest.raises(ValidationError, match="mean"):
            validate_distribution_config(
                config, ALLOWED_TYPES, min_mean=0.01
            )

    def test_min_mean_accepted(self) -> None:
        """min_mean constraint accepts mean at or above threshold."""
        config = {"distribution_type": "normal", "mean": 0.01, "std": 0.001}
        validate_distribution_config(
            config, ALLOWED_TYPES, min_mean=0.01
        )
