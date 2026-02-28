# Checklist: Tool Registry

**Branch**: `feature/ai-tool-registry`
**Depends on**: `feature/ai-core` merged
**Estimated time**: 1 day

---

## Prerequisites

- [ ] `feature/ai-core` branch merged to main
- [ ] AI providers working
- [ ] Encryption service tested

---

## Backend Implementation

### Tool Definition Models

- [ ] Create `apps/ai_assistant/tools/__init__.py`

- [ ] Create `apps/ai_assistant/tools/base.py` with:
  - `ToolDefinition` dataclass:
    - `name: str`
    - `description: str`
    - `parameters: dict` (JSON Schema)
    - `handler: Callable`
    - `category: str`
    - `requires_project: bool = False`
    - `is_async: bool = False`
  - `ToolResult` dataclass:
    - `success: bool`
    - `data: dict | None`
    - `error: ToolError | None`
  - `ToolError` dataclass:
    - `error_type: str`
    - `message: str`
    - `details: dict | None`
    - `recoverable: bool`

- [ ] Create `apps/ai_assistant/tools/decorators.py`:
  - `@tool` decorator for easy tool definition:
    ```python
    @tool(
        name="my_tool",
        description="Does something",
        category="utility"
    )
    def my_tool_handler(arg1: int, user: User) -> dict:
        ...
    ```
  - Automatically extracts parameter schema from type hints
  - Handles docstring parsing for parameter descriptions

### Tool Registry

- [ ] Create `apps/ai_assistant/tools/registry.py`:
  - `ToolRegistry` class (singleton pattern)
  - `register(tool: ToolDefinition)`: Add tool to registry
  - `unregister(name: str)`: Remove tool
  - `get_tool(name: str) -> ToolDefinition | None`
  - `get_all_tools() -> list[ToolDefinition]`
  - `get_tools_by_category(category: str) -> list[ToolDefinition]`
  - `to_anthropic_format() -> list[dict]`: Format for Anthropic API
  - `to_openai_format() -> list[dict]`: Format for OpenAI API

### Tool Executor

- [ ] Create `apps/ai_assistant/tools/executor.py`:
  - `ToolExecutor` class
  - `__init__(registry: ToolRegistry, user: User, project_id: int | None)`
  - `execute(tool_name: str, arguments: dict) -> ToolResult`:
    - Validate tool exists
    - Validate arguments against schema
    - Inject context (user, project_id)
    - Call handler
    - Wrap result in ToolResult
    - Handle exceptions → ToolError
  - `execute_async(tool_name: str, arguments: dict) -> ToolResult`:
    - For async tools, queue Celery task
    - Return task_id immediately

### Validation

- [ ] Create `apps/ai_assistant/tools/validation.py`:
  - `validate_arguments(schema: dict, arguments: dict) -> tuple[bool, str | None]`
  - Use `jsonschema` library for validation
  - Return validation errors in user-friendly format

- [ ] Add to `backend/pyproject.toml`:
  ```toml
  "jsonschema>=4.20.0",
  ```

### Context Manager

- [ ] Create `apps/ai_assistant/tools/context.py`:
  - `ToolContext` dataclass:
    - `user: User`
    - `project_id: int | None`
    - `conversation_id: int | None`
    - `request_id: str` (for tracing)
  - `ContextManager` class:
    - `from_request(request: HttpRequest) -> ToolContext`
    - `inject_context(handler: Callable, context: ToolContext, args: dict) -> dict`

### Example Tools (Utilities)

- [ ] Create `apps/ai_assistant/tools/utility_tools.py`:
  - `list_algorithms` tool:
    - No parameters
    - Returns list of available simulation algorithms
    - Category: "utility"
  - `get_project_info` tool:
    - Parameter: `project_id` (optional)
    - Returns project details
    - Category: "utility"
  - `check_task_status` tool:
    - Parameter: `task_id`
    - Returns Celery task status
    - Category: "utility"

### Tool Registration

- [ ] Create `apps/ai_assistant/tools/registration.py`:
  - `register_all_tools(registry: ToolRegistry)`:
    - Import and register all tool modules
    - Called at Django startup

- [ ] Update `apps/ai_assistant/apps.py`:
  - In `ready()` method, call tool registration
  ```python
  def ready(self):
      from .tools.registry import get_registry
      from .tools.registration import register_all_tools
      register_all_tools(get_registry())
  ```

