"""Unit tests for the parameter shim (``apps.simulations.services.params``).

These tests are **pure Python** — no Django ORM, no database. They lock in the
fallback order and edge-case behaviour that the TypeScript shim at
``frontend/src/lib/units.ts`` must mirror byte-for-byte.
"""

from __future__ import annotations

import math

import pytest

from apps.simulations.services.params import (
    DEFAULT_DIAMETER_NM,
    PARAM_KEY_DIAMETER,
    PARAM_KEY_RADIUS_LEGACY,
    PARAM_KEY_SCHEMA_VERSION,
    SCHEMA_VERSION_CURRENT,
    get_primary_particle_diameter_nm,
    get_scale_factor_nm,
    get_schema_version,
)


# ---------------------------------------------------------------------------
# get_primary_particle_diameter_nm — fallback order
# ---------------------------------------------------------------------------


def test_get_diameter_v2_present() -> None:
    """v2 key present with a positive number returns that value."""
    assert get_primary_particle_diameter_nm({PARAM_KEY_DIAMETER: 30.0}) == 30.0


def test_get_diameter_only_legacy_radius() -> None:
    """Only v1 legacy radius present: returns radius * 2."""
    assert get_primary_particle_diameter_nm({PARAM_KEY_RADIUS_LEGACY: 15.0}) == 30.0


def test_get_diameter_neither_present() -> None:
    """Empty dict falls through to the historical default."""
    assert get_primary_particle_diameter_nm({}) == DEFAULT_DIAMETER_NM
    assert DEFAULT_DIAMETER_NM == 50.0  # guard against silent default change


def test_get_diameter_both_present_v2_wins() -> None:
    """When both keys are present, v2 takes precedence."""
    params = {PARAM_KEY_DIAMETER: 30.0, PARAM_KEY_RADIUS_LEGACY: 15.0}
    assert get_primary_particle_diameter_nm(params) == 30.0


def test_get_diameter_v1_zero_falls_through() -> None:
    """v1 radius of 0 is non-positive: fall through to default."""
    assert (
        get_primary_particle_diameter_nm({PARAM_KEY_RADIUS_LEGACY: 0})
        == DEFAULT_DIAMETER_NM
    )


def test_get_diameter_v1_negative_falls_through() -> None:
    """Negative v1 radius: fall through to default."""
    assert (
        get_primary_particle_diameter_nm({PARAM_KEY_RADIUS_LEGACY: -5.0})
        == DEFAULT_DIAMETER_NM
    )


def test_get_diameter_v2_zero_falls_to_v1() -> None:
    """v2 = 0 is invalid; fall through to v1 when v1 is positive."""
    params = {PARAM_KEY_DIAMETER: 0, PARAM_KEY_RADIUS_LEGACY: 10.0}
    assert get_primary_particle_diameter_nm(params) == 20.0


def test_get_diameter_v2_negative_falls_to_v1() -> None:
    """Negative v2 is invalid; fall through to v1 when v1 is positive."""
    params = {PARAM_KEY_DIAMETER: -7.0, PARAM_KEY_RADIUS_LEGACY: 12.0}
    assert get_primary_particle_diameter_nm(params) == 24.0


def test_get_diameter_none_params() -> None:
    """``None`` input is handled gracefully."""
    assert get_primary_particle_diameter_nm(None) == DEFAULT_DIAMETER_NM


def test_get_diameter_non_dict_params() -> None:
    """Non-dict inputs (list, string, int) fall through to the default."""
    # Ignore type for the test — we explicitly want to exercise the guard.
    assert get_primary_particle_diameter_nm([]) == DEFAULT_DIAMETER_NM  # type: ignore[arg-type]
    assert get_primary_particle_diameter_nm("not a dict") == DEFAULT_DIAMETER_NM  # type: ignore[arg-type]
    assert get_primary_particle_diameter_nm(42) == DEFAULT_DIAMETER_NM  # type: ignore[arg-type]


def test_get_diameter_nan_falls_through() -> None:
    """NaN in v2 is invalid; fall through to v1."""
    params = {PARAM_KEY_DIAMETER: float("nan"), PARAM_KEY_RADIUS_LEGACY: 10.0}
    assert get_primary_particle_diameter_nm(params) == 20.0


