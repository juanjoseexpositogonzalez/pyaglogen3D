"""Simulation serializers."""

from __future__ import annotations

import base64
import random
from math import prod

from rest_framework import serializers

from .fields import DistributionField
from .models import ParametricStudy, Simulation
from .services.distribution_validation import validate_distribution_config
from .services.params import (
    PARAM_KEY_DIAMETER,
    PARAM_KEY_RADIUS_LEGACY,
    PARAM_KEY_SCHEMA_VERSION,
    SCHEMA_VERSION_CURRENT,
)
from .utils import generate_simulation_name

# Backend-side cap for base64-encoded CSV payloads. Matches the frontend's
# 10 MB client guard; enforced here so a pathological payload cannot slip
# past the UI and reach the parser. Base64 inflates size by ~33%, so a
# 10 MB raw file encodes to ~13.3 MB — we cap the encoded length to keep
# the check cheap (no decode required).
_CSV_MAX_BASE64_BYTES = 14 * 1024 * 1024


def generate_seed():
    """Generate a random seed."""
    return random.randint(0, 2**31 - 1)


class SimulationSerializer(serializers.ModelSerializer):
    """Serializer for Simulation model."""

    seed = serializers.IntegerField(required=False, default=generate_seed)
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    csv_data = serializers.CharField(
        required=False,
        write_only=True,
        help_text="Base64-encoded CSV data with x, y, z, radius columns (for 'imported' algorithm)",
    )
    seed_type = serializers.ChoiceField(
        choices=[
            ("monomers", "Monomers"),
            ("dimers", "Dimers"),
            ("trimers", "Trimers"),
        ],
        default="monomers",
        required=False,
        help_text="Seed type for CC tunable: monomers (default), dimers, or trimers.",
    )
    dpo_distribution = DistributionField(
        required=False,
        allow_null=True,
        help_text="Distribution config for dpo (CC tunable only): {mode, value/mean/std/min/max}",
    )
    target_kf_distribution = DistributionField(
        required=False,
        allow_null=True,
        help_text="Distribution config for target_kf (CC tunable only): {mode, value/mean/std/min/max}",
    )

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "project",
            "algorithm",
            "parameters",
            "seed",
            "seed_type",
            "status",
            "metrics",
            "execution_time_ms",
            "engine_version",
            "error_message",
            "created_at",
            "started_at",
            "completed_at",
            "csv_data",
            "dpo_distribution",
            "target_kf_distribution",
        ]
        read_only_fields = [
            "id",
            "project",
            "status",
            "metrics",
            "execution_time_ms",
            "engine_version",
            "error_message",
            "created_at",
            "started_at",
            "completed_at",
        ]

    def create(self, validated_data):
        """Auto-generate name and stamp the v2 parameter schema."""
        # Remove csv_data from validated_data before creating (it's handled in the view)
        validated_data.pop("csv_data", None)

        # Merge distribution configs into parameters JSONField (PYA-15).
        # These are not model fields — they live inside the params dict.
        dpo_dist = validated_data.pop("dpo_distribution", None)
        kf_dist = validated_data.pop("target_kf_distribution", None)
        if dpo_dist is not None or kf_dist is not None:
            params = validated_data.get("parameters")
            if isinstance(params, dict):
                params = dict(params)
                if dpo_dist is not None:
                    params["dpo_distribution"] = dpo_dist
                if kf_dist is not None:
                    params["target_kf_distribution"] = kf_dist
                validated_data["parameters"] = params

        if not validated_data.get("name"):
            validated_data["name"] = generate_simulation_name(
                validated_data.get("algorithm", "unknown")
            )

        # Stamp parameters_schema_version = "v2" on every new simulation and
        # convert any legacy primary_particle_radius_nm payload from older
        # clients to primary_particle_diameter_nm (radius * 2). New writes MUST
        # NEVER persist the legacy key. See services/params.py for the shim.
        params = validated_data.get("parameters")
        if isinstance(params, dict):
            params = dict(params)  # copy — don't mutate caller's dict
            if PARAM_KEY_DIAMETER not in params and PARAM_KEY_RADIUS_LEGACY in params:
                legacy_radius = params.pop(PARAM_KEY_RADIUS_LEGACY)
                try:
                    legacy_radius_f = float(legacy_radius)
                except (TypeError, ValueError):
                    legacy_radius_f = None
                if legacy_radius_f is not None and legacy_radius_f > 0:
                    params[PARAM_KEY_DIAMETER] = legacy_radius_f * 2.0
            else:
                # If both keys are present, drop the legacy one: we never
                # persist it going forward.
                params.pop(PARAM_KEY_RADIUS_LEGACY, None)
            params[PARAM_KEY_SCHEMA_VERSION] = SCHEMA_VERSION_CURRENT

            # PYA-14 Phase 2: lift seed_type from nested parameters.
            # Frontend sends seed_type inside parameters (SimulationForm.tsx:711);
            # legacy/scripted callers use top-level field. Nested wins (R17
            # contract). pop() removes the key from the JSON blob to avoid a
            # stale duplicate.
            if "seed_type" in params:
                nested_seed_type = params.pop("seed_type")
                valid_choices = {
                    c[0] for c in Simulation._meta.get_field("seed_type").choices
                }
                if nested_seed_type not in valid_choices:
                    raise serializers.ValidationError(
                        {
                            "seed_type": f"'{nested_seed_type}' is not a valid seed type. "
                            f"Choose from: {sorted(valid_choices)}."
                        }
                    )
                validated_data["seed_type"] = nested_seed_type

            validated_data["parameters"] = params

        return super().create(validated_data)

    def validate(self, data):
        """Cross-field validation."""
        algorithm = data.get("algorithm") or self.initial_data.get("algorithm")

        # For imported algorithm, csv_data is required
        if algorithm == "imported":
            if "csv_data" not in self.initial_data:
                raise serializers.ValidationError(
                    {"csv_data": "CSV data is required for imported algorithm"}
                )

        return data

    def validate_csv_data(self, value: str) -> str:
        """Validate import payload format (not content).

        Content validation (columns, shape, radius sign, N ≤ 100k) happens
        exactly once in the view via the appropriate parser — see T3 of the
        import-aggregate change: the serializer MUST NOT re-parse the upload
        or the payload is decoded and tokenized twice.

        Here we only ensure:

        1. The value is valid base64.
        2. The encoded payload is under the backend size cap (defense in
           depth against a client that bypasses the UI 10 MB guard).

        Encoding validation for CSV uploads lives in
        :func:`parse_csv_geometry` which accepts UTF-8, UTF-8-BOM, and
        Latin-1 (MATLAB ``writematrix`` on a Spanish locale emits
        ISO-8859-1). A strict UTF-8 gate here would bounce those files
        with an opaque 400 before the parser ever sees them.
        """
        if not value:
            return value

        if len(value) > _CSV_MAX_BASE64_BYTES:
            raise serializers.ValidationError("CSV payload too large (max ~10 MB).")

        try:
            base64.b64decode(value, validate=True)
        except Exception as e:
            raise serializers.ValidationError(f"Invalid base64 encoding: {e}")

        return value

    def validate_parameters(self, value: dict) -> dict:
        """Validate algorithm-specific parameters."""
        algorithm = self.initial_data.get("algorithm")

        if algorithm == "dla":
            required = ["n_particles"]
            for field in required:
                if field not in value:
                    raise serializers.ValidationError(
                        f"Missing required parameter: {field}"
                    )
            if value["n_particles"] < 10:
                raise serializers.ValidationError("n_particles must be at least 10")
            if value["n_particles"] > 100000:
                raise serializers.ValidationError("n_particles must be at most 100,000")

        elif algorithm == "limiting":
            # Limiting cases allow any N >= 1
            if "n_particles" in value and value["n_particles"] < 1:
                raise serializers.ValidationError(
                    "n_particles must be at least 1 for limiting cases"
                )

        elif algorithm == "imported":
            # Imported algorithm has minimal parameter requirements
            # Parameters will be populated by the view after parsing CSV
            pass

        return value


