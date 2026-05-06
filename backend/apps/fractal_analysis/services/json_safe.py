"""JSON-safe float sanitization.

JSON RFC 8259 forbids non-finite floats (NaN, +Infinity, -Infinity).
Python and Postgres accept them silently as ``float`` / ``double precision``,
but DRF's JSON renderer (which sets ``allow_nan=False``) crashes with
``ValueError: Out of range float values are not JSON compliant``.

This module provides a single helper used at every serialization site
that surfaces ``FraktalBatchImage`` or ``BatchImageResult`` float fields.
"""

from __future__ import annotations

import math


def json_safe_float(v):
    """Return ``None`` when *v* is NaN / +Inf / -Inf, else *v* unchanged.

    Use at every serialization site that surfaces FraktalBatchImage or
    engine-result floats: ``bisection_residual``, ``df_estimate``,
    ``fractal_dimension``, ``prefactor``, ``r_squared``, ``rg_nm``.

    Also used at persist time (defense-in-depth) so the DB never stores
    non-finite floats in the first place.
    """
    if v is None:
        return None
    try:
        if math.isnan(v) or math.isinf(v):
            return None
    except TypeError:
        # Not a float-like type (e.g. str, Decimal). Pass through.
        return v
    return v
