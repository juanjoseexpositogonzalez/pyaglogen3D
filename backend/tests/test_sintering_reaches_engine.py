"""R11 — sintering reaches the engine, and only where it is consumed.

Contract: openspec/changes/sintering-reaches-engine, T3.

Two defects, one requirement.

D5: a study configured as ``normal`` runs with no sintering at all. The
helper writes ``sintering_mean``, which no production consumer reads,
while the engine takes ``sintering_coeff`` as the mean
(``lib.rs:602``). The declared mean never arrives, and
``sintering_coeff`` keeps whatever it had - by default 1.0, which means
*no sintering*. The study's stored parameters claim one thing and the
physics does another.

R11.7: the sintering-extremes children copy ``base_parameters`` whole
(``utils.py:228``) while the ``sintering_config`` pop lives only in
``create_simulation`` (``views.py:1804``). So a study using surface 3
produces children that store a ``sintering_config`` contradicting the
coefficient they run at: with ``coefficient: 0.7`` in base, the child
runs the ``0.5`` extreme and stores ``0.7``. The engine ignores that
dict, so the physics is right - but the stored parameters do not
describe what ran, which is what this contract exists to close.
"""

from __future__ import annotations

from typing import Any

from apps.simulations.sintering_shape import FLAT_KEYS
from apps.simulations.utils import (
    SINTERING_EXTREMES,
    apply_sintering_config,
    generate_sintering_extreme_cases,
)

# --- R11.1 / D5 — the normal mean travels in the key the engine reads ---


def test_r11_1_normal_mean_travels_in_sintering_coeff() -> None:
    result = apply_sintering_config(
        {"n_particles": 1000},
        {"distribution_type": "normal", "mean": 0.8, "std": 0.05},
    )
    assert result["sintering_coeff"] == 0.8, (
        "the declared mean never reached the engine"
    )
    assert result["sintering_std"] == 0.05
    assert result["sintering_type"] == "normal"


def test_r11_1_sintering_mean_is_never_written() -> None:
    """The key the helper used to write, and nothing reads."""
    result = apply_sintering_config(
        {"n_particles": 1000},
        {"distribution_type": "normal", "mean": 0.8, "std": 0.05},
    )
    assert "sintering_mean" not in result


# --- R11.3 — no sintering key outside the set the worker reads ---


def test_r11_3_only_keys_the_worker_reads_are_written() -> None:
    configs: tuple[dict[str, Any], ...] = (
        {"distribution_type": "fixed", "coefficient": 0.9},
        {"distribution_type": "uniform", "min": 0.8, "max": 0.9},
        {"distribution_type": "normal", "mean": 0.8, "std": 0.05},
    )
    for config in configs:
        result = apply_sintering_config({"n_particles": 1000}, config)
        written = {k for k in result if k.startswith("sintering")}
        assert written <= FLAT_KEYS, f"{config} wrote {written - FLAT_KEYS}"


# --- R11.7 — extreme children carry no sintering_config ---


def test_r11_7_extreme_children_do_not_store_the_inherited_dict() -> None:
    base: dict[str, Any] = {
        "n_particles": 1000,
        "sintering_config": {"distribution_type": "fixed", "coefficient": 0.7},
    }
    cases = generate_sintering_extreme_cases(base)

    for _, _, params in cases:
        assert "sintering_config" not in params, (
            "the child stores a dict that contradicts the coefficient it runs at"
        )


def test_r11_7_extreme_children_keep_their_own_coefficient() -> None:
    """The second AND of R11.7: removing the dict must not disturb this."""
    base: dict[str, Any] = {
        "n_particles": 1000,
        "sintering_config": {"distribution_type": "fixed", "coefficient": 0.7},
    }
    cases = generate_sintering_extreme_cases(base)

    expected = list(SINTERING_EXTREMES["coefficients"])
    assert [params["sintering_coeff"] for _, _, params in cases] == expected


def test_r11_7_the_rest_of_base_parameters_survives() -> None:
    """T3.0d: only the dict goes. Flat inherited keys stay."""
    base: dict[str, Any] = {
        "n_particles": 1000,
        "seed_type": "monomers",
        "sintering_std": 0.05,
        "sintering_config": {"distribution_type": "fixed", "coefficient": 0.7},
    }
    cases = generate_sintering_extreme_cases(base)

    for _, _, params in cases:
        assert params["n_particles"] == 1000
        assert params["seed_type"] == "monomers"
        assert params["sintering_std"] == 0.05
