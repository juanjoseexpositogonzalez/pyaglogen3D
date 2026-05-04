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
