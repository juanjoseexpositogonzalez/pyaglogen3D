"""The sintering domain shape, in one place.

Contract: openspec/changes/sintering-reaches-engine, requirement R3.

Sintering reaches a child by seven user-controlled paths, in two shapes:
a `sintering_config` dict, and the flat `sintering_*` scalars the worker
actually reads (`tasks.py:1592-1598`). Both are validated here so a bad
setting produces a useful 400 **before anything is written** (R12),
instead of a study that runs with no sintering and no error.

These functions raise `ValueError`; the serializer turns that into a
`ValidationError` for the field that carries the offending value.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from itertools import product
from typing import Any

#: The flat keys the worker reads. Anything else is rejected, in
#: particular `sintering_mean`, which nothing reads.
FLAT_KEYS = frozenset(
    {
        "sintering_type",
        "sintering_coeff",
        "sintering_min",
        "sintering_max",
        "sintering_std",
    }
)

DISTRIBUTION_TYPES = frozenset({"fixed", "uniform", "normal"})

#: Algorithms whose engine invocation receives the full sintering set (R11).
SINTERING_ALGORITHMS = frozenset(
    {"dla", "cca", "ballistic", "ballistic_cc", "tunable", "tunable_cc"}
)

#: `limiting` reads `sintering_coeff` (`tasks.py:1800`) and ignores type, min,
#: max and std, so it accepts the fixed shape only.
FIXED_ONLY_ALGORITHMS = frozenset({"limiting"})

#: These consume no sintering at all. Declaring it for them would store
#: parameters that do not describe what ran.
NO_SINTERING_ALGORITHMS = frozenset({"fracval", "gcca", "box_rfa", "imported"})

#: Required dict fields per distribution type.
_DICT_REQUIRED: dict[str, tuple[str, ...]] = {
    "fixed": ("coefficient",),
    "uniform": ("min", "max"),
    "normal": ("mean", "std"),
}

_DICT_ALLOWED = frozenset(
    {"distribution_type", "coefficient", "min", "max", "mean", "std"}
)

#: Required flat keys per `sintering_type`. An absent type reads as `fixed`.
_FLAT_REQUIRED: dict[str, tuple[str, ...]] = {
    "fixed": ("sintering_coeff",),
    "uniform": ("sintering_min", "sintering_max"),
    "normal": ("sintering_coeff", "sintering_std"),
}

_COEFFICIENT_RANGE = (0.5, 1.0)
_STD_MAX = 0.2


def _as_number(name: str, value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number, got {value!r}")
    return float(value)


def _check_range(name: str, value: Any) -> None:
    number = _as_number(name, value)
    low, high = _COEFFICIENT_RANGE
    if not (low <= number <= high):
        raise ValueError(f"{name} must be between {low} and {high}, got {number}")


def _check_std(name: str, value: Any) -> None:
    number = _as_number(name, value)
    if not (0.0 < number <= _STD_MAX):
        raise ValueError(
            f"{name} must be greater than 0 and at most {_STD_MAX}, got {number}"
        )


def validate_dict_shape(config: Any, *, allow_empty: bool) -> None:
    """Validate one `sintering_config` dict.

    `allow_empty` is the difference between the two calling contexts: as
    the study field or inside `base_parameters`, `None` and `{}` mean
    "this study configures no sintering"; as a grid entry they are a
    setting that says nothing, and are rejected.
    """
    if config is None or config == {}:
        if allow_empty:
            return
        raise ValueError(
            "a sintering_config entry must describe a setting, not be empty"
        )

    if not isinstance(config, Mapping):
        raise ValueError(
            f"sintering_config must be an object, got {type(config).__name__}"
        )

    unknown = sorted(set(config) - _DICT_ALLOWED)
    if unknown:
        raise ValueError(
            f"unknown sintering_config keys: {', '.join(unknown)}. "
            f"Allowed: {', '.join(sorted(_DICT_ALLOWED))}"
        )

    if "distribution_type" not in config:
        raise ValueError("sintering_config requires distribution_type")

    dist_type = config["distribution_type"]
    if dist_type not in DISTRIBUTION_TYPES:
        raise ValueError(
            f"distribution_type must be one of: {', '.join(sorted(DISTRIBUTION_TYPES))}"
        )

    missing = [field for field in _DICT_REQUIRED[dist_type] if field not in config]
    if missing:
        raise ValueError(
            f"sintering_config with distribution_type '{dist_type}' "
            f"requires: {', '.join(missing)}"
        )

    if dist_type == "fixed":
        _check_range("coefficient", config["coefficient"])
    elif dist_type == "uniform":
        _check_range("min", config["min"])
        _check_range("max", config["max"])
        if _as_number("min", config["min"]) > _as_number("max", config["max"]):
            raise ValueError("min must be less than or equal to max")
    else:
        _check_range("mean", config["mean"])
        _check_std("std", config["std"])


def check_flat_keys(parameters: Mapping[str, Any], *, swept: bool) -> None:
    """Range and unknown-key checks, per key, where the key is written.

    `swept` says the values arrive as lists, one child per element.
    """
    for key, value in parameters.items():
        if not key.startswith("sintering_"):
            continue
        if key == "sintering_config":
            continue
        if key not in FLAT_KEYS:
            raise ValueError(
                f"unknown sintering key '{key}'. The worker reads only: "
                f"{', '.join(sorted(FLAT_KEYS))}"
            )
        if swept and not isinstance(value, list):
            raise ValueError(
                f"sintering key '{key}' is swept here, so it must be a list, got "
                f"{type(value).__name__}. A bare value passed validation and then "
                "broke the expansion once the study row already existed"
            )
        values: Iterable[Any] = value if swept and isinstance(value, list) else [value]
        for item in values:
            if key == "sintering_type":
                if item not in DISTRIBUTION_TYPES:
                    raise ValueError(
                        f"sintering_type must be one of: "
                        f"{', '.join(sorted(DISTRIBUTION_TYPES))}"
                    )
            elif key == "sintering_std":
                _check_std(key, item)
            else:
                _check_range(key, item)


def check_flat_required(merged: Mapping[str, Any]) -> None:
    """Required-key check over a child's merged projection.

    The rest of the shape may legitimately live in `base_parameters`,
    so this runs over base plus every swept key, not over one surface.
    """
    present = {key for key in merged if key in FLAT_KEYS}
    if not present:
        return  # absent means no sintering

    sintering_type = merged.get("sintering_type", "fixed")
    if sintering_type not in DISTRIBUTION_TYPES:
        raise ValueError(
            f"sintering_type must be one of: {', '.join(sorted(DISTRIBUTION_TYPES))}"
        )

    missing = [key for key in _FLAT_REQUIRED[sintering_type] if key not in merged]
    if missing:
        raise ValueError(
            f"sintering_type '{sintering_type}' requires: {', '.join(missing)}"
        )

    if sintering_type == "uniform":
        low = _as_number("sintering_min", merged["sintering_min"])
        high = _as_number("sintering_max", merged["sintering_max"])
        if low > high:
            raise ValueError(
                "sintering_min must be less than or equal to sintering_max"
            )


def check_algorithm_scope(
    algorithm: str | None,
    *,
    dicts: Iterable[Any],
    flats: Iterable[Mapping[str, Any]],
) -> None:
    """Allow-list by algorithm, over every surface at once (R11, R11.4-R11.6).

    `dicts` are the `sintering_config` settings found on any surface and
    `flats` the mappings that may carry flat `sintering_*` keys. The caller
    passes the algorithm to evaluate against: on a partial update that omits
    `base_algorithm`, that is the instance's stored one (R11.6).
    """
    settings: list[Any] = []
    for config in dicts:
        if not config:
            continue
        if isinstance(config, list):
            settings.extend(entry for entry in config if entry)
        else:
            settings.append(config)
    flat_keys = sorted(
        {key for mapping in flats for key in mapping if key in FLAT_KEYS}
    )
    if not settings and not flat_keys:
        return  # absent means no sintering: nothing to scope

    if algorithm in NO_SINTERING_ALGORITHMS:
        raise ValueError(
            f"algorithm '{algorithm}' does not consume sintering, so it must not "
            "be configured for it"
        )

    if algorithm in FIXED_ONLY_ALGORITHMS:
        for config in settings:
            if not isinstance(config, Mapping):
                continue
            if config.get("distribution_type") != "fixed":
                raise ValueError(
                    f"algorithm '{algorithm}' accepts the fixed sintering shape "
                    f"only, got '{config.get('distribution_type')}'"
                )
        for mapping in flats:
            for value in _swept_values(mapping.get("sintering_type")):
                if value != "fixed":
                    raise ValueError(
                        f"algorithm '{algorithm}' accepts the fixed sintering "
                        f"shape only, got sintering_type '{value}'"
                    )
            shape_only = sorted(
                key
                for key in mapping
                if key in {"sintering_min", "sintering_max", "sintering_std"}
            )
            if shape_only:
                raise ValueError(
                    f"algorithm '{algorithm}' ignores {', '.join(shape_only)}: it "
                    "accepts the fixed sintering shape only"
                )
        return

    if algorithm not in SINTERING_ALGORITHMS:
        raise ValueError(f"unknown algorithm '{algorithm}' for a sintering setting")


def _swept_values(value: Any) -> list[Any]:
    """One value or the elements of a swept list."""
    if value is None:
        return []
    return list(value) if isinstance(value, list) else [value]
def check_flat_required_over_sweeps(
    base_parameters: Mapping[str, Any],
    *,
    grid: Mapping[str, Any],
    extremes: Mapping[str, Any],
) -> None:
    """Required-key check on every child a sweep produces, not just the first.

    R3 puts the required-key check on the child's **merged projection**, and a
    sweep emits one child per element. Reading only the first element let
    `{sintering_type: ["fixed", "uniform"], sintering_coeff: [0.6]}` through:
    the second child was stored as `uniform` with no min/max, and the worker
    ran it as uniform 0.85-0.95 (`tasks.py:1596-1598`) - stored parameters
    that do not describe what ran.

    The two surfaces expand differently, so they are projected differently:
    the grid is a cartesian product (`views.py:1777`), while a theoretical
    extreme emits one child per key/value pair (`utils.py:199-203`).
    """
    base = {key: value for key, value in base_parameters.items() if key in FLAT_KEYS}

    swept_keys = [key for key in grid if key in FLAT_KEYS]
    if swept_keys:
        value_lists = [list(grid[key]) for key in swept_keys]
        for combination in product(*value_lists):
            merged = dict(base)
            merged.update(dict(zip(swept_keys, combination, strict=True)))
            check_flat_required(merged)
    else:
        check_flat_required(base)

    for key, values in extremes.items():
        if key not in FLAT_KEYS:
            continue
        for value in values if isinstance(values, list) else [values]:
            merged = dict(base)
            merged[key] = value
            check_flat_required(merged)
