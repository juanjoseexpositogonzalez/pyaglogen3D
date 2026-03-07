"""Embedding service for RAG using OpenAI text-embedding-3-small."""

import logging
from functools import lru_cache
from typing import Protocol

from django.conf import settings
import openai

logger = logging.getLogger(__name__)


class EmbeddingProvider(Protocol):
    """Protocol for embedding providers."""

    def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        ...

    @property
    def dimensions(self) -> int:
        """Return embedding dimensions."""
        ...

    @property
    def model_name(self) -> str:
        """Return model identifier."""
        ...


class OpenAIEmbeddingProvider:
    """OpenAI embedding provider using text-embedding-3-small.

    This model provides 1536-dimensional embeddings at low cost
    ($0.02 per 1M tokens) with excellent quality for semantic search.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "text-embedding-3-small",
    ):
        self._model = model
        self._client = openai.OpenAI(
            api_key=api_key or getattr(settings, "OPENAI_API_KEY", None)
        )
        self._dimensions = 1536  # text-embedding-3-small dimensions

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def model_name(self) -> str:
        return self._model

    def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text.

        Args:
            text: The text to embed.

        Returns:
            List of floats representing the embedding vector.
        """
        response = self._client.embeddings.create(
            model=self._model,
            input=text,
        )
        return response.data[0].embedding

    def embed_batch(
        self, texts: list[str], batch_size: int = 100
    ) -> list[list[float]]:
        """Generate embeddings for multiple texts in batches.

        Args:
            texts: List of texts to embed.
            batch_size: Maximum texts per API call (default 100).

        Returns:
            List of embedding vectors in the same order as input.
        """
        if not texts:
            return []

        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            response = self._client.embeddings.create(
                model=self._model,
                input=batch,
            )
            # Sort by index to maintain order
            sorted_data = sorted(response.data, key=lambda x: x.index)
            all_embeddings.extend([d.embedding for d in sorted_data])

        return all_embeddings


class EmbeddingService:
    """Main embedding service with preprocessing and provider abstraction.

    Usage:
        service = get_embedding_service()
        embedding = service.embed_text("Some text to embed")
        embeddings = service.embed_batch(["Text 1", "Text 2"])
    """

    def __init__(self, provider: EmbeddingProvider | None = None):
        self._provider = provider or self._get_default_provider()

    @staticmethod
    @lru_cache(maxsize=1)
    def _get_default_provider() -> EmbeddingProvider:
        """Get cached default provider."""
        return OpenAIEmbeddingProvider()

    def embed_text(self, text: str) -> list[float]:
        """Generate embedding for text with preprocessing.

        Args:
            text: The text to embed.

        Returns:
            Embedding vector as list of floats.
        """
        processed = self._preprocess(text)
        return self._provider.embed_text(processed)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for batch of texts.

        Args:
            texts: List of texts to embed.

        Returns:
            List of embedding vectors.
        """
        processed = [self._preprocess(t) for t in texts]
        return self._provider.embed_batch(processed)

    def _preprocess(self, text: str) -> str:
        """Preprocess text before embedding.

        - Normalizes whitespace
        - Truncates to max token limit
        """
        # Normalize whitespace
        text = " ".join(text.split())

        # Truncate if too long (8191 tokens max for OpenAI)
        # Approximate: 4 chars per token, leave margin
        max_chars = 30000
        if len(text) > max_chars:
            text = text[:max_chars]
            logger.warning(f"Text truncated to {max_chars} characters for embedding")

        return text

    @property
    def dimensions(self) -> int:
        """Return embedding dimensions."""
        return self._provider.dimensions

    @property
    def model_name(self) -> str:
        """Return model identifier."""
        return self._provider.model_name


def get_embedding_service() -> EmbeddingService:
    """Factory function for embedding service.

    Returns:
        Configured EmbeddingService instance.
    """
    return EmbeddingService()
