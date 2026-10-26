"""R3.10 and R7.3 — the helper invents no default.

Contract: openspec/changes/sintering-reaches-engine, T2.

``apply_sintering_config`` used to fill in whatever the caller omitted:
``distribution_type`` became ``fixed``, ``coefficient`` became ``1.0``,
``min``/``max`` became ``0.85``/``0.95``, ``mean``/``std`` became
``0.9``/``0.05``. That is the defect in its codified form: an incomplete
setting silently became a valid-looking one, and ``fixed``/``1.0`` means
*no sintering at all*.

The serializer now rejects those shapes before anything is written (R3),
so the helper should never see one. It raises anyway: reaching it with a
malformed dict is a programming error, not user input, and it must fail
loudly rather than invent physics.
"""

from __future__ import annotations

from typing import Any

import pytest

from apps.simulations.utils import apply_sintering_config

# --- R3.10 — the helper raises instead of filling in ---


@pytest.mark.parametrize(
    "config,why",
    [
        ({"distribution_type": "uniform"}, "uniform with no min/max"),
        ({"distribution_type": "fixed"}, "fixed with no coefficient"),
        ({"distribution_type": "normal"}, "normal with no mean/std"),
        ({"distribution_type": "normal", "mean": 0.8}, "normal with no std"),
        ({"coefficient": 0.9}, "no distribution_type at all"),
        ({"distribution_type": "gaussian", "mean": 0.8, "std": 0.05}, "unknown type"),
    ],
)
def test_r3_10_helper_raises_instead_of_defaulting(
    config: dict[str, Any], why: str
) -> None:
    with pytest.raises(ValueError):
        apply_sintering_config({"n_particles": 1000}, config)


def test_r3_10_out_of_range_also_raises() -> None:
    with pytest.raises(ValueError):
        apply_sintering_config(
            {"n_particles": 1000}, {"distribution_type": "fixed", "coefficient": 42.0}
        )


# --- R7.3 — the carve-out is explicit ---


def test_r7_3_the_value_payload_is_not_grandfathered() -> None:
    """The payload the canonical documents. Nothing reads ``value``."""
    with pytest.raises(ValueError):
        apply_sintering_config(
            {"n_particles": 1000}, {"distribution_type": "fixed", "value": 0.9}
        )


def test_r7_3_the_ui_selector_shape_is_not_grandfathered() -> None:
    """D2: the shape the batch form actually sends."""
    with pytest.raises(ValueError):
        apply_sintering_config(
            {"n_particles": 1000}, {"mode": "normal", "mean": 0.8, "std": 0.05}
        )


# --- Well-formed settings still work, unchanged ---


def test_well_formed_fixed_still_applies() -> None:
    result = apply_sintering_config(
        {"n_particles": 1000}, {"distribution_type": "fixed", "coefficient": 0.9}
    )
    assert result["sintering_type"] == "fixed"
    assert result["sintering_coeff"] == 0.9


def test_well_formed_uniform_still_applies() -> None:
    result = apply_sintering_config(
        {"n_particles": 1000},
        {"distribution_type": "uniform", "min": 0.8, "max": 0.9},
    )
    assert result["sintering_min"] == 0.8
    assert result["sintering_max"] == 0.9


# --- T2.4 — the declared regression, restated here so it is not lost ---


def test_none_and_empty_still_return_parameters_untouched() -> None:
    parameters = {"n_particles": 1000, "sintering_coeff": 0.6}
    empties: tuple[dict[str, Any] | None, ...] = (None, {})
    for empty in empties:
        assert apply_sintering_config(dict(parameters), empty) == parameters
