# Design: cc-tunable-rg-fit-fix

> SDD phase: DESIGN · Cycle 3 sub-cycle 1 of 2 (PYA-17)
> Builds on Cycle 1 (R22–R25) + Cycle 2 (R26–R27), all merged and archived.

## Decision Summary (LOCKED)

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Fit variant | **N-weighted log-space OLS** (`w_i = N_i / ΣN`), validated by Phase 0 diagnostic before tests lock tolerances. Fallback if diagnostic fails: tail-restricted fit (N ≥ N/2 threshold). |
| D2 | Flag | `CC_TUNABLE_RG_FIT_WEIGHTED`, default **ON**, read once per sim, no RNG salt (FLAG REGISTRY precedent, `tunable_cc.rs:104`). |
| D3 | Rollback scope | Metrics-only. Merge coordinates and `merge_trace` geometry are **identical ON vs OFF by construction** — the estimator is post-hoc. Verification: coordinates byte-identical + metrics ≤ 1e-10 relative. |
| D4 | R27.4 tightening | `kf ≥ 1.0` enforced for `Df_target ≤ 2.9` (was ≤ 2.7), conditional on flag ON. |
| D5 | Clamps | Unchanged: `Df ∈ [0.5, 3.5]`, `kf ∈ [0.01, 100]`. Phase 0 diagnostic must show no clamping at Df ∈ {2.5, 2.7, 2.9}, N ∈ {100, 500}. |

## Architecture

### Current flow (unbiased parts omitted)

```
merge loop (tunable_cc.rs:1696-1699)
  └─ push (largest.radius_of_gyration, particle_count) → rg_evolution / n_values
        └─ calculate_fractal_dimension_from_evolution (:1770-1841)
              ├─ x_i = ln(rg_i / rp), y_i = ln(n_i)
              ├─ UNWEIGHTED OLS over all points          ← BIAS HERE
              ├─ Df = slope.clamp(0.5, 3.5)
              └─ kf = exp(intercept).clamp(0.01, 100)
```

### New flow (flag ON)

```
              ├─ w_i = n_i / Σn
              ├─ WEIGHTED OLS: slope = S_xy/S_xx with
              │    S_xy = Σw(x−x̄_w)(y−ȳ_w), S_xx = Σw(x−x̄_w)²   (weighted means)
              ├─ same clamps
              └─ same return struct (no field changes)
```

The helper `weighted_linear_regression(x: &[f64], y: &[f64], w: &[f64]) -> (slope, intercept)`
is private, unit-tested in-file, and handles degenerate cases (Σw = 0 impossible here since
N ≥ 1; n = 1 point → zero variance → keep legacy clamped fallback).

### Bias mechanism (why weighting helps)

- Small-N early points: numerous, tightly clustered at low `ln(Rg/rp)`, low leverage per point
  but collectively dominate the unweighted sums.
- Tail points (high N): where guard-fallback merges land at `rg_after < rg_target` — they carry
  the information about the true asymptotic scaling but are outvoted today.
- `w_i = N_i / ΣN` re-balances influence toward large-N points where the fractal law
  `N = kf·(Rg/rp)^Df` is the design target (the merge loop *enforces* it per successful merge,
  `tunable_cc.rs:447-530`), making the fit consistent with the enforced law at the N that matters.

### Why not tail-restricted as primary

Throws away data and introduces an arbitrary threshold parameter; N-weighting uses all points,
has no extra parameters, and degrades continuously. Tail-restriction stays documented as D1
fallback if the Phase 0 diagnostic shows weighting insufficient (diagnostic prints both).

## Non-Regression Matrix

| Surface | Guarantee | How tested |
| --- | --- | --- |
| Merge coordinates (flag ON vs OFF) | Byte-identical | New test: same seed, compare serialized coords |
| `merge_trace` geometry | Identical | Same test asserts trace fields equal |
| Metrics flag OFF | ≤ 1e-10 relative vs pre-change | Snapshot comparison (pattern: Cycle 2 R-DOUBLE-ROLLBACK, but metrics-only) |
| Df convergence [1.4, 2.9] | R19/R27 tolerances unchanged | Existing sweep tests must pass unmodified |
| Python bindings | No signature/schema change | Binding tests untouched; `prefactor` value improves |
| Mid-band floor rate | R27.7 unchanged (geometry untouched) | Existing `mid_band_non_regression` passes |

## Test Plan Sketch (details in tasks.md)