class SimulationDetailSerializer(SimulationSerializer):
    """Detailed serializer including geometry URL."""

    geometry_available = serializers.SerializerMethodField()

    class Meta(SimulationSerializer.Meta):
        fields = SimulationSerializer.Meta.fields + ["geometry_available"]

    def get_geometry_available(self, obj: Simulation) -> bool:
        """Check if geometry data is available."""
        return obj.geometry is not None


class ParametricStudySerializer(serializers.ModelSerializer):
    """Serializer for ParametricStudy model."""

    total_simulations = serializers.SerializerMethodField()
    completed_simulations = serializers.SerializerMethodField()

    # New batch features
    include_limiting_cases = serializers.BooleanField(default=False)
    limiting_cases_config = serializers.JSONField(required=False, allow_null=True)
    sintering_config = serializers.JSONField(required=False, allow_null=True)
    include_box_counting = serializers.BooleanField(default=False)
    box_counting_params = serializers.JSONField(required=False, allow_null=True)

    class Meta:
        model = ParametricStudy
        fields = [
            "id",
            "project",
            "name",
            "description",
            "base_algorithm",
            "base_parameters",
            "parameter_grid",
            "seeds_per_combination",
            # New batch feature fields
            "include_limiting_cases",
            "limiting_cases_config",
            "sintering_config",
            "include_box_counting",
            "box_counting_params",
            # Status fields
            "status",
            "total_simulations",
            "completed_simulations",
            "created_at",
            "completed_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "status",
            "total_simulations",
            "completed_simulations",
            "created_at",
            "completed_at",
        ]

    def get_total_simulations(self, obj: ParametricStudy) -> int:
        """Return total number of simulations in study."""
        return obj.simulations.count()

    def get_completed_simulations(self, obj: ParametricStudy) -> int:
        """Return number of completed simulations."""
        return obj.simulations.filter(status="completed").count()

    def validate_sintering_config(self, value):
        """Validate sintering configuration."""
        if value is None:
            return value

        valid_types = {"fixed", "uniform", "normal"}
        dist_type = value.get("distribution_type", "fixed")
        if dist_type not in valid_types:
            raise serializers.ValidationError(
                f"distribution_type must be one of: {valid_types}"
            )

        # Validate coefficient ranges
        if dist_type == "fixed":
            coeff = value.get("coefficient", 1.0)
            if not (0.5 <= coeff <= 1.0):
                raise serializers.ValidationError(
                    "coefficient must be between 0.5 and 1.0"
                )
        elif dist_type == "uniform":
            min_val = value.get("min", 0.85)
            max_val = value.get("max", 0.95)
            if not (0.5 <= min_val <= 1.0):
                raise serializers.ValidationError("min must be between 0.5 and 1.0")
            if not (0.5 <= max_val <= 1.0):
                raise serializers.ValidationError("max must be between 0.5 and 1.0")
            if min_val > max_val:
                raise serializers.ValidationError(
                    "min must be less than or equal to max"
                )
        elif dist_type == "normal":
            mean = value.get("mean", 0.9)
            std = value.get("std", 0.05)
            if not (0.5 <= mean <= 1.0):
                raise serializers.ValidationError("mean must be between 0.5 and 1.0")
            if not (0.0 < std <= 0.2):
                raise serializers.ValidationError("std must be between 0.0 and 0.2")

        return value

    def validate_box_counting_params(self, value):
        """Validate box-counting parameters."""
        if value is None:
            return value

        points = value.get("points_per_sphere", 100)
        if not (10 <= points <= 1000):
            raise serializers.ValidationError(
                "points_per_sphere must be between 10 and 1000"
            )

        precision = value.get("precision", 18)
        if not (8 <= precision <= 21):
            raise serializers.ValidationError("precision must be between 8 and 21")

        return value

    def validate_limiting_cases_config(self, value):
        """Validate limiting cases configuration."""
        if value is None:
            return value

        # Ensure valid keys
        valid_keys = {
            "include_boundaries",
            "include_theoretical",
            "theoretical_extremes",
        }
        for key in value.keys():
            if key not in valid_keys:
                raise serializers.ValidationError(
                    f"Invalid key '{key}'. Valid keys: {valid_keys}"
                )

        return value

    # ------------------------------------------------------------------
    # Cross-field validation (grid key shapes + batch size)
    # ------------------------------------------------------------------

    #: Grid keys validated via distribution helper.
    _DISTRIBUTION_GRID_KEYS: dict[str, dict] = {
        "kf_distribution": {},
        "particle_radius_config": {"max_std_over_mean": 0.3},
        "sintering_config": {},
    }

    _BATCH_HARD_CAP = 1000
    _BATCH_WARN_THRESHOLD = 200

    def validate(self, data: dict) -> dict:  # noqa: C901
        """Cross-field validation for parameter_grid entries + batch size."""
        grid = data.get("parameter_grid") or {}
        allowed_dist_types = ("fixed", "uniform", "normal")
        valid_seed_types = {c[0] for c in Simulation._meta.get_field("seed_type").choices}

        # --- Validate distribution grid keys ---
        for key, constraints in self._DISTRIBUTION_GRID_KEYS.items():
            entries = grid.get(key)
            if entries is None:
                continue
            if not isinstance(entries, list):
                raise serializers.ValidationError(
                    {f"parameter_grid.{key}": "Must be a list of distribution configs."}
                )
            for i, entry in enumerate(entries):
                try:
                    validate_distribution_config(
                        entry, allowed_dist_types, **constraints
                    )
                except serializers.ValidationError as exc:
                    raise serializers.ValidationError(
                        {f"parameter_grid.{key}[{i}]": exc.detail}
                    )

        # --- Validate seed_type grid key ---
        seed_type_entries = grid.get("seed_type")
        if seed_type_entries is not None:
            if not isinstance(seed_type_entries, list):
                raise serializers.ValidationError(
                    {"parameter_grid.seed_type": "Must be a list of seed_type values."}
                )
            for entry in seed_type_entries:
                if entry not in valid_seed_types:
                    raise serializers.ValidationError(
                        {
                            "parameter_grid.seed_type": (
                                f"'{entry}' is not a valid seed_type. "
                                f"Choose from: {sorted(valid_seed_types)}."
                            )
                        }
                    )

        # --- Batch size projection ---
        seeds_per = data.get("seeds_per_combination", 1)
        grid_sizes = [len(v) for v in grid.values() if isinstance(v, list)]
        projected = seeds_per * (prod(grid_sizes) if grid_sizes else 0)

        if projected > self._BATCH_HARD_CAP:
            raise serializers.ValidationError(
                {
                    "parameter_grid": (
                        f"Projected batch size ({projected}) exceeds the "
                        f"maximum of {self._BATCH_HARD_CAP} simulations."
                    )
                }
            )

        # Store warning for >200 (view can include in response)
        self.batch_warning = None
        if projected > self._BATCH_WARN_THRESHOLD:
            self.batch_warning = (
                f"Batch contains {projected} simulations "
                f"(threshold: {self._BATCH_WARN_THRESHOLD}). "
                f"This may take a while."
            )

        return data


