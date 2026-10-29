# Theory: Tool Calling (Function Calling)

Understanding how LLMs execute actions through structured function calls.

---

## What is Tool Calling?

Tool calling (also called function calling) allows an LLM to:
1. Recognize when a user request requires an action
2. Select the appropriate tool from available options
3. Generate structured arguments for the tool
4. Return control to your application for execution

The LLM does NOT execute the tool itself. It generates a structured request that your code executes.

---

## The Tool Calling Loop

```
┌──────────────────────────────────────────────────────────────┐
│                     Tool Calling Flow                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. User: "Run a DLA simulation with 1000 particles"         │
│           ↓                                                  │
│  2. LLM analyzes request + available tools                   │
│           ↓                                                  │
│  3. LLM returns: tool_call(run_dla_simulation, n=1000)       │
│           ↓                                                  │
│  4. Your code executes the actual simulation                 │
│           ↓                                                  │
│  5. Your code sends result back to LLM                       │
│           ↓                                                  │
│  6. LLM generates natural language response                  │
│           ↓                                                  │
│  7. User: "Simulation complete! Df = 1.78, 1000 particles"   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Tool Definition Anatomy

### JSON Schema for Parameters

Tools use JSON Schema to define their parameters:

```python
tool_definition = {
    "name": "run_dla_simulation",
    "description": "Run a Diffusion-Limited Aggregation simulation to generate a 3D agglomerate",
    "parameters": {
        "type": "object",
        "properties": {
            "n_particles": {
                "type": "integer",
                "description": "Number of primary particles in the agglomerate",
                "minimum": 10,
                "maximum": 100000
            },
            "particle_radius": {
                "type": "number",
                "description": "Radius of primary particles in nanometers",
                "default": 25.0
            },
            "sticking_probability": {
                "type": "number",
                "description": "Probability of particle adhesion on contact (0-1)",
                "minimum": 0,
                "maximum": 1,
                "default": 1.0
            }
        },
        "required": ["n_particles"]
    }
}
```

### Key Schema Properties

| Property | Purpose |
|----------|---------|
| `type` | Data type (string, integer, number, boolean, array, object) |
| `description` | Helps LLM understand the parameter's purpose |
| `enum` | Restrict to specific values |
| `minimum/maximum` | Numeric constraints |
| `default` | Value if not specified |
| `required` | List of mandatory parameters |

---

## Multi-Tool Scenarios

### Sequential Tool Calls

Sometimes one request requires multiple tools in sequence:

```
User: "Run a simulation and then analyze its fractal dimension"

LLM Response 1: tool_call(run_dla_simulation, n=500)
→ Your code runs simulation, returns simulation_id=123
→ Send result to LLM

LLM Response 2: tool_call(run_box_counting, simulation_id=123)
→ Your code runs analysis, returns Df=1.82
→ Send result to LLM

LLM Response 3: "I've run a DLA simulation with 500 particles and
                 analyzed it. The fractal dimension is 1.82, which
                 indicates a moderately compact structure."
```

### Parallel Tool Calls

Some requests can execute tools in parallel:

```
User: "What are the fractal dimensions of simulations 1, 2, and 3?"

LLM Response: [
    tool_call(get_simulation_metrics, id=1),
    tool_call(get_simulation_metrics, id=2),
    tool_call(get_simulation_metrics, id=3)
]
→ Your code executes all three in parallel
→ Send combined results to LLM

LLM Response: "Here are the fractal dimensions:
               - Simulation 1: Df = 1.78
               - Simulation 2: Df = 1.82
               - Simulation 3: Df = 1.75"
```

---

## Handling Tool Results

### Success Case

```python
# Tool executed successfully
tool_result = {
    "tool_call_id": "call_abc123",
    "role": "tool",
    "content": json.dumps({
        "status": "success",
        "simulation_id": 456,
        "n_particles": 1000,
        "execution_time": 12.5
    })
}
```

### Error Case

```python
# Tool execution failed
tool_result = {
    "tool_call_id": "call_abc123",
    "role": "tool",
    "content": json.dumps({
        "status": "error",
        "error_type": "ValidationError",
        "message": "n_particles must be positive, got -100"
    })
}
```

The LLM will interpret the error and explain it to the user in natural language.

---

## Tool Design Best Practices

### 1. Clear, Specific Names

```python
# Good
"run_dla_simulation"
"export_results_to_csv"
"get_fractal_dimension"

# Bad
"run"           # Too vague
"do_simulation" # Unclear what type
"process"       # Could mean anything
```

### 2. Descriptive Descriptions

The description is crucial for the LLM to select the right tool:

```python
# Good
"description": "Run a Diffusion-Limited Aggregation (DLA) simulation to
                generate a 3D fractal agglomerate. DLA models particle
                aggregation through random walks."

# Bad
"description": "Runs a simulation"
```

### 3. Appropriate Granularity

```python
# Too coarse (does too much)
"run_simulation_and_analyze_and_export"

# Too fine (requires too many calls)
"set_particle_count"
"set_particle_radius"
"initialize_simulation"
"run_simulation_step"

