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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "comparison_sets"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name
