# Design: cc-tunable-bc-alignment

> SDD phase: DESIGN · Cycle 3 sub-cycle 2 of 2 (PYA-17)
> Builds on sub-cycle 1 (archived 2026-10-18). Exploration: obs #9190; Matlab reference: matlab_reference/{box_count,fit_frac}.m; comparison doc: docs/box_counting_comparison.md.

## Decision Summary (LOCKED)

| # | Decision | Choice |
|---|---|---|
| D1 | Window semantics | Additive parameter `fit_window: Option<(usize, usize)>` = inclusive **level-index range** `[start, end]` into the Morton level sequence (0 = finest). `None` (default) = legacy robust-fit path, byte-identical. NOT a copy of Matlab's `e=[18,30]` — those are indices into 32 levels; Phase 0 diagnostic determines the equivalent mid-band range for our 18-level space (candidate: `[4, 16]`, i.e. skip finest 4 saturated + coarsest 2). |
| D2 | Log base | Keep natural log internally for the regression (slope is base-invariant; changing base would alter reported intercept semantics for existing consumers). Aligned mode is defined by WINDOW, not by base. Matlab-parity intercept (log2) is reported only inside the Phase 0 diagnostic for cross-checking — not shipped. |
| D3 | API shape | Engine: `box_counting_3d_morton(points, precision, fit_window)` gains the optional param via a new public wrapper preserving the old 2-arg signature (`box_counting_3d(points, precision)` delegates with `None`). Python binding: `box_counting_3d(..., fit_window=None)`, `box_counting_agglomerate(..., fit_window=None)` (additive, defaulted). Backend: NO default-behavior change; opt-in plumbing deferred to a backend change if ever needed — NOT in this change (keeps Django untouched). |
| D4 | R27.5 tolerance | Canonical keeps `±0.90` at N≥500 for the DEFAULT path. The aligned window's effect is documented from Phase 0 evidence; a ±0.20 tightened assertion ships only as a NEW test on the OPT-IN path at the N the diagnostic proves sufficient (expected N≥2000), never retroactively on the default path. |
| D5 | Dead-variable cleanup | `best_start`/`best_r2`/`r2` residuals in `linear_regression_robust` are removed/refactored (verified no-op, obs #9190 §2) guarded by a default-path byte-identity assertion in Phase 0. |
| D6 | Precision cap | Morton cap stays 21 bits/dim (18 default). Raising to 32 changes bit layout and every fixture — deferred indefinitely unless evidence demands. |

## Architecture

### Current
```
box_counting_3d_morton(points, precision)            (box_counting_3d.rs:75)
  ├─ morton encode + sort + per-level unique counts   (:104-176)
  └─ linear_regression_robust(ln(1/box), ln(count))   (:299-380)
       └─ anchor coarsest-4, greedy extend, final OLS
```

### New
```
box_counting_3d(points, precision)          → morton_core(points, precision, None)   [unchanged]
box_counting_3d_windowed(points, precision, (s,e)) → morton_core(..., Some((s,e)))
morton_core:
  ├─ counts (unchanged)
  ├─ if fit_window: plain OLS over levels [s..=e]     (no greedy, no anchor)
  └─ else: legacy linear_regression_robust (cleaned per D5, byte-identical)
```

Struct `FractalResult` fields unchanged; `linear_region_start` reporting for the windowed path
uses `s` (documented in doc-comment).

## Phase 0 Diagnostic (before any test locks tolerances)

`engine/examples/diagnostics/bc_window_alignment_audit.rs`:
- Fixtures: CC-tunable agglomerates at Df_target ∈ {1.5, 2.0, 2.5, 2.7, 2.9}, N ∈ {100, 500, 2000}, 3 seeds.
- Variants: legacy window (current), candidate aligned windows sweep, with per-variant Df, R², and delta vs Rg-evolution Df and vs Df_target.
- Cross-check: a small Matlab-side run (or the documented values from `docs/box_counting_comparison.md`) validates direction and magnitude of the bias fix.
- Output: chosen `(s,e)` recommendation + whether ±0.20 is reachable at N=2000 → feeds R27.5 note and the new opt-in test tolerance.

## Non-Regression Matrix

| Surface | Guarantee | Test |
|---|---|---|
| Default BC output (all consumers) | byte-identical pre/post refactor (D5) | Phase 0 assertion + existing tests unmodified |
| Python bindings | additive-only params | binding tests pass untouched |
| CSV `sim_box_counting_df` | unchanged values | backend contract specs unaffected (no default change) |
| Opt-in windowed path | matches diagnostic-selected semantics | new unit + integration tests |

## Test Plan Sketch
1. Phase 0 diagnostic (above) → lock `(s,e)` and D4 evidence.
2. Unit: windowed OLS vs hand-computed; window bounds validation (empty/out-of-range → error, not panic).
3. Integration: default-path byte-identity; windowed path on fixtures; R27.5 opt-in ±0.20 test at diagnostic-proven N.
4. Suite: full engine + bindings.
