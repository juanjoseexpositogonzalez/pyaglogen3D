"""Celery tasks for RAG document indexing."""

import hashlib
import logging
from typing import Any

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def index_simulation_task(self, simulation_id: str) -> dict[str, Any]:
    """Index a completed simulation for RAG retrieval.

    This task is called automatically when a simulation completes.
    It creates or updates the IndexedDocument and its chunks with
    embedded vectors for semantic search.

    Args:
        simulation_id: UUID of the simulation to index.

    Returns:
        Dictionary with status and details.
    """
    from apps.simulations.models import Simulation, SimulationStatus
    from apps.rag.models import (
        IndexedDocument,
        DocumentChunk,
        DocumentSource,
        DocumentStatus,
    )
    from apps.rag.services.embedding_service import get_embedding_service
    from apps.rag.services.chunking import chunk_simulation_data

    try:
        simulation = Simulation.objects.select_related("project__owner").get(
            id=simulation_id
        )

        if simulation.status != SimulationStatus.COMPLETED:
            return {"status": "skipped", "reason": "Simulation not completed"}

        # Build content for hashing
        content = _build_simulation_content(simulation)
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        # Check if already indexed with same content
        existing = IndexedDocument.objects.filter(
            source_type=DocumentSource.SIMULATION,
            source_id=simulation.id,
        ).first()

        if existing and existing.content_hash == content_hash:
            return {"status": "skipped", "reason": "Already indexed, no changes"}

        # Create or update document
        if existing:
            # Delete old chunks
            existing.chunks.all().delete()
            doc = existing
        else:
            doc = IndexedDocument.objects.create(
                source_type=DocumentSource.SIMULATION,
                source_id=simulation.id,
                title=IndexedDocument._build_simulation_title(simulation),
                owner=simulation.project.owner,
                is_global=False,
                content_hash="",
            )

        doc.content_hash = content_hash
        doc.metadata = _build_simulation_metadata(simulation)
        doc.status = DocumentStatus.PROCESSING
        doc.save()

        # Chunk the content
        chunks = chunk_simulation_data(content, simulation)

        # Generate embeddings
        embedding_service = get_embedding_service()
        texts = [c["content"] for c in chunks]
        embeddings = embedding_service.embed_batch(texts)

        # Create chunk records
        chunk_objects = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_objects.append(
                DocumentChunk(
                    document=doc,
                    content=chunk["content"],
                    chunk_index=i,
                    embedding=embedding,
                    embedding_model=embedding_service.model_name,
                    section=chunk.get("section", ""),
                    metadata=chunk.get("metadata", {}),
                )
            )

        DocumentChunk.objects.bulk_create(chunk_objects)

        # Mark as ready
        doc.status = DocumentStatus.READY
        doc.indexed_at = timezone.now()
        doc.save()

        logger.info(
            f"Indexed simulation {simulation_id}: {len(chunk_objects)} chunks"
        )

        return {
            "status": "success",
            "document_id": str(doc.id),
            "chunks_created": len(chunk_objects),
        }

    except Simulation.DoesNotExist:
        logger.error(f"Simulation {simulation_id} not found")
        return {"status": "failed", "error": "Simulation not found"}

    except Exception as e:
        logger.exception(f"Failed to index simulation {simulation_id}")

        # Mark as failed
        IndexedDocument.objects.filter(
            source_type=DocumentSource.SIMULATION,
            source_id=simulation_id,
        ).update(status=DocumentStatus.FAILED, error_message=str(e))

        # Retry with exponential backoff
        if self.request.retries < self.max_retries:
            raise self.retry(countdown=60 * (self.request.retries + 1))

        return {"status": "failed", "error": str(e)}


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def index_analysis_task(self, analysis_id: str) -> dict[str, Any]:
    """Index a completed FRAKTAL analysis for RAG retrieval.

    Args:
        analysis_id: UUID of the analysis to index.

    Returns:
        Dictionary with status and details.
    """
    from apps.fractal_analysis.models import FraktalAnalysis, AnalysisStatus
    from apps.rag.models import (
        IndexedDocument,
        DocumentChunk,
        DocumentSource,
        DocumentStatus,
    )
    from apps.rag.services.embedding_service import get_embedding_service
    from apps.rag.services.chunking import chunk_analysis_data

    try:
        analysis = FraktalAnalysis.objects.select_related("project__owner").get(
            id=analysis_id
        )

        if analysis.status != AnalysisStatus.COMPLETED:
            return {"status": "skipped", "reason": "Analysis not completed"}

        # Build content for hashing
        content = _build_analysis_content(analysis)
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        # Check if already indexed
        existing = IndexedDocument.objects.filter(
            source_type=DocumentSource.ANALYSIS,
            source_id=analysis.id,
        ).first()

        if existing and existing.content_hash == content_hash:
            return {"status": "skipped", "reason": "Already indexed, no changes"}

        # Create or update document
        if existing:
            existing.chunks.all().delete()
            doc = existing
        else:
            doc = IndexedDocument.objects.create(
                source_type=DocumentSource.ANALYSIS,
                source_id=analysis.id,
                title=IndexedDocument._build_analysis_title(analysis),
                owner=analysis.project.owner,
                is_global=False,
                content_hash="",
            )

        doc.content_hash = content_hash
        doc.metadata = _build_analysis_metadata(analysis)
        doc.status = DocumentStatus.PROCESSING
        doc.save()

        # Chunk the content
        chunks = chunk_analysis_data(content, analysis)

        # Generate embeddings
        embedding_service = get_embedding_service()
        texts = [c["content"] for c in chunks]
        embeddings = embedding_service.embed_batch(texts)

        # Create chunk records
        chunk_objects = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_objects.append(
                DocumentChunk(
                    document=doc,
                    content=chunk["content"],
                    chunk_index=i,
                    embedding=embedding,
                    embedding_model=embedding_service.model_name,
                    section=chunk.get("section", ""),
                    metadata=chunk.get("metadata", {}),
                )
            )

        DocumentChunk.objects.bulk_create(chunk_objects)

        doc.status = DocumentStatus.READY
        doc.indexed_at = timezone.now()
        doc.save()

        logger.info(f"Indexed analysis {analysis_id}: {len(chunk_objects)} chunks")

        return {
            "status": "success",
            "document_id": str(doc.id),
            "chunks_created": len(chunk_objects),
        }

    except FraktalAnalysis.DoesNotExist:
        logger.error(f"Analysis {analysis_id} not found")
        return {"status": "failed", "error": "Analysis not found"}

    except Exception as e:
        logger.exception(f"Failed to index analysis {analysis_id}")

        IndexedDocument.objects.filter(
            source_type=DocumentSource.ANALYSIS,
            source_id=analysis_id,
        ).update(status=DocumentStatus.FAILED, error_message=str(e))

        if self.request.retries < self.max_retries:
            raise self.retry(countdown=60 * (self.request.retries + 1))

        return {"status": "failed", "error": str(e)}


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def index_scientific_document_task(self, document_id: str) -> dict[str, Any]:
    """Index an uploaded scientific document.

    Args:
        document_id: UUID of the IndexedDocument to process.

    Returns:
        Dictionary with status and details.
    """
    from apps.rag.models import IndexedDocument, DocumentChunk, DocumentStatus
    from apps.rag.services.embedding_service import get_embedding_service
    from apps.rag.services.chunking import chunk_scientific_document

    try:
        doc = IndexedDocument.objects.get(id=document_id)
        doc.status = DocumentStatus.PROCESSING
        doc.save()

        # Get content from abstract or file
        if doc.file:
            content = _extract_text_from_file(doc.file)
        else:
            content = doc.abstract

        if not content:
            doc.status = DocumentStatus.FAILED
            doc.error_message = "No content to index"
            doc.save()
            return {"status": "failed", "error": "No content to index"}

        # Update content hash
        doc.content_hash = hashlib.sha256(content.encode()).hexdigest()
        doc.save()

        # Delete existing chunks
        doc.chunks.all().delete()

        # Chunk with scientific document strategy
        chunks = chunk_scientific_document(content, doc)

        # Generate embeddings
        embedding_service = get_embedding_service()
        texts = [c["content"] for c in chunks]
        embeddings = embedding_service.embed_batch(texts)

        # Create chunks
        chunk_objects = [
            DocumentChunk(
                document=doc,
                content=chunk["content"],
                chunk_index=i,
                embedding=embedding,
                embedding_model=embedding_service.model_name,
                section=chunk.get("section", ""),
                page_number=chunk.get("page"),
                metadata=chunk.get("metadata", {}),
            )
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]

        DocumentChunk.objects.bulk_create(chunk_objects)

        doc.status = DocumentStatus.READY
        doc.indexed_at = timezone.now()
        doc.save()

        logger.info(
            f"Indexed scientific document {document_id}: {len(chunk_objects)} chunks"
        )

        return {"status": "success", "chunks_created": len(chunk_objects)}

    except IndexedDocument.DoesNotExist:
        logger.error(f"Document {document_id} not found")
        return {"status": "failed", "error": "Document not found"}

    except Exception as e:
        logger.exception(f"Failed to index document {document_id}")

        try:
            doc = IndexedDocument.objects.get(id=document_id)
            doc.status = DocumentStatus.FAILED
            doc.error_message = str(e)
            doc.save()
        except IndexedDocument.DoesNotExist:
            pass

        if self.request.retries < self.max_retries:
            raise self.retry(countdown=60 * (self.request.retries + 1))

        return {"status": "failed", "error": str(e)}