### Integration with AI Service

- [ ] Update `apps/ai_assistant/services/ai_service.py`:
  - Add `get_tools() -> list[dict]`: Get tools in provider format
  - Update `complete_with_tools()`:
    - Get tools from registry
    - Pass to provider
    - Return tool calls in response

### API Endpoints

- [ ] Update `apps/ai_assistant/views.py`:
  - `ToolListView`:
    - `GET /api/v1/ai/tools/`: List all available tools
    - Returns: name, description, category, parameters schema
  - `ToolExecuteView`:
    - `POST /api/v1/ai/tools/{name}/execute/`: Execute a tool directly
    - For testing and direct access (not via chat)

- [ ] Update `apps/ai_assistant/urls.py`:
  ```python
  path('tools/', ToolListView.as_view(), name='tool-list'),
  path('tools/<str:name>/execute/', ToolExecuteView.as_view(), name='tool-execute'),
  ```

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/test_tools/__init__.py`

- [ ] Create `apps/ai_assistant/tests/test_tools/test_registry.py`:
  - Test tool registration
  - Test tool retrieval by name
  - Test tool retrieval by category
  - Test duplicate registration handling
  - Test format conversion (Anthropic/OpenAI)

- [ ] Create `apps/ai_assistant/tests/test_tools/test_executor.py`:
  - Test successful execution
  - Test execution with missing arguments
  - Test execution with invalid arguments
  - Test context injection
  - Test error handling

- [ ] Create `apps/ai_assistant/tests/test_tools/test_validation.py`:
  - Test valid arguments pass
  - Test invalid type fails
  - Test missing required fails
  - Test enum validation
  - Test numeric range validation

- [ ] Create `apps/ai_assistant/tests/test_tools/test_decorators.py`:
  - Test @tool decorator creates proper definition
  - Test parameter extraction from type hints
  - Test docstring parsing

### Integration Tests

- [ ] Create `apps/ai_assistant/tests/test_tools/test_utility_tools.py`:
  - Test list_algorithms returns expected data
  - Test get_project_info with valid project
  - Test get_project_info with invalid project
  - Test check_task_status

### Run Tests

- [ ] All tests pass: `pytest apps/ai_assistant/tests/test_tools/ -v`
- [ ] Coverage: `pytest apps/ai_assistant/ --cov=apps.ai_assistant.tools`

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ai/tools/` | List all available tools |
| POST | `/api/v1/ai/tools/{name}/execute/` | Execute tool directly |

---

## File Structure

```
apps/ai_assistant/
├── tools/
│   ├── __init__.py
│   ├── base.py              # ToolDefinition, ToolResult, ToolError
│   ├── decorators.py        # @tool decorator
│   ├── registry.py          # ToolRegistry singleton
│   ├── executor.py          # ToolExecutor
│   ├── validation.py        # JSON Schema validation
│   ├── context.py           # ToolContext, ContextManager
│   ├── registration.py      # register_all_tools()
│   └── utility_tools.py     # Example utility tools
├── tests/
│   └── test_tools/
│       ├── __init__.py
│       ├── test_registry.py
│       ├── test_executor.py
│       ├── test_validation.py
│       └── test_utility_tools.py
└── ...
```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`
- [ ] List tools:
  ```bash
  http GET localhost:8000/api/v1/ai/tools/ Authorization:"Bearer <token>"
  ```
- [ ] Execute list_algorithms:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/list_algorithms/execute/ \
    Authorization:"Bearer <token>"
  ```
- [ ] Verify error handling with invalid tool name
- [ ] Verify error handling with invalid arguments

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/ai-tool-registry`
- [ ] Make atomic commits for each component
- [ ] All changes committed
- [ ] Push: `git push -u origin feature/ai-tool-registry`
- [ ] Create PR to main

---

## Definition of Done

- [ ] Tool registry pattern implemented
- [ ] Tool decorator working
- [ ] Executor handles sync execution
- [ ] Validation working with clear errors
- [ ] Example utility tools registered
- [ ] API endpoints functional
- [ ] Unit tests passing >80% coverage
- [ ] Manual testing completed
- [ ] PR reviewed and approved
- [ ] Merged to main
