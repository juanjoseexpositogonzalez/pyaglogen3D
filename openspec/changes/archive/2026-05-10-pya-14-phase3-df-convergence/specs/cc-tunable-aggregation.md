# Delta for cc-tunable-aggregation
<!-- Change: pya-14-phase3-df-convergence | Phase 3: Smart Pair Selection + Adaptive Fallback -->
<!-- Modifies canonical: openspec/specs/cc-tunable-aggregation.md (R1–R17) -->

## MODIFIED Requirements

### R3. Retry Policy on Geometric Merge Failure

When selecting a candidate pair (i, j) for a merge step, the engine MUST pre-screen pairs for
geometric feasibility before the retry loop. A pair is **feasible** when `required_distance >=
2 * max(rp_i, rp_j)` (the CC formula distance is large enough that the bounding spheres can
physically reach each other without overlap). The engine MUST pick uniformly at random from the
feasible subset when one exists; only when zero feasible pairs exist does the adaptive fallback
(R5 modified) engage.

(Previously: pair was selected uniformly at random from the full pool before checking feasibility;
retry loop exhausted 100 attempts on geometrically impossible pairs.)

Each retry independently samples fresh azimuth and elevation for the selected feasible pair.
Only after all retries on feasible pairs are exhausted does the adaptive fallback engage.

When the Phase 3 algorithm flag (R20) is `false`, behavior reverts to the current random
selection + undershoot ballistic policy.

#### Scenario 3.1 — First-attempt success

- GIVEN a merge where the first pair placement succeeds (no overlap, `d > 0`)
- WHEN the engine processes that step
- THEN exactly one attempt is made; retry counter is 0; adaptive fallback is NOT engaged

#### Scenario 3.2 — Success on retry attempt N (N > 1)

- GIVEN a merge where attempts 1 through N-1 fail and attempt N succeeds (all on the feasible set)
- WHEN the engine processes that step
- THEN the retry counter reaches N-1; the merge uses tunable geometry from attempt N; adaptive fallback is NOT engaged

#### Scenario 3.3 — All retries exhausted on feasible pairs → adaptive fallback

- GIVEN a merge where feasible pairs exist but all `max_merge_retries` placement attempts fail
- WHEN the engine processes that step
- THEN the adaptive fallback (R5) is used for that merge step
- AND the retry-exhaustion event is counted in simulation metadata (R7)

#### Scenario 3.4 — max_merge_retries is configurable

- GIVEN a caller that passes `max_merge_retries = 50`
- WHEN the engine is initialized with this parameter
- THEN the retry limit for every merge step in that simulation is 50, not the default 100
- AND the parameter is accepted without error for any positive integer value

#### Scenario 3.5 — No feasible pairs: skip retry loop, emit trace event, engage adaptive fallback

- GIVEN a merge step at late stage (N > 100) where ALL candidate pairs have `required_distance < 2 * max(rp_i, rp_j)`
- WHEN the engine evaluates the candidate pool
- THEN a `"no_feasible_pair"` event is emitted in `merge_trace` (separate non-merge entry with `step` and `pool_size` fields)
- AND the retry loop is skipped entirely (zero placement attempts)
- AND the adaptive fallback (R5) immediately engages

#### Scenario 3.6 — Feasible pre-screen backward compat for Df ≥ 2

- GIVEN `target_df >= 2.0` with a typical cluster pool (N = 350, dimers seed)
- WHEN the feasibility pre-screen runs across 5 seeds
- THEN ≥ 95% of merge steps find at least one feasible pair
- AND mean Df outcome is within ±5% of target (R21 non-regression)

#### Scenario 3.7 — formula returns None for candidate pair

- GIVEN a candidate pair where `calculate_com_distance` returns `None` (degenerate geometry)
- WHEN the feasibility pre-screen evaluates that pair
- THEN the pair is excluded from the feasible set (treated as infeasible)
- AND no panic or NaN is produced; the engine continues evaluating remaining candidates

---

### R5. Convergence to Target

For target parameters `(Df_target, kf_target)` and `N ≥ 100`, the engine MUST produce
aggregates whose mean Df and kf over ≥ 5 independent runs (different seeds) satisfy:

- `|mean(Df) − Df_target| / Df_target < 0.05`  (±5% relative) for `Df_target >= 2.0`
- `|mean(Df) − Df_target| / Df_target < 0.10`  (±10% relative) for `Df_target ∈ [1.4, 2.0)`
- `|mean(kf) − kf_target| / kf_target < 0.10`  (±10% relative)

