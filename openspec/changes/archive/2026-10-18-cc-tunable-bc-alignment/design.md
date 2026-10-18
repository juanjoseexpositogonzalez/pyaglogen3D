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
- L3 (2026-10-18): T3/T4 implemented (`morton_core` extraction, D5 cleanup, windowed path + validation
  errors, Python bindings).
  - **D3 API shape resolved:** `box_counting_3d_morton(points, precision)` keeps its exact 2-arg signature
    (delegates to `morton_core(..., None)`); the windowed path is a NEW public function
    `box_counting_3d_windowed(points, precision, (s, e)) -> Result<BoxCountingResult3D, BoxCountingError>`
    — a Result change on the public 2-arg function was rejected because it would ripple into every
    consumer (python bindings, diagnostics, integration tests). Error enum `BoxCountingError`:
    `EmptyWindow` (s > e), `WindowOutOfRange` (e ≥ effective level count), `InsufficientLevels`
    (< 3 count-valid levels in window) — never panics (R29.2). Windowed path skips the saturation
    truncation (Step 4b) and reports `linear_region_start = s`, log vectors carry the full effective
    sequence; `box_counting_3d_agglomerate`-equivalent python binding gained an additive
    `fit_window=None` keyword.
  - **T4 python signature deviation (justified):** pyo3 forbids a required positional parameter after
    an optional one, so the new binding is `box_counting_3d_windowed(coords, fit_window, precision=18)`
    (fit_window precedes precision) instead of `(coords, precision, fit_window)`; existing
    `box_counting_3d` / `box_counting_agglomerate` callers are untouched and additive
    (`box_counting_agglomerate` gained `fit_window=None`).
  - **Validation:** diagnostic re-run post-refactor **45/45 byte-identity exact** (dimension, R², std
    error, linear region start), max log-base error 4.9e-14 unchanged; new unit tests
    `engine/tests/bc_windowed_test.rs` (10 passed): recorded pre-refactor baseline (6 fixtures, exact
    f64 equality), verbatim pre-refactor replica oracle (7 fixtures), hand-computed windowed OLS
    (line32/precision-5 fixture with exact per-level counts → slope 1, R² 1), window bounds validation,
    degenerate cases (flat counts, N < 2). Full engine suite release: 371 passed / 0 failed
    (2 pre-existing ignores). `cargo check -p aglogen-python` (PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1)
    compiles clean; bare `cargo build -p aglogen-python` fails at the final cdylib LINK step —
    pre-existing environmental property of pyo3 0.23 + `extension-module` on macOS (no libpython link
    args emitted; maturin supplies `-Wl,-undefined,dynamic_lookup`), confirmed unrelated to this change
    (builds clean with that flag; no symbol from this change involved).
  - **No evidence contradicting Log L2 semantics was found**; the (s*, e*) = (1, last valid level)
    verdict and the ±0.35/±0.45 band were reproduced exactly by the post-refactor diagnostic run.
- L4 (2026-10-18): T5 integration evidence — `bc_windowed_test.rs::
  windowed_vs_legacy_on_real_cc_tunable_agglomerates` (9 live CC-tunable sims: Df_target ∈
  {2.5, 2.7, 2.9}, N=500, seeds {1,2,3}, R27.4 setup: Dimers, target_kf=1.3, rp=1.0, high-Df fix
  flag ON/default; precision 18; windowed vs legacy on identical coordinates).

  | Df_target | seed | Rg_Df | BC legacy | \|Δ\| legacy | window | BC windowed | \|Δ\| windowed |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 2.5 | 1 | 2.327 | 1.970 | 0.530 | (1, last) | 2.250 | 0.250 |
  | 2.5 | 2 | 2.458 | 1.932 | 0.568 | (1, last) | 2.161 | 0.339 |
  | 2.5 | 3 | 2.384 | 1.948 | 0.552 | (1, last) | 2.183 | 0.317 |
  | 2.7 | 1 | 2.815 | 2.011 | 0.689 | (1, last) | 2.497 | 0.203 |
  | 2.7 | 2 | 2.792 | 2.013 | 0.687 | (1, last) | 2.549 | 0.151 |
  | 2.7 | 3 | 2.760 | 2.541 | 0.159 | (0, last)† | 2.541 | 0.159 |
  | 2.9 | 1 | 2.960 | 2.575 | 0.325 | (0, last)† | 2.575 | 0.325 |
  | 2.9 | 2 | 2.902 | 2.617 | 0.283 | (0, last)† | 2.617 | 0.283 |
  | 2.9 | 3 | 2.918 | 2.590 | 0.310 | (0, last)† | 2.590 | 0.310 |

  Per-config means: legacy vs windowed = **0.550 vs 0.302** (Df 2.5), **0.512 vs 0.171** (Df 2.7),
  **0.306 vs 0.306** (Df 2.9). Assertions verified: per-seed |Δ| ≤ **0.45** on every seed
  (documented band; max windowed |Δ| = 0.339) and windowed mean ≤ legacy mean per config —
  **no seed contradicted the Log L2 evidence**, so no band weakening was needed.
  - **Coverage-gap finding (refines the L2 fixed-window verdict, does not contradict the band):**
    at N=500 the effective (count-valid) sequence holds only **3 levels** for the densest configs
    (all three seeds at Df_target 2.9; seed 3 at Df_target 2.7). The locked `(1, last)` window then
    contains 2 levels and the estimator correctly refuses with `InsufficientLevels` (R29.2
    contract: refuse to fit, never panic) — † rows use the fit-admitting clamp
    `s = min(1, effLevels − 3)` → `(0, last)`, i.e. the widest window from the same L2 sweep
    ("windows with ≥ 3 levels"). At those configs the windowed fit over the full effective sequence
    coincides exactly with the legacy robust fit (legacy greedy already accepts the whole
    count-valid range) — "improves or matches" holds as an exact match, zero improvement.
    The L2 sweep skipped such windows, so the (1, last) recommendation implicitly never covered
    them; T5 makes that explicit. Recommendation for any future consumer: clamp the window start
    per config (`s = min(1, effLevels − 3)`), or treat `InsufficientLevels` at effLevels = 3 as
    the signal to fall back to the default path.
  - **Non-regression (T6):** full engine suite release `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1
    cargo test -p aglogen-engine --release` → **372 passed / 0 failed** (3 pre-existing ignores:
    lib unit ignore, `capture_legacy_baseline` helper, doc-test target; = 371 pre-existing + 1 new
    T5 test). All pre-existing tolerance bodies untouched. `cargo check -p aglogen-python`
    (same env) compiles clean (3 pre-existing dead-code warnings, unrelated).
