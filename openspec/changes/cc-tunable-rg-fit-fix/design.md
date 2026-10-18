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
