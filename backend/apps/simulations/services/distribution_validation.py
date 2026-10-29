"""Pure validation helper for distribution config dicts.

Used by ``ParametricStudySerializer.validate()`` to check grid entries for
distribution-type parameters (kf_distribution, particle_radius_config,
sintering_config).

Raises ``rest_framework.exceptions.ValidationError`` on invalid config;
returns ``None`` on success.
"""

from __future__ import annotations

from typing import Sequence

from rest_framework.exceptions import ValidationError


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

    elif dist_type == "normal":
        if "mean" not in config:
            raise ValidationError(
                "Normal distribution requires a 'mean' field."
            )
        if "std" not in config:
            raise ValidationError(
                "Normal distribution requires a 'std' field."
            )
        std = config["std"]
        mean = config["mean"]
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
        if config["min"] > config["max"]:
            raise ValidationError(
                "Uniform distribution 'min' must be <= 'max'."
            )
