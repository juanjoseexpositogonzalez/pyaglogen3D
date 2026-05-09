# Proposal: AI Provider Model Catalog

## Intent

Users currently type model names by hand — error-prone and opaque. They can't know which models their API key tier actually grants. This change auto-fetches available models per provider, persists the list for instant dropdown population, and filters to chat-completion models only. Result: users pick from what they can actually use, and new models appear without a redeploy.

## Scope

### In Scope
- Backend service `services/model_catalog.py` — fetch + whitelist logic per provider
- `available_models` JSONField on `AIProviderConfig` (additive migration, `default=list`)
- Augment `test_connection` action to also fetch & persist models
- Optional `POST /api/v1/ai/providers/{id}/refresh-models/` standalone endpoint
- Serializer updates to expose `available_models` (read-only)
- Frontend: replace free-text `model_name` input with `<select>` from `available_models`
- Handle empty catalog state (CTA: "Test connection to load models")
- Backend tests with mocked SDK responses (strict TDD)
- Frontend tests for the new select behavior

### Out of Scope
- Encryption / JWT changes
- Separate `AIModel` table or FK refactoring
- Embedding / image-gen / audio model support
- Scheduled background refresh (Celery beat) — future work
- Admin UI for model management

## Capabilities

### New Capabilities
- `model-catalog`: Auto-fetch, whitelist-filter, and persist available AI models per provider

### Modified Capabilities
- `ai-provider-config`: Add `available_models` field; `test_connection` now also refreshes catalog; new `refresh-models` action

## Approach

- Add `ModelCatalogService` with per-provider fetcher using each SDK's list-models endpoint (Anthropic native, OpenAI/Groq/xAI via OpenAI-compat)
- Whitelist filters: anthropic → `claude-*`, openai → `gpt-*|o1-*|o3-*|o4-*`, groq → all returned, xai → `grok-*`
- Store result as `[{"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "created": ...}]` in JSONField
- `test_connection` view calls catalog service after successful auth test
- Frontend reads `available_models` from provider GET response; renders `<select>` or "test connection" CTA if empty

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/ai_assistant/models.py` | Modified | Add `available_models` JSONField |
| `backend/apps/ai_assistant/services/model_catalog.py` | New | Fetch + whitelist logic |
| `backend/apps/ai_assistant/views.py` | Modified | `test_connection` augmented, `refresh_models` action added |
| `backend/apps/ai_assistant/serializers.py` | Modified | Expose `available_models` read-only |
| `backend/apps/ai_assistant/migrations/` | New | Additive column migration |
| `backend/apps/ai_assistant/tests/` | Modified | New test classes for catalog service and endpoints |
| `frontend/src/lib/ai-api.ts` | Modified | Add `available_models` to `AIProvider` type |
| `frontend/src/app/ai/settings/page.tsx` | Modified | `<select>` replaces text input for model_name |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Provider API rate limits on list-models | Low | Only fetch on explicit user action (test/refresh), not on page load |
| Anthropic list-models endpoint changes | Low | Wrap in try/except, fall back to empty list + log warning |
| Large model lists bloating JSONField | Low | Whitelist filter keeps it tight; typical: 5-20 models per provider |

## Rollback Plan

Revert migration (drops `available_models` column — no data loss on existing fields). Revert frontend to free-text input. Zero impact on existing conversations or stored `model_name` values.

## Dependencies

- Provider SDKs already installed: `anthropic`, `openai` (used by Groq/xAI too)
- Anthropic list-models API available since late 2024

## Success Criteria

- [ ] `test_connection` returns model list alongside success status
- [ ] `available_models` persisted; subsequent page loads show dropdown instantly
- [ ] Only chat-completion models appear (no embeddings/image-gen)
- [ ] Frontend `<select>` populated from persisted list; free-text fallback gone
- [ ] Empty state shows "Test connection to load models" CTA
- [ ] All backend tests pass with mocked SDK calls (no real API hits)
