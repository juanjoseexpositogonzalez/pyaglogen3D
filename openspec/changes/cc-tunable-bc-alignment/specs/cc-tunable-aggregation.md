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
- **AND** (NEW, note) the ±0.20 aspiration is **retired as a target**: the Phase 0 diagnostic
  (`bc_window_alignment_audit`, design Log L2) refuted it — not reachable even at N=2000 with any
  fixed window (Df_target 2.5 retains ≈ −0.29…−0.34; Df ≥ 2.7 admits only start ≤ 1, where the
  window degenerates toward the legacy anchor). The OPT-IN windowed estimator (R29) instead carries
  the documented evidence band **±0.35 per-config mean / ±0.45 per-seed** (`|BC_Df − Df_target|`,
  window `(1, last effective level)`, locked by design Log L2/T5); the default path keeps ±0.90
  unconditionally

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

- **GIVEN** CC-tunable agglomerates at the Phase 0 diagnostic configs and the diagnostic-selected
  window `(s*, e*)` = (1, last effective level), clamped to the widest fit-admitting window from
  the same sweep when the locked window holds < 3 count-valid levels (dense configs, Log L4)
- **WHEN** the windowed estimator runs
- **THEN** `|BC_Df − Df_target|` improves over the default path on the per-config mean across
  seeds where the window differs from the legacy fit, and satisfies the **documented band ±0.35
  per-config mean / ±0.45 per-seed** locked by the Phase 0 evidence (design Log L2). The ±0.20
  target was refuted by that evidence (unreachable even at N=2000 with any fixed window) and is
  retired; the observed band is documented in the R27.5 note
- **AND** seeds where no fit-admitting window exists are refused with a validation error
  (`InsufficientLevels`, R29.2), never a panic, and are recorded in design Log L4
