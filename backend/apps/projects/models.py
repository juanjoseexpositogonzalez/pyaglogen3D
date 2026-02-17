"""Project models."""
import uuid

from django.db import models


class Project(models.Model):
    """Research project container for simulations and analyses."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
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
        """Return number of image analyses in this project."""
        return self.analyses.count()
