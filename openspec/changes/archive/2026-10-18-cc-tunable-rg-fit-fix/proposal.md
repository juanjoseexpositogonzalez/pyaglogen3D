# Proposal: cc-tunable-rg-fit-fix

> SDD phase: PROPOSAL · Cycle 3 of N (sub-cycle 1 of 2, PYA-17)
> Sub-cycle 2 = `cc-tunable-bc-alignment` (BC estimator Matlab alignment — separate change, after this one)
> Prior exploration: Engram obs #9190 (estimator exploration report, 2026-10-18); parent exploration in `docs/box_counting_comparison.md`

## Intent

The CC-tunable Rg-evolution estimator systematically **undershoots `kf` in the high-Df band**:
`mean(kf) = 0.929` at `Df_target = 2.9 / N = 100` against the R27.4 target `kf ≥ 1.0` (documented
as accepted deviation D3 in Cycle 2's CHANGELOG). The Df slope itself converges correctly
(`abs_err = 0.032` at Df=2.9); the bias is isolated to the **prefactor**.

**Root cause (exploration obs #9190, §3):** `calculate_fractal_dimension_from_evolution`
(`aglogen_core/engine/src/simulation/tunable_cc.rs:1770-1841`) runs an **unweighted OLS** of
`ln(N)` vs `ln(Rg/rp)` over ALL Rg-evolution points. Early merges contribute many small-N points
(≈50× range in N across the evolution); each point counts equally regardless of N. Guard-induced
and ballistic-fallback merges (Cycle 2 R27) land at `rg_after < rg_target`, so tail points sit
systematically off the ideal line — and with equal weighting the dense small-N cloud dominates
the fit, tilting the slope down and pulling `exp(intercept) = kf` below 1.0.

This is a **fit-methodology artifact, not a geometry defect**: the merge coordinates are correct
per R27; only the post-hoc regression is biased. Cycle 2's root causes (H_B2 fixed by R27,
H_B1 retracted) do not recur here.

## Scope

### In Scope
- Replace the unweighted OLS in `calculate_fractal_dimension_from_evolution` with an **N-weighted
  log-space OLS** (weight `w_i = N_i / ΣN`), behind a flag-gated default-ON rollout
  (`CC_TUNABLE_RG_FIT_WEIGHTED`, same pattern as R20/R22/R26).
- Restore `mean(kf) ≥ 1.0` at `Df_target = 2.9, N = 100, seeds ≥ 3` (tightens R27.4's enforcement
  band from `Df_target ≤ 2.7` to the full high-Df range).
- Phase 0 diagnostic comparing candidate variants (unweighted baseline, N-weighted, tail-restricted
  k-last / N≥threshold) on pinned seeds before locking the formula in tests.
- Non-regression: Df convergence across `[1.4, 2.9]` (R19/R27 tolerances unchanged), Cycle 1/2
  merge-trace non-regression.
- Rollback guarantee: with flag OFF, all derived metrics (`fractal_dimension`, `prefactor`) match
  pre-change values within 1e-10 relative.

### Out of Scope
- **BC estimator changes** — sub-cycle 2 (`cc-tunable-bc-alignment`): Matlab-aligned fit window
  (mid-scale anchor instead of coarsest-4), log2 switch, optional `e_range` param. The
  `box_counting_3d.rs:312-358` warnings were investigated (obs #9190 §2): dead residual, not a
  bug; cleanup may ride along with sub-cycle 2 but is numerically a no-op.
- R27.5 BC tolerance ±0.90 → ±0.20 (stays with sub-cycle 2 + N≥2000 nightly test).
- Any change to merge geometry, feasibility screening, or RNG consumption.
- The 2D `box_counting.rs` (Fraktal image analysis) — untouched, separate algorithm.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cc-tunable-aggregation`: adds R28 (N-weighted Rg-evolution fit, flag-gated) and modifies
  R27.4 (kf ≥ 1.0 now enforced across the full high-Df band, including Df=2.9).

## Approach

**Flag-gated estimator swap** (same pattern as R26): the fit change is strictly post-hoc — it
reads the already-recorded `rg_evolution`/`n_values` vectors and changes only the regression
mathematics. **Merge coordinates are byte-identical with flag ON and OFF by construction**; only
derived metrics change. This makes rollback verification cheaper than Cycles 1/2 (metrics-only
comparison, no fixture regeneration of coordinates).

### Fix
- File: `aglogen_core/engine/src/simulation/tunable_cc.rs`, function
  `calculate_fractal_dimension_from_evolution` (~line 1770).
- New private helper `weighted_linear_regression(x, y, w)` (or inline weighted accumulation) —
  weights `w_i = N_i / ΣN`; same clamps as today (`Df ∈ [0.5, 3.5]`, `kf ∈ [0.01, 100]`).
- Flag read once per simulation via `read_rg_fit_weighted_flag()` following the FLAG REGISTRY
  convention (no RNG salt — read-only, line 104 precedent).

### Key invariant (design-verified, cheap to test)
Because the estimator is post-hoc, flag ON vs OFF must produce **identical monomer coordinates**
and identical `merge_trace` geometry. This is a stronger rollback property than Cycles 1/2 and
gets its own test (R28.4).

## Risks

| Risk | Mitigation |
| --- | --- |
| Weighted fit overshoots: tail points (biased by guard fallbacks) gain influence | Phase 0 diagnostic compares variants on pinned seeds before tests lock tolerances; tail-restricted fallback documented in design |
| kf clamp range [0.01, 100] interacts with new intercept values | Diagnostic verifies no clamping at realistic Df/N combos |
| Python bindings / CSV expose `prefactor` | Semantics unchanged (same quantity, better estimate); no schema change; additive only |
| Consumers asserting on kf values in tests | Full test-suite run; in-repo assertions live in `tunable_cc.rs` unit tests and cc_tunable test files — all updated in Phase 3 |

## Verification Preview
- Diagnostic example `rg_fit_variants_audit.rs` (Phase 0) → evidence for formula lock.
- `high_df_convergence_band` extended: kf ≥ 1.0 at Df=2.9 (R27.4 MODIFIED).
- Rollback: metrics 1e-10 relative with flag OFF; coordinates byte-identical ON vs OFF (R28.3/R28.4).
- Full suite non-regression (361+ tests).
