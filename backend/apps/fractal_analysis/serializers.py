"""Fractal Analysis serializers."""
import base64
import binascii

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

    def validate_image(self, value: str) -> str:
        """Validate base64 encoded image data."""
        try:
            # Try decoding to validate it's valid base64
            base64.b64decode(value)
        except (binascii.Error, ValueError) as e:
            raise serializers.ValidationError(f"Invalid base64 data: {e}")

        # Basic size check (max 10MB after decoding)
        if len(value) > 14_000_000:  # ~10MB in base64
            raise serializers.ValidationError("Image too large. Maximum size is 10MB.")

        return value

    def validate_original_content_type(self, value: str) -> str:
        """Validate content type is an allowed image type."""
        allowed_types = {"image/png", "image/jpeg", "image/tiff", "image/bmp"}
        if value not in allowed_types:
            raise serializers.ValidationError(
                f"Invalid content type. Allowed: {', '.join(allowed_types)}"
            )
        return value

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
        """Return list of simulation IDs.

        Note: Use prefetch_related('simulations') in the queryset to avoid N+1.
        """
        return [str(sim.id) for sim in obj.simulations.all()]

    def get_analysis_ids(self, obj: ComparisonSet) -> list[str]:
        """Return list of analysis IDs.

        Note: Use prefetch_related('analyses') in the queryset to avoid N+1.
        """
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

    def validate(self, attrs: dict) -> dict:
        """Validate that all referenced items belong to the same project."""
        from apps.simulations.models import Simulation

        project = attrs.get("project")
        simulation_ids = attrs.get("simulation_ids", [])
        analysis_ids = attrs.get("analysis_ids", [])

        # Validate simulations belong to the project
        if simulation_ids:
            valid_count = Simulation.objects.filter(
                id__in=simulation_ids,
                project=project,
            ).count()
            if valid_count != len(simulation_ids):
                raise serializers.ValidationError({
                    "simulation_ids": "One or more simulations do not exist or belong to a different project."
                })

        # Validate analyses belong to the project
        if analysis_ids:
            valid_count = ImageAnalysis.objects.filter(
                id__in=analysis_ids,
                project=project,
            ).count()
            if valid_count != len(analysis_ids):
                raise serializers.ValidationError({
                    "analysis_ids": "One or more analyses do not exist or belong to a different project."
                })

        return attrs

    def create(self, validated_data: dict) -> ComparisonSet:
        """Create comparison set with related items."""
        from apps.simulations.models import Simulation

        simulation_ids = validated_data.pop("simulation_ids", [])
        analysis_ids = validated_data.pop("analysis_ids", [])
        project = validated_data.get("project")

        comparison_set = ComparisonSet.objects.create(**validated_data)

        if simulation_ids:
            # Filter by project for additional security
            simulations = Simulation.objects.filter(
                id__in=simulation_ids,
                project=project,
            )
            comparison_set.simulations.set(simulations)

        if analysis_ids:
            # Filter by project for additional security
            analyses = ImageAnalysis.objects.filter(
                id__in=analysis_ids,
                project=project,
            )
            comparison_set.analyses.set(analyses)

        return comparison_set
