"""Custom DRF fields for simulation distribution configs.

Supports the parametric-values-dpo-and-kf feature (PYA-15):
distribution config dicts for dpo_distribution and target_kf_distribution.
"""

from __future__ import annotations

from rest_framework import serializers

VALID_MODES = {"fixed", "normal", "uniform"}


class DistributionField(serializers.Field):
    """Validates a distribution config dict.

    Accepts:
      None — legacy scalar fallback (no distribution)
      {"mode": "fixed", "value": 12.5}
      {"mode": "normal", "mean": 12.5, "std": 1.5}
      {"mode": "uniform", "min": 10.0, "max": 15.0}
    """

    def to_internal_value(self, data: dict | None) -> dict | None:
        if data is None:
            return None

        if not isinstance(data, dict):
            raise serializers.ValidationError("must be a dict or null")

        mode = data.get("mode")
        if mode not in VALID_MODES:
            raise serializers.ValidationError(
                f"mode must be one of {sorted(VALID_MODES)}, got {mode!r}"
            )

        if mode == "fixed":
            value = data.get("value")
            if value is None or not isinstance(value, (int, float)) or value <= 0:
                raise serializers.ValidationError("fixed mode requires positive value")
            return {"mode": "fixed", "value": float(value)}

        if mode == "normal":
            mean = data.get("mean")
            std = data.get("std")
            if mean is None or not isinstance(mean, (int, float)) or mean <= 0:
                raise serializers.ValidationError("normal mode requires positive mean")
            if std is None or not isinstance(std, (int, float)) or std <= 0:
                raise serializers.ValidationError("normal mode requires positive std")
            return {"mode": "normal", "mean": float(mean), "std": float(std)}

        # mode == "uniform"
        min_v = data.get("min")
        max_v = data.get("max")
        if min_v is None or not isinstance(min_v, (int, float)) or min_v <= 0:
            raise serializers.ValidationError("uniform mode requires positive min")
        if max_v is None or not isinstance(max_v, (int, float)):
            raise serializers.ValidationError("uniform mode requires max")
        if max_v <= min_v:
            raise serializers.ValidationError("uniform mode requires max > min")
        return {"mode": "uniform", "min": float(min_v), "max": float(max_v)}

    def to_representation(self, value: dict | None) -> dict | None:
        return value
