# Delta for cc-tunable-aggregation

## ADDED Requirements

### R22. Low-Df Fix Feature Flag

The engine MUST read the env var `CC_TUNABLE_USE_LOW_DF_FIX` ONCE per simulation invocation
via a helper `read_low_df_fix_flag()` that mirrors `read_phase3_flag()`. Default value when the
variable is absent: `true` (fix active). Accepted off-values (case-insensitive): `"false"`,
`"0"`, `"no"`. Any other non-empty value is treated as `true`.

The flag is orthogonal to `CC_TUNABLE_USE_PHASE3_ALGORITHM` (R20). The two flags MUST NOT alias,
share state, or implicitly toggle each other.

#### Scenario R22.1 — Default ON when env var absent

- GIVEN the env var `CC_TUNABLE_USE_LOW_DF_FIX` is not set in the process environment
- WHEN `read_low_df_fix_flag()` is called at simulation start
- THEN it returns `true`

#### Scenario R22.2 — Off-values disable the fix

- GIVEN the env var is set to one of `"false"`, `"0"`, `"no"`, `"False"`, `"FALSE"`, `"NO"`
- WHEN `read_low_df_fix_flag()` is called
- THEN it returns `false`

#### Scenario R22.3 — Independent of Phase 3 flag

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM = false` and `CC_TUNABLE_USE_LOW_DF_FIX = true`
- WHEN the engine initializes
- THEN Phase 3 algorithm is OFF (random pair selection, undershoot fallback)
- AND the low-Df fix is ON (PC-seeded pool, gamma/2 bounding threshold)

---

### R23. PC-Generated Default Seed Pool

When `read_low_df_fix_flag()` returns `true` AND `seed_type == "monomers"`, the engine MUST
build the initial pool as `floor(N / PC_SEED_SIZE)` PC-generated sub-clusters of
`PC_SEED_SIZE = 4` particles each, plus `N mod PC_SEED_SIZE` leftover monomers appended to the
pool. When the flag is `false`, the existing monomer pool behavior (R4) applies unchanged.

The PC-seed builder MUST consume RNG draws from a **separate stream** derived from the main
seed via XOR with a fixed salt `PC_SEED_RNG_SALT = 0x5a7d_3f1e_8b2c_9604`. The main RNG state
MUST NOT be advanced by any PC-seed work. The salt value MUST be a `const` so that the same
seed reproduces the same PC-seed pool across runs and machines.

Each PC-seed cluster MUST be physically connected (no isolated particles within the cluster).
Across all seeds, every particle MUST belong to exactly one initial cluster (no duplicates, no
gaps).

#### Scenario R23.1 — N divisible by PC_SEED_SIZE: no leftover monomers

- GIVEN `seed_type = "monomers"`, `N = 20`, flag ON
- WHEN the simulation initializes
- THEN the pool contains exactly 5 PC-seed clusters of 4 particles each
- AND 0 leftover monomers
- AND total particle count is 20

#### Scenario R23.2 — Non-divisible N: leftover monomers appended

- GIVEN `seed_type = "monomers"`, `N = 21`, flag ON
- WHEN the simulation initializes
- THEN the pool contains 5 PC-seed clusters of 4 particles each AND 1 leftover monomer
- AND total particle count is 21

#### Scenario R23.3 — Flag OFF: monomer pool unchanged

- GIVEN `seed_type = "monomers"`, `N = 20`, flag OFF
- WHEN the simulation initializes
- THEN the pool contains exactly 20 monomer clusters (1 particle each)
- AND no PC-seed work is performed

#### Scenario R23.4 — Separate RNG stream: main draws unaffected

- GIVEN same `seed` and same `TunableCcParams` with `seed_type = "monomers"`, flag ON
- WHEN the simulation runs twice in two fresh processes
- THEN both runs produce identical SimulationResult.coordinates (deterministic salt + separate stream)
- AND the sequence of main-RNG draws after `initialize_seed_clusters` is bit-identical between any two runs that share the seed

#### Scenario R23.5 — `seed_type ∈ {"dimers", "trimers"}` unaffected by the flag

- GIVEN `seed_type = "dimers"` (or `"trimers"`), flag ON
- WHEN the simulation initializes
- THEN the pool is built by the existing dimers/trimers branch (R4) — PC-seed builder is NOT invoked
- AND the pool composition matches R4.2 / R4.4 exactly

---

### R24. Rollback Byte-Identity Guarantee

When `read_low_df_fix_flag()` returns `false`, the code path executed by
`run_tunable_cc_internal` MUST be byte-identical to the pre-fix algorithm: same RNG draw order,
same RNG consumers, same `find_feasible_pairs` threshold (`bounding_sum >= required_distance`,
full gamma), same seed pool construction. No new RNG streams are created in the flag-off path.

For any `(seed, TunableCcParams)` pair, running with `CC_TUNABLE_USE_LOW_DF_FIX=false` MUST
produce `SimulationResult.coordinates`, `radii`, `fractal_dimension`, `prefactor`, and
`rg_evolution` values bit-identical to the pre-patch reference output at the same seed.

#### Scenario R24.1 — Flag-off reproduces pre-patch coordinates

- GIVEN any `TunableCcParams` (any `seed_type`, any `target_df`, any `N ≤ 500`) and any seed `s`
- WHEN the simulation runs with `CC_TUNABLE_USE_LOW_DF_FIX=false`
- THEN `result.coordinates` matches a recorded pre-patch snapshot for `(params, s)` bit-for-bit
- AND `result.radii` matches bit-for-bit

#### Scenario R24.2 — Flag-off reproduces pre-patch fractal metrics

- GIVEN the same `(params, s)` as R24.1
- WHEN the simulation runs with the flag OFF
- THEN `result.fractal_dimension` and `result.prefactor` match the pre-patch values to within 1e-12 relative tolerance
- AND `result.rg_evolution` (entire sequence) matches the pre-patch sequence bit-for-bit

#### Scenario R24.3 — Flag-off creates no additional RNG streams

- GIVEN any simulation with the flag OFF
- WHEN execution reaches the end of `initialize_seed_clusters`
- THEN no RNG state was forked via the `PC_SEED_RNG_SALT` (no separate stream exists)
- AND the main RNG advance count equals the pre-patch advance count at the same point

---

### R25. Box-Counting Sanity in the Low-Df Band

When `read_low_df_fix_flag()` returns `true`, for any run with `target_df ∈ [1.4, 1.7]`,
`N ≥ 1000`, `seeds ≥ 3`, the final aggregate MUST satisfy a box-counting cross-check against
the Rg-scaling fractal dimension:

```
| BC_Df(coordinates, max_resolution=18) − result.fractal_dimension | ≤ 0.20
```

The tolerance accounts for documented finite-N box-counting bias (~0.2) observed in the
generator across all algorithms.

#### Scenario R25.1 — BC-vs-Rg agreement at Df=1.5

- GIVEN `target_df=1.5`, `target_kf=1.3`, `N=1000`, seeds `{1, 2, 3}`, `seed_type="monomers"`, flag ON
- WHEN each run completes
- THEN for each seed, `|BC_Df − result.fractal_dimension| ≤ 0.20`
- AND no seed produces a BC_Df value that is NaN, infinite, or negative

#### Scenario R25.2 — BC sanity holds across the low-Df band

- GIVEN `target_df ∈ {1.4, 1.5, 1.6, 1.7}`, `target_kf=1.3`, `N=1000`, seeds `{1, 2, 3}`
- WHEN each combination runs with flag ON
- THEN every (target_df, seed) pair satisfies `|BC_Df − result.fractal_dimension| ≤ 0.20`

---

## MODIFIED Requirements

### R3. Retry Policy on Geometric Merge Failure

When selecting a candidate pair (i, j) for a merge step, the engine MUST pre-screen pairs for
geometric feasibility before the retry loop. A pair is **feasible** when
`required_distance >= 2 * max(rp_i, rp_j)` (the CC formula distance is large enough that the
bounding spheres can physically reach each other without overlap).

The bounding-sum feasibility threshold used inside the pre-screen is gated by R22:

| `read_low_df_fix_flag()` | Bounding-sum threshold |
|--------------------------|------------------------|
| `true`  (default)        | `bounding_sum >= required_distance * 0.5` (MATLAB's `gamma/2`) |
| `false` (rollback)       | `bounding_sum >= required_distance` (full `gamma`, pre-fix strict rule) |

The threshold value MUST be computed ONCE per simulation (as `let bounding_threshold = ...`)
and reused for every candidate pair evaluated by `find_feasible_pairs` — it MUST NOT be
re-derived from the flag inside the inner loop.

The engine MUST pick uniformly at random from the feasible subset when one exists; only when
zero feasible pairs exist does the adaptive fallback (R5) engage. Each retry independently
samples fresh azimuth and elevation for the selected feasible pair. When the Phase 3 algorithm
flag (R20) is `false`, behavior reverts to the current random selection + undershoot ballistic
policy, while the R22 threshold gate still applies to any pre-screen logic that runs.

(Previously: the bounding-sum threshold was hardcoded to the full `required_distance` (`gamma`),
which over-rejected low-Df candidate pairs and pushed them into the ballistic fallback. The new
R22-gated threshold matches MATLAB's `gamma/2` rule when the fix is active.)

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

#### Scenario 3.8 — Low-Df fix threshold gate selects the right rule

- GIVEN two identical candidate pairs (same `n1`, `n2`, same bounding radii) where `bounding_sum = 0.6 * required_distance`
- WHEN `read_low_df_fix_flag() == true` evaluates the pair
- THEN the pair is included in the feasible set (passes `bounding_sum >= required_distance * 0.5`)
- WHEN `read_low_df_fix_flag() == false` evaluates the same pair
- THEN the pair is excluded from the feasible set (fails `bounding_sum >= required_distance`)

#### Scenario 3.9 — Threshold is computed once per simulation

- GIVEN any simulation invocation with `N >= 100`
- WHEN `find_feasible_pairs` runs for every merge step
- THEN the bounding threshold value is read from a single local variable initialized once before the merge loop
- AND `read_low_df_fix_flag()` is NOT called inside the candidate-pair inner loop

---

### R4. Seed Type Modes

The engine MUST accept a `seed_type` parameter with three modes controlling the initial
particle pool:

| `seed_type`   | Initial pool (flag OFF, rollback)                                  | Initial pool (flag ON, default)                                                                                  |
|---------------|--------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `"monomers"`  | N independent monomers                                              | `floor(N / PC_SEED_SIZE)` PC-seed clusters of `PC_SEED_SIZE = 4` particles + `N mod 4` leftover monomers (R23) |
| `"dimers"`    | ⌊N/2⌋ touching pairs; leftover 1 monomer when N is odd              | Same as flag OFF (R23.5)                                                                                         |
| `"trimers"`   | ⌊N/3⌋ linear trimers; leftovers: `N mod 3` additional monomers       | Same as flag OFF (R23.5)                                                                                         |

The default `seed_type` when the caller omits it MUST remain `"monomers"` (no change to the
parameter contract). Only the internal pool composition for that mode changes when the low-Df
fix flag is ON, as specified by R23.

(Previously: `seed_type = "monomers"` always produced N independent monomer clusters regardless
of flags. The new R23-gated behavior replaces that pool with PC-seed clusters when the fix is
active, which is the root cause of the low-Df convergence bug per Engram #705.)

#### Scenario 4.1 — Monomers, flag OFF: initial pool has N clusters of size 1

- GIVEN `seed_type = "monomers"`, `N = 10`, `CC_TUNABLE_USE_LOW_DF_FIX=false`
- WHEN the simulation initializes
- THEN the pool contains exactly 10 clusters each with 1 particle

#### Scenario 4.2 — Dimers: initial pool has ⌊N/2⌋ size-2 clusters

- GIVEN `seed_type = "dimers"` and `N = 10`
- WHEN the simulation initializes
- THEN the pool contains exactly 5 clusters each with 2 particles
- AND each dimer's inter-particle distance is `2·rp` (touching spheres)
- AND this holds regardless of the low-Df fix flag value

#### Scenario 4.3 — Dimers: odd N has one leftover monomer

- GIVEN `seed_type = "dimers"` and `N = 9`
- WHEN the simulation initializes
- THEN the pool contains 4 dimers and 1 monomer (total 9 particles)

#### Scenario 4.4 — Trimers: initial pool has ⌊N/3⌋ size-3 clusters

- GIVEN `seed_type = "trimers"` and `N = 12`
- WHEN the simulation initializes
- THEN the pool contains exactly 4 clusters each with 3 particles
- AND particles within each trimer are collinear with spacing `2·rp`

#### Scenario 4.5 — Trimers: leftover handling for non-divisible N

- GIVEN `seed_type = "trimers"` and `N = 11`
- WHEN the simulation initializes
- THEN the pool contains 3 trimers and 2 additional monomers (total 11 particles)
- AND no error or warning is raised

#### Scenario 4.6 — Default seed_type when param omitted

- GIVEN a caller that does not supply `seed_type`
- WHEN the simulation runs
- THEN behavior is identical to `seed_type = "monomers"` (with R23 applied if the flag is ON)

#### Scenario 4.7 — Monomers, flag ON: PC-seed pool replaces monomer pool

- GIVEN `seed_type = "monomers"`, `N = 20`, `CC_TUNABLE_USE_LOW_DF_FIX=true`
- WHEN the simulation initializes
- THEN the pool contains 5 PC-seed clusters of 4 particles each (per R23.1)
- AND total particle count remains 20

---

### R5. Convergence to Target

For target parameters `(Df_target, kf_target)` and `N ≥ 100`, the engine MUST produce
aggregates whose mean Df and kf over ≥ 5 independent runs (different seeds) satisfy:

- `|mean(Df) − Df_target| / Df_target < 0.05`  (±5% relative) for `Df_target >= 2.0`
- `|mean(Df) − Df_target| / Df_target < 0.10`  (±10% relative) for `Df_target ∈ [1.4, 2.0)`
- `|mean(kf) − kf_target| / kf_target < 0.10`  (±10% relative)

Additionally, **when `read_low_df_fix_flag()` is `true`** and `Df_target ∈ [1.4, 1.7]` with
`N ≥ 1000` and seeds `≥ 3`, the engine MUST satisfy:

- `mean(prefactor) >= 1.0` (no run produces the physically impossible `kf < 1.0` reported in
  the explore evidence — Engram #705)
- The Rg-scaling fractal dimension stored in `result.fractal_dimension` MUST agree with a
  box-counting cross-check on the same coordinates within `± 0.20` (R25).

When the adaptive fallback (Path B) engages, it MUST overshoot the required distance (never
undershoot). The current 89.9% undershoot rate (mean gap 27.9%, from explore #569) MUST drop to
< 5% of adaptive merges undershooting.

When Path B fallback triggers, the engine MUST:
1. Compute `max_achievable_distance` — the largest COM distance satisfying all geometric
   constraints (no overlap, bounding sphere preserved, sintering contact)
2. Emit the merge with `actual_distance = max_achievable_distance`
3. Tag the merge as `merge_type = "adaptive"` (distinct from "tunable" and "ballistic")
4. Ensure `actual_distance >= required_distance` (overshoot contract, never undershoot)

These bounds are verified by the integration test suite using `cargo test`.

(Previously: convergence in the low-Df band `[1.4, 1.7]` was not enforced and was empirically
violated — `Df_target = 1.5` produced measured Df ≈ 2.72 and `kf < 1.0` per Engram #705. No
explicit `kf >= 1.0` floor was specified, and no BC sanity check was required.)

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

#### Scenario 5.8 — Low-Df band convergence with fix ON

- GIVEN flag ON, `Df_target ∈ {1.4, 1.5, 1.6, 1.7}`, `target_kf=1.3`, `N=1000`, seeds `{1, 2, 3}`, `seed_type="monomers"`
- WHEN each (Df_target, seed) combination completes
- THEN `mean(result.fractal_dimension) / Df_target ∈ [0.90, 1.10]` for each Df_target
- AND `result.prefactor >= 1.0` for every individual run (no `kf < 1.0` reports)
- AND R25 BC sanity (`|BC_Df − fractal_dimension| ≤ 0.20`) holds for every run

---

### R19. Convergence Guarantee for Extended Df Range

WHEN running CC tunable with `target_df ∈ [1.4, 2.5]`, `target_kf ∈ [1.0, 1.5]`,
`n_particles ∈ [100, 1000]`, `seed_type = "dimers"`, the engine MUST produce aggregates within
tolerance over ≥ 3 independent RNG seeds per parameter combination:

- `|df_measured - target_df| / target_df <= 0.10`  (±10% for Df < 2.0)
- `|df_measured - target_df| / target_df <= 0.05`  (±5% for Df >= 2.0, R21)

Additionally, **when `read_low_df_fix_flag()` is `true`**, the convergence guarantee MUST also
hold for `seed_type = "monomers"` across the same parameter ranges. With the flag OFF
(rollback), `seed_type = "monomers"` retains the pre-fix behavior and is NOT subject to the
low-Df convergence guarantee — only `seed_type = "dimers"` is.

If `Df_target < 1.3` is found to be physically infeasible (no valid aggregate geometry exists),
this MUST be documented as an explicit exclusion with a warning emitted at simulation start.

(Previously: only `seed_type = "dimers"` was covered by the convergence guarantee for the
low-Df band, because the pre-fix monomer pool could not converge there. The fix activates the
guarantee for `"monomers"` too by replacing the pool composition per R23.)

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

#### Scenario R19.5 — Flag ON: monomers pool also converges in low-Df band

- GIVEN flag ON, `target_df ∈ {1.4, 1.5, 1.6, 1.7}`, `target_kf=1.3`, `N=350`, seeds {1, 2, 3}, `seed_type="monomers"`
- WHEN runs complete
- THEN `|mean(df_measured) − target_df| / target_df ≤ 0.10` for each `target_df`
- AND `result.prefactor >= 1.0` for every individual run

#### Scenario R19.6 — Flag OFF: monomers pool excluded from low-Df guarantee

- GIVEN flag OFF, `target_df=1.5`, `seed_type="monomers"`, `N=350`
- WHEN runs complete
- THEN the convergence guarantee does NOT apply; measured Df MAY diverge significantly from target
- AND this is the documented rollback behavior, not a regression
