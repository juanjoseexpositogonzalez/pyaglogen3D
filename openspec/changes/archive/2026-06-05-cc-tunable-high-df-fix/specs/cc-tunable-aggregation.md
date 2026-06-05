# Delta for cc-tunable-aggregation

> SDD Cycle 2 of 2 · Change: `cc-tunable-high-df-fix`
> Builds on Cycle 1 (R22–R25, archived 2026-05-29). Non-regression: R21, R22, R23, R24, R25 MUST remain green.

## ADDED Requirements

### R26. High-Df Fix Feature Flag

The engine MUST read the env var `CC_TUNABLE_USE_HIGH_DF_FIX` ONCE per simulation invocation via a helper `read_high_df_fix_flag()` that mirrors `read_low_df_fix_flag()` (R22). Default when absent: `true` (fix active). Accepted off-values (case-insensitive): `"false"`, `"0"`, `"no"`. Any other non-empty value is treated as `true`.

The flag is orthogonal to `CC_TUNABLE_USE_LOW_DF_FIX` (R22) and `CC_TUNABLE_USE_PHASE3_ALGORITHM` (R20). The three flags MUST NOT alias, share state, or implicitly toggle each other.

#### Scenario R26.1 — Default ON when env var absent

- GIVEN the env var `CC_TUNABLE_USE_HIGH_DF_FIX` is not set
- WHEN `read_high_df_fix_flag()` is called at simulation start
- THEN it returns `true`

#### Scenario R26.2 — Off-values disable the fix

- GIVEN the env var is set to any of `"false"`, `"0"`, `"no"`, `"False"`, `"FALSE"`, `"NO"`
- WHEN `read_high_df_fix_flag()` is called
- THEN it returns `false`

#### Scenario R26.3 — Orthogonal to R20 and R22

- GIVEN `CC_TUNABLE_USE_PHASE3_ALGORITHM=true`, `CC_TUNABLE_USE_LOW_DF_FIX=true`, `CC_TUNABLE_USE_HIGH_DF_FIX=false`
- WHEN the engine initializes
- THEN Phase 3 is ON, low-Df fix is ON (gamma/2 + PC seeds), high-Df guard is OFF
- AND no flag implicitly forces another

#### Scenario R26.4 — Rollback byte-identity (Cycle 1-only baseline)

- GIVEN any `TunableCcParams` and seed `s`, run with `CC_TUNABLE_USE_HIGH_DF_FIX=false` and `CC_TUNABLE_USE_LOW_DF_FIX=true`
- WHEN the simulation completes
- THEN `result.coordinates`, `result.radii`, `result.fractal_dimension`, `result.prefactor` are bit-identical (`to_bits()` equality) to the Cycle 1-only reference snapshot for `(params, s)` across at least 3 fixture configs

---

### R27. Physical-Contact Feasibility Guard

When `read_high_df_fix_flag()` returns `true`, `find_feasible_pairs` MUST exclude any candidate pair whose CC-formula `required_distance` is **geometrically impossible** — i.e. smaller than the minimum contact distance for the two bounding spheres. The guard is `required_distance >= 2 * max(rp_i, rp_j)` evaluated per-particle (MATLAB-aligned).

This guard is **unconditional** on `Df_target` and is applied in addition to (logically AND) the Cycle 1 R22-gated bounding-sum threshold (`bounding_sum >= required_distance * 0.5`). A pair is feasible only when BOTH conditions hold.

