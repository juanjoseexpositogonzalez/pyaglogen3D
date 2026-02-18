"""Simulation models."""
import uuid

from django.db import models


class SimulationAlgorithm(models.TextChoices):
    """Available simulation algorithms."""

    DLA = "dla", "Diffusion-Limited Aggregation"
    CCA = "cca", "Cluster-Cluster Aggregation"
    BALLISTIC = "ballistic", "Ballistic Particle-Cluster"
    BALLISTIC_CC = "ballistic_cc", "Ballistic Cluster-Cluster"
    TUNABLE = "tunable", "Tunable Sticking Probability"


class SimulationStatus(models.TextChoices):
    """Simulation execution status."""

    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"


class Simulation(models.Model):
    """3D particle agglomerate simulation."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="simulations",
    )
    algorithm = models.CharField(
        max_length=20,
        choices=SimulationAlgorithm.choices,
    )
    parameters = models.JSONField(
        help_text="Algorithm-specific parameters (n_particles, sticking_probability, etc.)"
    )
    seed = models.BigIntegerField(
        help_text="Random seed for reproducibility"
    )
    status = models.CharField(
        max_length=20,
        choices=SimulationStatus.choices,
        default=SimulationStatus.QUEUED,
    )
    # Geometry stored as binary NumPy array (N x 4: x, y, z, radius)
    geometry = models.BinaryField(
        null=True,
        blank=True,
        help_text="NumPy array of particle coordinates and radii",
    )
    metrics = models.JSONField(
        null=True,
        blank=True,
        help_text="Computed metrics: Df, kf, Rg, porosity, coordination, RDF",
    )
    execution_time_ms = models.PositiveIntegerField(null=True, blank=True)
    engine_version = models.CharField(max_length=20, blank=True)
    error_message = models.TextField(blank=True)
    task_id = models.CharField(max_length=50, blank=True, help_text="Celery task ID")
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "simulations"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "-created_at"]),
            models.Index(fields=["status"]),
            models.Index(fields=["algorithm"]),
        ]

    def __str__(self) -> str:
        return f"{self.algorithm} - {self.status} ({self.id})"


class ParametricStudy(models.Model):
    """Parametric sweep study containing multiple simulations."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="studies",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    base_algorithm = models.CharField(
        max_length=20,
        choices=SimulationAlgorithm.choices,
    )
    base_parameters = models.JSONField(
        help_text="Fixed parameters for all simulations"
    )
    parameter_grid = models.JSONField(
        help_text="Parameters to vary: {param_name: [values]}"
    )
    seeds_per_combination = models.PositiveIntegerField(default=1)
    simulations = models.ManyToManyField(
        Simulation,
        related_name="studies",
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        choices=SimulationStatus.choices,
        default=SimulationStatus.QUEUED,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "parametric_studies"
        ordering = ["-created_at"]
        verbose_name_plural = "Parametric studies"

    def __str__(self) -> str:
        return self.name
