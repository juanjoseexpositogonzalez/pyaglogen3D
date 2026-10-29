# Checklist: RAG Integration

**Branch**: `feature/rag-integration`
**Depends on**: `feature/rag-search` and `feature/ai-chat-backend` merged
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] `feature/rag-search` merged
- [ ] `feature/ai-chat-backend` merged
- [ ] Search service working
- [ ] Chat service working

---

## Backend Implementation

### RAG-Enabled Chat Service

- [ ] Update `apps/ai_assistant/services/chat_service.py`:
  - Add `SearchService` dependency
  - Add `use_rag` flag to `send_message()`
  - Implement `_retrieve_context(query)` method
  - Implement `_inject_context(messages, context)` method

### Context Injection Service

- [ ] Create `apps/ai_assistant/services/context_injection.py`:
  - `ContextInjectionService` class
  - `build_rag_system_prompt(base_prompt, context) -> str`
  - `format_context(results, max_tokens) -> str`
  - `fit_to_budget(results, max_tokens) -> list`

### Citation Processor

- [ ] Create `apps/ai_assistant/services/citation_processor.py`:
  - `CitationProcessor` class
  - `extract_citations(response) -> list[Citation]`
  - `verify_citations(citations, context) -> list[Citation]`
  - `add_citation_links(response, citations) -> str`
  - `generate_references(citations) -> str`

### Response Processor

- [ ] Create `apps/ai_assistant/services/response_processor.py`:
  - `ResponseProcessor` class
  - `process(response, context) -> ProcessedResponse`:
    - Extract citations
    - Verify citations
    - Add links
    - Generate references
    - Check quality

### Configuration

- [ ] Add to `config/settings/base.py`:
  ```python
  RAG_ENABLED = env.bool("RAG_ENABLED", default=True)
  RAG_MAX_CONTEXT_TOKENS = env.int("RAG_MAX_CONTEXT_TOKENS", default=3000)
  RAG_RETRIEVAL_K = env.int("RAG_RETRIEVAL_K", default=5)
  RAG_MIN_RELEVANCE_SCORE = env.float("RAG_MIN_RELEVANCE_SCORE", default=0.6)
  ```

### Serializers

- [ ] Update `apps/ai_assistant/serializers.py`:
  - Add `citations` field to `MessageSerializer`
  - Add `sources` field for references
  - Create `CitationSerializer`

### Update Chat Flow

- [ ] Modify chat processing:
  1. Receive user message
  2. If RAG enabled: search knowledge base
  3. Inject context into prompt
  4. Get LLM response
  5. Process citations
  6. Save message with citation metadata
  7. Return processed response

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/test_context_injection.py`:
  - Test prompt building
  - Test context formatting
  - Test token budget

- [ ] Create `apps/ai_assistant/tests/test_citation_processor.py`:
  - Test citation extraction
  - Test citation verification
  - Test link generation

- [ ] Create `apps/ai_assistant/tests/test_rag_integration.py`:
  - Test full flow (mocked)
  - Test with/without RAG
  - Test empty context handling

### Integration Tests

- [ ] Create end-to-end test:
  - Ingest test document
  - Send query
  - Verify context retrieved
  - Verify citations in response

---

## API Response Update

```json
{
    "id": "msg_uuid",
    "role": "assistant",
    "content": "The fractal dimension is approximately 1.78 [Meakin, 1984]...",
    "citations": [
        {
            "author": "Meakin",
            "year": 1984,
            "document_id": "doc_uuid",
            "verified": true
        }
    ],
    "sources": [
        {
            "id": "doc_uuid",
            "title": "Formation of Fractal Clusters",
            "authors": ["Meakin, P."],
            "year": 1984
        }
    ],
    "rag_context_used": true
}
```

---

## Manual Testing

- [ ] Test chat with scientific question
- [ ] Verify citations appear
- [ ] Click citation links
- [ ] Test with no relevant context
- [ ] Compare responses with/without RAG

---

## Git

- [ ] Create branch: `git checkout -b feature/rag-integration`
- [ ] Implement services
- [ ] Update chat service
- [ ] Add tests
- [ ] Push and create PR

---

## Definition of Done

- [ ] RAG integrated with chat
- [ ] Context injection working
- [ ] Citations extracted and verified
- [ ] Citation links functional
- [ ] All tests passing
- [ ] PR merged
