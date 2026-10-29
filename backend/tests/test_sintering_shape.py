"""R3 — the sintering domain shape, on every input surface.

Contract: openspec/changes/sintering-reaches-engine, requirement R3.

Today a batch study carrying sintering is accepted and runs without
sintering, with no error at all. These tests pin the shape rules that
close that: the dict shape, the flat-scalar shape, and the seven input
surfaces where either can arrive.
"""

from typing import Any

import pytest

from apps.simulations.serializers import ParametricStudySerializer


def _study(**overrides: Any) -> dict[str, Any]:
    """A valid study payload, with the pieces under test overridden."""
    data = {
        "name": "Sintering shape study",
        "base_algorithm": "tunable",
        "base_parameters": {"n_particles": 1000},
        "parameter_grid": {"target_df": [1.5, 2.0]},
    }
    data.update(overrides)
    return data


def _is_valid(project: Any, **overrides: Any) -> tuple[bool, Any]:
    payload = _study(**overrides)
    payload["project"] = str(project.id)
    serializer = ParametricStudySerializer(data=payload)
    return serializer.is_valid(), serializer.errors


# --- R3.3 — the dict shape requires its fields, it does not invent them ---


@pytest.mark.parametrize(
    "config,why",
    [
        ({"distribution_type": "fixed"}, "fixed without coefficient"),
        ({"distribution_type": "uniform", "min": 0.8}, "uniform without max"),
        ({"distribution_type": "normal", "mean": 0.8}, "normal without std"),
        ({"coefficient": 0.9}, "no distribution_type at all"),
        ({"distribution_type": "gaussian", "mean": 0.8, "std": 0.05}, "unknown type"),
        (
            {"distribution_type": "fixed", "value": 0.9},
            "the payload the canonical documents: nothing reads `value`",
        ),
        (
            {"mode": "normal", "mean": 0.8, "std": 0.05},
            "D2: the shape the UI selector sends",
        ),
    ],
)
def test_r3_3_malformed_dict_is_rejected(db: Any, project: Any, config: Any, why: Any) -> None:
    """An incomplete or unrecognised dict MUST be rejected, never defaulted."""
    valid, errors = _is_valid(project, sintering_config=config)
    assert not valid, f"accepted {why}: {config}"
    assert "sintering_config" in str(errors).lower()


def test_r3_3_well_formed_dict_is_accepted(db: Any, project: Any) -> None:
    valid, errors = _is_valid(
        project, sintering_config={"distribution_type": "normal", "mean": 0.8, "std": 0.05}
    )
    assert valid, errors


# --- R3.5 — flat scalars in base_parameters (surface 4) ---


def test_r3_5_flat_coefficient_out_of_range_is_rejected(db: Any, project: Any) -> None:
    """D5b: `sintering_coeff` outside [0.5, 1.0] is accepted today."""
    valid, _ = _is_valid(
        project, base_parameters={"n_particles": 1000, "sintering_coeff": 42.0}
    )
    assert not valid, "accepted sintering_coeff=42.0 in base_parameters"


def test_r3_5_flat_coefficient_without_type_reads_as_fixed(db: Any, project: Any) -> None:
    """The batch form sends exactly this on every `limiting` submit."""
    valid, errors = _is_valid(
        project, base_parameters={"n_particles": 1000, "sintering_coeff": 0.8}
    )
    assert valid, errors


# --- R3.6 — swept flat scalars in parameter_grid (surface 5) ---


def test_r3_6_swept_flat_values_are_validated(db: Any, project: Any) -> None:
    """D5b: `parameter_grid={"sintering_coeff": [-5.0, 42.0]}` returns 201 today."""
    valid, _ = _is_valid(
        project, parameter_grid={"target_df": [1.5], "sintering_coeff": [-5.0, 42.0]}
    )
    assert not valid, "accepted a swept sintering_coeff of -5.0 and 42.0"


def test_r3_6_well_formed_sweep_is_accepted(db: Any, project: Any) -> None:
    valid, errors = _is_valid(
        project, parameter_grid={"target_df": [1.5], "sintering_coeff": [0.6, 0.9]}
    )
    assert valid, errors


# --- R3.7 — a flat key no consumer reads ---


@pytest.mark.parametrize(
    "where,payload",
    [
        ("base_parameters", {"n_particles": 1000, "sintering_mean": 0.9}),
        ("parameter_grid", {"target_df": [1.5], "sintering_mean": [0.9]}),
    ],
)
def test_r3_7_sintering_mean_is_rejected(db: Any, project: Any, where: Any, payload: Any) -> None:
    """`sintering_mean` is written by the helper and read by nobody."""
    valid, _ = _is_valid(project, **{where: payload})
    assert not valid, f"accepted sintering_mean in {where}"


def test_r3_7_unknown_flat_sintering_key_is_rejected(db: Any, project: Any) -> None:
    valid, _ = _is_valid(
        project, base_parameters={"n_particles": 1000, "sintering_factor": 0.9}
    )
    assert not valid, "accepted an unknown flat sintering_* key"


# --- R3.8 — incomplete flat shapes, on the merged projection ---


def test_r3_8_uniform_without_max_is_rejected(db: Any, project: Any) -> None:
    valid, _ = _is_valid(
        project,
        base_parameters={
            "n_particles": 1000,
            "sintering_type": "uniform",
            "sintering_min": 0.8,
        },
    )
    assert not valid, "accepted uniform with no sintering_max"


def test_r3_8_swept_value_completes_the_shape(db: Any, project: Any) -> None:
    """The rest of the shape may legitimately live in base_parameters."""
    valid, errors = _is_valid(
        project,
        base_parameters={
            "n_particles": 1000,
            "sintering_type": "uniform",
            "sintering_min": 0.8,
        },
        parameter_grid={"target_df": [1.5], "sintering_max": [0.9, 0.95]},
    )
    assert valid, errors


# --- R3.9 — theoretical_extremes (surfaces 6 and 7) ---


def test_r3_9_malformed_dict_swept_through_extremes_is_rejected(db: Any, project: Any) -> None:
    """Surface 7 reintroduces D2 whole: `{mode, …}` returns 201 today."""
    valid, _ = _is_valid(
        project,
        limiting_cases_config={
            "theoretical_extremes": {
                "sintering_config": [{"mode": "normal", "mean": 0.8, "std": 0.05}]
            }
        },
    )
    assert not valid, "accepted the {mode, ...} shape swept through theoretical_extremes"


def test_r3_9_well_formed_dict_swept_through_extremes_keeps_working(db: Any, project: Any) -> None:
    """It reaches the engine correctly today and MUST keep doing so."""
    valid, errors = _is_valid(
        project,
        limiting_cases_config={
            "theoretical_extremes": {
                "sintering_config": [
                    {"distribution_type": "fixed", "coefficient": 0.8}
                ]
            }
        },
    )
    assert valid, errors


def test_r3_9_flat_extreme_out_of_range_is_rejected(db: Any, project: Any) -> None:
    valid, _ = _is_valid(
        project,
        limiting_cases_config={"theoretical_extremes": {"sintering_coeff": [42.0]}},
    )
    assert not valid, "accepted sintering_coeff=42.0 in theoretical_extremes"


# --- R3.2 — the study field accepts "no sintering" ---


@pytest.mark.parametrize("empty", [None, {}])
def test_r3_2_study_field_accepts_empty(db: Any, project: Any, empty: Any) -> None:
    """Surfaces 2 and 3: this study configures no sintering."""
    valid, errors = _is_valid(project, sintering_config=empty)
    assert valid, errors
