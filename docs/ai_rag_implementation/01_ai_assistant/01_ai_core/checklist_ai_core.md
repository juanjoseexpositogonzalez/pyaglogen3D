# Checklist: AI Core Infrastructure

**Branch**: `feature/ai-core`
**Depends on**: Prerequisites completed
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] All items in `00_prerequisites/checklist_prerequisites.md` completed
- [ ] At least one AI provider API key configured
- [ ] Encryption key generated for API key storage
- [ ] Empty `apps/ai_assistant/` directory exists

---

## Backend Implementation

### App Configuration

- [ ] Update `apps/ai_assistant/apps.py`:
  ```python
  name = "apps.ai_assistant"
  ```

- [ ] Add to `config/settings/base.py` INSTALLED_APPS:
  ```python
  "apps.ai_assistant",
  ```

- [ ] Create `apps/ai_assistant/__init__.py` (empty file)

### Models

#### AIProviderConfig Model

- [ ] Create `apps/ai_assistant/models.py` with fields:
  - `id` (UUID, primary key)
  - `user` (ForeignKey to User)
  - `provider` (CharField with choices: anthropic, openai, groq, xai)
  - `api_key_encrypted` (TextField for Fernet-encrypted key)
  - `model_name` (CharField, e.g., "claude-sonnet-4-20250514")
  - `is_default` (BooleanField)
  - `is_active` (BooleanField)
  - `created_at` (DateTimeField auto_now_add)
  - `updated_at` (DateTimeField auto_now)

- [ ] Add model Meta:
  - `unique_together = ['user', 'provider']`
  - `ordering = ['-is_default', '-created_at']`

- [ ] Create migration: `python manage.py makemigrations ai_assistant`
- [ ] Apply migration: `python manage.py migrate`

### Encryption Service

- [ ] Create `apps/ai_assistant/services/__init__.py`
- [ ] Create `apps/ai_assistant/services/encryption.py` with:
  - `APIKeyEncryption` class
  - `__init__`: Load key from `settings.AI_ENCRYPTION_KEY`
  - `encrypt(plain_text: str) -> str`: Encrypt API key
  - `decrypt(cipher_text: str) -> str`: Decrypt API key

- [ ] Add `AI_ENCRYPTION_KEY` to `config/settings/base.py`:
  ```python
  AI_ENCRYPTION_KEY = env("AI_ENCRYPTION_KEY", default="")
  ```

### Provider Abstraction

- [ ] Create `apps/ai_assistant/services/providers/__init__.py`

- [ ] Create `apps/ai_assistant/services/providers/base.py`:
  - `BaseProvider` abstract class
  - Abstract method: `complete(messages: list) -> AIResponse`
  - Abstract method: `complete_with_tools(messages: list, tools: list) -> AIResponse`
  - Abstract method: `get_model_info() -> dict`

- [ ] Create `apps/ai_assistant/services/providers/models.py`:
  - `AIResponse` dataclass (content, tool_calls, stop_reason, usage, model, provider)
  - `ToolCall` dataclass (id, name, arguments)
  - `TokenUsage` dataclass (input_tokens, output_tokens)
  - `StopReason` enum (END_TURN, TOOL_USE, MAX_TOKENS, ERROR)

- [ ] Create `apps/ai_assistant/services/providers/anthropic_provider.py`:
  - `AnthropicProvider(BaseProvider)`
  - Implement `complete()` using Anthropic SDK
  - Implement `complete_with_tools()` with tool definitions
  - Parse response into `AIResponse` format

- [ ] Create `apps/ai_assistant/services/providers/openai_provider.py`:
  - `OpenAIProvider(BaseProvider)`
  - Implement same interface using OpenAI SDK
  - Handle OpenAI response structure differences

- [ ] Create `apps/ai_assistant/services/providers/groq_provider.py`:
  - `GroqProvider(BaseProvider)`
  - Uses Groq SDK (OpenAI-compatible)

- [ ] Create `apps/ai_assistant/services/providers/xai_provider.py`:
  - `XAIProvider(BaseProvider)`
  - Uses OpenAI SDK with custom base_url

### Provider Factory

- [ ] Create `apps/ai_assistant/services/providers/factory.py`:
  - `ProviderFactory` class
  - `create_provider(config: AIProviderConfig) -> BaseProvider`
  - Map provider names to provider classes
  - Handle unknown provider types with clear error

### AI Service

- [ ] Create `apps/ai_assistant/services/ai_service.py`:
  - `AIService` class
  - `__init__(user: User)`: Load user's default provider config
  - `get_provider() -> BaseProvider`: Get configured provider
  - `complete(messages: list) -> AIResponse`: Simple completion
  - `complete_with_tools(messages: list, tools: list) -> AIResponse`: Tool-enabled completion
  - Error handling with fallback provider support

