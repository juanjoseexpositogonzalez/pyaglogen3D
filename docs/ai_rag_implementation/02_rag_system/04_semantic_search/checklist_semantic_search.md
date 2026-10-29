# Checklist: Semantic Search

**Branch**: `feature/rag-search`
**Depends on**: `feature/rag-ingestion` merged
**Estimated time**: 1 day

---

## Prerequisites

- [ ] `feature/rag-ingestion` merged
- [ ] Documents ingested in vector store
- [ ] Install: `pip install sentence-transformers`

---

## Backend Implementation

### Search Service Enhancement

- [ ] Update `apps/rag/services/search_service.py`:
  - `SearchConfig` dataclass (k, rerank, filters, hybrid)
  - `search(query, config) -> list[SearchResult]`:
    - Embed query
    - Vector search
    - Apply metadata filters
    - Optional reranking
    - Return formatted results
  - `hybrid_search(query, config) -> list[SearchResult]`:
    - Vector search
    - Keyword search (PostgreSQL full-text)
    - Merge with RRF

### Reranker Service

- [ ] Create `apps/rag/services/reranker_service.py`:
  - `RerankerService` class
  - `__init__(model_name)`: Load cross-encoder
  - `rerank(query, results, top_k) -> list[SearchResult]`
  - Batch processing for efficiency

### Query Processor

- [ ] Create `apps/rag/services/query_processor.py`:
  - `QueryProcessor` class
  - `expand_abbreviations(query) -> str`
  - `extract_filters(query) -> tuple[str, dict]`:
    - Parse "papers from 2020" → (query, {"year": 2020})
  - `preprocess(query) -> ProcessedQuery`

### Serializers

- [ ] Update `apps/rag/serializers.py`:
  - `SearchQuerySerializer`:
    - `query` (CharField, required)
    - `k` (IntegerField, default 10)
    - `rerank` (BooleanField, default True)
    - `filters` (DictField, optional)
    - `min_score` (FloatField, optional)
  - `SearchResultSerializer`:
    - `chunk_id`, `content`, `score`
    - `document`: nested document info
    - `highlights` (optional)

### Views

- [ ] Update `apps/rag/views.py` - SearchView:
  - Accept search parameters
  - Return formatted results
  - Include document metadata
  - Optional: highlight matches

### Configuration

- [ ] Add to `config/settings/base.py`:
  ```python
  RAG_RERANK_ENABLED = env.bool("RAG_RERANK_ENABLED", default=True)
  RAG_RERANK_MODEL = env(
      "RAG_RERANK_MODEL",
      default="cross-encoder/ms-marco-MiniLM-L-6-v2"
  )
  RAG_DEFAULT_K = env.int("RAG_DEFAULT_K", default=10)
  RAG_MIN_SCORE_THRESHOLD = env.float("RAG_MIN_SCORE_THRESHOLD", default=0.5)
  ```

---

## Testing

### Unit Tests

- [ ] Create `apps/rag/tests/test_search_service.py`:
  - Test basic search
  - Test with filters
  - Test score normalization
  - Test empty results

- [ ] Create `apps/rag/tests/test_reranker.py`:
  - Test reranking improves order
  - Test batch processing
  - Test with various inputs

- [ ] Create `apps/rag/tests/test_query_processor.py`:
  - Test abbreviation expansion
  - Test filter extraction

### Integration Tests

- [ ] Create `apps/rag/tests/test_search_integration.py`:
  - Test end-to-end search
  - Test search quality with known documents

---

## API Response Format

```json
{
    "query": "fractal dimension DLA",
    "total_results": 25,
    "results": [
        {
            "chunk_id": "uuid",
            "content": "The fractal dimension of DLA aggregates...",
            "score": 0.92,
            "rerank_score": 0.95,
            "document": {
                "id": "uuid",
                "title": "DLA Study",
                "authors": ["Smith"],
                "year": 2024
            },
            "metadata": {
                "page_number": 5,
                "section": "Results"
            }
        }
    ]
}
```

---

## Manual Testing

- [ ] Search with various queries
- [ ] Compare with/without reranking
- [ ] Test filter functionality
- [ ] Verify result relevance

---

## Git

- [ ] Create branch: `git checkout -b feature/rag-search`
- [ ] Implement and test
- [ ] Push and create PR

---

## Definition of Done

- [ ] Search service with reranking
- [ ] Query preprocessing
- [ ] Metadata filtering
- [ ] All tests passing
- [ ] PR merged