def test_get_diameter_infinity_falls_through() -> None:
    """Positive infinity in v2 is not finite; fall through to v1."""
    params = {PARAM_KEY_DIAMETER: math.inf, PARAM_KEY_RADIUS_LEGACY: 11.0}
    assert get_primary_particle_diameter_nm(params) == 22.0


def test_get_diameter_string_number_falls_through() -> None:
    """Numeric strings are not accepted (strict types): fall through."""
    params = {PARAM_KEY_DIAMETER: "30", PARAM_KEY_RADIUS_LEGACY: 8.0}
    # v2 rejected (string), v1 accepted.
    assert get_primary_particle_diameter_nm(params) == 16.0


def test_get_diameter_v2_integer_is_accepted() -> None:
    """Python ints should be accepted as valid positive finite numbers."""
    assert get_primary_particle_diameter_nm({PARAM_KEY_DIAMETER: 25}) == 25.0


# ---------------------------------------------------------------------------
# get_scale_factor_nm
# ---------------------------------------------------------------------------


def test_get_scale_factor_is_diameter_halved() -> None:
    """scale = diameter / 2 for the v2 path."""
    assert get_scale_factor_nm({PARAM_KEY_DIAMETER: 30.0}) == 15.0


def test_get_scale_factor_from_legacy_radius() -> None:
    """For v1 input, scale = (radius * 2) / 2 == radius."""
    assert get_scale_factor_nm({PARAM_KEY_RADIUS_LEGACY: 12.5}) == 12.5


def test_get_scale_factor_default() -> None:
    """Empty params: scale = DEFAULT_DIAMETER_NM / 2."""
    assert get_scale_factor_nm({}) == DEFAULT_DIAMETER_NM / 2.0


# ---------------------------------------------------------------------------
# get_schema_version
# ---------------------------------------------------------------------------


def test_get_schema_version_v2_explicit() -> None:
    """Explicit ``parameters_schema_version="v2"`` → ``"v2"``."""
    assert (
        get_schema_version({PARAM_KEY_SCHEMA_VERSION: SCHEMA_VERSION_CURRENT}) == "v2"
    )


def test_get_schema_version_v1_explicit() -> None:
    """Explicit ``parameters_schema_version="v1"`` → ``"v1"``."""
    assert get_schema_version({PARAM_KEY_SCHEMA_VERSION: "v1"}) == "v1"


def test_get_schema_version_inferred_v2_from_dpo() -> None:
    """No explicit version but v2 key present → infer ``"v2"``."""
    assert get_schema_version({PARAM_KEY_DIAMETER: 30.0}) == "v2"


def test_get_schema_version_inferred_v1_from_legacy_radius() -> None:
    """No explicit version, only legacy radius key → infer ``"v1"``."""
    assert get_schema_version({PARAM_KEY_RADIUS_LEGACY: 15.0}) == "v1"


def test_get_schema_version_none_for_ambiguous() -> None:
    """Neither key and no explicit version → ambiguous, return ``None``."""
    assert get_schema_version({}) is None
    assert get_schema_version({"unrelated_key": 123}) is None


def test_get_schema_version_explicit_overrides_inference() -> None:
    """Explicit version wins even if keys would suggest a different one."""
    # Shouldn't happen in practice, but documents the precedence rule.
    assert (
        get_schema_version({PARAM_KEY_SCHEMA_VERSION: "v1", PARAM_KEY_DIAMETER: 30.0})
        == "v1"
    )


def test_get_schema_version_none_input() -> None:
    """``None`` / non-dict input returns ``None``."""
    assert get_schema_version(None) is None
    assert get_schema_version([]) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Module surface — constants are stable and public
# ---------------------------------------------------------------------------


def test_public_constants_are_stable() -> None:
    """Lock the constant values to catch accidental renames."""
    assert PARAM_KEY_DIAMETER == "primary_particle_diameter_nm"
    assert PARAM_KEY_RADIUS_LEGACY == "primary_particle_radius_nm"
    assert PARAM_KEY_SCHEMA_VERSION == "parameters_schema_version"
    assert SCHEMA_VERSION_CURRENT == "v2"
    assert DEFAULT_DIAMETER_NM == 50.0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
