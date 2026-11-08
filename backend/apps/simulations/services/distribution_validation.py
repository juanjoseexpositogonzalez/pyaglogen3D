"""Pure validation helper for distribution config dicts.

Used by ``ParametricStudySerializer.validate()`` to check grid entries for
distribution-type parameters (kf_distribution, particle_radius_config,
sintering_config).

Raises ``rest_framework.exceptions.ValidationError`` on invalid config;
returns ``None`` on success.
"""

from __future__ import annotations

from collections.abc import Sequence

from rest_framework.exceptions import ValidationError


def _number(config: dict[str, object], field: str) -> float:
    """A real number, or a refusal naming the field.

    A string in a numeric slot used to reach the comparisons below and answer 500
    from *inside* validation: `'>' not supported between instances of 'float' and
    'str'`. Same family as the unhashable `seed_type` of #115 point 4 - user input
    producing a server error instead of a refusal - and it is checked here, once,
    rather than at each comparison (point 16).
    """
    value = config[field]
    # `True` is an `int` in Python, and a boolean is not a quantity.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(
            f"Distribution '{field}' must be a number, got {type(value).__name__}."
        )
    try:
        return float(value)
    except OverflowError:
        # A JSON integer past float range converts to nothing: `float(10**400)`
        # raises, and an unguarded helper answered 500 from inside validation for
        # three payloads that `develop` refused with 400. The sibling guard
        # `distribution_shape._positive` already carries this clause for the same
        # reason (#202).
        raise ValidationError(
            f"Distribution '{field}' must be a finite number, got a value too "
            "large to represent."
        ) from None


def validate_distribution_config(
    config: object,
    allowed_types: Sequence[str],
    *,
    max_std_over_mean: float | None = None,
    min_mean: float | None = None,
) -> None:
    """Validate a single distribution config dict.

    Parameters
    ----------
    config:
        Expected shape varies by ``distribution_type``:
        - ``"fixed"``: ``{"distribution_type": "fixed", "value": <float>}``
        - ``"normal"``: ``{"distribution_type": "normal", "mean": <float>, "std": <float>}``
        - ``"uniform"``: ``{"distribution_type": "uniform", "min": <float>, "max": <float>}``
    allowed_types:
        Tuple/list of accepted ``distribution_type`` values.
    max_std_over_mean:
        If set, enforce ``std / mean <= max_std_over_mean`` for normal configs.
    min_mean:
        If set, enforce ``mean >= min_mean`` for normal configs.

    Raises
    ------
    ValidationError
        With a descriptive message on any validation failure.
    """
    if not isinstance(config, dict):
        raise ValidationError("Distribution config must be a dict.")

    dist_type = config.get("distribution_type")
    if dist_type is None:
        raise ValidationError(
            "distribution_type is required in distribution config."
        )

    if dist_type not in allowed_types:
        raise ValidationError(
            f"distribution_type '{dist_type}' is not allowed. "
            f"Choose from: {sorted(allowed_types)}."
        )

    if dist_type == "fixed":
        if "value" not in config:
            raise ValidationError(
                "Fixed distribution requires a 'value' field."
            )
        _number(config, "value")  # type-checked here, compared by the engine

    elif dist_type == "normal":
        if "mean" not in config:
            raise ValidationError(
                "Normal distribution requires a 'mean' field."
            )
        if "std" not in config:
            raise ValidationError(
                "Normal distribution requires a 'std' field."
            )
        std = _number(config, "std")
        mean = _number(config, "mean")
        if std < 0:
            raise ValidationError(
                "Normal distribution 'std' must be non-negative."
            )
        if min_mean is not None and mean < min_mean:
            raise ValidationError(
                f"Normal distribution 'mean' must be >= {min_mean}."
            )
        if max_std_over_mean is not None and mean > 0:
            ratio = std / mean
            if ratio > max_std_over_mean:
                raise ValidationError(
                    f"std/mean ratio ({ratio:.4f}) exceeds cap "
                    f"({max_std_over_mean})."
                )

    elif dist_type == "uniform":
        if "min" not in config:
            raise ValidationError(
                "Uniform distribution requires a 'min' field."
            )
        if "max" not in config:
            raise ValidationError(
                "Uniform distribution requires a 'max' field."
            )
        if _number(config, "min") > _number(config, "max"):
            raise ValidationError(
                "Uniform distribution 'min' must be <= 'max'."
            )
