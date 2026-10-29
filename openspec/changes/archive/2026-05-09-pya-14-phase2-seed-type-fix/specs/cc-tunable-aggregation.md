# Spec Delta: cc-tunable-aggregation (PYA-14 Phase 2)

> 1 R-MODIFIED (R16 — ballistic `required_distance` clarification) +
> 1 R-ADDED (R17 — explicit `seed_type` routing contract).
> No algorithm changes. Bug-fix coverage only.

---

## MODIFIED Requirements

### R16 (MODIFIED — Cycle 14 / PYA-14 Phase 2) — Per-step merge diagnostic trace

(Previously: `required_distance` was only defined for tunable merges; ballistic fallback entries implicitly used `0.0`. Degenerate-distance error handling was unspecified.)

The CC tunable algorithm (`run_tunable_cc_internal`) MUST emit a
`merge_trace` field on `SimulationResult`. The trace is a list of
`MergeTraceEntry` records, one per successful merge step (tunable OR
ballistic fallback). Non-CC algorithms emit an empty list.

#### `MergeTraceEntry` structure

| Field | Type | Description |
| --- | --- | --- |
| `step` | usize | 0-indexed merge counter (0 = first merge, N-2 = last). |
| `n1` | usize | Particle count of the impacted sub-cluster at merge time. |
| `n2` | usize | Particle count of the impactor sub-cluster at merge time. |
| `required_distance` | f64 | COM-COM distance computed by `calculate_com_distance` for the candidate fragment pair using the canonical CC formula. MUST be populated for BOTH tunable and ballistic entries; MUST NOT be hardcoded to `0.0`. |
| `actual_distance` | f64 | Measured COM-COM distance after positioning + contact resolution. |
| `rg_after` | f64 | Measured radius of gyration of the merged cluster. |
| `rg_target` | f64 | Target Rg for the merged cluster: `rp · ((n1 + n2) / kf)^(1/Df)`. |
| `merge_type` | string | `"tunable"` if `calculate_com_distance` produced a valid d AND `can_clusters_connect` passed; `"ballistic"` if the algorithm fell back to `merge_ballistic`. |
| `retries` | usize | Number of placement attempts (rotations / pair re-picks) before this merge succeeded. |
| `bounding_check_passed` | bool | `true` when `bounding_radius1 + bounding_radius2 >= required_distance` at first attempt; `false` when the algorithm had to fall back. |

#### Scenario R16.1 — Trace length matches merge count

- GIVEN a CC tunable simulation with N particles seeded as monomers
- WHEN the simulation completes
- THEN `result.merge_trace.len() == N - 1`

#### Scenario R16.2 — Tunable merges discriminated

- GIVEN a CC tunable run where every merge succeeds via the formula
- WHEN the simulation completes
- THEN every entry in `result.merge_trace` has `merge_type == "tunable"` and `bounding_check_passed == true`

#### Scenario R16.3 — Ballistic fallback flagged

- GIVEN a CC tunable run where some merges fall back to ballistic (e.g. low Df target)
- WHEN the simulation completes
- THEN at least one entry has `merge_type == "ballistic"` AND that entry has `bounding_check_passed == false`

#### Scenario R16.4 — Required vs actual distance

- GIVEN a successful tunable merge
- WHEN the entry is recorded
- THEN `actual_distance` is within ±10% of `required_distance` (the contact-resolution tolerance)

#### Scenario R16.5 — Rg comparison

- GIVEN a successful merge
- WHEN the entry is recorded
- THEN `rg_after > 0` AND `rg_target > 0` AND both reflect the cluster after `update_properties()`

#### Scenario R16.6 — Non-CC algorithm produces empty trace

- GIVEN a ballistic-only or DLA simulation
- WHEN the simulation completes
- THEN `result.merge_trace == []`

#### Scenario R16.7 — Trace persists through binding to result dict

- GIVEN a CC tunable simulation invoked via the Python binding
- WHEN the result dict is built
- THEN `result["merge_trace"]` is a list of dicts with the 10 fields above (correct keys and primitive types)

#### Scenario R16.8 — Backwards compat for legacy results

- GIVEN a legacy `Simulation.result` JSON document stored before this cycle
- WHEN the API serialises the result
- THEN the response treats missing `merge_trace` as `[]` (or omits the key); existing clients are unaffected

#### Scenario R16.9 — Retries reflect actual attempts

- GIVEN a tunable merge that requires multiple particle-pair selection attempts before producing a valid placement
- WHEN the entry is recorded
- THEN `retries` equals the number of attempts that occurred before the final placement

