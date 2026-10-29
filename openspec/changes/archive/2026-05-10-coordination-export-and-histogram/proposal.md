# Proposal: Coordination Export and Histogram

## Intent

Export per-particle coordination data and coordination distribution histogram alongside existing aggregate stats. This preserves the information currently shown only in the contacts UI table, enabling the planned F2 graph visualization to replace that table without data loss.

## Scope

### In Scope
- Per-particle coordination list: `{particle_id, n_contacts, contact_neighbors[]}` in `Simulation.metrics`
- Coordination distribution histogram: `{coordination_distribution: {k: count}}` in `Simulation.metrics`
- Both fields in `SimulationViewSet.export_csv` and JSON metrics (DRF serializer)
- Both fields in `ParametricStudyViewSet.export_csv` (aggregated stats + optional long mode)
- Backward compat: existing `coordination = {mean, std}` unchanged

### Out of Scope
- F2 graph visualization (next cycle)
- F3 batch projection export, F4 batch image statistics, F5 hemisphere projection
- Changes to the current contacts UI table
- Recomputation of historical simulations

## Capabilities

### New Capabilities
- `coordination-export`: Per-particle coordination data and distribution histogram computed during simulation, persisted in metrics JSONField, and included in CSV/JSON exports

### Modified Capabilities
- `csv-export-locale`: New columns appended to SimulationViewSet.export_csv and ParametricStudyViewSet.export_csv for coordination data (append-only, no reorder)

## Approach

1. **Unify contact threshold**: Extract a shared service function from `neighbor_graph` logic (`r_i + r_j * (1 + tol)`) — variable-radius aware. Use in `run_simulation_task` instead of `2.1 * radius`.
2. **Compute once at simulation time**: Per-particle coordination + histogram computed in `run_simulation_task`, stored in `metrics` JSONField (no migration).
3. **Storage shape**: Nest under existing `metrics.coordination` — `per_particle[]`, `distribution{}` alongside `mean`, `std`.
4. **CSV exports**: SimulationViewSet adds per-particle section. ParametricStudyViewSet adds aggregate columns (mean, std, mode, max_coord) with optional `?coordination_detail=long` query param for per-particle rows.
5. **No historical backfill**: Only new sims populate the new fields. API consumers treat absence as "not yet computed".

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/simulations/tasks.py` | Modified | Use unified contact logic; persist per-particle + histogram to metrics |
| `backend/apps/simulations/views.py` (neighbor_graph) | Modified | Extract shared contact service function |
| `backend/apps/simulations/views.py` (export_csv) | Modified | Add coordination columns to SimulationViewSet.export_csv |
| `backend/apps/simulations/views.py` (ParametricStudy export) | Modified | Add aggregate coordination columns + optional long mode |
| `backend/apps/simulations/serializers.py` | Modified | Ensure new metrics fields serialize correctly |
| New: `backend/apps/simulations/services/coordination.py` | New | Shared contact computation service |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Storage growth (~40KB/sim for N=1000) | Low | TOAST compression handles transparently; document in CHANGELOG |
| CSV column additions break parsers | Med | Append-only additions; never reorder existing columns |
| Threshold change breaks historical comparability | Med | Keep `mean/std` using original threshold for backward compat; design decides final strategy |
| O(N^2) perf regression from refactor | Low | Refactor shares existing computation, no new O(N^2) work added |

## Rollback Plan

- No DB migration — metrics is a JSONField. Revert merge commit; old sims keep their shape.
- Frontend/API consumers checking for `per_particle` should treat absence as "not yet computed" gracefully.

## Dependencies

- None external. All code paths are backend-only within `apps/simulations`.

## Success Criteria

- [ ] New simulations expose `metrics.coordination.per_particle[]` and `metrics.coordination.distribution{}`
- [ ] CSV exports include new data without breaking existing column parsers
- [ ] All existing tests pass; new tests cover new fields
- [ ] ParametricStudy batch export works for N=1000 sims (no timeout, reasonable file size)
- [ ] `sum(distribution.values()) == N` for every simulation (sanity invariant)
- [ ] `neighbor_graph` endpoint and `run_simulation_task` use the same contact logic
