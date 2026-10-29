# Theory: Tool Design Principles

How to design tools that LLMs can use effectively and safely.

---

## The Tool Registry Pattern

A central registry manages all tools available to the AI:

```
┌─────────────────────────────────────────────────────────────┐
│                      Tool Registry                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  register(tool)          →  Add tool to registry            │
│  get_tools()             →  List all tools (for LLM)        │
│  get_tool(name)          →  Get specific tool               │
│  execute(name, args)     →  Run tool with arguments         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Registered Tools                   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  run_dla_simulation    │  SimulationTools           │   │
│  │  run_cca_simulation    │  SimulationTools           │   │
│  │  run_box_counting      │  AnalysisTools             │   │
│  │  export_to_csv         │  ExportTools               │   │
│  │  ...                   │  ...                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Tool Definition Structure

### Base Tool Interface

```python
@dataclass
class ToolDefinition:
    name: str                    # Unique identifier
    description: str             # What the tool does (for LLM)
    parameters: dict             # JSON Schema for arguments
    handler: Callable            # Function to execute
    category: str                # Grouping (simulation, analysis, export)
    requires_project: bool       # Whether project context needed
    is_async: bool               # Whether runs as Celery task
```

### Parameter Schema Patterns

#### Simple Parameters

```python
{
    "type": "object",
    "properties": {
        "n_particles": {
            "type": "integer",
            "description": "Number of particles to simulate",
            "minimum": 10,
            "maximum": 100000
        }
    },
    "required": ["n_particles"]
}
```

#### Enum Parameters

```python
{
    "type": "object",
    "properties": {
        "algorithm": {
            "type": "string",
            "enum": ["DLA", "CCA", "BALLISTIC", "EDEN"],
            "description": "Aggregation algorithm to use"
        }
    }
}
```

#### Nested Objects

```python
{
    "type": "object",
    "properties": {
        "particle_config": {
            "type": "object",
            "properties": {
                "radius": {"type": "number"},
                "material": {"type": "string"}
            }
        }
    }
}
```

#### Arrays

```python
{
    "type": "object",
    "properties": {
        "simulation_ids": {
            "type": "array",
            "items": {"type": "integer"},
            "description": "List of simulation IDs to compare",
            "minItems": 2,
            "maxItems": 10
        }
    }
}
```

---

## Tool Handler Design

### Synchronous Handler

For quick operations:

```python
def get_simulation_metrics(simulation_id: int, user: User) -> dict:
    """
    Quick database lookup, returns immediately.
    """
    simulation = Simulation.objects.get(id=simulation_id, project__owner=user)
    return {
        "id": simulation.id,
        "algorithm": simulation.algorithm,
        "n_particles": simulation.n_particles,
        "df": simulation.metrics.get("df"),
        "status": simulation.status
    }
```

### Asynchronous Handler

For long-running operations:

```python
def run_dla_simulation(
    n_particles: int,
    project_id: int,
    user: User,
    **kwargs
) -> dict:
    """
    Queues Celery task, returns task info immediately.
    """
    # Create simulation record
    simulation = Simulation.objects.create(
        project_id=project_id,
        algorithm="DLA",
        parameters={"n_particles": n_particles, **kwargs},
        status="QUEUED"
    )

    # Queue Celery task
    task = run_simulation_task.delay(simulation.id)

    return {
        "status": "queued",
        "simulation_id": simulation.id,
        "task_id": task.id,
        "message": f"DLA simulation queued with {n_particles} particles"
    }
```

---

## Context Injection

Tools need context about the current user and project:

```
┌──────────────────────────────────────────────────────────────┐
│                     Tool Execution Context                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  From Request:                                               │
│  ├── user: User              # Authenticated user            │
│  ├── project_id: int         # Current project (if any)      │
│  └── conversation_id: int    # Current chat session          │
│                                                              │
│  Injected by Registry:                                       │
│  ├── All of the above        # Passed to handler             │
│  └── permissions: list       # User's allowed operations     │
│                                                              │
│  From LLM:                                                   │
│  └── tool_arguments: dict    # Parameters from tool_call     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Handler Signature Pattern

```python
def handler(
    # LLM-provided arguments
    n_particles: int,
    algorithm: str,
    # Context-injected (not in schema)
    user: User,
    project_id: int | None,
    **kwargs
) -> dict:
    ...
```

The registry merges LLM arguments with context before calling the handler.

---

## Validation Layers

### Layer 1: JSON Schema (LLM-side)

The LLM validates against the schema before generating the call:

```python
"parameters": {
    "properties": {
        "n_particles": {
            "type": "integer",
            "minimum": 10
        }
    }
}
```

### Layer 2: Pydantic (Python-side)

Additional validation on the server:

```python
class RunSimulationParams(BaseModel):
    n_particles: int = Field(ge=10, le=100000)
    algorithm: Literal["DLA", "CCA", "BALLISTIC", "EDEN"]
    particle_radius: float = Field(default=25.0, gt=0)

    @field_validator("algorithm")
    def validate_algorithm(cls, v):
        # Additional business logic
        return v
```

