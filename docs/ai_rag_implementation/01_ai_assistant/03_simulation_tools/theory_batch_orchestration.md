# Theory: Batch Simulation Orchestration

Running thousands of simulations efficiently through AI commands.

---

## The Batch Challenge

Single simulations are straightforward. But researchers need:
- Parameter sweeps (vary one parameter, keep others fixed)
- Monte Carlo studies (same parameters, statistical samples)
- Grid searches (all combinations of multiple parameters)

Running 1000+ simulations requires orchestration.

---

## Orchestration Patterns

### Pattern 1: Sequential Execution

```
User: "Run DLA simulations for n=100, 200, 300, 400, 500"

┌─────────────────────────────────────────────┐
│  Sequential (Slow, Simple)                  │
├─────────────────────────────────────────────┤
│  Task 1: n=100  ████████░░░░  Running       │
│  Task 2: n=200  ░░░░░░░░░░░░  Queued        │
│  Task 3: n=300  ░░░░░░░░░░░░  Queued        │
│  Task 4: n=400  ░░░░░░░░░░░░  Queued        │
│  Task 5: n=500  ░░░░░░░░░░░░  Queued        │
│                                             │
│  Total time: Sum of all individual times    │
└─────────────────────────────────────────────┘
```

**Pros**: Simple, predictable resource usage
**Cons**: Slow, wastes available parallelism

### Pattern 2: Parallel Execution

```
User: "Run DLA simulations for n=100, 200, 300, 400, 500"

┌─────────────────────────────────────────────┐
│  Parallel (Fast, Resource-Intensive)        │
├─────────────────────────────────────────────┤
│  Worker 1: n=100  ████████░░░░  Running     │
│  Worker 2: n=200  ██████░░░░░░  Running     │
│  Worker 3: n=300  ████░░░░░░░░  Running     │
│  Worker 4: n=400  ██░░░░░░░░░░  Running     │
│  Worker 5: n=500  █░░░░░░░░░░░  Running     │
│                                             │
│  Total time: Max of individual times        │
└─────────────────────────────────────────────┘
```

**Pros**: Fast completion
**Cons**: Resource spike, may overwhelm workers

### Pattern 3: Chunked Batching (Recommended)

```
User: "Run 100 DLA simulations with n=1000"

┌─────────────────────────────────────────────┐
│  Chunked Batching (Balanced)                │
├─────────────────────────────────────────────┤
│  Chunk 1 (20 tasks): ████████████  Done     │
│  Chunk 2 (20 tasks): ████████░░░░  Running  │
│  Chunk 3 (20 tasks): ░░░░░░░░░░░░  Queued   │
│  Chunk 4 (20 tasks): ░░░░░░░░░░░░  Queued   │
│  Chunk 5 (20 tasks): ░░░░░░░░░░░░  Queued   │
│                                             │
│  Parallelism: 20 concurrent workers         │
│  Total time: (n_tasks / chunk_size) × avg   │
└─────────────────────────────────────────────┘
```

**Pros**: Controlled parallelism, predictable resource usage
**Cons**: Slightly slower than full parallel

---

## Celery Group and Chord

### Group: Parallel Independent Tasks

```python
from celery import group

# Run 10 simulations in parallel
tasks = group([
    run_simulation_task.s(params)
    for params in simulation_params_list
])

result = tasks.apply_async()
```

### Chord: Parallel Tasks + Callback

```python
from celery import chord

# Run simulations, then aggregate results
workflow = chord(
    [run_simulation_task.s(params) for params in params_list],
    aggregate_results_task.s()  # Called when all complete
)

result = workflow.apply_async()
```

### Chain: Sequential Dependencies

```python
from celery import chain

# Run simulation → analyze → export
workflow = chain(
    run_simulation_task.s(params),
    run_analysis_task.s(),       # Receives simulation_id
    export_results_task.s()       # Receives analysis_id
)

result = workflow.apply_async()
```

---

## Parametric Study Model

### Database Model

```python
class ParametricStudy(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    algorithm = models.CharField(choices=ALGORITHM_CHOICES)

    # Parameter definitions
    base_parameters = models.JSONField()  # Fixed parameters
    variable_parameter = models.CharField()  # e.g., "n_particles"
    parameter_values = models.JSONField()  # e.g., [100, 200, 300]

    # Status tracking
    status = models.CharField(choices=STATUS_CHOICES)
    total_simulations = models.IntegerField()
    completed_simulations = models.IntegerField(default=0)
    failed_simulations = models.IntegerField(default=0)

    # Timing
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
```

### Status Flow

```
CREATED → QUEUED → RUNNING → COMPLETED
                      ↓
                  PARTIALLY_FAILED (some succeeded)
                      ↓
                    FAILED (all failed)
```

---

## Batch Tool Design

### Tool: Run Parametric Study

```python
{
    "name": "run_parametric_study",
    "description": "Run multiple simulations varying one parameter",
    "parameters": {
        "type": "object",
        "properties": {
            "algorithm": {
                "type": "string",
                "enum": ["DLA", "CCA", "BALLISTIC", "EDEN"]
            },
            "variable_parameter": {
                "type": "string",
                "enum": ["n_particles", "particle_radius", "sticking_probability"]
            },
            "values": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 2,
                "maxItems": 100
            },
            "base_parameters": {
                "type": "object",
                "description": "Fixed parameters for all simulations"
            },
            "repetitions": {
                "type": "integer",
                "default": 1,
                "minimum": 1,
                "maximum": 10,
                "description": "Number of repetitions per value"
            }
        },
        "required": ["algorithm", "variable_parameter", "values"]
    }
}
```

