# Model Catalog Specification

## Purpose

Service contract for fetching, filtering, and normalizing available chat-completion models from each supported AI provider. This spec covers the fetch contract, error taxonomy, whitelist rules, and recommended-model heuristics.

## Requirements

### Requirement: Fetch Contract

The system MUST provide a `fetch_models(provider: str, api_key: str) -> list[dict]` function that returns a normalized, whitelisted list of available chat-completion models for the given provider.

Each returned model MUST contain `id` (string) and `display_name` (string). Models MAY include `context_window` (integer) and `is_recommended` (boolean, at most one `true` per call).

#### Scenario: Happy path — valid provider and key

- GIVEN a supported provider name and a valid api_key
- WHEN `fetch_models(provider, api_key)` is called
- THEN it MUST return a list of dicts, each with at least `id` and `display_name`
- AND all returned models MUST pass the provider's whitelist filter
- AND exactly one model MUST have `is_recommended: true` (when the list is non-empty)

#### Scenario: Empty result from provider API

- GIVEN a valid key but the provider returns an empty model list
- WHEN `fetch_models(provider, api_key)` is called
- THEN it MUST return `[]`
- AND no error MUST be raised

#### Scenario: Unknown provider

- GIVEN a provider name not in `{anthropic, openai, groq, xai}`
- WHEN `fetch_models(provider, api_key)` is called
- THEN it MUST raise `ValueError`

---

### Requirement: Error Taxonomy

The catalog service MUST raise typed exceptions so callers can map them to HTTP status codes without inspecting message strings.

| Exception | Trigger | Caller HTTP mapping |
|-----------|---------|---------------------|
| `ProviderAuthError` | Invalid or revoked API key | 401 / 400 |
| `ProviderUnavailableError` | Network failure or provider API down | 503 |
| `ProviderRateLimitError` | Rate limit hit on list-models endpoint | 429 |
| `ValueError` | Unknown provider name | 500 (caller's choice) |

#### Scenario: Invalid API key — ProviderAuthError

- GIVEN an invalid or revoked api_key
- WHEN `fetch_models(provider, api_key)` is called
- THEN it MUST raise `ProviderAuthError`
- AND MUST NOT raise a generic exception

#### Scenario: Provider API down — ProviderUnavailableError

- GIVEN the provider endpoint returns a network error or 5xx
- WHEN `fetch_models(provider, api_key)` is called
- THEN it MUST raise `ProviderUnavailableError`

#### Scenario: Rate limit — ProviderRateLimitError

- GIVEN the provider returns a rate-limit response (e.g. 429)
- WHEN `fetch_models(provider, api_key)` is called
- THEN it MUST raise `ProviderRateLimitError`

---

### Requirement: Whitelist Filter Rules

The service MUST apply per-provider whitelist rules to exclude non-chat-completion models (embeddings, image-gen, audio, fine-tuned variants).

| Provider | Keep rule |
|----------|-----------|
| anthropic | `id.startswith("claude-")` |
| openai | `id.startswith("gpt-")` OR `id.startswith("o1-")` OR `id.startswith("o3-")` OR `id.startswith("o4-")` |
| groq | keep all models returned by the API |
| xai | `id.startswith("grok-")` |

#### Scenario: Anthropic whitelist keeps only claude-* models

- GIVEN the Anthropic API returns a mixed list including `claude-sonnet-4-20250514` and `text-embedding-3-small`
- WHEN `fetch_models("anthropic", api_key)` is called
- THEN the result MUST include `claude-sonnet-4-20250514`
- AND MUST NOT include `text-embedding-3-small`

#### Scenario: OpenAI whitelist keeps gpt-* and o-series

- GIVEN the OpenAI API returns `gpt-4o`, `o3-mini`, `text-embedding-ada-002`, and `whisper-1`
- WHEN `fetch_models("openai", api_key)` is called
- THEN the result MUST include `gpt-4o` and `o3-mini`
- AND MUST NOT include `text-embedding-ada-002` or `whisper-1`

#### Scenario: Groq returns all models

- GIVEN the Groq API returns its full catalog
- WHEN `fetch_models("groq", api_key)` is called
- THEN ALL returned models MUST appear in the result without filtering

#### Scenario: xAI whitelist keeps only grok-* models

- GIVEN the xAI API returns `grok-3` and a non-chat model
- WHEN `fetch_models("xai", api_key)` is called
- THEN the result MUST include `grok-3`
- AND MUST NOT include non-grok models

---

### Requirement: Recommended Model Heuristic

The service MUST mark exactly one model per provider as `is_recommended: true` using a deterministic, version-aware rule. This is a default suggestion; users MAY select any model.

| Provider | Rule |
|----------|------|
| anthropic | Prefer "sonnet" tier; within tier, latest date suffix (`YYYYMMDD`) wins |
| openai | Latest `gpt-` model excluding `-mini`, `-nano`, `-instruct` variants; prefer `gpt-4o` family unless newer detected |
| groq | First `llama-3.3` or `llama-4` in API order; fallback `llama-3.1-70b-versatile`; fallback first |
| xai | Latest `grok-` by version number in id |

#### Scenario: Anthropic — sonnet tier preferred over opus and haiku

- GIVEN models `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-haiku-4-20250514`
- WHEN the heuristic runs
- THEN `claude-sonnet-4-20250514` MUST have `is_recommended: true`
- AND all others MUST have `is_recommended: false`

#### Scenario: Anthropic — latest date suffix wins within same tier

- GIVEN models `claude-sonnet-4-20240620` and `claude-sonnet-4-20250514`
- WHEN the heuristic runs
- THEN `claude-sonnet-4-20250514` MUST have `is_recommended: true`

#### Scenario: OpenAI — mini/instruct excluded from recommendation

- GIVEN models `gpt-4o`, `gpt-4o-mini`, `gpt-4o-2024-11-20`
- WHEN the heuristic runs
- THEN `gpt-4o` or `gpt-4o-2024-11-20` MUST have `is_recommended: true`
- AND `gpt-4o-mini` MUST have `is_recommended: false`

#### Scenario: Groq — llama-3.3 or llama-4 preferred

- GIVEN models include `llama-3.3-70b-versatile` and `gemma-7b-it`
- WHEN the heuristic runs
- THEN `llama-3.3-70b-versatile` MUST have `is_recommended: true`

#### Scenario: Single model in list

- GIVEN the filtered list contains exactly one model
- WHEN the heuristic runs
- THEN that model MUST have `is_recommended: true`

#### Scenario: Empty list — no recommendation

- GIVEN the filtered list is `[]`
- WHEN the heuristic runs
- THEN the result MUST be `[]` with no `is_recommended` field set
