# Checklist: Document Ingestion

**Branch**: `feature/rag-ingestion`
**Depends on**: `feature/rag-core` merged
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] `feature/rag-core` merged to main
- [ ] Vector store working
- [ ] Embedding service working
- [ ] pdfplumber installed: `pip install pdfplumber`

---

## Backend Implementation

### PDF Processing Service

- [ ] Create `apps/rag/services/pdf_service.py`:
  - `PDFService` class
  - `extract_text(file_path: str) -> str`: Full text extraction
  - `extract_metadata(file_path: str) -> dict`: Title, authors, etc.
  - `extract_with_layout(file_path: str) -> list[PageContent]`: Per-page
  - Handle multi-column, tables, headers/footers

### Text Cleaning Service

- [ ] Create `apps/rag/services/text_cleaner.py`:
  - `TextCleaner` class
  - `clean(text: str) -> str`: Full pipeline
  - `fix_hyphenation(text) -> str`
  - `remove_headers_footers(pages) -> list`
  - `normalize_whitespace(text) -> str`
  - `remove_page_numbers(text) -> str`

### Chunking Service

- [ ] Create `apps/rag/services/chunker.py`:
  - `ChunkConfig` dataclass (size, overlap, strategy)
  - `Chunker` class
  - `chunk_document(text, metadata) -> list[Chunk]`
  - Support strategies: fixed, sentence, semantic, section
  - Default: semantic with 500 chars, 50 overlap

### Ingestion Pipeline

- [ ] Create `apps/rag/services/ingestion_service.py`:
  - `IngestionService` class
  - `ingest_pdf(document: Document) -> IngestionResult`:
    - Extract text from PDF
    - Clean text
    - Extract metadata
    - Chunk text
    - Generate embeddings
    - Store in vector database
    - Create DocumentChunk records
  - `ingest_text(document: Document, text: str) -> IngestionResult`:
    - For non-PDF sources

### Celery Tasks

- [ ] Create/update `apps/rag/tasks.py`:
  - `ingest_document_task(document_id: int)`:
    - Load document
    - Call ingestion service
    - Update document status
    - Handle errors
  - `reindex_document_task(document_id: int)`:
    - Delete existing chunks
    - Re-ingest

### File Upload Handling

- [ ] Update `apps/rag/views.py` - DocumentViewSet:
  - Handle file upload in create()
  - Validate file type (PDF only)
  - Save file to storage
  - Queue ingestion task

- [ ] Add to `apps/rag/serializers.py`:
  - `DocumentUploadSerializer`:
    - `file` (FileField, required)
    - `title` (CharField, optional - extract from PDF)
    - Validate file size (max 50MB)
    - Validate file type

### Storage Configuration

- [ ] Configure file storage:
  ```python
  # config/settings/base.py
  RAG_DOCUMENT_UPLOAD_PATH = "rag_documents/"
  RAG_MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
  ```

- [ ] Add to `.gitignore`:
  ```
  media/rag_documents/
  ```

---

## API Endpoints

- [ ] `POST /api/v1/rag/documents/upload/`:
  - Accept multipart form with PDF
  - Return document ID and status
  - Queue background ingestion

- [ ] `GET /api/v1/rag/documents/{id}/status/`:
  - Return ingestion progress

- [ ] `POST /api/v1/rag/documents/{id}/reindex/`:
  - Re-process existing document

---

## Testing

### Unit Tests

- [ ] Create `apps/rag/tests/test_pdf_service.py`:
  - Test text extraction
  - Test metadata extraction
  - Test with sample PDFs

- [ ] Create `apps/rag/tests/test_chunker.py`:
  - Test fixed chunking
  - Test semantic chunking
  - Test overlap
  - Test metadata preservation

- [ ] Create `apps/rag/tests/test_ingestion_service.py`:
  - Test full pipeline (mocked)
  - Test error handling

### Integration Tests

- [ ] Create `apps/rag/tests/test_ingestion_integration.py`:
  - Test with real PDF
  - Test Celery task
  - Verify chunks in vector store

### Test Data

- [ ] Add sample PDFs to `apps/rag/tests/fixtures/`:
  - `sample_paper.pdf` (simple single-column)
  - `sample_two_column.pdf` (multi-column layout)
  - `sample_with_tables.pdf` (tables)

---

## File Structure

```
apps/rag/
├── services/
│   ├── __init__.py
│   ├── embedding_service.py      # From rag-core
│   ├── search_service.py         # From rag-core
│   ├── vector_store/             # From rag-core
│   ├── pdf_service.py            # NEW
│   ├── text_cleaner.py           # NEW
│   ├── chunker.py                # NEW
│   └── ingestion_service.py      # NEW
├── tasks.py                       # NEW
└── tests/
    ├── fixtures/
    │   └── sample_paper.pdf
    ├── test_pdf_service.py
    ├── test_chunker.py
    └── test_ingestion_service.py
```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`
- [ ] Start Celery: `celery -A config worker -l info`

- [ ] Upload a PDF:
  ```bash
  http -f POST localhost:8000/api/v1/rag/documents/upload/ \
    Authorization:"Bearer <token>" \
    file@/path/to/paper.pdf
  ```

- [ ] Check status:
  ```bash
  http GET localhost:8000/api/v1/rag/documents/<id>/status/ \
    Authorization:"Bearer <token>"
  ```

- [ ] Wait for processing, then search:
  ```bash
  http POST localhost:8000/api/v1/rag/search/ \
    Authorization:"Bearer <token>" \
    query="fractal dimension"
  ```

- [ ] Verify:
  - Document record created
  - Chunks created in database
  - Embeddings stored in vector DB
  - Search returns relevant results

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/rag-ingestion`
- [ ] Commit services
- [ ] Commit tasks
- [ ] Commit views and tests
- [ ] Push: `git push -u origin feature/rag-ingestion`
- [ ] Create PR to main

---

## Definition of Done

- [ ] PDF extraction working
- [ ] Text cleaning implemented
- [ ] Chunking with multiple strategies
- [ ] Embedding generation for chunks
- [ ] Vector store integration
- [ ] File upload endpoint
- [ ] Background processing
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