# Just right
"run_dla_simulation"      # Complete operation
"run_box_counting"        # Complete analysis
"export_to_csv"           # Complete export
```

### 4. Sensible Defaults

```python
"properties": {
    "n_particles": {
        "type": "integer",
        "description": "Number of particles (default: 500 for quick results)",
        "default": 500
    }
}
```

### 5. Validation Constraints

```python
"properties": {
    "algorithm": {
        "type": "string",
        "enum": ["DLA", "CCA", "BALLISTIC", "EDEN"],
        "description": "Aggregation algorithm to use"
    },
    "n_particles": {
        "type": "integer",
        "minimum": 10,
        "maximum": 100000
    }
}
```

---

## Async Tool Execution

For long-running operations (like simulations), use async patterns:

### Pattern 1: Immediate Task ID

```
User: "Run a simulation with 10000 particles"

LLM: tool_call(run_dla_simulation, n=10000)
Your code: Queues Celery task, returns immediately with task_id

Tool result: {"task_id": "abc123", "status": "queued",
              "estimated_time": "2-3 minutes"}

LLM: "I've started the simulation. Task ID: abc123.
      It should complete in 2-3 minutes. Use 'check status abc123'
      to see progress."
```

### Pattern 2: Status Check Tool

```python
{
    "name": "check_task_status",
    "description": "Check the status of a running simulation task",
    "parameters": {
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The task ID returned when the simulation was started"
            }
        },
        "required": ["task_id"]
    }
}
```

---

## Tool Categories for pyAgloGen3D

### Simulation Tools
- `run_dla_simulation` - Diffusion-Limited Aggregation
- `run_cca_simulation` - Cluster-Cluster Aggregation
- `run_ballistic_simulation` - Ballistic aggregation
- `run_eden_simulation` - Eden model growth
- `run_parametric_study` - Batch parameter sweep

### Analysis Tools
- `run_box_counting` - 3D fractal dimension
- `run_fraktal_analysis` - 2D projection analysis
- `compare_simulations` - Statistical comparison
- `get_simulation_metrics` - Retrieve computed metrics

### Export Tools
- `export_to_csv` - Tabular data export
- `export_to_docx` - Word document report
- `export_to_latex` - LaTeX/PDF report
- `generate_3d_image` - Visualization export

### Utility Tools
- `list_simulations` - Query user's simulations
- `get_simulation_details` - Single simulation info
- `check_task_status` - Async task status

---

## Conversation Context

### System Prompt Structure

```
You are an AI research assistant for pyAgloGen3D, a platform for
simulating and analyzing 3D fractal agglomerates.

You can help users by:
1. Running simulations (DLA, CCA, Ballistic, Eden)
2. Analyzing results (box-counting, fractal analysis)
3. Exporting data (CSV, Word, LaTeX)

When a user asks to run a simulation or analysis, use the appropriate
tool. Always confirm what you're doing before executing.

Current user: {username}
Project context: {project_name}
```

### Maintaining State

The conversation history provides context:

```python
messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": "Run a DLA with 1000 particles"},
    {"role": "assistant", "content": None, "tool_calls": [...]},
    {"role": "tool", "tool_call_id": "...", "content": result},
    {"role": "assistant", "content": "Simulation complete! ID: 123"},
    {"role": "user", "content": "Now analyze it"},  # "it" = simulation 123
    # LLM understands context from history
]
```

---

## Error Handling Strategies

### User-Friendly Error Messages

```python
# Don't expose raw exceptions
tool_result = {
    "status": "error",
    "message": "Unable to run simulation: particle count (150000) exceeds
               maximum (100000). Please use a smaller number of particles."
}
```

### Recoverable Errors

```python
# Suggest alternatives
tool_result = {
    "status": "error",
    "error_type": "ResourceBusy",
    "message": "Worker queue is full. Simulation queued at position 5.",
    "suggestion": "Try again in a few minutes or use fewer particles
                   for faster execution."
}
```

---

## Security Considerations

### Input Validation

Always validate tool arguments server-side:

```python
def run_simulation(n_particles: int, project_id: int):
    # Validate range
    if not 10 <= n_particles <= 100000:
        raise ValidationError("n_particles out of range")

    # Validate ownership
    project = Project.objects.get(id=project_id)
    if project.owner != current_user:
        raise PermissionError("Not your project")
```

### Rate Limiting

Prevent abuse of expensive operations:

```python
# Limit simulations per user per hour
if user.simulations_last_hour >= 50:
    return {"error": "Rate limit exceeded. Max 50 simulations/hour."}
```

### Output Sanitization

Don't leak sensitive data in tool results:

```python
# Bad - exposes internal paths
{"error": "File not found: /var/app/data/user_123/sim.bin"}

# Good - sanitized
{"error": "Simulation data not found. It may have been deleted."}
```

---

## Key Takeaways

1. **LLM suggests, you execute**: The LLM generates structured calls, your code runs them
2. **Tools need great descriptions**: This is how the LLM decides which tool to use
3. **Handle async gracefully**: Long tasks return immediately with status tracking
4. **Validate everything server-side**: Never trust LLM-generated arguments
5. **Design for conversation**: Tools should work well in multi-turn dialogues

---

## Further Reading

- [Anthropic Tool Use Guide](https://docs.anthropic.com/claude/docs/tool-use)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [JSON Schema Specification](https://json-schema.org/)