class BatchProjectionExportRequestSerializer(serializers.Serializer):
    """Validate batch projection export requests.

    Per spec R1 + R2:
    - ``simulation_ids``: non-empty UUID list, max 50
    - ``mode``: ``"grid"`` | ``"fibonacci"`` | ``"legacy"``
    - ``config``: mode-specific parameters (extra keys silently ignored)
    """

    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=1,
        max_length=50,
    )
    mode = serializers.ChoiceField(choices=["grid", "fibonacci", "legacy"])
    config = serializers.DictField(default=dict)

    def validate(self, data: dict) -> dict:
        """Cross-field validation: mode-specific config rules."""
        mode = data.get("mode")
        config = data.get("config", {})

        if mode in ("grid", "legacy"):
            az_step = config.get("az_step")
            el_step = config.get("el_step")
            if az_step is None:
                raise serializers.ValidationError(
                    {"config": f"Mode '{mode}' requires 'az_step' in config"}
                )
            if el_step is None:
                raise serializers.ValidationError(
                    {"config": f"Mode '{mode}' requires 'el_step' in config"}
                )
            try:
                az_step = float(az_step)
                el_step = float(el_step)
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {"config": "az_step and el_step must be numeric"}
                )
            if az_step <= 0 or el_step <= 0:
                raise serializers.ValidationError(
                    {"config": "az_step and el_step must be > 0"}
                )

        elif mode == "fibonacci":
            n = config.get("n")
            if n is None:
                raise serializers.ValidationError(
                    {"config": "Mode 'fibonacci' requires 'n' in config"}
                )
            try:
                n = int(n)
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {"config": "'n' must be an integer"}
                )
            if n < 1 or n > 1000:
                raise serializers.ValidationError(
                    {"config": "'n' must be between 1 and 1000"}
                )

        return data