When the adaptive fallback (Path B) engages, it MUST overshoot the required distance (never
undershoot). The current 89.9% undershoot rate (mean gap 27.9%, from explore #569) MUST drop
to < 5% of adaptive merges undershooting.

(Previously: convergence only guaranteed for `Df_target >= 1.8`; no lower Df guarantee existed;
ballistic fallback undershot required distance 89.9% of the time.)

When Path B fallback triggers, the engine MUST:
1. Compute `max_achievable_distance` — the largest COM distance satisfying all geometric
   constraints (no overlap, bounding sphere preserved, sintering contact)
2. Emit the merge with `actual_distance = max_achievable_distance`
3. Tag the merge as `merge_type = "adaptive"` (distinct from "tunable" and "ballistic")
4. Ensure `actual_distance >= required_distance` (overshoot contract, never undershoot)

#### Scenario 5.1 — Primary convergence target (Df=1.6, kf=1.7, N=350)

- GIVEN 5 runs with seeds 1–5 and target `Df=1.6, kf=1.7, N=350, seed_type="dimers"`
- WHEN each run completes and Df/kf are measured from the output aggregate
- THEN `mean(Df) ∈ [1.44, 1.76]` (±10%) and `mean(kf) ∈ [1.53, 1.87]`

#### Scenario 5.2 — Medium Df target (Df=1.8, kf=1.4, N=350)

- GIVEN 5 runs with seeds 1–5 and target `Df=1.8, kf=1.4, N=350`
- WHEN runs complete
- THEN `mean(Df) ∈ [1.71, 1.89]` and `mean(kf) ∈ [1.26, 1.54]`

#### Scenario 5.3 — High Df target (Df=2.0, kf=1.0, N=100)

- GIVEN 5 runs with seeds 1–5 and target `Df=2.0, kf=1.0, N=100`
- WHEN runs complete
- THEN `mean(Df) ∈ [1.90, 2.10]` and `mean(kf) ∈ [0.90, 1.10]`

#### Scenario 5.4 — Out-of-tolerance triggers CI failure

- GIVEN a formula regression where `calculate_com_distance` reverts to the buggy form
- WHEN the Scenario 5.1 integration test runs
- THEN the assertion fails because `mean(Df) > 1.76`
- AND CI is red — this is the guard against regression

#### Scenario 5.5 — Adaptive fallback overshoot contract

- GIVEN a merge step where adaptive fallback triggers (no feasible pair OR retries exhausted)
- WHEN `max_achievable_distance` is computed and the merge executes
- THEN `actual_distance >= required_distance` (overshoot, never undershoot)
- AND `merge_type == "adaptive"` in the trace entry

#### Scenario 5.6 — Undershoot rate drops below 5%

- GIVEN 5 runs with seeds 1–5 and target `Df=1.7, kf=1.3, N=350, seed_type="dimers"`
- WHEN adaptive merges are collected from merge_trace
- THEN `count(actual_distance < required_distance) / count(adaptive_merges) < 0.05`
- AND baseline was 89.9% undershoot (from explore analysis of 870 merges); Phase 3 MUST reduce this

#### Scenario 5.7 — Empty cluster pool error

- GIVEN a state where the cluster pool has zero candidates (degenerate simulation state)
- WHEN the engine attempts to select a merge pair
- THEN an explicit error is returned (not a panic); simulation terminates gracefully
- AND the error is observable from the Python binding as an exception with a descriptive message

---

### R7. Diagnostic Metadata

The engine MUST include retry and fallback counters in the simulation result metadata, extended
with Phase 3 adaptive merge tracking.

(Previously: only `tunable_merges`, `ballistic_merges`, `max_retries_per_merge` were tracked;
no adaptive merge type existed.)

| Field | Description |
|-------|-------------|
| `tunable_merges` | Count of merge steps completed via tunable geometry |
| `ballistic_merges` | Count of legacy ballistic merges (Phase 2 flag off OR explicit ballistic path) |
| `adaptive_merges` | Count of merge steps completed via adaptive fallback (Phase 3) |
| `no_feasible_pair_events` | Count of steps where zero feasible pairs existed |
| `max_retries_per_merge` | Highest retry count observed across all merge steps |

#### Scenario 7.1 — Low retry rate (algorithm working well)

- GIVEN a well-posed target (e.g., Df=1.8, kf=1.3, N=100)
- WHEN the simulation completes
- THEN `tunable_merges / (tunable_merges + adaptive_merges + ballistic_merges) > 0.80`
- AND `max_retries_per_merge` is present in the metadata

#### Scenario 7.2 — High retry rate (geometry constrained)

- GIVEN a target near the feasibility limit (e.g., Df=1.7, kf=1.3, N=350, dimers)
- WHEN the simulation completes
- THEN `adaptive_merges > 0` AND present in metadata
- AND the result is still returned (no crash)

#### Scenario 7.3 — Metadata always present regardless of outcome

- GIVEN any completed CC-tunable simulation (successful or with fallback merges)
- WHEN the result is returned
- THEN all five metadata fields are present and non-null

#### Scenario 7.4 — Phase 2 flag off: no adaptive_merges

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM = false`
- WHEN the simulation completes
- THEN `adaptive_merges == 0` and `ballistic_merges` reflects the full fallback count

---

## ADDED Requirements

### R18. merge_trace Schema Extension

The `MergeTraceEntry` schema MUST be extended with Phase 3 fields. Existing consumers reading
`merge_trace` MUST accept `"adaptive"` as a valid `merge_type`; schema additions are optional
fields (no breaking change for older consumers).

A `"no_feasible_pair"` event is a non-merge trace entry: it records that a step was reached but
no merge occurred at that step via the normal path, triggering the adaptive fallback.

| New Field | Type | Present On | Description |
|-----------|------|-----------|-------------|
| `merge_type` value `"adaptive"` | string | adaptive entries | Distinct from `"tunable"` and `"ballistic"` |
| `overshoot_pct` | f64 | adaptive entries | `(actual_distance - required_distance) / required_distance`; 0.0 if equal |
| event `"no_feasible_pair"` | trace entry | when pool has zero feasible pairs | `step` + `pool_size` fields; no merge occurred |

#### Scenario R18.1 — Adaptive entry has overshoot_pct populated

- GIVEN a merge step tagged `merge_type = "adaptive"`
- WHEN the `MergeTraceEntry` is recorded
- THEN `overshoot_pct` is present and equals `(actual - required) / required`
- AND `overshoot_pct >= 0.0` (overshoot contract from R5)

#### Scenario R18.2 — no_feasible_pair event carries step and pool_size

- GIVEN a step where all candidate pairs failed feasibility pre-screen
- WHEN the trace entry is emitted
- THEN the entry has `step` (the 0-indexed merge counter) and `pool_size` (number of clusters at that step)
- AND the entry does NOT have `actual_distance`, `rg_after`, or `merge_type` fields
- AND a separate merge entry IS subsequently emitted for the adaptive merge that occurred at that step

#### Scenario R18.3 — Legacy consumers accept "adaptive" merge_type

- GIVEN a consumer that previously checked `merge_type in ["tunable", "ballistic"]`
- WHEN it reads a trace with `"adaptive"` entries
- THEN it does NOT crash; unknown merge_type values are treated as non-breaking
- AND `overshoot_pct` (absent in old entries) is treated as optional (None / absent)

#### Scenario R18.4 — Existing trace fields unchanged

- GIVEN any merge step regardless of type
- WHEN the trace entry is recorded
- THEN all existing R16 fields (`step`, `n1`, `n2`, `required_distance`, `actual_distance`, `rg_after`, `rg_target`, `retries`, `bounding_check_passed`) remain present and semantically unchanged

---

### R19. Convergence Guarantee for Extended Df Range

WHEN running CC tunable with `target_df ∈ [1.4, 2.5]`, `target_kf ∈ [1.0, 1.5]`,
`n_particles ∈ [100, 1000]`, `seed_type = "dimers"`, the engine MUST produce aggregates within
tolerance over ≥ 3 independent RNG seeds per parameter combination:

- `|df_measured - target_df| / target_df <= 0.10`  (±10% for Df < 2.0)
- `|df_measured - target_df| / target_df <= 0.05`  (±5% for Df >= 2.0, R21)

If `Df_target < 1.3` is found to be physically infeasible (no valid aggregate geometry exists),
this MUST be documented as an explicit exclusion with a warning emitted at simulation start.

#### Scenario R19.1 — Parametric sweep covers required range

- GIVEN the parametric test sweep with combinations: Df ∈ {1.4, 1.6, 1.7, 1.8, 2.0, 2.5}, kf ∈ {1.0, 1.3, 1.5}, N ∈ {100, 350}, seeds {1, 2, 3}, seed_type="dimers"
- WHEN all combinations run
- THEN every (Df, kf, N) combination meets its respective tolerance tier
- AND the sweep is automated (CI-runnable, not manual)

#### Scenario R19.2 — Low Df = 1.4 within ±10%

- GIVEN `target_df=1.4`, `target_kf=1.3`, `N=350`, seeds 1–3, `seed_type="dimers"`
- WHEN runs complete
- THEN `mean(df_measured) ∈ [1.26, 1.54]` (±10%)

#### Scenario R19.3 — Df < 1.3 emits infeasibility warning

- GIVEN `target_df = 1.2` (below guaranteed range)
- WHEN the simulation starts
- THEN a warning is logged/returned indicating potential physical infeasibility
- AND the simulation still runs (warning only, not an error); the result MAY not converge

#### Scenario R19.4 — NaN in formula → graceful handling

- GIVEN a degenerate parameter set where the CC formula produces NaN for some candidate pairs
- WHEN the feasibility pre-screen processes those pairs
- THEN NaN-producing pairs are excluded from the feasible set (treated as infeasible)
- AND no panic or NaN propagates into the merge result or trace

---

### R20. Phase 3 Feature Flag for Rollback

The smart pair selection + adaptive fallback behavior MUST be gated behind a compile-time
Rust constant or runtime env var named `CC_TUNABLE_USE_PHASE3_ALGORITHM`.

Default: `true` (Phase 3 active). When `false`, behavior reverts exactly to the Phase 2
algorithm (random pair selection + undershoot ballistic fallback), with no behavioral difference
observable in any integration test targeting pre-Phase-3 behavior.

#### Scenario R20.1 — Flag true: Phase 3 algorithm active

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM = true` (default)
- WHEN a simulation with `target_df=1.7, N=350, seed_type="dimers"` runs
- THEN feasibility pre-screen is active, adaptive merges may appear in trace, R19 tolerance met

#### Scenario R20.2 — Flag false: Phase 2 algorithm active (no regression)

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM = false`
- WHEN a simulation with any target runs
- THEN behavior is bit-for-bit identical to Phase 2 implementation (same merge sequence for same seed)
- AND `adaptive_merges == 0` and no `"no_feasible_pair"` events appear in trace

#### Scenario R20.3 — Flag readable from env var without recompile

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM=false` set as an environment variable
- WHEN the engine initializes
- THEN Phase 2 behavior is active without recompilation

#### Scenario R20.4 — Flag default is true (opt-out, not opt-in)

- GIVEN neither compile-time constant nor env var is set
- WHEN the engine initializes
- THEN Phase 3 algorithm is active (`CC_TUNABLE_USE_PHASE3_ALGORITHM` defaults to `true`)

---

### R21. Non-Regression for Df ≥ 2.0

WHEN Phase 3 algorithm is active AND `target_df >= 2.0`, cases that converged in Phase 2 MUST
still converge in Phase 3 within the tighter ±5% tolerance.

(Baseline from explore #569: early-stage ballistic rate 4.2% — these cases were working; Phase 3
MUST NOT introduce regression.)

#### Scenario R21.1 — Df=2.0 non-regression (unit level)

- GIVEN Phase 3 active, `target_df=2.0`, `target_kf=1.0`, `N=350`, seeds 1–5
- WHEN runs complete
- THEN `mean(Df) ∈ [1.90, 2.10]` (±5% — same bound as Phase 2 R5 Scenario 5.3)
- AND `tunable_merges / total_merges` does not drop more than 5 percentage points vs Phase 2

#### Scenario R21.2 — Df=2.5 non-regression

- GIVEN Phase 3 active, `target_df=2.5`, `target_kf=1.3`, `N=350`, seeds 1–3
- WHEN runs complete
- THEN `mean(Df) ∈ [2.375, 2.625]` (±5%)

#### Scenario R21.3 — Phase 2 flag off produces identical results to Phase 2

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM = false`, same seed and params as R21.1
- WHEN the simulation runs
- THEN `df_measured` is within floating-point tolerance of the Phase 2 reference value
- AND this serves as the regression baseline to detect inadvertent Phase 3 contamination
