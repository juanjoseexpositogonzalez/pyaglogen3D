# Checklist: RAG Core Infrastructure

**Branch**: `feature/rag-core`
**Depends on**: `feature/ai-core` merged
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] `feature/ai-core` merged to main
- [ ] ChromaDB installed: `pip install chromadb`
- [ ] Embedding model accessible (OpenAI API key or local model)

---

## Backend Implementation

### App Setup

- [ ] Create Django app if not exists:
  ```bash
  python manage.py startapp rag
  mv rag apps/
  ```

- [ ] Update `apps/rag/apps.py`:
  ```python
  name = "apps.rag"
  ```

- [ ] Add to `config/settings/base.py` INSTALLED_APPS:
  ```python
  "apps.rag",
  ```

### Models

- [ ] Create `apps/rag/models.py`:

#### Document Model
- Fields:
  - `id` (UUID, primary key)
  - `title` (CharField, max 500)
  - `authors` (JSONField, list of strings)
  - `year` (IntegerField, nullable)
  - `abstract` (TextField, nullable)
  - `source` (CharField: upload, arxiv, semantic_scholar)
  - `source_id` (CharField, nullable - external ID)
  - `file` (FileField, nullable - for uploads)
  - `url` (URLField, nullable)
  - `metadata` (JSONField)
  - `status` (CharField: pending, processing, ready, failed)
  - `created_at` (DateTimeField)
  - `updated_at` (DateTimeField)

#### DocumentChunk Model
- Fields:
  - `id` (UUID, primary key)
  - `document` (ForeignKey to Document)
  - `content` (TextField)
  - `chunk_index` (IntegerField)
  - `page_number` (IntegerField, nullable)
  - `section` (CharField, nullable)
  - `embedding` (JSONField - temporary for ChromaDB)
  - `embedding_model` (CharField)
  - `metadata` (JSONField)
  - `created_at` (DateTimeField)

- [ ] Create migration: `python manage.py makemigrations rag`
- [ ] Apply migration: `python manage.py migrate`

### Embedding Service

- [ ] Create `apps/rag/services/__init__.py`

- [ ] Create `apps/rag/services/embedding_service.py`:
  - `EmbeddingService` class
  - `__init__(model_name: str = None)`: Load configured model
  - `embed_text(text: str) -> list[float]`: Single embedding
  - `embed_batch(texts: list[str]) -> list[list[float]]`: Batch embedding
  - `get_model_info() -> dict`: Model name, dimensions

- [ ] Support multiple embedding providers:
  - OpenAI: `text-embedding-3-small`
  - Sentence Transformers: `all-MiniLM-L6-v2`
  - Configure via settings

### Vector Store Abstraction

- [ ] Create `apps/rag/services/vector_store/__init__.py`

- [ ] Create `apps/rag/services/vector_store/base.py`:
  - `VectorStore` abstract base class
  - `add_chunks(chunks: list[DocumentChunk], embeddings: list) -> None`
  - `search(query_embedding: list, k: int, filters: dict) -> list[SearchResult]`
  - `delete_by_document(document_id: str) -> None`
  - `get_stats() -> dict`

- [ ] Create `apps/rag/services/vector_store/chroma_store.py`:
  - `ChromaStore(VectorStore)` implementation
  - Initialize with persistent storage path
  - Implement all abstract methods

- [ ] Create `apps/rag/services/vector_store/factory.py`:
  - `get_vector_store() -> VectorStore`
  - Return appropriate store based on settings

### Search Service

- [ ] Create `apps/rag/services/search_service.py`:
  - `SearchService` class
  - `__init__()`: Initialize embedding + vector store
  - `search(query: str, k: int = 10, filters: dict = None) -> list[SearchResult]`:
    - Embed query
    - Search vector store
    - Return results with metadata

### Configuration