### Serializers

- [ ] Create `apps/ai_assistant/serializers.py`:
  - `AIProviderConfigSerializer`:
    - Read fields: id, provider, model_name, is_default, is_active, created_at
    - Write fields: provider, api_key, model_name, is_default
    - `create()`: Encrypt API key before saving
    - `update()`: Re-encrypt if API key changed
  - `AIProviderConfigListSerializer` (read-only, no api_key)

### Views

- [ ] Create `apps/ai_assistant/views.py`:
  - `AIProviderConfigViewSet(viewsets.ModelViewSet)`:
    - `queryset`: Filter by current user
    - `permission_classes = [IsAuthenticated, IsAIUser]`
    - `perform_create()`: Set user, handle is_default logic
    - `@action(detail=True, methods=['post']) test_connection`: Verify API key works

### Permissions

- [ ] Create `apps/ai_assistant/permissions.py`:
  - `IsAIUser` permission class
  - Check: `user.is_staff or user.has_ai_access` (add field later)
  - For now, allow all authenticated users for development

### URLs

- [ ] Create `apps/ai_assistant/urls.py`:
  ```python
  router = DefaultRouter()
  router.register('providers', AIProviderConfigViewSet, basename='ai-provider')
  urlpatterns = router.urls
  ```

- [ ] Add to `apps/core/urls.py`:
  ```python
  path('api/v1/ai/', include('apps.ai_assistant.urls')),
  ```

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/__init__.py`

- [ ] Create `apps/ai_assistant/tests/test_encryption.py`:
  - Test encrypt/decrypt roundtrip
  - Test with special characters
  - Test with empty string

- [ ] Create `apps/ai_assistant/tests/test_providers.py`:
  - Test Anthropic response parsing (mocked)
  - Test OpenAI response parsing (mocked)
  - Test tool call parsing

- [ ] Create `apps/ai_assistant/tests/test_models.py`:
  - Test AIProviderConfig creation
  - Test unique_together constraint
  - Test is_default logic

- [ ] Create `apps/ai_assistant/tests/test_views.py`:
  - Test CRUD operations on provider configs
  - Test test_connection action
  - Test permission enforcement

### Integration Tests (Optional, requires API key)

- [ ] Create `apps/ai_assistant/tests/test_integration.py`:
  - Mark with `@pytest.mark.slow`
  - Skip if API key not available
  - Test real API call with simple prompt
  - Test tool calling with mock tool

### Run Tests

- [ ] All unit tests pass: `pytest apps/ai_assistant/ -v`
- [ ] Coverage report: `pytest apps/ai_assistant/ --cov=apps.ai_assistant`

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ai/providers/` | List user's provider configs |
| POST | `/api/v1/ai/providers/` | Create new provider config |
| GET | `/api/v1/ai/providers/{id}/` | Get single config |
| PUT | `/api/v1/ai/providers/{id}/` | Update config |
| DELETE | `/api/v1/ai/providers/{id}/` | Delete config |
| POST | `/api/v1/ai/providers/{id}/test_connection/` | Test API key |

---

## Configuration Constants

- [ ] Add to `config/settings/base.py`:
  ```python
  # AI Provider Settings
  AI_ENCRYPTION_KEY = env("AI_ENCRYPTION_KEY", default="")
  AI_DEFAULT_PROVIDER = env("AI_DEFAULT_PROVIDER", default="anthropic")
  AI_DEFAULT_MODEL = env("AI_DEFAULT_MODEL", default="claude-sonnet-4-20250514")
  AI_MAX_TOKENS = env.int("AI_MAX_TOKENS", default=4096)
  AI_TIMEOUT_SECONDS = env.int("AI_TIMEOUT_SECONDS", default=60)
  ```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`
- [ ] Create provider config via API (use httpie or curl):
  ```bash
  http POST localhost:8000/api/v1/ai/providers/ \
    Authorization:"Bearer <token>" \
    provider=anthropic \
    api_key=sk-ant-xxx \
    model_name=claude-sonnet-4-20250514 \
    is_default:=true
  ```
- [ ] Verify API key is encrypted in database
- [ ] Test connection endpoint works
- [ ] Test with invalid API key shows appropriate error

---

## Git

- [ ] Create branch: `git checkout -b feature/ai-core`
- [ ] Make atomic commits for each logical change
- [ ] All changes committed with clear messages
- [ ] Push: `git push -u origin feature/ai-core`
- [ ] Create PR to main with description

---

## Definition of Done

- [ ] All backend models created and migrated
- [ ] All provider abstractions implemented
- [ ] Encryption service working
- [ ] API endpoints functional
- [ ] Unit tests passing with >80% coverage
- [ ] Manual testing completed
- [ ] PR reviewed and approved
- [ ] Merged to main
