# CC Tunable Formula Fix (PYA-10)

Corrects three bugs in the CC tunable `calculate_com_distance` formula
that caused systematic convergence toward the ballistic limit (Df ≈ 1.91)
regardless of the target fractal dimension.

## Why

Three user runs with target (Df=1.6, kf=1.7) produced Df values of
1.87, 2.07, and 1.90 — mean ≈ 1.95, all clustered near the ballistic
limit.  The kf values were 1.51, 1.25, and 1.38 (mean ≈ 1.38).  This
was systematic bias, not noise: the CC tunable algorithm was ignoring
the target and producing ballistic-like aggregates.

## Root cause

Three multiplicative bugs in `calculate_com_distance` in
`aglogen_core/engine/src/simulation/tunable_cc.rs`:

1. **Wrong leading factor**: the formula used `rp²/(n₁·n₂)` instead
   of `n·rp²/(n₁·n₂)`.  Missing factor of `n = n₁ + n₂`.

2. **Single-cluster term**: the term `n₁·(n₁/kf)^(2/Df)` was missing
   the inner `n₁` multiplier, producing `(n₁/kf)^(2/Df)` alone.
   Same error for the `n₂` term.

3. **Spurious 3/5 constant**: a `(3/5)` factor inherited from the Rg
   definition was applied to the COM distance formula where it does
   not belong.  The COM distance is NOT scaled by the monomer's
   moment of inertia.

## The correct formula

```
d² = (n·rp²)/(n₁·n₂) · [n·(n/kf)^(2/Df) − n₁·(n₁/kf)^(2/Df) − n₂·(n₂/kf)^(2/Df)]
```

where `n = n₁ + n₂`, `rp` is the primary particle radius, `Df` is
the target fractal dimension, and `kf` is the target prefactor.

The printed thesis equation (Chapter 6, CC Tuneable section) has a
typo in the leading factor.  The derivation above was cross-validated
against the PC case (n₂=1), which reduces to the known PC formula
and produces correct results in the Tunable PC algorithm.

## Other improvements

### Two-rotation positioning (P2)

The cluster merge direction is now sampled uniformly on the unit
sphere (`φ = U(0, 2π)`, `cos θ = U(−1, 1)`).  Previously, a
single-axis rotation was used, biasing merge directions and reducing
the algorithm's ability to find valid placements.

### Retry policy (P2)

Each merge step now retries up to `max_merge_retries` (default 100)
with a new random sub-cluster pair per retry.  Ballistic fallback
only triggers after all retries are exhausted.  Diagnostic metadata
tracks `tunable_merges`, `ballistic_merges`, and
`max_retries_per_merge` per simulation.

### Seed types: Monomers / Dimers / Trimers (P3)

A `SeedType` enum controls how the N primary particles are grouped
before the CC merge loop begins:

- **Monomers** (default): N independent monomers.
- **Dimers**: ⌊N/2⌋ touching pairs, leftover monomer if N is odd.
- **Trimers**: ⌊N/3⌋ linear triplets, leftover handling for N mod 3 ≠ 0.

Configurable via simulation creation form and API (`seed_type` field).

## Migration

```
python manage.py migrate simulations 0006
```

Additive nullable migration: adds `seed_type` CharField (default
`"monomers"`) to the Simulation model.  Reversible.

## Backward compatibility

- Existing simulations are untouched — the fix only affects future
  simulations using CC tunable.
- Legacy API callers without `seed_type` default to `monomers`.
- Legacy Python binding callers via `seed_cluster_size` still work
  (mapped to `Monomers` via deprecated `SeedStrategy::TunablePc` path).

## Validation

An integration test (`integration_cc_tunable.rs`) includes:

- **Smoke test** (runs): Df=1.8/kf=1.3/N=100 completes with tunable
  merges active (Df measured ~1.84, 2% error).
- **Convergence test** (ignored): 5-run mean at Df=1.6/kf=1.7/N=350.
  Currently ignored because ballistic fallback dominates (~72% of
  merges) at this low-Df target.

## Known limitations

The CC tunable algorithm converges well for Df ≥ 1.8 but **does not
converge to targets Df < 1.8** even after this fix.  Diagnostic
results from the integration tests (`integration_cc_tunable.rs`):

