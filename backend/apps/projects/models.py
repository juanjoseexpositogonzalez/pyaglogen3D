"""Project models."""
import uuid

from django.conf import settings
from django.db import models


class Project(models.Model):
    """Research project container for simulations and analyses."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    # Owner and sharing
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owned_projects",
        null=True,  # Nullable for migration, will be made required
        blank=True,
    )
    is_public = models.BooleanField(
        default=False,
        help_text="Public projects are visible to all users (read-only).",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "projects"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.name

    @property
    def simulation_count(self) -> int:
        """Return number of simulations in this project."""
        return self.simulations.count()

    @property
    def analysis_count(self) -> int:
        """Return total number of analyses (ImageAnalysis + FraktalAnalysis) in this project."""
        image_analyses = self.analyses.count() if hasattr(self, 'analyses') else 0
        fraktal_analyses = self.fraktal_analyses.count() if hasattr(self, 'fraktal_analyses') else 0
        return image_analyses + fraktal_analyses
