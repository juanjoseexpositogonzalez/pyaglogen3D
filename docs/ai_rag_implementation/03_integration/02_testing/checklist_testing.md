# Checklist: Integration Testing

**Branch**: `feature/ai-rag-tests`
**Depends on**: `feature/ai-access-control` merged
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] All features implemented and merged
- [ ] Access control in place
- [ ] Test fixtures available

---

## Test Infrastructure

### Factories

- [ ] Create `apps/ai_assistant/tests/factories.py`:
  - `ConversationFactory`
  - `MessageFactory`
  - `AIProviderConfigFactory`

- [ ] Create `apps/rag/tests/factories.py`:
  - `DocumentFactory`
  - `DocumentChunkFactory`

### Mocks

- [ ] Create `apps/ai_assistant/tests/mocks/__init__.py`

- [ ] Create `apps/ai_assistant/tests/mocks/ai_responses.py`:
  - `mock_simple_response(content: str)`
  - `mock_tool_call_response(tool_name, arguments)`
  - `mock_error_response(error_type)`

- [ ] Create `apps/ai_assistant/tests/conftest.py`:
  - `mock_ai_service` fixture
  - `mock_embedding_service` fixture
  - `mock_vector_store` fixture
  - `ai_user` fixture (user with AI access)

---

## Unit Tests

### AI Assistant

- [ ] `test_providers.py`:
  - Test Anthropic response parsing
  - Test OpenAI response parsing
  - Test tool call parsing
  - Test error handling

- [ ] `test_tool_registry.py`:
  - Test tool registration
  - Test tool retrieval
  - Test format conversion

- [ ] `test_tool_validation.py`:
  - Test each tool's parameter validation
  - Test required fields
  - Test type coercion

- [ ] `test_context_manager.py`:
  - Test message truncation
  - Test token counting
  - Test budget management

- [ ] `test_citation_processor.py`:
  - Test citation extraction
  - Test citation verification
  - Test link generation

### RAG

- [ ] `test_chunker.py`:
  - Test fixed chunking
  - Test semantic chunking
  - Test overlap behavior
  - Test metadata preservation

- [ ] `test_search_service.py`:
  - Test query embedding
  - Test similarity search
  - Test filter application
  - Test reranking

- [ ] `test_context_injection.py`:
  - Test prompt building
  - Test context formatting
  - Test budget constraints

---

## Integration Tests

### Chat Flow

- [ ] Create `apps/ai_assistant/tests/integration/test_chat_flow.py`:

```python
def test_simple_chat_message(mock_ai_service, ai_user, db):
    """Test basic chat without tools."""

def test_chat_with_tool_execution(mock_ai_service, ai_user, db):
    """Test chat that triggers a tool."""

def test_multi_turn_conversation(mock_ai_service, ai_user, db):
    """Test conversation context is maintained."""

def test_chat_with_rag_context(mock_ai_service, mock_search, ai_user, db):
    """Test RAG integration in chat."""
```

### Tool Execution

- [ ] Create `apps/ai_assistant/tests/integration/test_tool_execution.py`:

```python
def test_simulation_tool_creates_simulation(ai_user, db):
    """Test DLA simulation tool creates record."""

def test_analysis_tool_runs_analysis(ai_user, db):
    """Test box counting tool."""

def test_export_tool_generates_file(ai_user, db):
    """Test CSV export tool."""

def test_tool_respects_permissions(regular_user, db):
    """Test tools check user permissions."""
```

### RAG Pipeline

- [ ] Create `apps/rag/tests/integration/test_ingestion.py`:

```python
def test_pdf_ingestion_creates_chunks(db, sample_pdf):
    """Test full PDF ingestion pipeline."""

def test_api_ingestion_from_arxiv(db, mock_arxiv):
    """Test arXiv import."""

def test_search_returns_relevant_chunks(db, indexed_documents):
    """Test search quality."""
```

### Access Control

- [ ] Create `apps/ai_assistant/tests/integration/test_access_control.py`:

```python
def test_regular_user_cannot_access_ai(regular_user, client):
    """Test AI endpoints return 403 for regular users."""

def test_ai_user_can_access_ai(ai_user, client):
    """Test AI endpoints work for AI users."""

def test_admin_can_manage_rag(admin_user, client):
    """Test RAG admin endpoints."""

def test_access_grant_revoke_flow(admin_user, regular_user, client):
    """Test full access management flow."""
```

---

## E2E Tests (Optional)

- [ ] Create `apps/ai_assistant/tests/e2e/test_real_api.py`:
  - Mark all with `@pytest.mark.slow`
  - Skip if API key not available
  - Test basic completion
  - Test tool calling
  - Test error handling

---

## Performance Tests

- [ ] Create `apps/ai_assistant/tests/performance/test_search_performance.py`:
  - Test search latency with 1000 documents
  - Test embedding batch performance
  - Test context building speed

---

## Test Commands

- [ ] Add to `pyproject.toml`:
  ```toml
  [tool.pytest.ini_options]
  markers = [
      "slow: marks tests as slow (deselect with '-m \"not slow\"')",
      "e2e: marks tests as end-to-end (requires API keys)",
  ]
  ```

- [ ] Document test commands:
  ```bash
  # All tests
  pytest

  # Fast tests only
  pytest -m "not slow"

  # AI assistant tests
  pytest apps/ai_assistant/

  # RAG tests
  pytest apps/rag/

  # With coverage
  pytest --cov=apps.ai_assistant --cov=apps.rag
  ```

---

## Coverage Requirements

- [ ] Verify coverage meets targets:
  - `apps/ai_assistant/`: > 80%
  - `apps/rag/`: > 80%
  - Critical paths: > 90%

---

## CI Integration

- [ ] Ensure tests run in CI:
  - Unit tests on every PR
  - Integration tests on every PR
  - E2E tests on merge to main (optional)

---

## Manual Testing Checklist

### AI Assistant

- [ ] Create conversation
- [ ] Send simple message, get response
- [ ] Request simulation, verify created
- [ ] Request analysis, verify results
- [ ] Request export, download file
- [ ] Multi-turn conversation works

### RAG

- [ ] Upload PDF, verify ingested
- [ ] Search returns relevant results
- [ ] Chat includes citations
- [ ] Admin can manage documents

### Access Control

- [ ] Regular user blocked from AI
- [ ] Admin can grant access
- [ ] Newly granted user can access AI
- [ ] Admin can revoke access
- [ ] Revoked user blocked from AI

---

## Git

- [ ] Create branch: `git checkout -b feature/ai-rag-tests`
- [ ] Create test infrastructure
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Verify coverage
- [ ] Push and create PR

---

## Definition of Done

- [ ] Test factories created
- [ ] Mock infrastructure in place
- [ ] Unit tests for all components
- [ ] Integration tests for key flows
- [ ] E2E tests for critical paths
- [ ] Coverage > 80%
- [ ] All tests passing
- [ ] CI configured
- [ ] PR merged
