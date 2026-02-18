"""Fractal Analysis models."""
import uuid

from django.db import models


class FractalMethod(models.TextChoices):
    """Available fractal analysis methods."""

    BOX_COUNTING = "box_counting", "Box-Counting"
    SANDBOX = "sandbox", "Sandbox Method"
    CORRELATION = "correlation", "Correlation Dimension"
    LACUNARITY = "lacunarity", "Lacunarity"
    MULTIFRACTAL = "multifractal", "Multifractal Dq"
    FRAKTAL_GRANULATED_2012 = "fraktal_granulated_2012", "FRAKTAL Granulated 2012"
    FRAKTAL_VOXEL_2018 = "fraktal_voxel_2018", "FRAKTAL Voxel 2018"


class SourceType(models.TextChoices):
    """Source of the image for analysis."""

    UPLOADED_IMAGE = "uploaded_image", "Uploaded Image"
    SIMULATION_PROJECTION = "simulation_projection", "Simulation Projection"


class AnalysisStatus(models.TextChoices):
    """Analysis execution status."""

    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"


class ImageAnalysis(models.Model):
    """2D image fractal analysis."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="analyses",
    )
    # Images stored as binary data
    original_image = models.BinaryField(
        help_text="Original uploaded image"
    )
    original_filename = models.CharField(max_length=255)
    original_content_type = models.CharField(max_length=50)
    processed_image = models.BinaryField(
        null=True,
        blank=True,
        help_text="Binarized/preprocessed image",
    )
    preprocessing_params = models.JSONField(
        help_text="Threshold method, invert, clean params"
    )
    method = models.CharField(
        max_length=20,
        choices=FractalMethod.choices,
    )
    method_params = models.JSONField(
        null=True,
        blank=True,
        help_text="Method-specific parameters",
    )
    results = models.JSONField(
        null=True,
        blank=True,
        help_text="Fractal dimension, R2, log data, etc.",
    )
    status = models.CharField(
        max_length=20,
        choices=AnalysisStatus.choices,
        default=AnalysisStatus.QUEUED,
    )
    execution_time_ms = models.PositiveIntegerField(null=True, blank=True)
    engine_version = models.CharField(max_length=20, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "image_analyses"
        ordering = ["-created_at"]
        verbose_name_plural = "Image analyses"
        indexes = [
            models.Index(fields=["project", "-created_at"]),
            models.Index(fields=["status"]),
            models.Index(fields=["method"]),
        ]

    def __str__(self) -> str:
        return f"{self.method} - {self.status} ({self.id})"


class FraktalAnalysis(models.Model):
    """FRAKTAL fractal analysis for agglomerate images.

    Supports both 2012 Granulated and 2018 Voxel models from the FRAKTAL program.
    Can analyze uploaded images or projections from 3D simulations.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="fraktal_analyses",
    )

    # Source configuration
    source_type = models.CharField(
        max_length=30,
        choices=SourceType.choices,
        default=SourceType.UPLOADED_IMAGE,
    )
    # For uploaded images
    original_image = models.BinaryField(
        null=True,
        blank=True,
        help_text="Original uploaded image",
    )
    original_filename = models.CharField(max_length=255, blank=True)
    original_content_type = models.CharField(max_length=50, blank=True)
    # For simulation projections
    simulation = models.ForeignKey(
        "simulations.Simulation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fraktal_analyses",
        help_text="Source simulation for projection-based analysis",
    )
    projection_params = models.JSONField(
        null=True,
        blank=True,
        help_text="Projection parameters: azimuth, elevation, resolution",
    )

    # Analysis model and parameters
    model = models.CharField(
        max_length=30,
        choices=[
            ("granulated_2012", "Granulated 2012"),
            ("voxel_2018", "Voxel 2018"),
        ],
        help_text="FRAKTAL analysis model to use",
    )
    # Granulated 2012 parameters
    npix = models.FloatField(
        help_text="Pixels per 100nm in the scale bar",
    )
    dpo = models.FloatField(
        null=True,
        blank=True,
        help_text="Mean primary particle diameter (nm) - required for granulated model",
    )
    delta = models.FloatField(
        default=1.1,
        help_text="Filling factor (1.0-1.5)",
    )
    correction_3d = models.BooleanField(
        default=False,
        help_text="Apply 3D correction to Rg",
    )
    pixel_min = models.PositiveSmallIntegerField(
        default=10,
        help_text="Min pixel value for segmentation",
    )
    pixel_max = models.PositiveSmallIntegerField(
        default=240,
        help_text="Max pixel value for segmentation",
    )
    npo_limit = models.PositiveIntegerField(
        default=5,
        help_text="Minimum particle count (granulated model)",
    )
    escala = models.FloatField(
        default=100.0,
        help_text="Scale reference in nm",
    )
    m_exponent = models.FloatField(
        default=1.0,
        help_text="m exponent for zp calculation (voxel model)",
    )

    # Results
    results = models.JSONField(
        null=True,
        blank=True,
        help_text="FRAKTAL results: rg, ap, df, npo, kf, zf, jf, volume, mass, surface_area",
    )
    status = models.CharField(
        max_length=20,
        choices=AnalysisStatus.choices,
        default=AnalysisStatus.QUEUED,
    )
    execution_time_ms = models.PositiveIntegerField(null=True, blank=True)
    engine_version = models.CharField(max_length=20, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "fraktal_analyses"
        ordering = ["-created_at"]
        verbose_name_plural = "FRAKTAL analyses"
        indexes = [
            models.Index(fields=["project", "-created_at"]),
            models.Index(fields=["status"]),
            models.Index(fields=["model"]),
            models.Index(fields=["source_type"]),
        ]

    def __str__(self) -> str:
        return f"FRAKTAL {self.model} - {self.status} ({self.id})"


class ComparisonSet(models.Model):
    """Set of simulations and analyses for comparison."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="comparison_sets",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    simulations = models.ManyToManyField(
        "simulations.Simulation",
        related_name="comparison_sets",
        blank=True,
    )
    analyses = models.ManyToManyField(
        ImageAnalysis,
        related_name="comparison_sets",
        blank=True,
    )
    fraktal_analyses = models.ManyToManyField(
        FraktalAnalysis,
        related_name="comparison_sets",
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "comparison_sets"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name
