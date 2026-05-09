# Tasks: AI Provider Model Catalog

5 phases · 24 tasks · Strict TDD · Backend pytest: `backend/.venv/bin/pytest`

---

## Phase 1: Foundation — Anthropic SDK check + model migration

- [x] 1.1 **[backend, S]** Inspect `backend/pyproject.toml` or `backend/requirements.txt` for `anthropic` version. If pinned < `0.40` or absent, document fallback: treat anthropic as static catalog (no SDK fetch), add comment in `model_catalog.py`. Add to design open questions.
- [x] 1.2 **[backend, M]** In `backend/apps/ai_assistant/models.py`, add to `AIProviderConfig`: `available_models = JSONField(default=list, blank=True)` and `models_refreshed_at = DateTimeField(null=True, blank=True)`.
- [x] 1.3 **[backend, S]** Run `cd backend && python manage.py makemigrations ai_assistant --name add_model_catalog_fields`. Verify the generated migration file is reversible (`operations` array has `RemoveField` for rollback).
- [x] 1.4 **[backend, M]** TDD — RED: `backend/apps/ai_assistant/tests/test_model_catalog_fields.py` asserts model has new fields, defaults are `[]` and `null`, serializers include them. GREEN: implement fields. REFACTOR: no-op.

---

## Phase 2: ModelCatalogService — backend, TDD per provider

- [x] 2.1 **[backend, S]** Create `backend/apps/ai_assistant/services/model_catalog.py` skeleton: `ModelInfo` TypedDict, 3 exception classes (`ProviderAuthError`, `ProviderUnavailableError`, `ProviderRateLimitError`), `normalize_display_name(model_id)` function, `fetch_models(provider, api_key)` dispatcher raising `ValueError` for unknown provider.
- [x] 2.2 **[backend, M]** TDD `_fetch_anthropic`: mock `anthropic.Anthropic().models.list()` paginated response. Assert whitelist keeps only `claude-*`. Assert recommended = latest sonnet by date suffix. Assert error mapping (auth→ProviderAuthError, connection→ProviderUnavailableError, rate→ProviderRateLimitError).
- [x] 2.3 **[backend, M]** TDD `_fetch_openai`: mock `openai.OpenAI(api_key).models.list()`. Assert whitelist keeps `gpt-*`/`o1-*`/`o3-*`/`o4-*`. Assert recommended = latest non-mini gpt-4o family. Same error mapping.
- [x] 2.4 **[backend, M]** TDD `_fetch_groq`: mock `openai.OpenAI(api_key, base_url=GROQ_BASE_URL).models.list()`. Assert no filter applied. Assert recommended = first `llama-3.3` or `llama-4`, fallback chain per spec. Same error mapping.
- [x] 2.5 **[backend, M]** TDD `_fetch_xai`: mock `openai.OpenAI(api_key, base_url=XAI_BASE_URL).models.list()`. Assert whitelist keeps `grok-*`. Assert recommended = latest grok by version. Same error mapping.
- [x] 2.6 **[backend, S]** TDD `normalize_display_name`: `"gpt-4o"` → `"GPT-4o"`, `"llama-3.3-70b-versatile"` → `"Llama 3.3 70B Versatile"`, `"o1-mini"` → `"O1 Mini"`. Parametrized test with 10 known pairs.
- [x] 2.7 **[backend, L]** TDD error mapping integration: for each of the 4 providers, assert `InvalidSignatureError` → `ProviderAuthError`, `ConnectError` → `ProviderUnavailableError`, `RateLimitError` → `ProviderRateLimitError`. Use `pytest.mark.parametrize`.

---

## Phase 3: View layer + API endpoints — backend integration

