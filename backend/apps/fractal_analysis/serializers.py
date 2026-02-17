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

    simulation_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=None,
        source="simulations",
        required=False,
    )
    analysis_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=ImageAnalysis.objects.all(),
        source="analyses",
        required=False,
    )

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

    def __init__(self, *args, **kwargs):
        """Initialize with simulation queryset."""
        super().__init__(*args, **kwargs)
        from apps.simulations.models import Simulation

        self.fields["simulation_ids"].queryset = Simulation.objects.all()
