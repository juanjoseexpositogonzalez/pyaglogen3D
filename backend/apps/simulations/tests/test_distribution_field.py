"""P4.1 — DistributionField DRF custom field validation.

Tests the DistributionField that validates distribution config dicts
for dpo_distribution and target_kf_distribution.

Covers spec R11 (target_kf validation) and R12 (dpo validation):
- mode must be one of: fixed, normal, uniform
- fixed requires positive value
- normal requires positive mean AND positive std
- uniform requires positive min AND max > min
- None is accepted (legacy scalar fallback)
"""

from __future__ import annotations

import pytest
from rest_framework import serializers

from apps.simulations.fields import DistributionField


class _Harness(serializers.Serializer):
    """Minimal serializer wrapping DistributionField for isolated testing."""

    dist = DistributionField(required=False, allow_null=True)


def _validate(data: dict | None) -> dict | None:
    """Run DistributionField validation and return internal value."""
    s = _Harness(data={"dist": data})
    s.is_valid(raise_exception=True)
    return s.validated_data["dist"]


def _expect_error(data: dict | None) -> str:
    """Run validation expecting failure; return error message string."""
    s = _Harness(data={"dist": data})
    assert not s.is_valid(), f"Expected validation error for {data!r}"
    return str(s.errors["dist"])


# ── Happy paths ───────────────────────────────────────────────────────


class TestDistributionFieldAccepts:
    def test_fixed_mode(self) -> None:
        result = _validate({"mode": "fixed", "value": 12.5})
        assert result == {"mode": "fixed", "value": 12.5}

    def test_fixed_mode_int_coerced_to_float(self) -> None:
        result = _validate({"mode": "fixed", "value": 5})
        assert result == {"mode": "fixed", "value": 5.0}
        assert isinstance(result["value"], float)

    def test_normal_mode(self) -> None:
        result = _validate({"mode": "normal", "mean": 12.5, "std": 1.5})
        assert result == {"mode": "normal", "mean": 12.5, "std": 1.5}

    def test_uniform_mode(self) -> None:
        result = _validate({"mode": "uniform", "min": 10.0, "max": 15.0})
        assert result == {"mode": "uniform", "min": 10.0, "max": 15.0}

    def test_null_returns_none(self) -> None:
        result = _validate(None)
        assert result is None


# ── Rejections ────────────────────────────────────────────────────────


class TestDistributionFieldRejects:
    def test_invalid_mode(self) -> None:
        err = _expect_error({"mode": "gaussian"})
        assert "mode must be one of" in err

    def test_missing_mode(self) -> None:
        err = _expect_error({"value": 1.0})
        assert "mode" in err.lower()

    def test_not_a_dict(self) -> None:
        err = _expect_error("not-a-dict")
        assert "dict" in err.lower()

    # fixed mode
    def test_fixed_missing_value(self) -> None:
        err = _expect_error({"mode": "fixed"})
        assert "value" in err.lower()

    def test_fixed_negative_value(self) -> None:
        err = _expect_error({"mode": "fixed", "value": -1.0})
        assert "positive" in err.lower()

    def test_fixed_zero_value(self) -> None:
        err = _expect_error({"mode": "fixed", "value": 0})
        assert "positive" in err.lower()

    # normal mode
    def test_normal_missing_std(self) -> None:
        err = _expect_error({"mode": "normal", "mean": 1.0})
        assert "std" in err.lower()

    def test_normal_missing_mean(self) -> None:
        err = _expect_error({"mode": "normal", "std": 0.1})
        assert "mean" in err.lower()

    def test_normal_negative_mean(self) -> None:
        err = _expect_error({"mode": "normal", "mean": -1.0, "std": 0.1})
        assert "positive" in err.lower()

    def test_normal_zero_std(self) -> None:
        err = _expect_error({"mode": "normal", "mean": 1.0, "std": 0})
        assert "positive" in err.lower()

    def test_normal_negative_std(self) -> None:
        err = _expect_error({"mode": "normal", "mean": 1.0, "std": -0.1})
        assert "positive" in err.lower()

    # uniform mode
    def test_uniform_max_less_than_min(self) -> None:
        err = _expect_error({"mode": "uniform", "min": 10.0, "max": 5.0})
        assert "max > min" in err.lower()

    def test_uniform_max_equal_min(self) -> None:
        err = _expect_error({"mode": "uniform", "min": 10.0, "max": 10.0})
        assert "max > min" in err.lower()

    def test_uniform_negative_min(self) -> None:
        err = _expect_error({"mode": "uniform", "min": -1.0, "max": 5.0})
        assert "positive" in err.lower()

    def test_uniform_zero_min(self) -> None:
        err = _expect_error({"mode": "uniform", "min": 0, "max": 5.0})
        assert "positive" in err.lower()

    def test_uniform_missing_max(self) -> None:
        err = _expect_error({"mode": "uniform", "min": 1.0})
        assert "max" in err.lower()

    def test_uniform_missing_min(self) -> None:
        err = _expect_error({"mode": "uniform", "max": 5.0})
        assert "min" in err.lower()


# ── Representation (to_representation) ────────────────────────────────


class TestDistributionFieldRepresentation:
    def test_to_representation_passthrough(self) -> None:
        field = DistributionField()
        data = {"mode": "fixed", "value": 12.5}
        assert field.to_representation(data) == data

    def test_to_representation_none(self) -> None:
        field = DistributionField()
        assert field.to_representation(None) is None
