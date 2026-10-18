# Delta Spec: cc-tunable-bc-alignment → capability cc-tunable-aggregation

> SDD Cycle 3 sub-cycle 2 of 2 (PYA-17). Builds on sub-cycle 1 (archived 2026-10-18, R27.4
> accepted-deviation note). Decisions D1–D6: `design.md`.

## MODIFIED Requirements

### Requirement: R27. Physical-Contact Feasibility Guard

Scenario R27.5 note is MODIFIED: documents the aligned-window evidence and scopes the ±0.20
long-term target to the OPT-IN path only.

#### Scenario R27.5 — BC sanity in the high-Df band

- **GIVEN** flag ON, `Df_target ∈ {2.5, 2.7, 2.9}`, `N ≥ 100`, seeds `{1, 2, 3}`
- **WHEN** each run completes
- **THEN** every (Df_target, seed) pair satisfies `|BC_Df(coordinates) − result.fractal_dimension| ≤ 0.90` (at N ≥ 500; DEFAULT path tolerance, unchanged)
- **AND** no seed produces NaN, infinite, or negative `BC_Df`
- **AND** (NEW, note) the long-term ±0.20 target applies ONLY to the opt-in windowed estimator
  (R29) at the N proven sufficient by the Phase 0 diagnostic (`bc_window_alignment_audit`);
  the default path keeps ±0.90 unconditionally

## ADDED Requirements

### Requirement: R29. Matlab-Aligned Windowed Box-Counting Estimator (opt-in)

The 3D box-counting estimator SHALL accept an optional inclusive level-index fit window
`fit_window: Option<(usize, usize)>` (design D1). Default `None` preserves the legacy
robust-fit path **byte-identically**. The windowed path computes plain OLS of
`ln(box_size)` vs `ln(box_count)` restricted to levels `[start, end]` and reports
`linear_region_start = start`.

#### Scenario R29.1 — Default path byte-identity

- **GIVEN** any fixed coordinate set
- **WHEN** `box_counting_3d(points, precision)` is called before and after this change
- **THEN** the returned `FractalResult` fields (`dimension`, `r_squared`, `linear_region_start`, …) are byte-identical (D5 cleanup is a no-op)

#### Scenario R29.2 — Windowed path semantics

- **GIVEN** a fixed coordinate set and `fit_window = (s, e)` with `0 ≤ s ≤ e < levels`
- **WHEN** the windowed estimator runs
- **THEN** the regression uses exactly the level counts in `[s, e]` (no greedy extension, no coarse anchor)
- **AND** out-of-range or empty windows produce a validation error, never a panic

#### Scenario R29.3 — Python bindings additive-only

- **GIVEN** existing callers of `box_counting_3d(coords, precision)` and `box_counting_agglomerate(...)`
- **WHEN** called without the new optional argument
- **THEN** results are identical to pre-change; with `fit_window=...` the windowed path engages

#### Scenario R29.4 — Aligned-window accuracy (evidence-gated)

- **GIVEN** CC-tunable agglomerates at the Phase 0 diagnostic configs and the diagnostic-selected window `(s*, e*)`
- **WHEN** the windowed estimator runs
- **THEN** `|BC_Df − Df_target|` improves over the default path per the diagnostic, and satisfies the tolerance the Phase 0 evidence locks (target ±0.20 at the proven N; else the observed band is documented in the R27.5 note instead)
