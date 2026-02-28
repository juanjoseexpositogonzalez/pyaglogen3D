# Theory: Hybrid Access Pattern

Combining REST API access with direct backend access for optimal performance.

---

## The Challenge

AI tools need to interact with your application:

```
┌──────────────────────────────────────────────────────────────────┐
│                    Access Pattern Options                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Option A: REST API Only                                         │
│  ┌──────┐     HTTP      ┌─────────┐     HTTP      ┌──────────┐  │
│  │  AI  │ ───────────▶  │ Gateway │ ───────────▶  │ Backend  │  │
│  └──────┘               └─────────┘               └──────────┘  │
│                                                                  │
│  ✓ Secure, auditable                                             │
│  ✗ Slow for bulk operations                                      │
│  ✗ HTTP overhead per request                                     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Option B: Direct Backend Only                                   │
│  ┌──────┐    Python     ┌──────────┐                            │
│  │  AI  │ ───────────▶  │ Services │                            │
│  └──────┘               └──────────┘                            │
│                                                                  │
│  ✓ Fast, no HTTP overhead                                        │
│  ✗ Harder to audit                                               │
│  ✗ Bypasses API validation                                       │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Option C: Hybrid (Recommended)                                  │
│  ┌──────┐     HTTP      ┌─────────┐               ┌──────────┐  │
│  │  AI  │ ───────────▶  │ Gateway │               │ Services │  │
│  └──────┘    (user ops) └─────────┘               └──────────┘  │
│      │                                                  ▲        │
│      │        Direct Python (bulk ops)                  │        │
│      └──────────────────────────────────────────────────┘        │
│                                                                  │
│  ✓ Best of both worlds                                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## When to Use Each Pattern

### REST API (HTTP)

Use for:
- User-initiated actions (single simulation)
- Actions that need audit trails
- Cross-service communication
- External integrations

```python
# Example: User clicks "Run Simulation"
response = await api_client.post(
    "/api/v1/simulations/",
    json={"algorithm": "DLA", "n_particles": 500},
    headers={"Authorization": f"Bearer {token}"}
)
```

### Direct Backend

Use for:
- Bulk operations (1000+ simulations)
- Internal processing (analysis pipelines)
- Background tasks (Celery workers)
- Performance-critical paths

```python
# Example: AI batch operation
from apps.simulations.services import SimulationService

service = SimulationService(user=current_user)
for params in parameter_sweep:
    simulation = service.create_simulation(params)
    service.queue_execution(simulation)
```

---

## Implementation Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Service Layer                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                   SimulationService                           │ │
│  │  - create_simulation(params) → Simulation                     │ │
│  │  - queue_execution(simulation) → Task                         │ │
│  │  - get_simulation(id) → Simulation                            │ │
│  │  - list_simulations(filters) → QuerySet                       │ │
│  └───────────────────────────────────────────────────────────────┘ │
│         ▲                                           ▲               │
│         │                                           │               │
│    ┌────┴─────┐                              ┌──────┴──────┐       │
│    │ REST API │                              │  AI Tools   │       │
│    │ (DRF)    │                              │  (Direct)   │       │
│    └──────────┘                              └─────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Layer Benefits

1. **Single source of truth**: Business logic in one place
2. **Reusable**: Both API and AI tools use same code
3. **Testable**: Test services independently
4. **Consistent**: Same validation everywhere

---

## Service Class Pattern

### Base Service

```python
class BaseService:
    def __init__(self, user: User):
        self.user = user
        self.logger = logging.getLogger(self.__class__.__name__)

    def _check_permission(self, obj, action: str):
        """Check if user has permission for action on object."""
        if hasattr(obj, 'project'):
            project = obj.project
        elif hasattr(obj, 'owner'):
            project = None  # Use obj.owner
        else:
            raise ValueError("Cannot determine ownership")

        if not self._has_access(project, action):
            raise PermissionDenied(f"Cannot {action} this object")

    def _audit_log(self, action: str, obj, details: dict = None):
        """Log action for audit trail."""
        AuditLog.objects.create(
            user=self.user,
            action=action,
            object_type=obj.__class__.__name__,
            object_id=str(obj.pk),
            details=details or {}
        )
```

### Simulation Service

```python
class SimulationService(BaseService):
    def create_simulation(
        self,
        project_id: int,
        algorithm: str,
        parameters: dict
    ) -> Simulation:
        # Validate project access
        project = Project.objects.get(id=project_id)
        self._check_permission(project, "create_simulation")

        # Validate parameters
        validated_params = self._validate_parameters(algorithm, parameters)

        # Create simulation
        simulation = Simulation.objects.create(
            project=project,
            algorithm=algorithm,
            parameters=validated_params,
            status="CREATED"
        )

        self._audit_log("create_simulation", simulation)
        return simulation

    def queue_execution(self, simulation: Simulation) -> str:
        """Queue simulation for execution."""
        self._check_permission(simulation, "execute")

        simulation.status = "QUEUED"
        simulation.save()

        task = run_simulation_task.delay(simulation.id)

        self._audit_log("queue_execution", simulation, {"task_id": task.id})
        return task.id

    def create_and_queue_batch(
        self,
        project_id: int,
        algorithm: str,
        parameter_list: list[dict]
    ) -> list[Simulation]:
        """Create and queue multiple simulations efficiently."""
        project = Project.objects.get(id=project_id)
        self._check_permission(project, "create_simulation")

        simulations = []

        # Bulk create
        for params in parameter_list:
            validated = self._validate_parameters(algorithm, params)
            simulations.append(Simulation(
                project=project,
                algorithm=algorithm,
                parameters=validated,
                status="QUEUED"
            ))

        # Bulk insert
        Simulation.objects.bulk_create(simulations)

        # Queue all
        from celery import group
        task_group = group([
            run_simulation_task.s(sim.id) for sim in simulations
        ])
        task_group.apply_async()

        self._audit_log("create_batch", project, {"count": len(simulations)})
        return simulations
