# Checklist: Simulation Tools

**Branch**: `feature/ai-simulation-tools`
**Depends on**: `feature/ai-tool-registry` merged
**Estimated time**: 1-2 days

---

## Prerequisites

- [ ] `feature/ai-tool-registry` branch merged to main
- [ ] Tool registry pattern implemented
- [ ] Existing simulation tasks working (`apps/simulations/tasks.py`)

---

## Backend Implementation

### Simulation Tool Definitions

- [ ] Create `apps/ai_assistant/tools/simulation_tools.py`

#### Single Simulation Tools

- [ ] Implement `run_dla_simulation` tool:
  - Parameters: n_particles (required), particle_radius, sticking_probability
  - Handler: Create Simulation, queue `run_simulation_task`
  - Return: simulation_id, task_id, status

- [ ] Implement `run_cca_simulation` tool:
  - Parameters: n_particles, n_clusters, cluster_size
  - Same pattern as DLA

- [ ] Implement `run_ballistic_simulation` tool:
  - Parameters: n_particles, particle_radius
  - Same pattern

- [ ] Implement `run_eden_simulation` tool:
  - Parameters: n_particles, growth_probability
  - Same pattern

- [ ] Consider creating `run_simulation` generic tool:
  - Parameter: algorithm (enum)
  - Parameter: parameters (object, algorithm-specific)
  - Routes to appropriate simulation type

#### Query Tools

- [ ] Implement `list_simulations` tool:
  - Parameters: project_id (optional), algorithm (optional), status (optional), limit
  - Returns: List of simulations with basic info
  - No async execution

- [ ] Implement `get_simulation` tool:
  - Parameters: simulation_id
  - Returns: Full simulation details including metrics
  - Validates user access to simulation

- [ ] Implement `get_simulation_status` tool:
  - Parameters: simulation_id or task_id
  - Returns: Current status, progress if available

### Parametric Study Tools

- [ ] Create `apps/ai_assistant/tools/study_tools.py`

- [ ] Implement `run_parametric_study` tool:
  - Parameters:
    - algorithm (enum)
    - variable_parameter (string)
    - values (array of numbers)
    - base_parameters (object)
    - repetitions (integer, default 1)
  - Handler:
    - Create ParametricStudy record
    - Generate all simulation combinations
    - Queue batch job
  - Return: study_id, total_simulations, status

- [ ] Implement `check_study_status` tool:
  - Parameters: study_id
  - Returns: status, progress, completed/failed counts

- [ ] Implement `get_study_results` tool:
  - Parameters: study_id
  - Returns: Aggregated results with statistics

- [ ] Implement `retry_failed_simulations` tool:
  - Parameters: study_id
  - Re-queues failed simulations from study

### Batch Orchestration

- [ ] Create `apps/ai_assistant/services/batch_orchestrator.py`:
  - `BatchOrchestrator` class
  - `create_study(study_config: dict) -> ParametricStudy`
  - `execute_study(study: ParametricStudy) -> None`:
    - Create Celery group for simulations
    - Set up completion callback
  - `get_progress(study_id: int) -> dict`

### Celery Tasks for Batch

- [ ] Update `apps/simulations/tasks.py` or create new:
  - `run_parametric_study_task(study_id: int)`:
    - Load study config
    - Create group of simulation tasks
    - Execute with rate limiting
  - `study_completion_callback(results, study_id: int)`:
    - Aggregate results
    - Update study status
    - Compute statistics

### Progress Tracking

- [ ] Create `apps/ai_assistant/services/progress_tracker.py`:
  - `StudyProgressTracker` class
  - `update_progress(study_id, simulation_id, status)`
  - `get_progress(study_id) -> dict`
  - Store progress in Redis for real-time access

### Tool Registration

- [ ] Update `apps/ai_assistant/tools/registration.py`:
  - Import simulation_tools
  - Import study_tools
  - Register all tools

---

## API Endpoints

- [ ] Add simulation tool endpoints (optional, for direct access):
  - `POST /api/v1/ai/tools/run_simulation/execute/`
  - `POST /api/v1/ai/tools/run_parametric_study/execute/`

- [ ] Add study status endpoint:
  - `GET /api/v1/simulations/studies/{id}/status/`
  - Real-time progress without authentication through AI

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/test_tools/test_simulation_tools.py`:
  - Test tool parameter validation
  - Test simulation creation (mocked task)
  - Test list_simulations filtering
  - Test get_simulation access control

- [ ] Create `apps/ai_assistant/tests/test_tools/test_study_tools.py`:
  - Test study creation
  - Test parameter value generation
  - Test progress tracking

- [ ] Create `apps/ai_assistant/tests/test_batch_orchestrator.py`:
  - Test study execution flow
  - Test Celery group creation
  - Test completion callback

### Integration Tests

- [ ] Create `apps/ai_assistant/tests/test_simulation_integration.py`:
  - Test full simulation flow (with test Celery)
  - Test parametric study with 5 simulations
  - Mark as slow test

### Run Tests

- [ ] All tests pass: `pytest apps/ai_assistant/tests/test_tools/test_simulation*.py -v`
- [ ] Integration tests: `pytest apps/ai_assistant/tests/test_simulation_integration.py -v --slow`

---

## Tool Summary

| Tool | Category | Async | Description |
|------|----------|-------|-------------|
| `run_dla_simulation` | simulation | Yes | Run DLA simulation |
| `run_cca_simulation` | simulation | Yes | Run CCA simulation |
| `run_ballistic_simulation` | simulation | Yes | Run Ballistic simulation |
| `run_eden_simulation` | simulation | Yes | Run Eden simulation |
| `list_simulations` | query | No | List user's simulations |
| `get_simulation` | query | No | Get simulation details |
| `get_simulation_status` | query | No | Check simulation status |
| `run_parametric_study` | batch | Yes | Run parameter sweep |
| `check_study_status` | query | No | Check study progress |
| `get_study_results` | query | No | Get aggregated results |
| `retry_failed_simulations` | batch | Yes | Retry failed in study |

---

## Manual Testing

- [ ] Start Celery worker: `celery -A config worker -l info`
- [ ] Start Django: `python manage.py runserver`

- [ ] Test single simulation via tool:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/run_dla_simulation/execute/ \
    Authorization:"Bearer <token>" \
    n_particles:=500 \
    project_id:=1
  ```

- [ ] Test parametric study:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/run_parametric_study/execute/ \
    Authorization:"Bearer <token>" \
    algorithm=DLA \
    variable_parameter=n_particles \
    values:='[100, 200, 300]' \
    project_id:=1
  ```

- [ ] Verify simulations appear in database
- [ ] Verify Celery tasks execute
- [ ] Check study progress updates correctly

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/ai-simulation-tools`
- [ ] Commit each tool implementation separately
- [ ] Push: `git push -u origin feature/ai-simulation-tools`
- [ ] Create PR to main

---

## Definition of Done

- [ ] All single simulation tools implemented
- [ ] Parametric study tool working
- [ ] Batch orchestration functional
- [ ] Progress tracking real-time
- [ ] All tests passing
- [ ] Manual testing with real simulations
- [ ] PR reviewed and approved
- [ ] Merged to main
