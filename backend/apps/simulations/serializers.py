"""Simulation serializers."""
import random

from rest_framework import serializers

from .models import ParametricStudy, Simulation
from .utils import generate_simulation_name


def generate_seed():
    """Generate a random seed."""
    return random.randint(0, 2**31 - 1)


class SimulationSerializer(serializers.ModelSerializer):
    """Serializer for Simulation model."""

    seed = serializers.IntegerField(required=False, default=generate_seed)
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "project",
            "algorithm",
            "parameters",
            "seed",
            "status",
            "metrics",
            "execution_time_ms",
            "engine_version",
            "error_message",
            "created_at",
            "started_at",
            "completed_at",
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
        """Auto-generate name if not provided."""
        if not validated_data.get("name"):
            validated_data["name"] = generate_simulation_name(
                validated_data.get("algorithm", "unknown")
            )
        return super().create(validated_data)

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
                raise serializers.ValidationError(
                    "n_particles must be at least 10"
                )
            if value["n_particles"] > 100000:
                raise serializers.ValidationError(
                    "n_particles must be at most 100,000"
                )

        elif algorithm == "limiting":
            # Limiting cases allow any N >= 1
            if "n_particles" in value and value["n_particles"] < 1:
                raise serializers.ValidationError(
                    "n_particles must be at least 1 for limiting cases"
                )

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
                raise serializers.ValidationError("min must be less than or equal to max")
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
        valid_keys = {"include_boundaries", "include_theoretical", "theoretical_extremes"}
        for key in value.keys():
            if key not in valid_keys:
                raise serializers.ValidationError(
                    f"Invalid key '{key}'. Valid keys: {valid_keys}"
                )

        return value
