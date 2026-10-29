# Checklist: Chat Backend

**Branch**: `feature/ai-chat-backend`
**Depends on**: All tool branches merged (simulation, analysis, export)
**Estimated time**: 2 days

---

## Prerequisites

- [ ] `feature/ai-simulation-tools` merged
- [ ] `feature/ai-analysis-tools` merged
- [ ] `feature/ai-export-tools` merged
- [ ] All tools registered and working

---

## Backend Implementation

### Models

- [ ] Create/update `apps/ai_assistant/models.py`:

#### Conversation Model
- Fields:
  - `id` (UUID, primary key)
  - `user` (ForeignKey to User)
  - `project` (ForeignKey to Project, nullable)
  - `title` (CharField, max 255, blank)
  - `provider` (CharField, default "anthropic")
  - `model` (CharField, e.g., "claude-sonnet-4-20250514")
  - `created_at` (DateTimeField, auto_now_add)
  - `updated_at` (DateTimeField, auto_now)
  - `is_archived` (BooleanField, default False)
- Meta:
  - `ordering = ['-updated_at']`

#### Message Model
- Fields:
  - `id` (UUID, primary key)
  - `conversation` (ForeignKey, related_name='messages')
  - `role` (CharField, choices: user, assistant, tool, system)
  - `content` (TextField, nullable)
  - `tool_calls` (JSONField, nullable)
  - `tool_call_id` (CharField, nullable)
  - `created_at` (DateTimeField, auto_now_add)
- Meta:
  - `ordering = ['created_at']`

- [ ] Create migration: `python manage.py makemigrations ai_assistant`
- [ ] Apply migration: `python manage.py migrate`

### Serializers

- [ ] Create `apps/ai_assistant/serializers.py` (or update existing):

#### ConversationSerializer
- Read fields: id, title, project_id, provider, model, created_at, updated_at, message_count
- Write fields: project_id, provider, model
- `message_count`: SerializerMethodField

#### ConversationDetailSerializer
- Includes: messages (nested)
- Uses MessageSerializer for messages

#### MessageSerializer
- All fields for reading
- Write: role, content, tool_calls, tool_call_id

#### ChatInputSerializer
- Fields: content (required), project_id (optional)
- Validation: content not empty

### Chat Service

- [ ] Create `apps/ai_assistant/services/chat_service.py`:
  - `ChatService` class
  - `__init__(user: User)`
  - `create_conversation(project_id: int | None, provider: str) -> Conversation`
  - `get_conversation(conversation_id: str) -> Conversation`
  - `send_message(conversation: Conversation, content: str) -> Message`:
    - Save user message
    - Build context
    - Call AI provider
    - Handle tool calls loop
    - Save all messages
    - Return final assistant message
  - `_build_context(conversation: Conversation) -> list[dict]`:
    - System prompt
    - Conversation history
    - Context window management
  - `_handle_tool_calls(response: AIResponse, conversation: Conversation) -> AIResponse`:
    - Execute each tool
    - Save tool results
    - Send back to AI
    - Repeat if more tool calls
  - `generate_title(conversation: Conversation) -> str`

### System Prompt Builder

- [ ] Create `apps/ai_assistant/services/prompt_builder.py`:
  - `PromptBuilder` class
  - `build_system_prompt(user: User, project: Project | None) -> str`
  - `get_tool_instructions() -> str`
  - `get_context_summary(conversation: Conversation) -> str`

### Context Manager

- [ ] Create `apps/ai_assistant/services/context_manager.py`:
  - `ContextManager` class
  - `get_messages_for_context(conversation: Conversation, max_tokens: int) -> list`
  - `_count_tokens(text: str) -> int`
  - `_truncate_old_messages(messages: list, max_tokens: int) -> list`
  - `_summarize_history(messages: list) -> str` (optional)

### Views

- [ ] Update `apps/ai_assistant/views.py`:

#### ConversationViewSet
- `GET /conversations/` - List user's conversations
- `POST /conversations/` - Create new conversation
- `GET /conversations/{id}/` - Get conversation with messages
- `DELETE /conversations/{id}/` - Delete conversation
- `POST /conversations/{id}/archive/` - Archive conversation

#### ChatView
- `POST /conversations/{id}/chat/` - Send message and get response
  - Input: `{"content": "user message"}`
  - Output: Final assistant message
  - Handles tool execution internally

#### MessageListView
- `GET /conversations/{id}/messages/` - Get paginated messages

### URLs

- [ ] Update `apps/ai_assistant/urls.py`:
  ```python
  router.register('conversations', ConversationViewSet, basename='conversation')

  urlpatterns = [
      path('', include(router.urls)),
      path('conversations/<uuid:pk>/chat/', ChatView.as_view(), name='chat'),
      path('conversations/<uuid:pk>/messages/', MessageListView.as_view(), name='messages'),
  ]
  ```

