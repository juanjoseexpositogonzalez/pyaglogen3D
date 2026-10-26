"""The precedence this contract deliberately does NOT change.

Contract: openspec/changes/sintering-reaches-engine, T1.5 and T1.5a.

Six review rounds on this contract produced three undeclared precedence
inversions, each found only after fixing the previous one. None of the
four defects in scope needs a precedence change, so the cut removed it:
today's order is described, not changed, and the follow-up contract owns
the fix.

That makes these tests the guard on an *absence*: no delta scenario
backs them, on purpose. What they protect is that hardening the input
validation did not quietly reorder anything.

Two paths, with opposite outcomes, and both must stay as they are:

1. Through ``create_simulation``: any dict setting wins over any flat
   key, because ``views.py:1804`` pops ``sintering_config`` from the
   merged parameters and ``apply_sintering_config`` then overwrites the
   flat keys.
2. The sintering-extremes block (``views.py:1869-1906``): it runs only
   when a study dict exists, yet never calls ``apply_sintering_config``,
   so each child keeps the flat coefficient of its own extreme. A dict
   exists there and the flat key still wins.

Not covered here, and said so rather than implied: the ordering *among*
dicts (grid, then ``base_parameters``, then the study field) is decided
during grid expansion in ``perform_create``, not by either function
below, so it needs an API-level test. T1.5a asks for the two paths;
this is them.
"""

from __future__ import annotations

from typing import Any

from apps.simulations.utils import (
    SINTERING_EXTREMES,
    apply_sintering_config,
    generate_sintering_extreme_cases,
)

# --- Path 1: through create_simulation, the dict wins ---


def test_dict_still_overwrites_a_flat_coefficient() -> None:
    """``apply_sintering_config`` overwrites flat keys. Unchanged."""
    parameters = {"n_particles": 1000, "sintering_coeff": 0.6}
    result = apply_sintering_config(
        parameters, {"distribution_type": "fixed", "coefficient": 0.95}
    )
    assert result["sintering_coeff"] == 0.95, "the dict stopped winning on this path"


def test_no_dict_leaves_the_flat_coefficient_alone() -> None:
    """With nothing to apply, the flat value survives untouched."""
    parameters = {"n_particles": 1000, "sintering_coeff": 0.6}
    empties: tuple[dict[str, Any] | None, ...] = (None, {})
    for empty in empties:
        result = apply_sintering_config(dict(parameters), empty)
        assert result["sintering_coeff"] == 0.6, f"{empty!r} altered the flat value"


# --- Path 2: the extremes block, where the flat key wins ---


def test_extreme_children_keep_their_own_coefficient() -> None:
    """A study dict exists here, and the flat key still wins.

    This is the exemption that makes the sintering extremes mean what
    their names say. If it ever flips, four children per study start
    running at the study coefficient instead of their own extreme.
    """
    base: dict[str, Any] = {
        "n_particles": 1000,
        "sintering_config": {"distribution_type": "fixed", "coefficient": 0.7},
    }
    cases = generate_sintering_extreme_cases(base)

    expected = list(SINTERING_EXTREMES["coefficients"])
    assert [params["sintering_coeff"] for _, _, params in cases] == expected
    for _, _, params in cases:
        assert params["sintering_type"] == "fixed"
        assert params["sintering_coeff"] != 0.7, "the study dict took over the extreme"


# --- R7.1 and R7.2: the canonical scenarios restated verbatim (T1.7a) ---


def test_r7_1_old_grid_with_only_scalar_keys(db, project) -> None:  # type: ignore[no-untyped-def]
    """A grid that predates sintering must validate exactly as before."""
    from apps.simulations.serializers import ParametricStudySerializer

    serializer = ParametricStudySerializer(
        data={
            "project": str(project.id),
            "name": "Old study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"n_particles": [100, 200], "target_df": [1.8]},
        }
    )
    assert serializer.is_valid(), serializer.errors


def test_r7_2_study_without_any_sintering_remains_valid(db, project) -> None:  # type: ignore[no-untyped-def]
    """Historical studies carry no sintering at all and must stay valid."""
    from apps.simulations.serializers import ParametricStudySerializer

    serializer = ParametricStudySerializer(
        data={
            "project": str(project.id),
            "name": "Historical study",
            "base_algorithm": "tunable",
            "base_parameters": {"n_particles": 1000},
            "parameter_grid": {"target_df": [1.5, 2.0]},
            "limiting_cases_config": {"include_boundaries": True},
        }
    )
    assert serializer.is_valid(), serializer.errors
