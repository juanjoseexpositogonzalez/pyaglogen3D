# Checklist: Analysis Tools

**Branch**: `feature/ai-analysis-tools`
**Depends on**: `feature/ai-tool-registry` merged
**Estimated time**: 1 day

---

## Prerequisites

- [ ] `feature/ai-tool-registry` branch merged to main
- [ ] Existing analysis functionality working (`apps/fractal_analysis/`)
- [ ] Rust `aglogen_core` box-counting available

---

## Backend Implementation

### Analysis Tool Definitions

- [ ] Create `apps/ai_assistant/tools/analysis_tools.py`

#### Box-Counting Tools

- [ ] Implement `run_box_counting` tool:
  - Parameters:
    - simulation_id (required)
    - min_box_size (optional, default 0.5)
    - max_box_size (optional, default 2.0)
    - n_sizes (optional, default 20)
  - Handler:
    - Load simulation geometry
    - Call `aglogen_core.box_counting_3d`
    - Store results in simulation.metrics
  - Return: df, r_squared, scaling_range
  - Is async for large simulations

- [ ] Implement `get_box_counting_results` tool:
  - Parameters: simulation_id
  - Returns: Existing analysis results or error if not analyzed

#### Fraktal Analysis Tools

- [ ] Implement `run_fraktal_analysis` tool:
  - Parameters:
    - simulation_id (required)
    - method (enum: granulated_2012, voxel_2018)
    - projection_axis (enum: x, y, z, random)
  - Handler:
    - Queue existing `run_fraktal_analysis_task`
    - Return task_id for async tracking
  - Return: analysis_id, task_id, status

- [ ] Implement `run_fraktal_from_image` tool:
  - Parameters:
    - image_path or image_base64
    - method
    - calibration (pixels_per_nm)
  - For uploaded images (not simulations)
  - Handler: Create FraktalAnalysis, queue task

- [ ] Implement `get_fraktal_results` tool:
  - Parameters: analysis_id
  - Returns: df, rg, kf, npo, ap

#### Comparison Tools

- [ ] Implement `compare_simulations` tool:
  - Parameters:
    - simulation_ids (array, 2-20 items)
    - metrics (array: df, rg, n_particles, etc.)
  - Handler:
    - Load metrics for all simulations
    - Compute statistics (mean, std, min, max)
    - Compute correlations if multiple metrics
  - Return: comparison object with statistics

- [ ] Implement `analyze_parametric_study` tool:
  - Parameters: study_id
  - Handler:
    - Get all completed simulations in study
    - Run box-counting on any missing
    - Aggregate results by parameter value
  - Return: per-value statistics, trends

#### Query Tools

- [ ] Implement `list_analyses` tool:
  - Parameters:
    - project_id (optional)
    - simulation_id (optional)
    - analysis_type (box_counting, fraktal)
  - Returns: List of analyses with basic info

---

## Analysis Service

- [ ] Create `apps/ai_assistant/services/analysis_service.py`:
  - `AnalysisService` class
  - `run_box_counting(simulation_id, params) -> AnalysisResult`
  - `run_fraktal(simulation_id, params) -> AnalysisResult`
  - `compare(simulation_ids, metrics) -> ComparisonResult`
  - `aggregate_study(study_id) -> AggregatedResults`

### Caching

- [ ] Implement analysis result caching:
  - Cache key: `analysis:{sim_id}:{params_hash}`
  - TTL: 24 hours
  - Invalidate on simulation update

### Error Handling

- [ ] Handle common analysis errors:
  - Simulation not complete → clear error message
  - No geometry data → suggest waiting for completion
  - Analysis timeout → queue as async task
  - Poor fit quality → return result with warning flag

---

## Tool Registration

- [ ] Update `apps/ai_assistant/tools/registration.py`:
  - Import analysis_tools
  - Register all analysis tools

---

## Testing

### Unit Tests

- [ ] Create `apps/ai_assistant/tests/test_tools/test_analysis_tools.py`:
  - Test box_counting parameter validation
  - Test with completed simulation (mocked)
  - Test with incomplete simulation (error case)
  - Test comparison with valid simulations
  - Test comparison with missing metrics

- [ ] Create `apps/ai_assistant/tests/test_analysis_service.py`:
  - Test caching behavior
  - Test error handling
  - Test aggregation logic

### Integration Tests

- [ ] Create `apps/ai_assistant/tests/test_analysis_integration.py`:
  - Test full analysis flow with small simulation
  - Test comparison across study
  - Mark as slow test

### Run Tests

- [ ] All tests pass: `pytest apps/ai_assistant/tests/test_tools/test_analysis*.py -v`

---

## Tool Summary

| Tool | Category | Async | Description |
|------|----------|-------|-------------|
| `run_box_counting` | analysis | Maybe* | 3D fractal analysis |
| `get_box_counting_results` | query | No | Get existing results |
| `run_fraktal_analysis` | analysis | Yes | 2D fraktal analysis |
| `run_fraktal_from_image` | analysis | Yes | Analyze uploaded image |
| `get_fraktal_results` | query | No | Get fraktal results |
| `compare_simulations` | analysis | No | Compare metrics |
| `analyze_parametric_study` | analysis | Maybe* | Analyze full study |
| `list_analyses` | query | No | List analyses |

*Async for large simulations, sync for small ones

---

## AI Response Examples

After implementing, the AI should handle:

```
User: "What's the fractal dimension of simulation 123?"
→ AI calls get_box_counting_results(simulation_id=123)
→ Returns: "Simulation 123 has a fractal dimension of 1.78 with R²=0.998"

User: "Analyze all simulations in my DLA study"
→ AI calls analyze_parametric_study(study_id=45)
→ Returns: "I analyzed 10 simulations. The mean Df is 1.79 ± 0.03,
           ranging from 1.75 to 1.82."

User: "Compare simulations 1, 2, and 3"
→ AI calls compare_simulations(simulation_ids=[1,2,3], metrics=["df","rg"])
→ Returns: "Comparison results:
           - Df: 1.78, 1.82, 1.75 (mean: 1.78)
           - Rg: 45.2, 48.1, 43.8 nm (mean: 45.7 nm)"
```

---

## Manual Testing

- [ ] Start Django server: `python manage.py runserver`
- [ ] Ensure Celery running: `celery -A config worker -l info`

- [ ] Test box-counting on existing simulation:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/run_box_counting/execute/ \
    Authorization:"Bearer <token>" \
    simulation_id:=1
  ```

- [ ] Test comparison:
  ```bash
  http POST localhost:8000/api/v1/ai/tools/compare_simulations/execute/ \
    Authorization:"Bearer <token>" \
    simulation_ids:='[1, 2, 3]' \
    metrics:='["df", "rg"]'
  ```

- [ ] Verify results match existing analysis functionality

---

## Git

- [ ] Ensure on latest main: `git checkout main && git pull`
- [ ] Create branch: `git checkout -b feature/ai-analysis-tools`
- [ ] Commit each tool separately
- [ ] Push: `git push -u origin feature/ai-analysis-tools`
- [ ] Create PR to main

---

## Definition of Done

- [ ] All analysis tools implemented
- [ ] Comparison functionality working
- [ ] Study aggregation working
- [ ] Caching implemented
- [ ] Error handling complete
- [ ] All tests passing
- [ ] Manual testing successful
- [ ] PR reviewed and approved
- [ ] Merged to main
