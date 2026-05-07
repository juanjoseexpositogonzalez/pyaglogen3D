# Spec Delta: cc-tunable-aggregation (cycle 14 / PYA-14 Phase 1)

> 1 R-DELTA — `SimulationResult` gains a per-merge diagnostic trace.
> No behaviour change. Foundation for the Phase 2 fix.

---

## R16 (ADDED) — Per-step merge diagnostic trace

**Modifies**: nothing. New requirement on `cc-tunable-aggregation`.

The CC tunable algorithm (`run_tunable_cc_internal`) MUST emit a
`merge_trace` field on `SimulationResult`. The trace is a list of
`MergeTraceEntry` records, one per successful merge step (tunable OR
ballistic fallback). Non-CC algorithms emit an empty list.

### `MergeTraceEntry` structure

| Field | Type | Description |
| --- | --- | --- |
| `step` | usize | 0-indexed merge counter (0 = first merge, N-2 = last). |
| `n1` | usize | Particle count of the impacted sub-cluster at merge time. |
| `n2` | usize | Particle count of the impactor sub-cluster at merge time. |
| `required_distance` | f64 | COM-COM distance computed by `calculate_com_distance` (the target d for the power law). |
| `actual_distance` | f64 | Measured COM-COM distance after positioning + contact resolution. |
| `rg_after` | f64 | Measured radius of gyration of the merged cluster. |
| `rg_target` | f64 | Target Rg for the merged cluster: `rp · ((n1 + n2) / kf)^(1/Df)`. |
| `merge_type` | string | `"tunable"` if `calculate_com_distance` produced a valid d AND `can_clusters_connect` passed; `"ballistic"` if the algorithm fell back to `merge_ballistic`. |
| `retries` | usize | Number of placement attempts (rotations / pair re-picks) before this merge succeeded. |
| `bounding_check_passed` | bool | `true` when `bounding_radius1 + bounding_radius2 >= required_distance` at first attempt; `false` when the algorithm had to fall back. |

### Scenarios

**Scenario R16.1 — Trace length matches merge count**

Given a CC tunable simulation with N particles seeded as monomers,  
when the simulation completes,  
then `result.merge_trace.len() == N - 1`.

**Scenario R16.2 — Tunable merges discriminated**

Given a CC tunable run where every merge succeeds via the formula,  
when the simulation completes,  
then every entry in `result.merge_trace` has `merge_type == "tunable"` and `bounding_check_passed == true`.

**Scenario R16.3 — Ballistic fallback flagged**

Given a CC tunable run where some merges fall back to ballistic (e.g. low Df target → bounding sphere too small for late-game merges),  
when the simulation completes,  
then at least one entry has `merge_type == "ballistic"` AND that entry has `bounding_check_passed == false`.

**Scenario R16.4 — Required vs actual distance**

Given a successful tunable merge,  
when the entry is recorded,  
then `actual_distance` is within ±10% of `required_distance` (the contact-resolution tolerance).

**Scenario R16.5 — Rg comparison**

Given a successful merge,  
when the entry is recorded,  
then `rg_after > 0` AND `rg_target > 0` AND both reflect the cluster after `update_properties()`.

**Scenario R16.6 — Non-CC algorithm produces empty trace**

Given a ballistic-only or DLA simulation,  
when the simulation completes,  
then `result.merge_trace == []`.

**Scenario R16.7 — Trace persists through binding to result dict**

Given a CC tunable simulation invoked via the Python binding,  
when the result dict is built,  
then `result["merge_trace"]` is a list of dicts with the 10 fields above (correct keys and primitive types).

**Scenario R16.8 — Backwards compat for legacy results**

Given a legacy `Simulation.result` JSON document stored before this cycle,  
when the API serialises the result,  
then the response treats missing `merge_trace` as `[]` (or omits the key); existing clients are unaffected.

**Scenario R16.9 — Retries reflect actual attempts**

Given a tunable merge that requires multiple particle-pair selection attempts before producing a valid placement,  
when the entry is recorded,  
then `retries` equals the number of attempts that occurred before the final placement.

**Scenario R16.10 — No behaviour change at coeff=1.0 / default config**

Given identical seed and parameters before and after this cycle,  
when both simulations run with default sintering and default distributions (frente 13 backwards-compat path),  
then the final aggregate's particle positions are bitwise-identical (the trace is purely additive observation).

### Backwards compatibility

- `merge_trace` is additive on `SimulationResult` and on the result dict / JSONField. Default value: empty list.
- Pre-cycle 14 results stored without the field deserialise gracefully (treated as `[]`).
- No DB migration. No frontend changes (rendering deferred to a future cycle).

### Out of scope

- Implementing the actual fix for low-Df drift (Path B "adaptive d" or Path D "smart pair selection"). That is Phase 2, a separate cycle.
- CSV export of trace columns. Defer.
- Frontend visualisation of the trace.