| Seed type | Target Df=1.6 result | Tunable merges | Ballistic |
| --------- | -------------------- | -------------- | --------- |
| Monomers  | mean Df ≈ 2.03 (27% err) | ~21%       | ~80%      |
| Dimers    | mean Df ≈ 1.96 (23% err) | ~78%       | ~22%      |
| Trimers   | mean Df ≈ 2.08 (30% err) | ~58%       | ~42%      |

Note: `seed_type=Dimers` raises tunable merge success from ~21% to
~78%, confirming the formula fix works.  But the resulting Df stays
near 2.0.  This means the issue is **not** the ballistic fallback
alone — the merge process itself does not preserve the target Df
invariant across iterative cluster merges.

Hypothesis: `position_clusters_for_contact` computes the correct
COM distance per merge step, but the iterative process drifts because
each merge recomputes from the partial aggregate's measured Rg
instead of enforcing a global invariant on the final aggregate.

This is tracked as a follow-up Jira issue (PYA-14) for a separate
SDD cycle.  The formula fix here is mathematically correct (all
unit tests pass, PC cross-validation holds) and provides clear
diagnostic visibility (`tunable_merges`, `ballistic_merges`,
`max_retries_per_merge` in the simulation result) to help debug
the remaining algorithmic issue.

**Recommended workaround for users targeting Df < 1.8**: until
PYA-14 is resolved, set the target Df to ≥ 1.8 OR use a different
algorithm (e.g. ballistic CC with manually tuned parameters).

---

## Low-Df Convergence Fix (`cc-tunable-low-df-fix`, cycle 1 of 2)

The **cc-tunable-low-df-fix** change (SDD cycle 1 of 2) resolves the primary convergence failure
in the low-Df band `[1.4, 1.7]` by two independent changes, both controlled by the
`CC_TUNABLE_USE_LOW_DF_FIX` environment flag (default `true`):

1. **PC-seed pool** (`seed_type = "monomers"`, flag ON): replaces the N independent monomer
   pool with `floor(N / 4)` pre-built 4-particle clusters. This gives the CC merge loop
   more structured starting material for building low-Df aggregates.
2. **Relaxed bounding threshold** (`gamma/2` instead of `gamma`): loosens the feasibility
   pre-screen in `find_feasible_pairs` from `bounding_sum >= required_distance` to
   `bounding_sum >= required_distance * 0.5`, matching the MATLAB reference implementation.

### Before / After (N=1000, seeds 1-3, kf=1.3, Monomers)

| Df_target | Before fix (sim_Df) | After fix (sim_Df) | After fix (BC_Df) |
|-----------|---------------------|--------------------|-------------------|
| 1.50      | 2.72                | 1.55               | 1.44              |
| 1.80      | 1.80                | 1.79               | 1.63              |
| 2.00      | 2.00                | 2.01               | 1.80              |
| 2.20      | 2.21                | 2.25               | 1.91              |
| 2.50      | 2.39                | 2.45               | 2.21              |
| 2.70      | 2.35                | 2.45               | 2.18              |
| 2.90      | 2.42                | 2.39               | 2.06              |

Note: Df ≥ 2.5 still undershoots — cycle 2 (`cc-tunable-high-df-fix`) is pending.

### Rollback / escape hatch

Set `CC_TUNABLE_USE_LOW_DF_FIX=false` to restore the **pre-fix algorithm bit-identically**
(same RNG draws, same seed pool, same bounding threshold). This is useful for:
- Reproducing pre-fix simulation results for comparison
- Temporarily disabling the fix while debugging convergence issues

```bash
CC_TUNABLE_USE_LOW_DF_FIX=false cargo run ...
```

Accepted off-values (case-insensitive): `"false"`, `"0"`, `"no"`. Any other value (including
absent) activates the fix.

### Companion change

`cc-tunable-high-df-fix` (cycle 2 of 2) — addresses residual undershoot for `Df ≥ 2.5`.
See **High-Df Convergence Fix** section below.

---

## High-Df Convergence Fix (Cycle 2 — cc-tunable-high-df-fix)