```

---

## API View Using Service

```python
class SimulationViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_service(self):
        return SimulationService(user=self.request.user)

    def create(self, request, project_pk=None):
        service = self.get_service()
        simulation = service.create_simulation(
            project_id=project_pk,
            algorithm=request.data['algorithm'],
            parameters=request.data.get('parameters', {})
        )
        service.queue_execution(simulation)
        return Response(
            SimulationSerializer(simulation).data,
            status=status.HTTP_201_CREATED
        )
```

---

## AI Tool Using Service

```python
def run_dla_simulation_handler(
    n_particles: int,
    user: User,
    project_id: int,
    **kwargs
) -> dict:
    """AI tool handler - uses service directly."""
    service = SimulationService(user=user)

    simulation = service.create_simulation(
        project_id=project_id,
        algorithm="DLA",
        parameters={"n_particles": n_particles, **kwargs}
    )

    task_id = service.queue_execution(simulation)

    return {
        "status": "queued",
        "simulation_id": simulation.id,
        "task_id": task_id
    }


def run_parametric_study_handler(
    algorithm: str,
    variable_parameter: str,
    values: list,
    user: User,
    project_id: int,
    **kwargs
) -> dict:
    """AI tool for bulk operations - uses service directly."""
    service = SimulationService(user=user)

    # Generate parameter combinations
    parameter_list = [
        {**kwargs, variable_parameter: value}
        for value in values
    ]

    # Use efficient batch method
    simulations = service.create_and_queue_batch(
        project_id=project_id,
        algorithm=algorithm,
        parameter_list=parameter_list
    )

    return {
        "status": "queued",
        "simulation_count": len(simulations),
        "simulation_ids": [s.id for s in simulations]
    }
```

---

## Performance Comparison

| Operation | REST API | Direct Service |
|-----------|----------|----------------|
| Single simulation | 50ms | 5ms |
| 10 simulations | 500ms | 15ms |
| 100 simulations | 5s | 50ms |
| 1000 simulations | 50s+ (rate limited) | 500ms |

Direct service access:
- No HTTP overhead
- No JSON serialization/deserialization
- Bulk database operations
- Direct Celery queuing

---

## Security Considerations

### Always Verify User Context

```python
class SimulationService(BaseService):
    def create_simulation(self, project_id: int, ...):
        project = Project.objects.get(id=project_id)

        # CRITICAL: Always check permission
        if not self._user_can_access_project(project):
            raise PermissionDenied()

        # ...
```

### Audit All Operations

```python
def _audit_log(self, action: str, obj, details: dict = None):
    AuditLog.objects.create(
        user=self.user,
        action=action,
        object_type=obj.__class__.__name__,
        object_id=str(obj.pk),
        details=details or {},
        ip_address=None,  # Internal operation
        source="ai_tool"  # Mark as AI-initiated
    )
```

### Rate Limiting Still Applies

```python
def create_and_queue_batch(self, ...):
    # Check user's quota
    if self._get_queued_count() + len(parameter_list) > self.user.batch_limit:
        raise QuotaExceeded(
            f"Batch would exceed limit of {self.user.batch_limit}"
        )
```

---

## Configuration

### Environment Settings

```python
# config/settings/base.py

# Batch operation limits
AI_BATCH_MAX_SIMULATIONS = env.int("AI_BATCH_MAX_SIMULATIONS", 1000)
AI_BATCH_RATE_LIMIT = env.int("AI_BATCH_RATE_LIMIT", 100)  # per minute

# Whether to use direct backend or API
AI_USE_DIRECT_BACKEND = env.bool("AI_USE_DIRECT_BACKEND", True)
```

### Feature Flags

```python
def get_access_method(operation: str, count: int) -> str:
    """Determine whether to use API or direct backend."""
    if not settings.AI_USE_DIRECT_BACKEND:
        return "api"

    # Use direct for batch operations
    if count > 10:
        return "direct"

    # Use API for user-visible single operations
    return "api"
```

---

## Key Takeaways

1. **Service layer**: Put business logic in services, not views
2. **Hybrid access**: API for single, direct for bulk
3. **Permission checks**: Always verify user access in services
4. **Audit logging**: Track all operations regardless of access method
5. **Rate limiting**: Apply quotas even for direct access
6. **Performance**: 10-100x faster for bulk operations

---

## Further Reading

- [Django Service Layer Pattern](https://www.hacksoft.io/blog/django-styleguide)
- [Celery Bulk Operations](https://docs.celeryproject.org/en/stable/userguide/canvas.html#groups)
- [Django Bulk Create](https://docs.djangoproject.com/en/4.2/ref/models/querysets/#bulk-create)