1. **Phase 0 (diagnostic, pre-lock)**: `engine/examples/diagnostics/rg_fit_variants_audit.rs`
   — runs Df_target ∈ {2.5, 2.7, 2.9} × N ∈ {100, 500} × 3 seeds; prints per-variant
   (unweighted / N-weighted / tail-restricted N≥N/2) Df, kf, R²; verifies D5 no-clamp.
2. **Unit**: `weighted_linear_regression` against hand-computed values + degenerate cases.
3. **Integration**: R28.1 (kf ≥ 1.0 at Df=2.9, ≥3 seeds, flag ON), R28.2 (existing sweeps pass),
   R28.3 (flag OFF metrics ≡ pre-change), R28.4 (coordinates byte-identical ON vs OFF).
4. **R27.4 MODIFIED**: extend `high_df_convergence_band` kf enforcement to Df=2.9.

## Rollback

`CC_TUNABLE_RG_FIT_WEIGHTED=false` → function takes the legacy unweighted path; doc-comment
mirrors `read_high_df_fix_flag` (:76-90 precedent).

## Log

- L1 (2026-10-18, T1-T2 Phase 0 diagnostic `rg_fit_variants_audit`, runtime 48.3 s, full
  config set Df∈{2.5,2.7,2.9} × N∈{100,500} × seeds{1,2,3}, R27.4 setup: Dimers, kf=1.3,
  rp=1.0): **D1 primary NOT confirmed — evidence contradicts D1's premise.** The N-weighted
  variant does not merely fall short of kf ≥ 1.0 at Df=2.9/N=100; it is *worse* than the
  current unweighted fit. The D1 fallback trigger condition ("weighted fails while
  tail-restricted passes") is also NOT met, because tail-restriction fails too. Neither
  candidate fit restores R28.1's `mean(prefactor) ≥ 1.0` at Df_target = 2.9.

  Point reconstruction from public `SimulationResult` data (`rg_evolution` + `merge_trace`,
  `no_feasible_pair` entries skipped, `n_i = max(n_{i-1}, n1+n2)`) was self-validated:
  recomputed UNW matches the engine estimator exactly (max err 0.0e0 over all 18 runs) and
  reproduces the Cycle 2 baseline mean kf = 0.929 at 2.9/100.

  Mean kf per variant per config (seeds {1,2,3}):

  | config | UNW (current) | WGT (D1 primary) | TAIL (D1 fallback) |
  |---|---|---|---|
  | 2.5/100 | 1.260 | 1.312 | 1.943 |
  | 2.5/500 | 1.332 | 1.317 | 1.003 (1 run hit Df=3.5 clamp) |
  | 2.7/100 | 1.060 | 1.065 | 1.107 |
  | 2.7/500 | 1.063 | 1.101 | 1.173 |
  | 2.9/100 | **0.929** | **0.879** | **0.921** |
  | 2.9/500 | 0.941 | 0.941 | 0.990 |

  D5 no-clamp: the D1 primary (WGT) has **zero** clamp-boundary hits across all 18 runs —
  no prefactor touches 100.0 (nor 0.01, nor Df [0.5, 3.5]). The only hit in the whole
  matrix is the TAIL variant clamping Df to 3.5 at 2.5/500 seed 1 (tail of 3 points,
  degenerate leverage) — one more argument against tail-restriction as primary.

  Interpretation: weighting toward large-N points *lowers* kf at Df=2.9, i.e. the tail
  points are NOT sitting above the small-N scaling line — the guard/adaptive fallback
  merges land at `rg_after < rg_target` (R27 geometry), dragging the large-N end down.
  The kf deficit at the extreme high-Df edge is a property of the recorded point cloud
  (finite-N geometric feasibility), not of unweighted point dominance. Note the mean
  kf = 0.929 at 2.9/500 (all variants ≤ 0.990) shows it is not an N=100 artifact either.

  **Proposed disposition (for parent decision, not implemented here):** D1 as locked
  ("N-weighted restores kf ≥ 1.0") cannot deliver R28.1/R27.4-M at Df=2.9. Options:
  (a) keep the N-weighted fit for its small Df-bias improvement (mean Df 2.973 vs 2.932
  at 2.9/100, still within R19/R27.4 ± 0.15) but relax/amend R28.1's kf ≥ 1.0 to a
  documented deviation (Cycle 2 D3 style); (b) re-lock D1 to tail-restricted (also fails
  kf, adds a threshold parameter and a Df clamp hit — not recommended by evidence);
  (c) revisit the estimator target itself (sub-cycle 2 BC-alignment territory). T3-T4
  (flag + wiring) can proceed mechanically for option (a), but R28.1's kf assertion
  must NOT be written as `≥ 1.0` without a design amendment.
