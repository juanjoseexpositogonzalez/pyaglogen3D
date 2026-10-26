# AI Provider Config Specification

## Purpose

Specification for the `AIProviderConfig` model and its API endpoints, including the model catalog feature for dynamically fetching and persisting available AI models per provider.

## Requirements

### Requirement: Available Models Catalog Field

`AIProviderConfig` MUST store a `available_models` JSONField (default `[]`, blank allowed) containing the list of chat-completion models last fetched for this provider. The field MUST persist between requests so subsequent page loads serve the catalog instantly without an API call.

Each entry MUST contain at minimum `id` (string) and `display_name` (string). Entries MAY include `context_window` (integer) and `is_recommended` (boolean).

`AIProviderConfig` MUST store a `models_refreshed_at` DateTimeField (null=True, blank=True) recording when the catalog was last populated.

Existing configs default to `[]` and `null` — no data migration is required.

#### Scenario: New provider config has empty catalog by default

- GIVEN a new `AIProviderConfig` is created without triggering a model fetch
- WHEN the record is saved
- THEN `available_models` MUST equal `[]`
- AND `models_refreshed_at` MUST be `null`

#### Scenario: Existing configs are backward-compatible

- GIVEN an existing `AIProviderConfig` predates this change
- WHEN the migration runs
- THEN `available_models` defaults to `[]`
- AND `models_refreshed_at` defaults to `null`
- AND no existing field values are affected

#### Scenario: Catalog is persisted after fetch

- GIVEN a provider config has a valid api_key
- WHEN the model catalog is successfully fetched
- THEN `available_models` MUST be updated with the normalized, whitelisted model list
- AND `models_refreshed_at` MUST be set to the current UTC timestamp

---

### Requirement: test_connection Augments Catalog

The `POST /api/v1/ai/providers/{id}/test_connection/` endpoint MUST, upon a successful auth test, also fetch the model catalog for that provider, persist it, and include it in the response.

If the auth test fails, the endpoint MUST NOT modify `available_models` or `models_refreshed_at`.

The response payload MUST gain `models` (array) and `refreshed_at` (ISO 8601 string or null) fields. Existing callers that ignore these fields MUST continue to work unchanged.

#### Scenario: Successful test connection refreshes catalog

- GIVEN a valid `AIProviderConfig` with a working api_key
- WHEN `POST /api/v1/ai/providers/{id}/test_connection/` is called
- THEN the response MUST contain `{"success": true, "message": "...", "models": [...], "refreshed_at": "..."}`
- AND `available_models` on the config MUST be updated
- AND `models_refreshed_at` MUST reflect the fetch time

#### Scenario: Failed test connection leaves catalog untouched

- GIVEN a `AIProviderConfig` with an invalid api_key and a previously populated `available_models`
- WHEN `POST /api/v1/ai/providers/{id}/test_connection/` is called
- THEN the response MUST contain `{"success": false, "message": "..."}`
- AND `available_models` MUST remain unchanged
- AND `models_refreshed_at` MUST remain unchanged

#### Scenario: Auth passes but catalog fetch fails (network/rate-limit)

- GIVEN a valid api_key but the provider list-models endpoint is unavailable
- WHEN `POST /api/v1/ai/providers/{id}/test_connection/` is called
- THEN the response MUST return `success: true` (auth passed)
- AND `models` MUST be `[]`
- AND `available_models` MUST NOT be overwritten with an empty list
- AND a warning SHOULD be logged

---

### Requirement: Standalone Refresh-Models Endpoint

The system MUST expose `POST /api/v1/ai/providers/{id}/refresh-models/` that fetches and persists the model catalog using the stored (encrypted) api_key without re-running the auth test.

The response MUST follow the same shape as test_connection's model fields: `{"models": [...], "refreshed_at": "..."}`.

#### Scenario: Refresh succeeds

- GIVEN a `AIProviderConfig` with a valid stored api_key
- WHEN `POST /api/v1/ai/providers/{id}/refresh-models/` is called
- THEN the response MUST contain the updated model list and timestamp
- AND `available_models` and `models_refreshed_at` MUST be persisted

#### Scenario: Refresh fails — invalid key

- GIVEN a `AIProviderConfig` whose api_key is expired or revoked
- WHEN `POST /api/v1/ai/providers/{id}/refresh-models/` is called
- THEN the endpoint MUST return HTTP 401
- AND `available_models` MUST NOT be modified

#### Scenario: Refresh fails — provider unavailable

- GIVEN the provider API is down
- WHEN `POST /api/v1/ai/providers/{id}/refresh-models/` is called
- THEN the endpoint MUST return HTTP 503
- AND `available_models` MUST NOT be modified

#### Scenario: Refresh fails — rate limited

- GIVEN the provider returns a rate-limit error
- WHEN `POST /api/v1/ai/providers/{id}/refresh-models/` is called
- THEN the endpoint MUST return HTTP 429
- AND `available_models` MUST NOT be modified

---

### Requirement: Frontend Model Picker

The AI provider settings form MUST replace the free-text `model_name` input with a `<select>` element populated from `provider.available_models`.

#### Scenario: Catalog loaded — renders select

- GIVEN `provider.available_models` is non-empty
- WHEN the form renders
- THEN a `<select>` MUST display each model's `display_name`
- AND the model with `is_recommended: true` MUST be visually distinguished (star or badge)

#### Scenario: Catalog empty — empty state CTA

- GIVEN `provider.available_models` is `[]`
- WHEN the form renders
- THEN the select MUST be replaced by an empty-state message
- AND the message MUST prompt the user to "Test connection to load available models"

#### Scenario: Legacy model_name not in catalog

- GIVEN `provider.model_name` contains a value not present in `available_models`
- WHEN the form renders
- THEN MUST display the legacy value as the selected option
- AND MUST show a warning indicator ("This model is not in the latest catalog")

#### Scenario: Refreshed_at shown as relative time

- GIVEN `models_refreshed_at` is a non-null timestamp
- WHEN the UI renders the provider card
- THEN the relative time MUST be displayed (e.g. "Refreshed 2 hours ago")