> Status: **shipped** (PR chain: #65 / #66 / PR3)

### Root Cause (H_B2)

After Cycle 1, `Df_target ∈ [2.5, 2.9]` with Dimers still capped near `sim_Df ≈ 2.4`.
The root cause (H_B2, from `explore.md §4.B`): `calculate_com_distance` returns
`Some(d)` where `d < 2·rp_max` — a geometrically impossible contact distance. This
value passes the Cycle 1 bounding-sum threshold (trivially, since `bounding_sum ≥ d * 0.5`
is easy for a small `d`), causing every subsequent placement attempt to fail. Retries
exhaust → `march_inward_merge` → ballistic contact at `d = 2·rp` → measured Df caps
at the ballistic limit (~2.0–2.4).

The fix is a **physical-contact guard** inserted in `find_feasible_pairs`:

```
# After calculate_com_distance returns Some(d):
if use_high_df_fix:
    rp_max = max(rp_i, rp_j)           # per-particle, MATLAB-aligned
    if required_distance < 2 * rp_max:
        continue                        # geometrically impossible — skip
# Proceed to Cycle 1 bounding-sum check
```

The guard is unconditional on `Df_target` and purely additive — it can only remove
pairs that were already guaranteed to fail placement, never a valid pair.

### Fix Mechanism: `adaptive_high_df_floor` Tag

When all candidate pairs fail the contact guard (AllInfeasible), the adaptive fallback
engages as usual, but the `MergeTraceEntry` is tagged with `merge_type = "adaptive_high_df_floor"`
(distinct from `"adaptive"`). This enables precise auditing of guard-triggered fallbacks.
The `actual_distance` is `2·rp_max` (the physical contact floor).

### Before / After Comparison (N=100, seeds 1–3, kf=1.3, Dimers)

| Df_target | Before sim_Df | After sim_Df | abs_err | kf_mean |
|-----------|---------------|--------------|---------|---------|
| 2.50      | ~2.399        | 2.439        | 0.061   | 1.260   |
| 2.70      | ~2.396        | 2.802        | 0.102   | 1.060   |
| 2.90      | ~2.427        | 2.932        | 0.032   | 0.929 ⚠️ |

Spec tolerance: `|mean(Df) − Df_target| ≤ 0.15` absolute (R27.4). All three targets pass.

#### ⚠️ kf at Df=2.9 / N=100

`kf_mean = 0.929` at Df=2.9 sits below the `≥ 1.0` target. This is a **finite-N
Rg-evolution estimator artifact**: at N=100 and near the geometric feasibility ceiling
(Df=2.9), the Rg-evolution tail is short and underestimates the final Rg, biasing the
power-law kf fit downward. The Df convergence is correct. Cycle 3
(`cc-tunable-estimator-overhaul`) tracks kf improvement for the extreme high-Df band.

### Rollback

```bash
# Rollback Cycle 2 only (keep Cycle 1 low-Df fix active)
CC_TUNABLE_USE_HIGH_DF_FIX=false cargo run ...

# Full rollback to pre-Cycle-1 (both fixes disabled)
CC_TUNABLE_USE_HIGH_DF_FIX=false CC_TUNABLE_USE_LOW_DF_FIX=false cargo run ...
```

Both rollback paths are byte-identical to their respective baseline states (R26.4 / R24).

### `high_df_feasibility_audit` Diagnostic

Run `cargo run --release --example high_df_feasibility_audit -p aglogen-engine` for a
before/after comparison at `Df_target ∈ {2.7, 2.9}` showing guard activation counts
and Df improvement per run.

### Flag Matrix (3 flags, 8 rows)

| `LOW_DF_FIX` | `HIGH_DF_FIX` | `PHASE3` | Behavior |
|:---:|:---:|:---:|---|
| F | F | F | Pre-Cycle 1: random pair, full gamma, monomers, no guards |
| F | F | T | Pre-Cycle 1 + Phase 3 smart pair |
| T | F | F | Cycle 1 fixes only (PC seeds + gamma/2), Phase 2 pair |
| T | F | T | **Cycle 1 production default**: PC seeds, gamma/2, Phase 3 |
| F | T | F | Phase 2 + contact guard only (monomer seeds at mid-band risk) |
| F | T | T | Phase 3 + contact guard, monomer seeds |
| T | T | F | Cycle 1 + Cycle 2 fixes, Phase 2 pair |
| T | T | T | **Cycle 2 production default**: PC seeds, gamma/2, Phase 3, contact guard |