---

## Tool Execution Integration

- [ ] Update chat service to use ToolExecutor:
  ```python
  def _handle_tool_calls(self, response, conversation):
      executor = ToolExecutor(
          registry=get_registry(),
          user=self.user,
          project_id=conversation.project_id
      )

      for tool_call in response.tool_calls:
          result = executor.execute(
              tool_call.name,
              tool_call.arguments
          )
          # Save tool result as message
          Message.objects.create(
              conversation=conversation,
              role="tool",
              tool_call_id=tool_call.id,
              content=json.dumps(result.to_dict())
          )
  ```

---

## Error Handling

- [ ] Handle common errors in ChatService:
  - Provider unavailable → return error message, allow retry
  - Token limit exceeded → truncate context, retry
  - Tool execution failed → include error in tool result
  - Rate limit → return appropriate error

- [ ] Create custom exceptions:
  - `ChatError` base exception
  - `ProviderUnavailableError`
  - `ContextTooLongError`
  - `ToolExecutionError`

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/test_chat/`:

#### test_models.py
- Test Conversation creation
- Test Message creation
- Test relationship queries
- Test ordering

#### test_chat_service.py
- Test conversation creation
- Test message sending (mocked AI)
- Test tool call handling
- Test context building
- Test title generation

#### test_context_manager.py
- Test message truncation
- Test token counting
- Test context window limits

#### test_views.py
- Test conversation CRUD
- Test chat endpoint
- Test message pagination
- Test permission enforcement

### Integration Tests

- [ ] Create `apps/ai_assistant/tests/test_chat_integration.py`:
  - Test full chat flow with mocked AI
  - Test tool execution in chat
  - Test multi-turn conversation
  - Mark as slow test

### Run Tests

- [ ] All tests pass: `pytest apps/ai_assistant/tests/test_chat/ -v`
- [ ] Coverage: `pytest apps/ai_assistant/ --cov=apps.ai_assistant`

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ai/conversations/` | List conversations |
| POST | `/api/v1/ai/conversations/` | Create conversation |
| GET | `/api/v1/ai/conversations/{id}/` | Get conversation |
| DELETE | `/api/v1/ai/conversations/{id}/` | Delete conversation |
| POST | `/api/v1/ai/conversations/{id}/archive/` | Archive |
| POST | `/api/v1/ai/conversations/{id}/chat/` | Send message |
| GET | `/api/v1/ai/conversations/{id}/messages/` | Get messages |

---

## Response Format

### Chat Response

```json
{
    "id": "msg_uuid",
    "role": "assistant",
    "content": "I've started a DLA simulation with 500 particles. The simulation ID is 123.",
    "tool_calls": null,
    "created_at": "2025-01-15T10:30:00Z",
    "conversation_id": "conv_uuid"
}
```

### With Tool Execution (Internal)

The response shows the final message. Tool calls are saved but not exposed in detail:

```json
{
    "id": "msg_uuid",
    "role": "assistant",
    "content": "I've run the simulation. Here are the results:\n- Simulation ID: 123\n- Status: Queued\n- Estimated time: 2 minutes",
    "tools_executed": ["run_dla_simulation"],
    "created_at": "2025-01-15T10:30:00Z"
}
```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`
- [ ] Start Celery: `celery -A config worker -l info`

- [ ] Create conversation:
  ```bash
  http POST localhost:8000/api/v1/ai/conversations/ \
    Authorization:"Bearer <token>"
  ```

- [ ] Send message:
  ```bash
  http POST localhost:8000/api/v1/ai/conversations/<id>/chat/ \
    Authorization:"Bearer <token>" \
    content="Run a DLA simulation with 500 particles"
  ```

- [ ] Verify:
  - Message saved to database
  - Tool executed (simulation created)
  - Response includes tool results

- [ ] Test multi-turn:
  ```bash
  # Follow-up message
  http POST localhost:8000/api/v1/ai/conversations/<id>/chat/ \
    Authorization:"Bearer <token>" \
    content="Now analyze it"
  ```

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/ai-chat-backend`
- [ ] Commit models and migrations first
- [ ] Commit services
- [ ] Commit views and tests
- [ ] Push: `git push -u origin feature/ai-chat-backend`
- [ ] Create PR to main

---

## Definition of Done

- [ ] Conversation and Message models created
- [ ] Chat service handling full flow
- [ ] Tool execution integrated
- [ ] Context management working
- [ ] API endpoints functional
- [ ] Error handling complete
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
