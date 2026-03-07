"""RAG models for document indexing and retrieval."""

import uuid
from typing import TYPE_CHECKING

from django.conf import settings
from django.db import models
from pgvector.django import VectorField

if TYPE_CHECKING:
    from apps.simulations.models import Simulation
    from apps.fractal_analysis.models import FraktalAnalysis


class DocumentSource(models.TextChoices):
    """Source type of the indexed document."""

    SIMULATION = "simulation", "Simulation Results"
    ANALYSIS = "analysis", "Analysis Results"
    STUDY = "study", "Parametric Study"
    SCIENTIFIC_DOC = "scientific_doc", "Scientific Documentation"
    UPLOADED = "uploaded", "Uploaded Document"


class DocumentStatus(models.TextChoices):
    """Document processing status."""

    PENDING = "pending", "Pending"
    PROCESSING = "processing", "Processing"
    READY = "ready", "Ready"
    FAILED = "failed", "Failed"


class IndexedDocument(models.Model):
    """Represents a document in the RAG knowledge base.

    Each document can be:
    - A user's simulation (auto-indexed on completion)
    - A user's analysis (auto-indexed on completion)
    - Scientific literature (global, admin-uploaded)
    - User-uploaded documentation
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Source tracking
    source_type = models.CharField(
        max_length=30,
        choices=DocumentSource.choices,
        db_index=True,
    )
    source_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
        help_text="ID of source object (simulation, analysis, etc.)",
    )

    # Document metadata
    title = models.CharField(max_length=500)
    content_hash = models.CharField(
        max_length=64,
        db_index=True,
        help_text="SHA-256 hash to detect content changes",
    )

    # For scientific docs
    authors = models.JSONField(default=list, blank=True)
    year = models.IntegerField(null=True, blank=True)
    abstract = models.TextField(blank=True)
    url = models.URLField(blank=True)
    file = models.FileField(upload_to="rag_documents/", null=True, blank=True)

    # Processing status
    status = models.CharField(
        max_length=20,
        choices=DocumentStatus.choices,
        default=DocumentStatus.PENDING,
        db_index=True,
    )
    error_message = models.TextField(blank=True)

    # Structured metadata for filtering
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional metadata (algorithm, parameters, metrics, etc.)",
    )

    # Ownership (for user data isolation)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="indexed_documents",
        help_text="Owner for user-specific documents (simulations, analyses)",
    )
    is_global = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Global documents (scientific literature) visible to all users",
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    indexed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "rag_indexed_documents"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["source_type", "source_id"]),
            models.Index(fields=["owner", "source_type"]),
            models.Index(fields=["is_global", "status"]),
        ]
        verbose_name = "Indexed Document"
        verbose_name_plural = "Indexed Documents"

    def __str__(self) -> str:
        return f"{self.get_source_type_display()}: {self.title}"

    @classmethod
    def get_or_create_for_simulation(
        cls, simulation: "Simulation"
    ) -> tuple["IndexedDocument", bool]:
        """Get or create an IndexedDocument for a simulation."""
        return cls.objects.get_or_create(
            source_type=DocumentSource.SIMULATION,
            source_id=simulation.id,
            defaults={
                "title": cls._build_simulation_title(simulation),
                "owner": simulation.project.owner,
                "is_global": False,
                "content_hash": "",
            },
        )

    @classmethod
    def get_or_create_for_analysis(
        cls, analysis: "FraktalAnalysis"
    ) -> tuple["IndexedDocument", bool]:
        """Get or create an IndexedDocument for a FRAKTAL analysis."""
        return cls.objects.get_or_create(
            source_type=DocumentSource.ANALYSIS,
            source_id=analysis.id,
            defaults={
                "title": cls._build_analysis_title(analysis),
                "owner": analysis.project.owner,
                "is_global": False,
                "content_hash": "",
            },
        )

    @staticmethod
    def _build_simulation_title(simulation: "Simulation") -> str:
        """Generate a descriptive title for a simulation."""
        n_particles = simulation.parameters.get("n_particles", "?")
        return f"{simulation.algorithm.upper()} simulation with {n_particles} particles"

    @staticmethod
    def _build_analysis_title(analysis: "FraktalAnalysis") -> str:
        """Generate a descriptive title for an analysis."""
        return f"FRAKTAL {analysis.model.upper()} analysis"


class DocumentChunk(models.Model):
    """A chunk of text from a document with its embedding vector.

    Chunks are created during indexing and stored with their embeddings
    for efficient semantic search using pgvector.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        IndexedDocument,
        on_delete=models.CASCADE,
        related_name="chunks",
    )

    # Chunk content
    content = models.TextField()
    chunk_index = models.IntegerField(
        help_text="Order of this chunk within the document"
    )

    # Embedding vector (1536 dimensions for text-embedding-3-small)
    embedding = VectorField(dimensions=1536, null=True, blank=True)
    embedding_model = models.CharField(
        max_length=100, default="text-embedding-3-small"
    )

    # Chunk metadata
    section = models.CharField(
        max_length=200,
        blank=True,
        help_text="Section heading if applicable",
    )
    page_number = models.IntegerField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "rag_document_chunks"
        ordering = ["document", "chunk_index"]
        verbose_name = "Document Chunk"
        verbose_name_plural = "Document Chunks"

    def __str__(self) -> str:
        preview = self.content[:50] + "..." if len(self.content) > 50 else self.content
        return f"Chunk {self.chunk_index}: {preview}"