### Natural Language Examples

```
"Run a parameter sweep of DLA with n_particles from 100 to 1000 in steps of 100"

LLM generates:
{
    "algorithm": "DLA",
    "variable_parameter": "n_particles",
    "values": [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
}
```

```
"Compare CCA and DLA for n=500 with 5 repetitions each"

LLM generates two tool calls:
1. run_parametric_study(algorithm="DLA", values=[500], repetitions=5)
2. run_parametric_study(algorithm="CCA", values=[500], repetitions=5)
```

---

## Progress Tracking

### Real-Time Updates

```python
class ParametricStudyProgress:
    """Track progress of a parametric study."""

    def __init__(self, study_id: int):
        self.study = ParametricStudy.objects.get(id=study_id)

    def update(self, simulation_id: int, status: str):
        """Called when a simulation completes or fails."""
        if status == "COMPLETED":
            self.study.completed_simulations += 1
        elif status == "FAILED":
            self.study.failed_simulations += 1

        self.study.save()
        self._check_completion()

    def _check_completion(self):
        total = self.study.total_simulations
        done = self.study.completed_simulations + self.study.failed_simulations

        if done == total:
            if self.study.failed_simulations == 0:
                self.study.status = "COMPLETED"
            elif self.study.completed_simulations == 0:
                self.study.status = "FAILED"
            else:
                self.study.status = "PARTIALLY_FAILED"

            self.study.completed_at = timezone.now()
            self.study.save()
```

### Status Tool

```python
{
    "name": "check_study_status",
    "description": "Check the progress of a parametric study",
    "parameters": {
        "properties": {
            "study_id": {"type": "integer"}
        },
        "required": ["study_id"]
    }
}
```

Returns:

```json
{
    "study_id": 123,
    "status": "RUNNING",
    "progress": {
        "total": 100,
        "completed": 45,
        "failed": 2,
        "percentage": 45
    },
    "estimated_remaining": "3 minutes"
}
```

---

## Resource Management

### Worker Pool Limits

```python
# config/celery.py
CELERY_WORKER_CONCURRENCY = 8  # Max parallel tasks per worker
CELERY_TASK_SOFT_TIME_LIMIT = 300  # 5 minute soft limit
CELERY_TASK_TIME_LIMIT = 360  # 6 minute hard limit
```

### Rate Limiting

```python
@celery_app.task(rate_limit='10/m')  # Max 10 per minute
def run_simulation_task(simulation_id: int):
    ...
```

### Priority Queues

```python
# High priority: Single simulations (user waiting)
run_simulation_task.apply_async(
    args=[sim_id],
    queue='high_priority'
)

# Low priority: Batch simulations
run_simulation_task.apply_async(
    args=[sim_id],
    queue='batch'
)
```

---

## Error Recovery

### Retry Strategy

```python
@celery_app.task(
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=3
)
def run_simulation_task(simulation_id: int):
    ...
```

### Partial Failure Handling

When some simulations fail:

1. Mark study as `PARTIALLY_FAILED`
2. Store failure reasons per simulation
3. Provide retry tool:

```python
{
    "name": "retry_failed_simulations",
    "description": "Retry failed simulations in a study",
    "parameters": {
        "properties": {
            "study_id": {"type": "integer"}
        }
    }
}
```

---

## Result Aggregation

### Automatic Analysis

After study completes, automatically compute:

```python
def aggregate_study_results(study: ParametricStudy) -> dict:
    simulations = study.simulations.filter(status="COMPLETED")

    # Group by parameter value
    results = {}
    for sim in simulations:
        value = sim.parameters[study.variable_parameter]
        if value not in results:
            results[value] = []
        results[value].append({
            "df": sim.metrics.get("df"),
            "rg": sim.metrics.get("rg"),
            "n_particles": sim.metrics.get("n_particles")
        })

    # Compute statistics
    aggregated = {}
    for value, sims in results.items():
        dfs = [s["df"] for s in sims if s["df"]]
        aggregated[value] = {
            "mean_df": statistics.mean(dfs) if dfs else None,
            "std_df": statistics.stdev(dfs) if len(dfs) > 1 else None,
            "n_samples": len(dfs)
        }

    return aggregated
```

---

## Key Takeaways

1. **Use chunked batching**: Balance speed vs resource usage
2. **Celery groups/chords**: Built-in parallelism support
3. **Progress tracking**: Users need visibility into long operations
4. **Handle partial failures**: Not all-or-nothing
5. **Rate limiting**: Protect system from overload
6. **Auto-aggregation**: Compute summary statistics automatically

---

## Further Reading

- [Celery Canvas (Groups, Chords)](https://docs.celeryproject.org/en/stable/userguide/canvas.html)
- [Redis Rate Limiting](https://redis.io/commands/incr#pattern-rate-limiter)
- [Task Queues Best Practices](https://blog.heroku.com/background_jobs_best_practices)