When zero candidate pairs pass the guard for a merge step, the adaptive fallback (R5) MUST engage with:
- `merge_type = "adaptive_high_df_floor"` (distinct from `"adaptive"` to aid audit, per locked decision #3),
- `actual_distance = 2 * max(rp_i, rp_j)` (the physical floor — guaranteed overshoot of the impossible target).

When `read_high_df_fix_flag()` is `false`, the guard MUST NOT be evaluated; behavior reverts to Cycle 1-only (R3 + R22 bounding threshold), preserving R26.4.

For `Df_target ∈ [2.5, 2.9]` with `N ≥ 100`, seeds ≥ 3, flag ON, the final aggregate MUST satisfy a box-counting cross-check against the Rg-scaling fractal dimension within `|BC_Df − result.fractal_dimension| ≤ 0.20` (mirroring R25 for the high-Df band, per locked decision #4).

#### Scenario R27.1 — Geometrically impossible pair excluded

- GIVEN flag ON, a candidate pair where `calculate_com_distance` returns `Some(d)` with `d < 2 * max(rp_i, rp_j)`
- WHEN `find_feasible_pairs` evaluates that pair
- THEN the pair is excluded from the feasible set
- AND no placement attempt is made for it

#### Scenario R27.2 — Zero-feasible triggers `adaptive_high_df_floor`

- GIVEN flag ON, a late-stage merge step where every candidate pair fails the physical-contact guard
- WHEN the merge executes
- THEN a `"no_feasible_pair"` event is emitted in `merge_trace` (per R3 Scenario 3.5)
- AND the merge entry has `merge_type == "adaptive_high_df_floor"`
- AND `actual_distance == 2 * max(rp_i, rp_j)` for the chosen pair
- AND `actual_distance >= required_distance` (overshoot contract, R5 Scenario 5.5)

#### Scenario R27.3 — Guard is additive to Cycle 1 R22 threshold

- GIVEN flag ON AND `read_low_df_fix_flag() == true`, a candidate pair with `bounding_sum = 0.6 * required_distance` AND `required_distance = 1.8 * max(rp_i, rp_j)`
- WHEN `find_feasible_pairs` evaluates the pair
- THEN the pair is excluded (passes R22 gamma/2 but fails R27 physical-contact guard)

#### Scenario R27.4 — High-Df convergence with fix ON

- GIVEN flag ON, `Df_target ∈ {2.5, 2.7, 2.9}`, `target_kf=1.3`, `N=100`, seeds `{1, 2, 3}`, `seed_type="dimers"`
- WHEN each (Df_target, seed) run completes
- THEN `|mean(result.fractal_dimension) − Df_target| ≤ 0.15` for each `Df_target`
- AND `result.prefactor >= 1.0` for every individual run

#### Scenario R27.5 — BC sanity in the high-Df band

- GIVEN flag ON, `Df_target ∈ {2.5, 2.7, 2.9}`, `N ≥ 100`, seeds `{1, 2, 3}`
- WHEN each run completes
- THEN every (Df_target, seed) pair satisfies `|BC_Df(coordinates) − result.fractal_dimension| ≤ 0.20`
- AND no seed produces NaN, infinite, or negative `BC_Df`

#### Scenario R27.6 — Flag OFF: guard inactive, Cycle 1 behavior preserved

- GIVEN flag OFF, `Df_target = 2.7`, any seed
- WHEN `find_feasible_pairs` runs
- THEN no `required_distance >= 2 * max(rp_i, rp_j)` check is performed
- AND no merge is tagged `"adaptive_high_df_floor"`
- AND results are bit-identical to Cycle 1-only baseline (R26.4)

#### Scenario R27.7 — Mid-band non-regression (locked: unconditional guard)

- GIVEN flag ON AND `read_low_df_fix_flag() == true`, `Df_target ∈ {1.8, 2.0, 2.2, 2.4}`, `target_kf=1.3`, `N=350`, seeds `{1, 2, 3}`, `seed_type="dimers"`
- WHEN each (Df_target, seed) run completes
- THEN convergence MUST still hold within the existing R5 / R19 tolerance tier for each `Df_target`
- AND `adaptive_high_df_floor` rate MUST NOT exceed 10% of total merges in any single run

---

## MODIFIED Requirements

### R5. Convergence to Target

For target parameters `(Df_target, kf_target)` and `N ≥ 100`, the engine MUST produce aggregates whose mean Df and kf over ≥ 5 independent runs (different seeds) satisfy:

- `|mean(Df) − Df_target| / Df_target < 0.05`  (±5% relative) for `Df_target >= 2.0`
- `|mean(Df) − Df_target| / Df_target < 0.10`  (±10% relative) for `Df_target ∈ [1.4, 2.0)`
- `|mean(kf) − kf_target| / kf_target < 0.10`  (±10% relative)

**When `read_low_df_fix_flag()` is `true`** and `Df_target ∈ [1.5, 1.7]` with `N ≥ 2000` and seeds `≥ 3`, the engine MUST satisfy `mean(Df) / Df_target ∈ [0.90, 1.10]`, `result.prefactor >= 1.0` per run, and R25 BC sanity. **Df_target = 1.4** uses the weaker best-effort contract: mean Df < 1.8 with `prefactor >= 1.0`.

**When `read_high_df_fix_flag()` is `true`** and `Df_target ∈ [2.5, 2.9]` with `N ≥ 100` and seeds `≥ 3`, the engine MUST satisfy:

- `|mean(result.fractal_dimension) − Df_target| ≤ 0.15` (absolute tolerance — wider than ±5% because the band sits at the edge of geometric feasibility)
- `result.prefactor >= 1.0` for every individual run
- R27.5 BC sanity (`|BC_Df − result.fractal_dimension| ≤ 0.20`) holds for every run

When the adaptive fallback (Path B) engages, it MUST overshoot the required distance (never undershoot). When Path B triggers, the engine MUST:
1. Compute `max_achievable_distance` — the largest COM distance satisfying all geometric constraints (no overlap, bounding sphere preserved, sintering contact).
2. Emit the merge with `actual_distance = max_achievable_distance`.
3. Tag the merge with `merge_type ∈ {"adaptive", "adaptive_high_df_floor"}` — distinct from `"tunable"` and `"ballistic"`. The `"adaptive_high_df_floor"` tag is emitted exclusively when R27's physical-contact guard rejects every candidate pair; otherwise the existing `"adaptive"` tag applies. The two tags MUST NOT be aliased.
4. Ensure `actual_distance >= required_distance` (overshoot contract, never undershoot).

These bounds are verified by the integration test suite using `cargo test`.

(Previously: low-Df band [1.5, 1.7] enforced via R22 fix; high-Df band [2.5, 2.9] was not covered — measured Df silently capped at ~2.4 due to unscreened geometric impossibility per explore.md §4.B H_B2. The new R26-gated extension adds a ±0.15 absolute tolerance for `Df_target ∈ [2.5, 2.9]` and adds the `"adaptive_high_df_floor"` merge type alongside the existing `"adaptive"` tag.)

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
- AND `merge_type ∈ {"adaptive", "adaptive_high_df_floor"}` in the trace entry

#### Scenario 5.6 — Undershoot rate drops below 5%

- GIVEN 5 runs with seeds 1–5 and target `Df=1.7, kf=1.3, N=350, seed_type="dimers"`
- WHEN adaptive merges (both tags) are collected from `merge_trace`
- THEN `count(actual_distance < required_distance) / count(adaptive_merges) < 0.05`
- AND baseline was 89.9% undershoot (from explore #569); Phase 3 + Cycle 1 + Cycle 2 MUST keep this reduced

#### Scenario 5.7 — Empty cluster pool error

- GIVEN a state where the cluster pool has zero candidates (degenerate simulation state)
- WHEN the engine attempts to select a merge pair
- THEN an explicit error is returned (not a panic); simulation terminates gracefully
- AND the error is observable from the Python binding as an exception with a descriptive message

#### Scenario 5.8 — Low-Df band convergence with low-Df fix ON

- GIVEN low-Df flag ON, `Df_target ∈ {1.5, 1.6, 1.7}`, `target_kf=1.3`, `N=2000`, seeds `{1, 2, 3}`, `seed_type="monomers"`
- WHEN each (Df_target, seed) combination completes
- THEN `mean(result.fractal_dimension) / Df_target ∈ [0.90, 1.10]` for each Df_target
- AND `result.prefactor >= 1.0` for every individual run (no `kf < 1.0` reports)
- AND R25 BC sanity (`|BC_Df − fractal_dimension| ≤ 0.20`) holds for every run

#### Scenario 5.9 — Df=1.4 best-effort guarantee with low-Df fix ON

- GIVEN low-Df flag ON, `Df_target=1.4`, `target_kf=1.3`, `N=2000`, seeds `{1, 2, 3}`, `seed_type="monomers"`
- WHEN runs complete
- THEN `mean(result.fractal_dimension) < 1.8` (proves the fix recovers from the pre-fix ~2.7 failure mode)
- AND `result.prefactor >= 1.0` for every individual run
- AND the strict ±10% bound does NOT apply (Df=1.4 sits at the floor)

#### Scenario 5.10 — High-Df band convergence with high-Df fix ON

- GIVEN high-Df flag ON, `Df_target ∈ {2.5, 2.7, 2.9}`, `target_kf=1.3`, `N=100`, seeds `{1, 2, 3}`, `seed_type="dimers"`
- WHEN each (Df_target, seed) combination completes
- THEN `|mean(result.fractal_dimension) − Df_target| ≤ 0.15` for each `Df_target` (absolute tolerance, per R27.4)
- AND `result.prefactor >= 1.0` for every individual run
- AND R27.5 BC sanity holds for every run

#### Scenario 5.11 — Mid-band non-regression with high-Df fix ON (unconditional guard)

- GIVEN high-Df flag ON AND low-Df flag ON, `Df_target ∈ {1.8, 2.0, 2.2, 2.4}`, `target_kf=1.3`, `N=350`, seeds `{1, 2, 3}`, `seed_type="dimers"`
- WHEN each (Df_target, seed) combination completes
- THEN each Df_target meets its existing tolerance tier (R5 first bullet for `>= 2.0`; second bullet for `< 2.0`)
- AND `adaptive_high_df_floor` merge ratio MUST NOT exceed 10% in any individual run (mid-band protection per locked decision #1)

#### Scenario 5.12 — `adaptive_high_df_floor` lands at physical floor

- GIVEN high-Df flag ON, a merge step where R27 rejects every candidate
- WHEN the fallback engages
- THEN `merge_type == "adaptive_high_df_floor"`
- AND `actual_distance == 2 * max(rp_i, rp_j)` for the chosen pair (no off-by-epsilon undershoot)

---

### R19. Convergence Guarantee for Extended Df Range

WHEN running CC tunable with `target_df ∈ [1.4, 2.9]`, `target_kf ∈ [1.0, 1.5]`, `n_particles ∈ [100, 1000]`, `seed_type = "dimers"`, the engine MUST produce aggregates within tolerance over ≥ 3 independent RNG seeds per parameter combination:

| Band                     | Tolerance contract                                                                           |
|--------------------------|----------------------------------------------------------------------------------------------|
| `target_df ∈ [1.4, 2.0)` | `\|df_measured − target_df\| / target_df ≤ 0.10`                                              |
| `target_df ∈ [2.0, 2.5)` | `\|df_measured − target_df\| / target_df ≤ 0.05` (R21)                                        |
| `target_df ∈ [2.5, 2.9]` | `\|df_measured − target_df\| ≤ 0.15` (absolute) **when `read_high_df_fix_flag()` is `true`**  |

When the high-Df fix is OFF (rollback), `target_df ∈ [2.5, 2.9]` retains the pre-Cycle-2 behavior and is NOT subject to the high-Df convergence guarantee (pre-Cycle-2 silently capped at Df ≈ 2.4 per explore.md §4.B H_B2).

**When `read_low_df_fix_flag()` is `true`**, the convergence guarantee MUST also hold for `seed_type = "monomers"` across the same parameter ranges. With the low-Df flag OFF (rollback), `seed_type = "monomers"` retains the pre-Cycle-1 behavior and is NOT subject to the low-Df convergence guarantee — only `seed_type = "dimers"` is.

If `Df_target < 1.3` is found to be physically infeasible (no valid aggregate geometry exists), this MUST be documented as an explicit exclusion with a warning emitted at simulation start.

(Previously: convergence was guaranteed for `target_df ∈ [1.4, 2.5]` only; `target_df ∈ (2.5, 2.9]` was outside the guarantee band — pre-Cycle-2 capped silently near Df ≈ 2.4 due to the unscreened geometric impossibility. The new R26-gated high-Df extension activates the guarantee for `target_df ∈ [2.5, 2.9]` with a ±0.15 absolute tolerance.)

#### Scenario R19.1 — Parametric sweep covers required range

- GIVEN the parametric test sweep with combinations: Df ∈ {1.4, 1.6, 1.7, 1.8, 2.0, 2.5, 2.7, 2.9}, kf ∈ {1.0, 1.3, 1.5}, N ∈ {100, 350}, seeds {1, 2, 3}, seed_type="dimers"
- WHEN all combinations run
- THEN every (Df, kf, N) combination meets its respective tolerance tier (R19 table)
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

#### Scenario R19.5 — Low-Df flag ON: monomers pool also converges in low-Df band

- GIVEN low-Df flag ON, `target_df ∈ {1.4, 1.5, 1.6, 1.7}`, `target_kf=1.3`, `N=350`, seeds {1, 2, 3}, `seed_type="monomers"`
- WHEN runs complete
- THEN `|mean(df_measured) − target_df| / target_df ≤ 0.10` for each `target_df`
- AND `result.prefactor >= 1.0` for every individual run

#### Scenario R19.6 — Low-Df flag OFF: monomers pool excluded from low-Df guarantee

- GIVEN low-Df flag OFF, `target_df=1.5`, `seed_type="monomers"`, `N=350`
- WHEN runs complete
- THEN the convergence guarantee does NOT apply; measured Df MAY diverge significantly from target
- AND this is the documented rollback behavior, not a regression

#### Scenario R19.7 — High-Df flag ON: [2.5, 2.9] band converges within ±0.15 absolute

- GIVEN high-Df flag ON, `target_df ∈ {2.5, 2.7, 2.9}`, `target_kf=1.3`, `N=100`, seeds {1, 2, 3}, `seed_type="dimers"`
- WHEN runs complete
- THEN `|mean(df_measured) − target_df| ≤ 0.15` for each `target_df`
- AND `result.prefactor >= 1.0` for every individual run

#### Scenario R19.8 — High-Df flag OFF: [2.5, 2.9] band excluded from guarantee

- GIVEN high-Df flag OFF, `target_df=2.7`, `N=100`, seeds {1, 2, 3}, `seed_type="dimers"`
- WHEN runs complete
- THEN the ±0.15 convergence guarantee does NOT apply; measured Df MAY cap near 2.4
- AND this is the documented rollback behavior (R26.4 byte-identity), not a regression

---

## Non-Regression References (Cycle 1, do NOT redefine)

The following Cycle 1 requirements remain in force unchanged and MUST be preserved by every Cycle 2 implementation and test:

| Req | Title                                  | Cycle 2 obligation                                                                 |
|-----|----------------------------------------|------------------------------------------------------------------------------------|
| R21 | Non-Regression for Df ≥ 2.0            | Df=2.0 and Df=2.5 still converge within ±5% with the high-Df guard active.         |
| R22 | Low-Df Fix Feature Flag                | `read_low_df_fix_flag()` semantics unchanged; orthogonal to R26.                   |
| R23 | PC-Generated Default Seed Pool         | PC-seed pool composition and separate RNG stream unchanged.                        |
| R24 | Rollback Byte-Identity Guarantee       | `CC_TUNABLE_USE_LOW_DF_FIX=false` still reproduces pre-Cycle-1 byte-identically.   |
| R25 | Box-Counting Sanity in the Low-Df Band | Low-Df band `[1.4, 1.7]` BC-vs-Rg agreement within ±0.20 unchanged. R27.5 mirrors. |
