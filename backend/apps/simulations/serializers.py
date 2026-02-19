"""Simulation serializers."""
import random

from rest_framework import serializers

from .models import ParametricStudy, Simulation


def generate_seed():
    """Generate a random seed."""
    return random.randint(0, 2**31 - 1)


class SimulationSerializer(serializers.ModelSerializer):
    """Serializer for Simulation model."""

    seed = serializers.IntegerField(required=False, default=generate_seed)

    class Meta:
        model = Simulation
        fields = [
            "id",
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
