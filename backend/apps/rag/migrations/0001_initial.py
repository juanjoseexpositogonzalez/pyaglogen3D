"""Initial migration for RAG app with pgvector support."""

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import pgvector.django


class Migration(migrations.Migration):
    """Create RAG models with pgvector extension."""

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # Enable pgvector extension
        migrations.RunSQL(
            "CREATE EXTENSION IF NOT EXISTS vector;",
            reverse_sql="DROP EXTENSION IF EXISTS vector;",
        ),
        # Create IndexedDocument model
        migrations.CreateModel(
            name="IndexedDocument",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "source_type",
                    models.CharField(
                        choices=[
                            ("simulation", "Simulation Results"),
                            ("analysis", "Analysis Results"),
                            ("study", "Parametric Study"),
                            ("scientific_doc", "Scientific Documentation"),
                            ("uploaded", "Uploaded Document"),
                        ],
                        db_index=True,
                        max_length=30,
                    ),
                ),
                (
                    "source_id",
                    models.UUIDField(
                        blank=True,
                        db_index=True,
                        help_text="ID of source object (simulation, analysis, etc.)",
                        null=True,
                    ),
                ),
                ("title", models.CharField(max_length=500)),
                (
                    "content_hash",
                    models.CharField(
                        db_index=True,
                        help_text="SHA-256 hash to detect content changes",
                        max_length=64,
                    ),
                ),
                ("authors", models.JSONField(blank=True, default=list)),
                ("year", models.IntegerField(blank=True, null=True)),
                ("abstract", models.TextField(blank=True)),
                ("url", models.URLField(blank=True)),
                (
                    "file",
                    models.FileField(
                        blank=True, null=True, upload_to="rag_documents/"
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("processing", "Processing"),
                            ("ready", "Ready"),
                            ("failed", "Failed"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("error_message", models.TextField(blank=True)),
                (
                    "metadata",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="Additional metadata (algorithm, parameters, metrics, etc.)",
                    ),
                ),
                (
                    "is_global",
                    models.BooleanField(
                        db_index=True,
                        default=False,
                        help_text="Global documents (scientific literature) visible to all users",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("indexed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "owner",
                    models.ForeignKey(
                        blank=True,
                        help_text="Owner for user-specific documents (simulations, analyses)",
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="indexed_documents",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Indexed Document",
                "verbose_name_plural": "Indexed Documents",
                "db_table": "rag_indexed_documents",
                "ordering": ["-created_at"],
            },
        ),
        # Create DocumentChunk model
        migrations.CreateModel(
            name="DocumentChunk",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("content", models.TextField()),
                (
                    "chunk_index",
                    models.IntegerField(
                        help_text="Order of this chunk within the document"
                    ),
                ),
                (
                    "embedding",
                    pgvector.django.VectorField(
                        blank=True, dimensions=1536, null=True
                    ),
                ),
                (
                    "embedding_model",
                    models.CharField(
                        default="text-embedding-3-small", max_length=100
                    ),
                ),
                (
                    "section",
                    models.CharField(
                        blank=True,
                        help_text="Section heading if applicable",
                        max_length=200,
                    ),
                ),
                ("page_number", models.IntegerField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chunks",
                        to="rag.indexeddocument",
                    ),
                ),
            ],
            options={
                "verbose_name": "Document Chunk",
                "verbose_name_plural": "Document Chunks",
                "db_table": "rag_document_chunks",
                "ordering": ["document", "chunk_index"],
            },
        ),
        # Add indexes for IndexedDocument
        migrations.AddIndex(
            model_name="indexeddocument",
            index=models.Index(
                fields=["source_type", "source_id"],
                name="rag_indexed_source_type_e98a75_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="indexeddocument",
            index=models.Index(
                fields=["owner", "source_type"],
                name="rag_indexed_owner_i_0c6e7a_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="indexeddocument",
            index=models.Index(
                fields=["is_global", "status"],
                name="rag_indexed_is_glob_8d3d0a_idx",
            ),
        ),
        # Create HNSW index for vector similarity search
        migrations.RunSQL(
            """
            CREATE INDEX IF NOT EXISTS rag_chunk_embedding_hnsw_idx
            ON rag_document_chunks
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);
            """,
            reverse_sql="DROP INDEX IF EXISTS rag_chunk_embedding_hnsw_idx;",
        ),
    ]
