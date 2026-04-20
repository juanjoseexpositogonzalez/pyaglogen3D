"""Parameter schema shim for simulation parameters.

This module is the **single source of truth** for resolving the primary-particle
diameter (in nanometres) from a stored simulation's ``parameters`` JSON blob,
regardless of whether it was persisted under the legacy v1 schema or the
current v2 schema.

Why this exists
---------------
- The Rust engine computes Radius of Gyration (Rg) as a **dimensionless**
  scalar. Every read boundary (CSV export, UI display) must multiply that value
  by ``primary_particle_diameter_nm / 2`` to obtain the nm-scaled Rg.
- Legacy simulations (v1) persisted ``primary_particle_radius_nm`` and had no
  explicit schema version. New simulations (v2) persist
  ``primary_particle_diameter_nm`` and stamp ``parameters_schema_version="v2"``.
- Downstream callers MUST NOT branch on schema version themselves: they call
  :func:`get_scale_factor_nm` / :func:`get_primary_particle_diameter_nm` and
  stay schema-agnostic.

Fallback order for :func:`get_primary_particle_diameter_nm`
-----------------------------------------------------------
1. ``params["primary_particle_diameter_nm"]`` — v2 key, used when the value is
   a positive finite number.
2. ``params["primary_particle_radius_nm"] * 2`` — v1 key, used when v2 is
   missing / zero / NaN / Inf and the radius is a positive finite number.
3. :data:`DEFAULT_DIAMETER_NM` — preserves the historical default for ancient
   rows that carry neither key.

Non-dict input (``None``, lists, etc.), missing keys, non-numeric values,
``NaN``, ``Infinity``, zero, and negatives all fall through to the next step.

Parity
------
The TypeScript shim at ``frontend/src/lib/units.ts`` mirrors this module
byte-for-byte in fallback order and default values. If you change the rules
here, update the TS shim in the same commit or CSV and UI values will diverge.
"""

from __future__ import annotations

import math
from typing import Any

# --- Public constants --------------------------------------------------------

PARAM_KEY_DIAMETER: str = "primary_particle_diameter_nm"
"""v2 parameters key — primary particle diameter in nm."""

PARAM_KEY_RADIUS_LEGACY: str = "primary_particle_radius_nm"
"""v1 (legacy) parameters key — primary particle radius in nm."""

PARAM_KEY_SCHEMA_VERSION: str = "parameters_schema_version"
"""Parameters key that stamps the schema version (``"v2"`` for new writes)."""

DEFAULT_DIAMETER_NM: float = 50.0
"""Historical default diameter in nm (preserves the legacy radius=25 behaviour)."""

SCHEMA_VERSION_CURRENT: str = "v2"
"""Schema version stamped on all new writes."""


# --- Internal helpers --------------------------------------------------------


def _coerce_positive_finite(value: Any) -> float | None:
    """Return ``value`` as a positive finite float, or ``None`` otherwise.

    Rejects ``None``, non-numeric, booleans disguised as ints (we accept ints
    but not ``bool`` to avoid ``True``->1.0 surprises), ``NaN``, ``Infinity``,
    zero, and negatives.
    """
    # Reject bool explicitly: ``isinstance(True, int)`` is True in Python.
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    f = float(value)
    if not math.isfinite(f):
        return None
    if f <= 0.0:
        return None
    return f


def _as_params_dict(params: Any) -> dict[str, Any] | None:
    """Return ``params`` if it's a mapping, else ``None``."""
    if isinstance(params, dict):
        return params
    return None


# --- Public API --------------------------------------------------------------


def get_primary_particle_diameter_nm(params: dict[str, Any] | None) -> float:
    """Resolve primary particle diameter in nm from v2 or v1 schema.

    Fallback order:

    1. ``params[PARAM_KEY_DIAMETER]`` if it is a positive finite number (v2).
    2. ``params[PARAM_KEY_RADIUS_LEGACY] * 2`` if the radius is a positive
       finite number (v1).
    3. :data:`DEFAULT_DIAMETER_NM` (50.0).

    Args:
        params: The simulation's stored ``parameters`` JSON blob. ``None`` or
            any non-dict input is treated as "no params available" and falls
            through to the default.

    Returns:
        The diameter in nm as a float, always positive and finite.
    """
    p = _as_params_dict(params)
    if p is None:
        return DEFAULT_DIAMETER_NM

    # Step 1: v2 key.
    dpo = _coerce_positive_finite(p.get(PARAM_KEY_DIAMETER))
    if dpo is not None:
        return dpo

    # Step 2: v1 legacy radius × 2.
    radius = _coerce_positive_finite(p.get(PARAM_KEY_RADIUS_LEGACY))
    if radius is not None:
        return radius * 2.0

    # Step 3: historical default.
    return DEFAULT_DIAMETER_NM


def get_scale_factor_nm(params: dict[str, Any] | None) -> float:
    """Return the nm-scale factor for Rg display/export: ``diameter / 2``.

    This is the single source of truth for the scale applied at every read
    boundary (CSV export, UI cells, chart axes). Multiply the dimensionless
    engine Rg by this value to obtain Rg in nm.
    """
    return get_primary_particle_diameter_nm(params) / 2.0


def get_schema_version(params: dict[str, Any] | None) -> str | None:
    """Detect the parameters schema version.

    Resolution rules:

    - Explicit ``params[PARAM_KEY_SCHEMA_VERSION] == "v2"`` → ``"v2"``.
    - Explicit ``params[PARAM_KEY_SCHEMA_VERSION] == "v1"`` → ``"v1"``.
    - Otherwise, infer from keys:
        * ``PARAM_KEY_DIAMETER`` present → ``"v2"``.
        * ``PARAM_KEY_DIAMETER`` absent and ``PARAM_KEY_RADIUS_LEGACY`` present
          → ``"v1"``.
        * Neither key present and no explicit version → ``None`` (ambiguous).

    Args:
        params: The simulation's stored ``parameters`` JSON blob. ``None`` or
            any non-dict input returns ``None``.

    Returns:
        ``"v2"``, ``"v1"``, or ``None`` when the schema cannot be determined.
    """
    p = _as_params_dict(params)
    if p is None:
        return None

    explicit = p.get(PARAM_KEY_SCHEMA_VERSION)
    if explicit == "v2":
        return "v2"
    if explicit == "v1":
        return "v1"

    # Inference from key presence.
    if PARAM_KEY_DIAMETER in p:
        return "v2"
    if PARAM_KEY_RADIUS_LEGACY in p:
        return "v1"

    return None


__all__ = [
    "PARAM_KEY_DIAMETER",
    "PARAM_KEY_RADIUS_LEGACY",
    "PARAM_KEY_SCHEMA_VERSION",
    "DEFAULT_DIAMETER_NM",
    "SCHEMA_VERSION_CURRENT",
    "get_primary_particle_diameter_nm",
    "get_scale_factor_nm",
    "get_schema_version",
]