#### Scenario R16.10 — No behaviour change at coeff=1.0 / default config

- GIVEN identical seed and parameters before and after this cycle
- WHEN both simulations run with default sintering and default distributions
- THEN the final aggregate's particle positions are bitwise-identical (the trace is purely additive observation)

#### Scenario R16.11 — Ballistic entry populates required_distance from CC formula

- GIVEN a merge step that exhausted all retries and fell back to `merge_ballistic`
- WHEN the `MergeTraceEntry` is recorded
- THEN `required_distance` MUST equal the value returned by `calculate_com_distance(n1, n2, rp, df, kf, sintering_coeff)` called for that candidate pair BEFORE the ballistic merge executes
- AND `merge_type == "ballistic"`

#### Scenario R16.12 — Degenerate distance sets required_distance to 0.0 with warning

- GIVEN a ballistic fallback merge where `calculate_com_distance` returns `None` (e.g., negative argument under sqrt due to degenerate cluster sizes or parameters)
- WHEN the `MergeTraceEntry` is recorded
- THEN `required_distance` is set to `0.0`
- AND a tracing/log warning is emitted identifying the degenerate pair (n1, n2, step)
- AND no panic or error is raised; the ballistic merge proceeds normally

#### Backwards compatibility

- `merge_trace` is additive on `SimulationResult` and on the result dict / JSONField. Default value: empty list.
- Pre-cycle 14 results stored without the field deserialise gracefully (treated as `[]`).
- No DB migration. No frontend changes.

---

## ADDED Requirements

### R17 — Seed Type Parameter Routing

The simulation API MUST accept `seed_type` as a value inside the `parameters` JSON object (nested) and route it to the engine, in addition to the existing top-level field.

The system MUST resolve `seed_type` using the following precedence:

1. If `parameters.seed_type` is present → use that value (nested wins).
2. Else if top-level `seed_type` is present → use that value (legacy fallback).
3. Else → default to `"monomers"`.

The persisted `Simulation.seed_type` field MUST reflect the value actually sent to the engine, NOT the DRF serializer default. After persistence, `parameters` SHOULD NOT contain a `seed_type` key (it is lifted via `pop()`).

Valid values: `"monomers"`, `"dimers"`, `"trimers"`. Any other value MUST be rejected with a 400 error before creating a simulation record.

#### Scenario R17.1 — Nested seed_type wins over absent top-level

- GIVEN a POST with `parameters.seed_type = "dimers"` and no top-level `seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "dimers"`
- AND `Simulation.seed_type == "dimers"` in the DB
- AND `parameters` does not contain a `seed_type` key after persistence

#### Scenario R17.2 — Legacy top-level seed_type used when nested absent

- GIVEN a POST with top-level `seed_type = "trimers"` and no `parameters.seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "trimers"`
- AND `Simulation.seed_type == "trimers"` in the DB

#### Scenario R17.3 — Nested wins when both top-level and nested present

- GIVEN a POST with `parameters.seed_type = "dimers"` AND top-level `seed_type = "monomers"`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "dimers"` (nested wins)
- AND `Simulation.seed_type == "dimers"` in the DB

#### Scenario R17.4 — Default to monomers when neither present

- GIVEN a POST with no `seed_type` at top-level and no `parameters.seed_type`
- WHEN the serializer processes the request
- THEN the engine receives `seed_type = "monomers"`
- AND `Simulation.seed_type == "monomers"` in the DB

#### Scenario R17.5 — Invalid nested value rejected with 400

- GIVEN a POST with `parameters.seed_type = "foo"`
- WHEN the serializer validates the request
- THEN a 400 response is returned with a descriptive validation error
- AND no `Simulation` record is created

---

## Rationale

**R16 clarification** is bug-fix coverage for trace data integrity: ballistic entries were hardcoding `required_distance = 0.0`, making Phase 1 trace data incomplete and blocking empirical PYA-14 analysis. The degenerate-case scenario (R16.12) covers the `None` path of `calculate_com_distance` that already exists in R1.

**R17 is new** because the API contract for `seed_type` routing was implicit before this cycle: the DRF serializer ignored nested `parameters.seed_type`, silently overriding it with the default `"monomers"`. This bug invalidated all prior seed-type comparisons. R17 makes the precedence rule explicit, tested, and permanent.

---

## Out of Scope

- CC tunable formula changes (Df/kf math is unchanged)
- Historical data migration or flagging of affected simulations
- Frontend changes (backend lift is sufficient)
- CSV export or UI rendering of merge_trace data