@shared_task
def reindex_all_user_data(user_id: str) -> dict[str, Any]:
    """Reindex all simulations and analyses for a user.

    This is a manual trigger for backfilling existing data.

    Args:
        user_id: UUID of the user.

    Returns:
        Dictionary with count of queued items.
    """
    from django.contrib.auth import get_user_model
    from apps.simulations.models import Simulation, SimulationStatus
    from apps.fractal_analysis.models import FraktalAnalysis, AnalysisStatus

    User = get_user_model()

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return {"status": "failed", "error": "User not found"}

    indexed_count = 0

    # Index simulations
    simulations = Simulation.objects.filter(
        project__owner=user,
        status=SimulationStatus.COMPLETED,
    ).values_list("id", flat=True)

    for sim_id in simulations:
        index_simulation_task.delay(str(sim_id))
        indexed_count += 1

    # Index FRAKTAL analyses
    analyses = FraktalAnalysis.objects.filter(
        project__owner=user,
        status=AnalysisStatus.COMPLETED,
    ).values_list("id", flat=True)

    for analysis_id in analyses:
        index_analysis_task.delay(str(analysis_id))
        indexed_count += 1

    logger.info(f"Queued {indexed_count} items for reindexing for user {user.email}")

    return {"status": "success", "queued": indexed_count}


