"""Shape and algorithm scope for the four distribution keys (R13).

Mirror of `sintering_shape` for the other two magnitudes a batch study can
sweep: the fractal prefactor and the primary particle size.

Two facts drive everything here, both measured against the engine rather
than read (`tests/diagnostics/test_fase0_distribution_engine.py`):

1. The engine boundary is flat kwargs — `kf_mode`, `kf_value`, `dpo_mean`,
   … — and the only translator is `expand_distribution_kwargs`, which
   discriminates on `mode` and returns `{}` for anything else. A shape its
   translator does not recognise reaches the engine as nothing at all, so
   the simulation runs at the default and nobody is told.
2. Out-of-range values are not cosmetic: `kf_value=-1`, `kf_mean=-1` and an
   inverted `uniform` raise a Rust `PanicException`, which derives from
   `BaseException` and escapes the worker's only `except Exception`, leaving
   the row stuck in `RUNNING`.

Only `tunable_cc` consumes these keys: `run_simulation_task` expands them
inside that branch alone, and `run_tunable_cc` is the only binding declaring
those kwargs. The allow-list is therefore written as the set that is
permitted — enumerating the excluded is how `limiting` and `imported` were
silently lost while this contract was being written.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

#: Discriminator values `expand_distribution_kwargs` understands.
MODES: tuple[str, ...] = ("fixed", "normal", "uniform")

#: The two names the worker reads, and the two the batch grid exposes.
ENGINE_KEYS: tuple[str, ...] = ("target_kf_distribution", "dpo_distribution")
PARITY_KEYS: tuple[str, ...] = ("kf_distribution", "particle_radius_config")
DISTRIBUTION_KEYS: tuple[str, ...] = PARITY_KEYS + ENGINE_KEYS

#: Algorithms whose worker branch expands these keys into engine kwargs.
CONSUMING_ALGORITHMS: frozenset[str] = frozenset({"tunable_cc"})

#: Required fields per mode.
_REQUIRED: dict[str, tuple[str, ...]] = {
    "fixed": ("value",),
    "normal": ("mean", "std"),
    "uniform": ("min", "max"),
}


#: Magnitudes whose std/mean is capped, under either spelling: the cap exists
#: to prevent negative radii, so it follows the magnitude, not the key name.
CAPPED_MAGNITUDE: frozenset[str] = frozenset({"particle_radius_config", "dpo_distribution"})


def validate_shape(
    config: Any,
    *,
    max_std_over_mean: float | None = None,
) -> None:
    """Raise `ValueError` unless `config` is a distribution the engine can run.

    Accepts the `mode` shape the engine pipeline speaks. The legacy
    `distribution_type` spelling was tolerated only until the translation
    landed; it has, so a config that carries it is refused like any other
    discriminator the translator does not recognise.
    """
    if not isinstance(config, Mapping):
        raise ValueError(
            f"must be an object with a 'mode' field, got {type(config).__name__}"
        )

    # The translation landed, so the legacy `distribution_type` spelling is
    # refused here like any other discriminator: `expand_distribution_kwargs`
    # reads `mode` and returns {} for anything else, which is the silent
    # default this closes.
    mode = config.get("mode")
    if mode not in MODES:
        raise ValueError(f"mode must be one of {list(MODES)}, got {mode!r}")

    missing = [field for field in _REQUIRED[mode] if config.get(field) is None]
    if missing:
        raise ValueError(f"{mode} distribution requires {missing}")

    if mode == "fixed":
        _positive(config, "value")
    elif mode == "normal":
        _positive(config, "mean")
        _positive(config, "std")
        if max_std_over_mean is not None:
            mean, std = float(config["mean"]), float(config["std"])
            if std / mean > max_std_over_mean:
                raise ValueError(
                    f"std/mean ratio ({std / mean:.4f}) exceeds cap ({max_std_over_mean})"
                )
    else:
        _positive(config, "min")
        # `max` needs the same type guard as the rest: a string bound reaches
        # the binding and raises there, after the row is written, and a bool
        # runs silently as 1.0.
        _positive(config, "max")
        low, high = float(config["min"]), float(config["max"])
        if high <= low:
            raise ValueError(f"uniform requires min < max, got min={low}, max={high}")


def _positive(config: Mapping[str, Any], field: str) -> None:
    raw = config[field]
    # A bool is an int in Python, and `float("1.8")` succeeds: both used to
    # pass here. The first reaches the binding as True and runs as 1.0 with
    # nothing said; the second raises inside the worker after the write.
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError(f"'{field}' must be a number, got {raw!r}")
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"'{field}' must be a number, got {raw!r}") from exc
    if value <= 0:
        raise ValueError(f"'{field}' must be greater than 0, got {value}")


class SweptShapeError(ValueError):
    """A swept carrier holds something other than a list of configs."""

    def __init__(self, label: str, message: str) -> None:
        super().__init__(message)
        self.label = label


def collect_surfaces(
    *,
    grid: Mapping[str, Any] | None,
    base_parameters: Mapping[str, Any] | None,
    limiting_cases_config: Mapping[str, Any] | None,
) -> list[tuple[str, Any]]:
    """Every declared distribution config, labelled by the surface it came from.

    Twelve surfaces: the four keys on each of three carriers. A grid or a
    swept extreme holds a list; `base_parameters` holds the config itself.
    """
    found: list[tuple[str, Any]] = []
    extremes = (limiting_cases_config or {}).get("theoretical_extremes") or {}

    for carrier_name, carrier in (
        ("parameter_grid", grid or {}),
        ("limiting_cases_config.theoretical_extremes", extremes),
    ):
        if not isinstance(carrier, Mapping):
            continue
        for key in DISTRIBUTION_KEYS:
            entries = carrier.get(key)
            if entries is None:
                continue
            if not isinstance(entries, list):
                # A sweep needs a list. An object here used to be iterated by
                # key, so each child stored the string "mode" or "value" as
                # its configuration and failed at run time (R13.7).
                raise SweptShapeError(
                    f"{carrier_name}.{key}",
                    f"must be a list of distribution configs, got {type(entries).__name__}",
                )
            found.extend(
                (f"{carrier_name}.{key}[{i}]", entry)
                for i, entry in enumerate(entries)
            )

    if isinstance(base_parameters, Mapping):
        for key in DISTRIBUTION_KEYS:
            if base_parameters.get(key) is not None:
                found.append((f"base_parameters.{key}", base_parameters[key]))

    return found


def check_algorithm_scope(
    algorithm: str | None, surfaces: Iterable[tuple[str, Any]]
) -> None:
    """Raise `ValueError` when a declared key cannot reach the given algorithm.

    The caller passes the *effective* algorithm: on a partial update that
    omits `base_algorithm`, that is the one already stored, so the mismatch
    cannot be reached from either side.
    """
    declared = sorted({label.split(".")[-1].split("[")[0] for label, _ in surfaces})
    if not declared:
        return
    if algorithm in CONSUMING_ALGORITHMS:
        return
    permitted = ", ".join(sorted(CONSUMING_ALGORITHMS))
    raise ValueError(
        f"{', '.join(declared)} is only consumed by {permitted}; "
        f"{algorithm!r} ignores it, so the simulation would run at the engine default"
    )