- [x] 3.1 **[backend, M]** Modify `test_connection` in `views.py`: on auth success, call `fetch_models(provider_name, api_key)`, persist to `available_models` + `models_refreshed_at`. On catalog failure: log warning, return `models: []` and `models_error` field — do NOT mask auth success. On auth failure: return 400 with no catalog mutation.
- [x] 3.2 **[backend, M]** Add `refresh_models` action to `AIProviderConfigViewSet`: `POST /api/v1/ai/providers/{id}/refresh_models/`. Decrypt stored key, call `fetch_models`, persist, return `{success, models, refreshed_at}`. Map exceptions: `ProviderAuthError`→401, `ProviderUnavailableError`→503, `ProviderRateLimitError`→429. Add `@action(detail=True, methods=["post"])`.
- [x] 3.3 **[backend, L]** Integration tests: mock `fetch_models` at the service level. Assert `test_connection` success path persists catalog and returns new fields. Assert `refresh_models` fetches fresh list. Assert error paths return correct HTTP status codes and do not mutate `available_models`. Run: `backend/.venv/bin/pytest backend/apps/ai_assistant/tests/ -v`.

---

## Phase 4: Frontend integration

- [x] 4.1 **[frontend, S]** Locate the provider config form/modal. Candidates: `frontend/src/components/ai/`, `frontend/src/app/(app)/settings/ai/`, or grep for `model_name` input in provider forms. Confirm target component.
- [x] 4.2 **[frontend, M]** In `ai-api.ts`, add `available_models: ModelInfo[]`, `models_refreshed_at: string | null` to `AIProvider` type; add `refreshModels(providerId): Promise<...>` method.
- [x] 4.3 **[frontend, M]** Replace `model_name` text input with `<select>` populated from `provider.available_models`. Show `display_name` as option label, `id` as value. Preserve legacy model_name value as option if not in catalog.
- [x] 4.4 **[frontend, S]** Add empty-state CTA: when `available_models.length === 0`, show "Test connection to load available models" with a button to trigger test.
- [x] 4.5 **[frontend, S]** Show ⭐ badge next to model with `is_recommended: true` in the select options.
- [x] 4.6 **[frontend, S]** Show stale-model warning: if current `model_name` is not in `available_models`, show inline warning below the select.
- [x] 4.7 **[frontend, S]** Use `formatDistanceToNow` from `frontend/src/lib/utils.ts` to display `models_refreshed_at` as relative time.
- [x] 4.8 **[frontend, M]** Update local state after `test_connection` or `refresh_models` response with new catalog data. Ensure optimistic update of `available_models` and `models_refreshed_at`.
- [x] 4.9 **[frontend, L]** Vitest tests: empty state renders, dropdown populates with correct options, recommended badge appears on correct option, stale warning shows for legacy model, state updates after refresh. Run: `cd frontend && npx vitest run`.

---

## Phase 5: Cross-cutting + docs

- [x] 5.1 **[docs, S]** Write `openspec/changes/ai-provider-model-catalog/SMOKE_TEST.md`: curl examples for `test_connection` and `refresh_models`, expected response shapes, UI walkthrough checklist. Include rate-limit and auth-failure scenarios.
- [x] 5.2 **[docs, S]** Add CHANGELOG entry under `[Unreleased]` with one-line summary and PR/issue reference.
- [x] 5.3 **[docs, XS]** Note: canonical spec sync to `openspec/specs/` handled by sdd-archive phase.

---

## Dependency graph

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
  ↑           ↑           ↑
  └── DB      └── Service └── Endpoint shape
               (all mocked in Phase 2 tests)
```

Phase 2 tests mock at the SDK level so they can run without DB or network. Phase 3 tests use in-memory DB fixtures. Phase 4 depends on Phase 3 endpoint responses being stable.

## Verification trigger

All Phase 2 unit tests: `backend/.venv/bin/pytest backend/apps/ai_assistant/tests/test_model_catalog.py -v`
All Phase 3 integration: `backend/.venv/bin/pytest backend/apps/ai_assistant/tests/test_views.py -v`
All Phase 4 frontend: `cd frontend && npx vitest run`