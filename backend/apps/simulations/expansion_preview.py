"""Validate a study by expanding it, not by modelling the expansion.

R12 requires every sintering setting to be validated **before the first write**.
The first attempt did that with a second, parallel model of how children are
built, and three rounds of adversarial review found the same failure mode every
time: the model covered one shape of one surface and diverged from the real
generator somewhere else - the range-boundary children, the server-side default
extremes, the precedence of a dict over the flat keys.

So this module does not model anything. It runs the **same functions**
`perform_create` runs (`views.py:1750-1906`), in the same order, over the same
inputs, and hands back the parameter dicts the children would carry. Nothing is
written: `generate_limiting_cases`, `generate_sintering_extreme_cases` and
`apply_sintering_config` are pure, and the preview never touches the database or
the queue.

Two consequences worth stating. A malformed input that used to blow up *during*
expansion - after the study row existed and some tasks were already dispatched -
now blows up *here*, before anything is written, and becomes a 400. And the
precedence rules do not need restating: whatever `create_simulation` does to a
child's parameters is what the preview sees.

    What this does **not** do, after a round that proved the alternative worse:
    it does not invent children. A theoretical-extremes map supplied while
    `include_limiting_cases` is off produces no child, and projecting one
    anyway rejected valid studies - including maps that `include_theoretical:
    false` makes unreachable even with the flag on. The values on that surface
    are still range- and unknown-key-checked by `check_flat_keys` in the
    serializer; what is not required of them is the completeness of a child
    that will never exist.
"""

from __future__ import annotations

import itertools
from collections.abc import Mapping
from math import prod
from typing import Any

from .sintering_shape import check_flat_keys, check_flat_required
from .utils import (
    apply_sintering_config,
    generate_limiting_cases,
    generate_sintering_extreme_cases,
)


class ExpansionPreviewError(ValueError):
    """An input that would have broken the expansion after writing rows."""


class GridShapeError(ExpansionPreviewError):
    """A `parameter_grid` value that is not a list of values."""


#: `create_simulation` casts these before storing them (`views.py:1810-1815`).
INTEGER_PARAMS = ("n_particles",)


def _cast_integers(sim_params: dict[str, Any], *, guarded: bool) -> None:
    """Mirror the int() cast of the real path, including its asymmetry.

    `create_simulation` skips dicts (`views.py:1812-1814`); the inline
    sintering-extremes block does not (`views.py:1878-1880`). Both are
    reproduced, because a cast that raises here costs nothing, while the same
    cast raising during expansion costs a study row and its queued tasks.
    """
    for name in INTEGER_PARAMS:
        if name not in sim_params:
            continue
        if guarded and isinstance(sim_params[name], dict):
            continue
        sim_params[name] = int(sim_params[name])


def _as_child(params: Mapping[str, Any], study_sintering_config: Any) -> dict[str, Any]:
    """Apply what `create_simulation` applies (`views.py:1784-1815`)."""
    sim_params = dict(params)
    sim_params.pop("seed_type", None)

    combo_sintering = sim_params.pop("sintering_config", None)
    if combo_sintering is not None:
        sim_params = apply_sintering_config(sim_params, combo_sintering)
    else:
        sim_params = apply_sintering_config(sim_params, study_sintering_config)

    _cast_integers(sim_params, guarded=True)
    return sim_params


def preview_children(
    *,
    algorithm: str,
    base_parameters: Mapping[str, Any],
    parameter_grid: Mapping[str, Any],
    study_sintering_config: Any,
    include_limiting_cases: bool,
    limiting_cases_config: Any,
    max_children: int,
) -> list[dict[str, Any]]:
    """Return the parameters every child would carry, or raise.

    `max_children` keeps the preview bounded: a bigger expansion is the batch
    cap's rejection to make, and the cap needs only the product of the lengths.
    """
    param_names = list(parameter_grid.keys())
    param_values = [parameter_grid[name] for name in param_names]

    # Every grid value must be a list. Without this the preview measured the
    # `len()` of whatever it got - 3 for the string "1.5" - while the batch cap
    # counted only list values, so the two disagreed, the preview bailed out of
    # validating anything, and the cap let the request through: 1200 children,
    # all of them storing a shape the worker would not run.
    for name, values in zip(param_names, param_values, strict=True):
        if not isinstance(values, list):
            raise GridShapeError(
                f"parameter_grid['{name}'] must be a list of values, got "
                f"{type(values).__name__}"
            )

    projected = prod(len(values) for values in param_values) if param_values else 1
    if projected > max_children:
        # Returning nothing here used to leave the request unvalidated on the
        # premise that the batch cap would reject it anyway. The cap multiplies
        # by `seeds_per_combination`, so with zero seeds it accepted and the
        # study was created with nothing checked at all. Too big to validate is
        # itself a rejection, and it is never silent.
        raise ExpansionPreviewError(
            f"projected batch size ({projected}) exceeds the maximum "
            f"{max_children}, so this study cannot be validated before it is "
            "written"
        )

    children: list[dict[str, Any]] = []
    try:
        for combo in itertools.product(*param_values):
            params = dict(base_parameters)
            for index, name in enumerate(param_names):
                params[name] = combo[index]
            children.append(_as_child(params, study_sintering_config))

        if include_limiting_cases:
            limiting_cases = generate_limiting_cases(
                dict(base_parameters),
                dict(parameter_grid),
                algorithm,
                limiting_cases_config,
            )
            for _case_type, _description, params in limiting_cases:
                children.append(_as_child(params, study_sintering_config))

            if study_sintering_config:
                extreme_cases = generate_sintering_extreme_cases(dict(base_parameters))
                # This path deliberately does not apply the study's dict: each
                # child keeps the flat coefficient of its own extreme
                # (`views.py:1875-1880`).
                for _t, _d, params in extreme_cases:
                    extreme_child = dict(params)
                    _cast_integers(extreme_child, guarded=False)
                    children.append(extreme_child)
        if not children:
            # An empty sweep produces no child at all, so nothing above was
            # checked. The base projection is then the only shape the study
            # stores, and an incomplete one must not be stored. This sits
            # inside the try on purpose: its first version did not, and
            # reintroduced the very 500 that removing the previous branch was
            # meant to close.
            children.append(_as_child(dict(base_parameters), study_sintering_config))
    except ValueError:
        raise
    except (TypeError, AttributeError, KeyError, IndexError) as exc:
        raise ExpansionPreviewError(
            f"this study cannot be expanded as configured: {exc}"
        ) from exc


    return children


def check_children(children: list[dict[str, Any]]) -> None:
    """Every child must carry a sintering shape the worker can run."""
    for child in children:
        sintering = {
            key: value for key, value in child.items() if key.startswith("sintering_")
        }
        if not sintering:
            continue
        check_flat_keys(child, swept=False)
        check_flat_required(child)
