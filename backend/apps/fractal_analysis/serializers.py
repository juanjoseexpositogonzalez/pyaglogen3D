"""Fractal Analysis serializers."""
import base64
import binascii

from rest_framework import serializers

from apps.simulations.utils import generate_fraktal_name
from .models import ComparisonSet, FraktalAnalysis, ImageAnalysis, SourceType


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


class FraktalAnalysisSerializer(serializers.ModelSerializer):
    """Serializer for FraktalAnalysis model."""

    simulation_id = serializers.SerializerMethodField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)

    class Meta:
        model = FraktalAnalysis
        fields = [
            "id",
            "name",
            "project",
            "source_type",
            "original_filename",
            "original_content_type",
            "simulation_id",
            "projection_params",
            "model",
            "npix",
            "dpo",
            "delta",
            "correction_3d",
            "pixel_min",
            "pixel_max",
            "npo_limit",
            "escala",
            "m_exponent",
            "auto_calibrate",
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
            "results",
            "status",
            "execution_time_ms",
            "engine_version",
            "error_message",
            "created_at",
            "started_at",
            "completed_at",
        ]

    def get_simulation_id(self, obj: FraktalAnalysis) -> str | None:
        """Return simulation ID if source is simulation projection."""
        return str(obj.simulation_id) if obj.simulation_id else None


class FraktalAnalysisCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating FraktalAnalysis with image upload or simulation projection."""

    image = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Base64 encoded image data (required for uploaded_image source)",
    )
    simulation_id = serializers.UUIDField(
        write_only=True,
        required=False,
        allow_null=True,
        help_text="Simulation ID for projection-based analysis",
    )
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)

    class Meta:
        model = FraktalAnalysis
        fields = [
            "id",
            "name",
            "source_type",
            "image",
            "original_filename",
            "original_content_type",
            "simulation_id",
            "projection_params",
            "model",
            "npix",
            "dpo",
            "delta",
            "correction_3d",
            "pixel_min",
            "pixel_max",
            "npo_limit",
            "escala",
            "m_exponent",
            "auto_calibrate",
            "status",
        ]
        read_only_fields = ["id", "status"]

    def validate_image(self, value: str) -> str:
        """Validate base64 encoded image data."""
        if not value:
            return value
        try:
            base64.b64decode(value)
        except (binascii.Error, ValueError) as e:
            raise serializers.ValidationError(f"Invalid base64 data: {e}")

        if len(value) > 14_000_000:  # ~10MB in base64
            raise serializers.ValidationError("Image too large. Maximum size is 10MB.")

        return value

    def validate_original_content_type(self, value: str) -> str:
        """Validate content type is an allowed image type."""
        if not value:
            return value
        allowed_types = {"image/png", "image/jpeg", "image/tiff", "image/bmp"}
        if value not in allowed_types:
            raise serializers.ValidationError(
                f"Invalid content type. Allowed: {', '.join(allowed_types)}"
            )
        return value

    def validate_model(self, value: str) -> str:
        """Validate model choice."""
        allowed = {"granulated_2012", "voxel_2018"}
        if value not in allowed:
            raise serializers.ValidationError(
                f"Invalid model. Allowed: {', '.join(allowed)}"
            )
        return value

    def validate_delta(self, value: float) -> float:
        """Validate delta is in valid range (1.0-1.5)."""
        if not (1.0 <= value <= 1.5):
            raise serializers.ValidationError("Delta must be between 1.0 and 1.5")
        return value

    def validate_npix(self, value: float) -> float:
        """Validate npix is positive."""
        if value <= 0:
            raise serializers.ValidationError("npix must be positive")
        return value

    def validate(self, attrs: dict) -> dict:
        """Validate source-specific requirements and model-specific parameters."""
        source_type = attrs.get("source_type", SourceType.UPLOADED_IMAGE)
        model = attrs.get("model")

        # Validate source-specific requirements
        if source_type == SourceType.UPLOADED_IMAGE:
            if not attrs.get("image"):
                raise serializers.ValidationError({
                    "image": "Image is required for uploaded_image source type"
                })
            if not attrs.get("original_filename"):
                raise serializers.ValidationError({
                    "original_filename": "Filename is required for uploaded_image source type"
                })
        elif source_type == SourceType.SIMULATION_PROJECTION:
            if not attrs.get("simulation_id"):
                raise serializers.ValidationError({
                    "simulation_id": "Simulation ID is required for simulation_projection source type"
                })

        # Validate model-specific parameters
        if model == "granulated_2012":
            auto_calibrate = attrs.get("auto_calibrate", False)
            if not auto_calibrate and not attrs.get("dpo"):
                raise serializers.ValidationError({
                    "dpo": "Primary particle diameter (dpo) is required for granulated_2012 model (or enable auto-calibrate)"
                })
            # Set a default dpo for auto-calibrate if not provided
            if auto_calibrate and not attrs.get("dpo"):
                attrs["dpo"] = 40.0  # Starting point for auto-calibration

        return attrs

    def create(self, validated_data: dict) -> FraktalAnalysis:
        """Create analysis with decoded image or simulation reference."""
        from apps.simulations.models import Simulation

        image_b64 = validated_data.pop("image", None)
        simulation_id = validated_data.pop("simulation_id", None)

        # Auto-generate name if not provided
        if not validated_data.get("name"):
            validated_data["name"] = generate_fraktal_name(
                validated_data.get("model", "unknown")
            )

        if image_b64:
            image_bytes = base64.b64decode(image_b64)
            validated_data["original_image"] = image_bytes

        if simulation_id:
            try:
                simulation = Simulation.objects.get(id=simulation_id)
                validated_data["simulation"] = simulation
            except Simulation.DoesNotExist:
                raise serializers.ValidationError({
                    "simulation_id": "Simulation not found"
                })

        return super().create(validated_data)


class ComparisonSetSerializer(serializers.ModelSerializer):
    """Serializer for ComparisonSet model."""

    simulation_ids = serializers.SerializerMethodField()
    analysis_ids = serializers.SerializerMethodField()
    fraktal_analysis_ids = serializers.SerializerMethodField()

    class Meta:
        model = ComparisonSet
        fields = [
            "id",
            "project",
            "name",
            "description",
            "simulation_ids",
            "analysis_ids",
            "fraktal_analysis_ids",
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

    def get_fraktal_analysis_ids(self, obj: ComparisonSet) -> list[str]:
        """Return list of FRAKTAL analysis IDs.

        Note: Use prefetch_related('fraktal_analyses') in the queryset to avoid N+1.
        """
        return [str(analysis.id) for analysis in obj.fraktal_analyses.all()]


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
    fraktal_analysis_ids = serializers.ListField(
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
            "fraktal_analysis_ids",
        ]

    def validate(self, attrs: dict) -> dict:
        """Validate that all referenced items belong to the same project."""
        from apps.simulations.models import Simulation

        project = attrs.get("project")
        simulation_ids = attrs.get("simulation_ids", [])
        analysis_ids = attrs.get("analysis_ids", [])
        fraktal_analysis_ids = attrs.get("fraktal_analysis_ids", [])

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

        # Validate FRAKTAL analyses belong to the project
        if fraktal_analysis_ids:
            valid_count = FraktalAnalysis.objects.filter(
                id__in=fraktal_analysis_ids,
                project=project,
            ).count()
            if valid_count != len(fraktal_analysis_ids):
                raise serializers.ValidationError({
                    "fraktal_analysis_ids": "One or more FRAKTAL analyses do not exist or belong to a different project."
                })

        return attrs

    def create(self, validated_data: dict) -> ComparisonSet:
        """Create comparison set with related items."""
        from apps.simulations.models import Simulation

        simulation_ids = validated_data.pop("simulation_ids", [])
        analysis_ids = validated_data.pop("analysis_ids", [])
        fraktal_analysis_ids = validated_data.pop("fraktal_analysis_ids", [])
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

        if fraktal_analysis_ids:
            # Filter by project for additional security
            fraktal_analyses = FraktalAnalysis.objects.filter(
                id__in=fraktal_analysis_ids,
                project=project,
            )
            comparison_set.fraktal_analyses.set(fraktal_analyses)

        return comparison_set
