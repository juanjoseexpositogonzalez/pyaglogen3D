# Smoke Test Plan: AI Provider Model Catalog

## Pre-conditions

1. Backend deployed with migration `0004_add_model_catalog_fields` applied
2. Frontend built and deployed (or running dev server)
3. At least one `AIProviderConfig` exists with a valid API key (Anthropic, OpenAI, Groq, or xAI)
4. Authenticated user with valid JWT token

---

## Step 1: API endpoint verification

### 1a. Test connection (fetches catalog on success)

```bash
# Replace $JWT with a valid token, $PROVIDER_ID with an existing provider config ID
curl -X POST https://api.pyaglogen3d.com/api/v1/ai/providers/$PROVIDER_ID/test_connection/ \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

**Expected response** (200):
```json
{
  "success": true,
  "message": "Connection successful",
  "models": [
    {"id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4", "is_recommended": true},
    {"id": "claude-3-5-haiku-20241022", "display_name": "Claude 3.5 Haiku", "is_recommended": false}
  ],
  "models_refreshed_at": "2026-05-09T17:30:00Z"
}
```

### 1b. Refresh models (standalone catalog refresh)

```bash
curl -X POST https://api.pyaglogen3d.com/api/v1/ai/providers/$PROVIDER_ID/refresh_models/ \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

**Expected response** (200):
```json
{
  "success": true,
  "models": [...],
  "refreshed_at": "2026-05-09T17:31:00Z"
}
```

---

## Step 2: UI walkthrough

1. **Log in** to the application
2. **Navigate** to AI Settings (Settings > AI or `/ai/settings`)
3. **Edit an existing provider** (one with a valid API key)
4. **Click "Test connection"** button
   - [ ] Verify: success toast/message appears
   - [ ] Verify: model dropdown populates with available models
   - [ ] Verify: ⭐ badge appears next to the recommended model
   - [ ] Verify: "Refreshed X ago" text appears below the model picker
5. **Select a different model** from the dropdown
   - [ ] Verify: selection is reflected in the form state
6. **Click "Refresh models"** (if separate button exists, or re-test connection)
   - [ ] Verify: model list updates
   - [ ] Verify: "Refreshed X ago" timestamp updates

---

## Step 3: Error path verification

### 3a. Invalid API key

1. Edit a provider and set an invalid/expired API key
2. Click "Test connection"

**Expected behavior:**
- [ ] Returns HTTP 400 (not 500)
- [ ] Friendly error message displayed (e.g., "Authentication failed — check your API key")
- [ ] Model dropdown stays empty (no stale models loaded)
- [ ] Previously stored `available_models` is NOT wiped (error doesn't mutate catalog)

### 3b. Provider unavailable (simulate network issue)

```bash
# With an invalid base URL or when provider is down
curl -X POST https://api.pyaglogen3d.com/api/v1/ai/providers/$PROVIDER_ID/refresh_models/ \
  -H "Authorization: Bearer $JWT"
```

**Expected:** HTTP 503 with `{"error": "Provider temporarily unavailable"}`

### 3c. Rate limit hit

**Expected:** HTTP 429 with `{"error": "Rate limited — try again later"}`

---

## Expected Outcomes Summary

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1a | test_connection with valid key | 200 + models array populated |
| 1b | refresh_models | 200 + fresh models + timestamp |
| 2 | UI test connection | Dropdown populates, ⭐ on recommended, relative time shown |
| 3a | Invalid API key | 400 + friendly message, dropdown empty, no catalog wipe |
| 3b | Provider down | 503 + unavailable message |
| 3c | Rate limited | 429 + rate limit message |

---

## Verdict Checklist

- [ ] All Step 1 curl commands return expected HTTP codes and response shapes
- [ ] UI dropdown populates dynamically after test_connection
- [ ] Recommended model has ⭐ visual indicator
- [ ] "Refreshed X ago" appears and uses relative time
- [ ] Error with bad key returns 400 (NOT 500) with user-friendly message
- [ ] Error does not wipe previously cached models
- [ ] Empty state shows "Test connection to load available models" CTA
- [ ] Stale model warning appears if current model_name not in catalog
