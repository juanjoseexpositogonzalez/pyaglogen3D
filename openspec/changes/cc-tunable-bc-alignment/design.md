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

## Log

- L2 (2026-10-18): T1/T2 Phase 0 diagnostic `engine/examples/diagnostics/bc_window_alignment_audit.rs`
  (45 runs = Df ∈ {1.5,2.0,2.5,2.7,2.9} × N ∈ {100,500,2000} × seeds {1,2,3}, R27.4 setup: Dimers,
  target_kf=1.3, rp=1.0; ~10 min release, full 3-seed matrix kept — no N=2000 seed reduction needed).
  Validations: recomputed-count legacy path (read-only copy; estimator untouched) **byte-identical to the
  public API `box_counting_3d_morton` 45/45** (dimension, R², std error, linear region start — the
  post-D5-refactor assertion itself still ships with T3); **D2 log-base invariance confirmed numerically**,
  max |slope_ln − slope_log2| = 4.9e-14 over 108 window fits + all legacy fit ranges.
  - **Structural finding (D1 premise correction):** on the default precision-18 Morton space the estimator's
    count-validity filter (`0 < count < N`) leaves only **2–8 usable levels, all in raw levels ~10–17**;
    raw levels 0–13 are count == N for every config. The design's candidate mid-band `[4,16]` (raw indices,
    "skip finest 4 saturated + coarsest 2") is therefore **empty**, and a Matlab-style 32-level mid-window
    has no equivalent here. Locked window semantics (D1) resolve as: inclusive indices into the **effective
    (count-valid, finest-first) level sequence**, `end` clamped to the last effective level (swept end
    candidates {16,15,14} are equivalent after clamping).
  - **Fixed-window sweep** (start {0..5} × end {16,15,14} clamped, ≥3 levels; starts 0–1 added after pass 1
    showed start ≥ 2 admits no fit at Df ≥ 2.7 where effLevels ≤ 4): best fixed window
    **(s*, e*) = (1, last effective level)** — mean |Δt| **0.154** over all 45 runs (legacy 0.325);
    at N=2000 mean 0.150 / max 0.443. Runner-up (2, last): mean 0.156, but no fit at all for Df ≥ 2.7 —
    disqualified as a fixed recommendation covering all configs.
  - Per-config means at N=2000, window (1, last) vs LEGACY (Δ = Df − Df_target):

    | Df_target | legacy Df | Δ legacy | window Df | Δ window |
    | --- | --- | --- | --- | --- |
    | 1.5 | 1.578 | +0.078 | 1.578 | +0.078 |
    | 2.0 | 1.876 | −0.124 | 1.876 | −0.124 |
    | 2.5 | 2.021 | −0.479 | 2.159 | −0.341 |
    | 2.7 | 2.505 | −0.195 | 2.694 | −0.006 |
    | 2.9 | 2.545 | −0.355 | 2.717 | −0.183 |

    (window ≡ legacy at Df 1.5/2.0 because the robust greedy fit already accepts the whole count-valid range
    there; window beats legacy everywhere it differs. Residual deficit is concentrated at Df_target 2.5.)
  - **D4 evidence (R27.5):** ±0.20 is **NOT reachable at N=2000** across the full Df range with any fixed
    window: Df_target 2.5 retains ≈ −0.29…−0.34, and Df ≥ 2.7 admits only start ≤ 1 (effLevels ≤ 4) where
    the window degenerates toward the legacy anchor. Achievable documented band on the opt-in path at
    N=2000: **≈ ±0.35 per-config mean / ±0.45 per-seed**. Canonical ±0.90 default-path tolerance (D4)
    unchanged; the T5 opt-in test must assert the documented band, not ±0.20.
  - **T3 implications recorded:** (a) windowed path must return a validation error — not panic — when the
    effective in-window level count is < 3 (happens at small N / high Df, e.g. effLevels = 2–3 at
    Df ≥ 2.5/N ≤ 100); (b) `linear_region_start` for the windowed path reports `s` per design (with the
    effective-sequence semantics above); (c) dead-variable cleanup (D5) is guarded by the 45/45 byte-identity
    baseline reproduced by this diagnostic.