- [ ] Add to `config/settings/base.py`:
  ```python
  # RAG Settings
  RAG_VECTOR_DB_BACKEND = env("RAG_VECTOR_DB_BACKEND", default="chromadb")
  RAG_VECTOR_DB_PATH = BASE_DIR / "data" / "chromadb"
  RAG_EMBEDDING_MODEL = env("RAG_EMBEDDING_MODEL", default="openai")
  RAG_EMBEDDING_MODEL_NAME = env(
      "RAG_EMBEDDING_MODEL_NAME",
      default="text-embedding-3-small"
  )
  RAG_CHUNK_SIZE = env.int("RAG_CHUNK_SIZE", default=500)
  RAG_CHUNK_OVERLAP = env.int("RAG_CHUNK_OVERLAP", default=50)
  ```

- [ ] Create data directory:
  ```bash
  mkdir -p data/chromadb
  echo "data/" >> .gitignore
  ```

### Serializers

- [ ] Create `apps/rag/serializers.py`:
  - `DocumentSerializer`:
    - Read: all fields + chunk_count
    - Write: title, authors, year, abstract, source, metadata
  - `DocumentChunkSerializer`:
    - Read only: id, content, chunk_index, page_number, section
  - `SearchResultSerializer`:
    - Read: chunk, score, document

### Views

- [ ] Create `apps/rag/views.py`:
  - `DocumentViewSet`:
    - List, create, retrieve, delete
    - Filter by source, status
    - Permission: IsAIUser
  - `SearchView`:
    - `POST /rag/search/` with query
    - Return top-k results

### URLs

- [ ] Create `apps/rag/urls.py`:
  ```python
  router = DefaultRouter()
  router.register('documents', DocumentViewSet, basename='document')

  urlpatterns = [
      path('', include(router.urls)),
      path('search/', SearchView.as_view(), name='rag-search'),
  ]
  ```

- [ ] Add to `apps/core/urls.py`:
  ```python
  path('api/v1/rag/', include('apps.rag.urls')),
  ```

---

## Testing

### Unit Tests

- [ ] Create `apps/rag/tests/__init__.py`

- [ ] Create `apps/rag/tests/test_embedding_service.py`:
  - Test embedding generation
  - Test batch embedding
  - Test model info

- [ ] Create `apps/rag/tests/test_vector_store.py`:
  - Test add chunks
  - Test search
  - Test delete by document
  - Test with filters

- [ ] Create `apps/rag/tests/test_search_service.py`:
  - Test end-to-end search
  - Test empty results
  - Test with filters

- [ ] Create `apps/rag/tests/test_models.py`:
  - Test Document creation
  - Test DocumentChunk creation
  - Test relationships

### Run Tests

- [ ] All tests pass: `pytest apps/rag/ -v`

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/rag/documents/` | List documents |
| POST | `/api/v1/rag/documents/` | Create document record |
| GET | `/api/v1/rag/documents/{id}/` | Get document |
| DELETE | `/api/v1/rag/documents/{id}/` | Delete document + chunks |
| POST | `/api/v1/rag/search/` | Search knowledge base |

---

## File Structure

```
apps/rag/
├── __init__.py
├── apps.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── admin.py
├── services/
│   ├── __init__.py
│   ├── embedding_service.py
│   ├── search_service.py
│   └── vector_store/
│       ├── __init__.py
│       ├── base.py
│       ├── chroma_store.py
│       └── factory.py
└── tests/
    ├── __init__.py
    ├── test_models.py
    ├── test_embedding_service.py
    ├── test_vector_store.py
    └── test_search_service.py
```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`

- [ ] Create document:
  ```bash
  http POST localhost:8000/api/v1/rag/documents/ \
    Authorization:"Bearer <token>" \
    title="Test Paper" \
    authors:='["Author 1"]' \
    source=upload
  ```

- [ ] Verify ChromaDB data directory created

- [ ] Test search (after ingestion is implemented):
  ```bash
  http POST localhost:8000/api/v1/rag/search/ \
    Authorization:"Bearer <token>" \
    query="fractal dimension"
  ```

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/rag-core`
- [ ] Commit models first
- [ ] Commit services
- [ ] Commit views and tests
- [ ] Push: `git push -u origin feature/rag-core`
- [ ] Create PR to main

---

## Definition of Done

- [ ] Document and DocumentChunk models created
- [ ] Embedding service working
- [ ] Vector store abstraction implemented
- [ ] ChromaDB integration working
- [ ] Search service functional
- [ ] API endpoints working
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
