"""Search service for RAG using pgvector similarity search."""

import logging
from dataclasses import dataclass
from typing import Any, TYPE_CHECKING

from django.db import connection

from apps.rag.models import DocumentChunk, IndexedDocument, DocumentStatus
from apps.rag.services.embedding_service import get_embedding_service

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractUser

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """A single search result with relevance score."""

    chunk: DocumentChunk
    score: float
    document: IndexedDocument

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "chunk_id": str(self.chunk.id),
            "document_id": str(self.document.id),
            "content": self.chunk.content,
            "score": round(self.score, 4),
            "source_type": self.document.source_type,
            "title": self.document.title,
            "section": self.chunk.section,
            "metadata": {
                **self.document.metadata,
                **self.chunk.metadata,
            },
        }


class RAGSearchService:
    """Service for semantic search over the RAG knowledge base.

    Uses pgvector for efficient cosine similarity search with HNSW indexing.

    Usage:
        service = get_search_service()
        results = service.search(
            query="What Df values have I seen for DLA?",
            user=request.user,
            k=5,
        )
    """

    def __init__(self, embedding_service=None):
        self._embedding_service = embedding_service or get_embedding_service()

    def search(
        self,
        query: str,
        user: "AbstractUser",
        k: int = 5,
        min_score: float = 0.5,
        source_types: list[str] | None = None,
        include_global: bool = True,
    ) -> list[SearchResult]:
        """Search the knowledge base for relevant chunks.

        Args:
            query: The search query (natural language).
            user: The user performing the search (for data isolation).
            k: Maximum number of results to return.
            min_score: Minimum similarity score (0-1) to include.
            source_types: Filter by source types (simulation, analysis, etc.).
            include_global: Include global documents (scientific literature).

        Returns:
            List of SearchResult objects sorted by relevance.
        """
        # Generate query embedding
        query_embedding = self._embedding_service.embed_text(query)

        # Build SQL query with pgvector
        # Using cosine distance: 1 - (a <=> b) gives similarity
        sql = """
            SELECT
                c.id as chunk_id,
                c.content,
                c.section,
                c.metadata as chunk_metadata,
                d.id as document_id,
                d.title,
                d.source_type,
                d.metadata as document_metadata,
                1 - (c.embedding <=> %s::vector) as similarity
            FROM rag_document_chunks c
            JOIN rag_indexed_documents d ON c.document_id = d.id
            WHERE d.status = %s
            AND (
                (d.owner_id = %s AND d.is_global = false)
                OR (d.is_global = true AND %s = true)
            )
        """
        params: list[Any] = [
            str(query_embedding),
            DocumentStatus.READY,
            str(user.id),
            include_global,
        ]

        # Add source type filter
        if source_types:
            placeholders = ", ".join(["%s"] * len(source_types))
            sql += f" AND d.source_type IN ({placeholders})"
            params.extend(source_types)

        sql += """
            ORDER BY similarity DESC
            LIMIT %s
        """
        params.append(k * 2)  # Fetch extra for filtering by min_score

        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()

        # Convert to SearchResult objects
        results: list[SearchResult] = []
        seen_documents: set[str] = set()

        for row in rows:
            similarity = float(row[8])
            if similarity < min_score:
                continue

            document_id = str(row[4])

            # Optionally deduplicate by document
            # (uncomment if you want max 1 chunk per document)
            # if document_id in seen_documents:
            #     continue
            # seen_documents.add(document_id)

            # Fetch full objects
            try:
                chunk = DocumentChunk.objects.get(id=row[0])
                document = IndexedDocument.objects.get(id=row[4])
            except (DocumentChunk.DoesNotExist, IndexedDocument.DoesNotExist):
                continue

            results.append(
                SearchResult(
                    chunk=chunk,
                    score=similarity,
                    document=document,
                )
            )

            if len(results) >= k:
                break

        logger.info(
            f"RAG search for '{query[:50]}...' returned {len(results)} results"
        )
        return results

    def search_simulations(
        self,
        query: str,
        user: "AbstractUser",
        k: int = 5,
        algorithm: str | None = None,
    ) -> list[SearchResult]:
        """Search specifically for simulation results.

        Args:
            query: The search query.
            user: The user performing the search.
            k: Maximum results.
            algorithm: Filter by specific algorithm.

        Returns:
            List of SearchResult objects from simulations only.
        """
        results = self.search(
            query=query,
            user=user,
            k=k,
            source_types=["simulation"],
            include_global=False,
        )

        # Additional filtering by algorithm if specified
        if algorithm:
            results = [
                r
                for r in results
                if r.document.metadata.get("algorithm", "").lower()
                == algorithm.lower()
            ]

        return results

    def search_analyses(
        self,
        query: str,
        user: "AbstractUser",
        k: int = 5,
    ) -> list[SearchResult]:
        """Search specifically for FRAKTAL analysis results.

        Args:
            query: The search query.
            user: The user performing the search.
            k: Maximum results.

        Returns:
            List of SearchResult objects from analyses only.
        """
        return self.search(
            query=query,
            user=user,
            k=k,
            source_types=["analysis"],
            include_global=False,
        )

    def search_scientific(
        self,
        query: str,
        k: int = 5,
    ) -> list[SearchResult]:
        """Search scientific documentation (global documents only).

        This method searches global documents without user context,
        useful for finding literature references.

        Args:
            query: The search query.
            k: Maximum results.

        Returns:
            List of SearchResult objects from scientific docs.
        """
        # For global search, we need a user context but filter to global only
        # This is a bit awkward but maintains the API contract
        from django.contrib.auth import get_user_model

        User = get_user_model()
        system_user = User.objects.filter(is_superuser=True).first()

        if not system_user:
            logger.warning("No superuser found for global search")
            return []

        return self.search(
            query=query,
            user=system_user,
            k=k,
            source_types=["scientific_doc", "uploaded"],
            include_global=True,
        )


def get_search_service() -> RAGSearchService:
    """Factory function for search service.

    Returns:
        Configured RAGSearchService instance.
    """
    return RAGSearchService()
