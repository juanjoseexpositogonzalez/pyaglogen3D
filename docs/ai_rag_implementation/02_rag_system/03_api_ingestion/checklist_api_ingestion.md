# Checklist: API Ingestion

**Branch**: `feature/rag-api-ingestion`
**Depends on**: `feature/rag-ingestion` merged
**Estimated time**: 1 day

---

## Prerequisites

- [ ] `feature/rag-ingestion` merged to main
- [ ] Document ingestion pipeline working
- [ ] Install: `pip install arxiv requests`

---

## Backend Implementation

### Paper Sources

- [ ] Create `apps/rag/services/sources/__init__.py`

- [ ] Create `apps/rag/services/sources/base.py`:
  - `Paper` dataclass (source, source_id, title, authors, abstract, year, pdf_url, metadata)
  - `PaperSource` abstract base class
  - `search(query, limit) -> list[Paper]`
  - `get_paper(paper_id) -> Paper`
  - `download_pdf(paper, output_path) -> bool`

- [ ] Create `apps/rag/services/sources/arxiv_source.py`:
  - `ArxivSource(PaperSource)` implementation
  - Rate limiting (1 request per 3 seconds)
  - Query building for arXiv syntax
  - PDF download

- [ ] Create `apps/rag/services/sources/semantic_scholar_source.py`:
  - `SemanticScholarSource(PaperSource)` implementation
  - API key support (optional, higher limits)
  - Handle papers without PDFs

### Paper Search Service

- [ ] Create `apps/rag/services/paper_search_service.py`:
  - `PaperSearchService` class
  - `search_all(query, limit) -> list[Paper]`:
    - Search both arXiv and Semantic Scholar
    - Deduplicate results
    - Sort by relevance
  - `search_arxiv(query, limit) -> list[Paper]`
  - `search_semantic_scholar(query, limit) -> list[Paper]`
  - `get_paper(source, paper_id) -> Paper`

### API Ingestion Service

- [ ] Create `apps/rag/services/api_ingestion_service.py`:
  - `APIIngestionService` class
  - `import_paper(paper: Paper) -> Document`:
    - Create Document record
    - Download PDF if available
    - Queue ingestion task
  - `import_abstract_only(paper: Paper) -> Document`:
    - For papers without accessible PDFs
    - Create single chunk from abstract

### Celery Tasks

- [ ] Update `apps/rag/tasks.py`:
  - `import_paper_task(source: str, paper_id: str)`:
    - Fetch paper metadata
    - Download PDF
    - Call ingestion
  - `search_new_papers_task()`:
    - Weekly task for knowledge base updates
    - Find new papers in configured topics

### Models

- [ ] Add `PendingPaper` model (optional, for admin review):
  - `source` (CharField)
  - `source_id` (CharField)
  - `title` (CharField)
  - `metadata` (JSONField)
  - `status` (pending, approved, rejected)
  - `discovered_at` (DateTimeField)

### Serializers

- [ ] Add to `apps/rag/serializers.py`:
  - `PaperSearchSerializer` (input):
    - `query` (CharField, required)
    - `sources` (ListField, optional: arxiv, semantic_scholar)
    - `limit` (IntegerField, default 10)
  - `PaperResultSerializer` (output):
    - All Paper fields
    - `already_imported` (bool)
  - `ImportPaperSerializer` (input):
    - `source` (CharField)
    - `source_id` (CharField)

### Views

- [ ] Add to `apps/rag/views.py`:
  - `PaperSearchView`:
    - `POST /rag/papers/search/`
    - Search arXiv and Semantic Scholar
    - Return results with import status
  - `ImportPaperView`:
    - `POST /rag/papers/import/`
    - Import paper from external source
    - Queue background ingestion

### URLs

- [ ] Update `apps/rag/urls.py`:
  ```python
  path('papers/search/', PaperSearchView.as_view(), name='paper-search'),
  path('papers/import/', ImportPaperView.as_view(), name='paper-import'),
  ```

---

## Configuration

- [ ] Add to `config/settings/base.py`:
  ```python
  # API Ingestion
  RAG_ARXIV_RATE_LIMIT = 0.33  # requests per second
  RAG_S2_API_KEY = env("SEMANTIC_SCHOLAR_API_KEY", default="")
  RAG_AUTO_DISCOVER_TOPICS = [
      "fractal aggregation",
      "DLA simulation",
      "aerosol nanoparticle"
  ]
  ```

- [ ] Add to `.env.example`:
  ```
  SEMANTIC_SCHOLAR_API_KEY=
  ```

---

## Testing

### Unit Tests

- [ ] Create `apps/rag/tests/test_arxiv_source.py`:
  - Test search (mocked API)
  - Test paper retrieval
  - Test rate limiting

- [ ] Create `apps/rag/tests/test_semantic_scholar_source.py`:
  - Test search (mocked API)
  - Test paper retrieval
  - Test missing PDF handling

- [ ] Create `apps/rag/tests/test_paper_search_service.py`:
  - Test combined search
  - Test deduplication

### Integration Tests

- [ ] Create `apps/rag/tests/test_api_ingestion_integration.py`:
  - Test full import flow
  - Test with real API (mark as slow, optional)

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/rag/papers/search/` | Search academic APIs |
| POST | `/api/v1/rag/papers/import/` | Import paper by source ID |

---

## Manual Testing

- [ ] Start Django server and Celery

- [ ] Search for papers:
  ```bash
  http POST localhost:8000/api/v1/rag/papers/search/ \
    Authorization:"Bearer <token>" \
    query="fractal dimension aggregation" \
    limit:=5
  ```

- [ ] Import a paper:
  ```bash
  http POST localhost:8000/api/v1/rag/papers/import/ \
    Authorization:"Bearer <token>" \
    source=arxiv \
    source_id="2401.12345"
  ```

- [ ] Verify:
  - Document created
  - PDF downloaded (if available)
  - Ingestion task queued
  - Eventually searchable

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/rag-api-ingestion`
- [ ] Commit source implementations
- [ ] Commit services and tasks
- [ ] Commit views and tests
- [ ] Push: `git push -u origin feature/rag-api-ingestion`
- [ ] Create PR to main

---

## Definition of Done

- [ ] arXiv source working
- [ ] Semantic Scholar source working
- [ ] Paper search combining both
- [ ] Import functionality working
- [ ] PDF download working
- [ ] Abstract-only fallback working
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