### Layer 3: Business Logic

Final validation in the handler:

```python
def run_simulation(params: RunSimulationParams, user: User):
    # Check user quota
    if user.simulations_today >= user.daily_limit:
        raise QuotaExceededError("Daily simulation limit reached")

    # Check project ownership
    project = Project.objects.get(id=params.project_id)
    if project.owner != user and not project.is_shared_with(user):
        raise PermissionError("Not authorized for this project")
```

---

## Error Handling

### Error Categories

| Category | Example | User Message |
|----------|---------|--------------|
| Validation | Invalid parameter | "n_particles must be between 10 and 100000" |
| Permission | Not authorized | "You don't have access to this project" |
| Resource | Project not found | "Project 123 not found" |
| Quota | Rate limit hit | "Daily limit reached. Try again tomorrow" |
| System | Database error | "Service temporarily unavailable" |

### Error Response Format

```python
@dataclass
class ToolError:
    error_type: str        # ValidationError, PermissionError, etc.
    message: str           # User-friendly message
    details: dict | None   # Additional context
    recoverable: bool      # Can user retry with different params?
```

### LLM Error Handling

The LLM receives errors and explains them naturally:

```
Tool Result: {
    "error_type": "ValidationError",
    "message": "n_particles must be positive",
    "recoverable": true
}

LLM Response: "I couldn't run that simulation because the number
              of particles must be a positive number. Could you
              specify how many particles you'd like to use?"
```

---

## Tool Categorization

### Simulation Tools
- Create and run simulations
- Long-running, async execution
- Return task IDs for status tracking

### Analysis Tools
- Process simulation results
- May be sync (quick) or async (heavy computation)
- Return computed metrics

### Query Tools
- List and search existing data
- Always synchronous
- Read-only operations

### Export Tools
- Generate output files
- May be sync (small) or async (large)
- Return file URLs or content

### Utility Tools
- Check status, get help
- Always synchronous
- System operations

---

## Tool Discovery

### Static Registration

Tools registered at app startup:

```python
# apps/ai_assistant/tools/__init__.py

def register_all_tools(registry: ToolRegistry):
    # Simulation tools
    registry.register(run_dla_simulation_tool)
    registry.register(run_cca_simulation_tool)

    # Analysis tools
    registry.register(run_box_counting_tool)

    # Export tools
    registry.register(export_csv_tool)
```

### Dynamic Tool Generation

For project-specific tools:

```python
def get_project_tools(project: Project) -> list[ToolDefinition]:
    """Generate tools based on project capabilities."""
    tools = []

    if project.has_simulations:
        tools.append(make_analyze_project_tool(project))

    if project.has_parametric_studies:
        tools.append(make_study_tool(project))

    return tools
```

---

## Idempotency

### Idempotent Tools (Safe to Retry)

```python
def get_simulation(simulation_id: int) -> dict:
    """Always returns same result for same input."""
    return Simulation.objects.get(id=simulation_id).to_dict()
```

### Non-Idempotent Tools (Side Effects)

```python
def run_simulation(params: dict) -> dict:
    """Creates new simulation each time."""
    # Include deduplication logic
    existing = Simulation.objects.filter(
        project_id=params["project_id"],
        parameters=params,
        created_at__gte=timezone.now() - timedelta(minutes=5)
    ).first()

    if existing:
        return {"status": "duplicate", "simulation_id": existing.id}

    # Create new simulation
    ...
```

---

## Rate Limiting

### Per-Tool Limits

```python
TOOL_RATE_LIMITS = {
    "run_dla_simulation": {"calls": 10, "period": "hour"},
    "run_parametric_study": {"calls": 5, "period": "hour"},
    "export_to_csv": {"calls": 100, "period": "day"},
}
```

### Implementation

```python
def check_rate_limit(user: User, tool_name: str) -> bool:
    limits = TOOL_RATE_LIMITS.get(tool_name)
    if not limits:
        return True

    cache_key = f"tool_limit:{user.id}:{tool_name}"
    current = cache.get(cache_key, 0)

    if current >= limits["calls"]:
        return False

    cache.incr(cache_key)
    return True
```

---

## Key Takeaways

1. **Single Responsibility**: Each tool does one thing well
2. **Clear Schema**: JSON Schema enables LLM validation
3. **Context Injection**: User/project context added automatically
4. **Layered Validation**: Schema → Pydantic → Business logic
5. **Graceful Errors**: Return structured errors the LLM can explain
6. **Async by Default**: Long operations return immediately with task ID
7. **Rate Limiting**: Protect expensive operations

---

## Further Reading

- [JSON Schema Specification](https://json-schema.org/understanding-json-schema/)
- [Pydantic V2 Documentation](https://docs.pydantic.dev/)
- [Celery Task Design](https://docs.celeryproject.org/en/stable/userguide/tasks.html)