# Helper functions


def _build_simulation_content(simulation) -> str:
    """Build textual content from simulation for indexing."""
    parts = [
        f"Simulation: {simulation.name or 'Unnamed'}",
        f"Algorithm: {simulation.get_algorithm_display()}",
        f"Parameters: {_format_parameters(simulation.parameters)}",
    ]

    if simulation.metrics:
        parts.append(f"Results: {_format_metrics(simulation.metrics)}")

    return "\n\n".join(parts)


def _build_simulation_metadata(simulation) -> dict[str, Any]:
    """Extract metadata for filtering."""
    return {
        "algorithm": simulation.algorithm,
        "n_particles": simulation.parameters.get("n_particles"),
        "fractal_dimension": (
            simulation.metrics.get("fractal_dimension") if simulation.metrics else None
        ),
        "project_id": str(simulation.project_id),
        "created_at": simulation.created_at.isoformat(),
    }


def _build_analysis_content(analysis) -> str:
    """Build textual content from analysis for indexing."""
    parts = [
        f"FRAKTAL Analysis: {analysis.name or 'Unnamed'}",
        f"Model: {analysis.get_model_display()}",
        f"Source: {analysis.get_source_type_display()}",
    ]

    if analysis.results:
        parts.append(f"Results: {_format_analysis_results(analysis.results)}")

    return "\n\n".join(parts)


def _build_analysis_metadata(analysis) -> dict[str, Any]:
    """Extract metadata for filtering."""
    return {
        "model": analysis.model,
        "source_type": analysis.source_type,
        "fractal_dimension": analysis.results.get("df") if analysis.results else None,
        "project_id": str(analysis.project_id),
        "created_at": analysis.created_at.isoformat(),
    }


def _format_parameters(params: dict) -> str:
    """Format parameters as readable text."""
    return ", ".join(f"{k}={v}" for k, v in params.items())


def _format_metrics(metrics: dict) -> str:
    """Format metrics as readable text."""
    key_metrics = ["fractal_dimension", "radius_of_gyration", "porosity", "prefactor"]
    parts = []
    for key in key_metrics:
        if key in metrics:
            value = metrics[key]
            if isinstance(value, float):
                parts.append(f"{key}={value:.4f}")
            else:
                parts.append(f"{key}={value}")
    return ", ".join(parts)


def _format_analysis_results(results: dict) -> str:
    """Format analysis results as readable text."""
    key_results = ["df", "rg", "npo", "kf"]
    parts = []
    for key in key_results:
        if key in results:
            value = results[key]
            if isinstance(value, float):
                parts.append(f"{key}={value:.4f}")
            else:
                parts.append(f"{key}={value}")
    return ", ".join(parts)


def _extract_text_from_file(file) -> str:
    """Extract text from uploaded file.

    Currently supports plain text files.
    TODO: Add PDF extraction with pypdf or similar.
    """
    try:
        content = file.read()
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="ignore")
        return content
    except Exception as e:
        logger.warning(f"Failed to extract text from file: {e}")
        return ""
