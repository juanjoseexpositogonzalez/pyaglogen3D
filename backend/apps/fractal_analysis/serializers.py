"""Fractal Analysis serializers."""
import base64

from rest_framework import serializers

from .models import ComparisonSet, ImageAnalysis


class ImageAnalysisSerializer(serializers.ModelSerializer):
    """Serializer for ImageAnalysis model."""

    class Meta:
        model = ImageAnalysis
        fields = [
            "id",
            "project",
            "original_filename",
            "original_content_type",
            "preprocessing_params",
            "method",
            "method_params",
            "results",
            "status",
            "execution_time_ms",
            "engine_version",
            "error_message",
            "created_at",
            "started_at",
            "completed_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "results",
            "execution_time_ms",
            "engine_version",
            "error_message",
            "created_at",
            "started_at",
            "completed_at",
        ]


class ImageAnalysisCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating ImageAnalysis with image upload."""

    image = serializers.CharField(
        write_only=True,
        help_text="Base64 encoded image data",
    )

    class Meta:
        model = ImageAnalysis
        fields = [
            "project",
            "image",
            "original_filename",
            "original_content_type",
            "preprocessing_params",
            "method",
            "method_params",
        ]

    def create(self, validated_data: dict) -> ImageAnalysis:
        """Create analysis with decoded image."""
        image_b64 = validated_data.pop("image")
        image_bytes = base64.b64decode(image_b64)
        validated_data["original_image"] = image_bytes
        return super().create(validated_data)


class ComparisonSetSerializer(serializers.ModelSerializer):
    """Serializer for ComparisonSet model."""

    simulation_ids = serializers.SerializerMethodField()
    analysis_ids = serializers.SerializerMethodField()

    class Meta:
        model = ComparisonSet
        fields = [
            "id",
            "project",
            "name",
            "description",
            "simulation_ids",
            "analysis_ids",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def get_simulation_ids(self, obj: ComparisonSet) -> list[str]:
        """Return list of simulation IDs."""
        return [str(sim.id) for sim in obj.simulations.all()]

    def get_analysis_ids(self, obj: ComparisonSet) -> list[str]:
        """Return list of analysis IDs."""
        return [str(analysis.id) for analysis in obj.analyses.all()]


class ComparisonSetCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating ComparisonSet with related items."""

    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )
    analysis_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )

    class Meta:
        model = ComparisonSet
        fields = [
            "project",
            "name",
            "description",
            "simulation_ids",
            "analysis_ids",
        ]

    def create(self, validated_data: dict) -> ComparisonSet:
        """Create comparison set with related items."""
        from apps.simulations.models import Simulation

        simulation_ids = validated_data.pop("simulation_ids", [])
        analysis_ids = validated_data.pop("analysis_ids", [])

        comparison_set = ComparisonSet.objects.create(**validated_data)

        if simulation_ids:
            simulations = Simulation.objects.filter(id__in=simulation_ids)
            comparison_set.simulations.set(simulations)

        if analysis_ids:
            analyses = ImageAnalysis.objects.filter(id__in=analysis_ids)
            comparison_set.analyses.set(analyses)

        return comparison_set
