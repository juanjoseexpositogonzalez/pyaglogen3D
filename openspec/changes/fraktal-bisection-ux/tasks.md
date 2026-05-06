# Tasks: Fraktal Bisection UX (Cycle 12 / PYA-13)

## Phase P1 — Engine: surface BisectionResult fields + quality classification + failure_reason detection

- [x] T1.1 — `bracket_found: bool` added to `BisectionResult` (commit d911207)
- [x] T1.2 — `FailureReason` enum (NoSignChange, KfNegative, IterationLimit) (commit b90706a)
- [x] T1.3 — `AnalysisQuality` enum (Converged, Approximate, Excluded, Failed) (commit 59b05c1)
- [x] T1.4 — 5 diagnostic fields in `FraktalResult` (commit b3fb3f9)
- [x] T1.5 — `granulated_2012.rs:296` discard point now surfaces diagnostic data on both paths (commit 691d170)
- [x] T1.6 — `classify_quality()` helper with `EXCLUDED_RESIDUAL_THRESHOLD = 1.0` constant (commit 6bcc144)
- [x] T1.7 — `BatchImageResult` gains 5 diagnostic fields populated from FraktalResult (commit b540d3a). Voxel 2018 also patched for parity (orchestrator inline; see follow-up commit).
- [x] T1.8 — Cargo tests integrated in unit modules: 13 tests across bisection.rs, granulated_2012.rs, result.rs covering classification, failure_reason mapping, bracket_found, diagnostic field population. 273 engine tests passing (was 269 baseline, +4).

## Phase P2 — Python binding: expose new fields

- [x] T2.1 — Update result dict construction in `analyze_fraktal_batch` to include all 5 new fields: `quality`, `bisection_iterations`, `bisection_residual`, `failure_reason`, `df_estimate` (file: `aglogen_core/python/src/lib.rs`) (commit f88483f)
- [x] T2.2 — Update result dict construction in `analyze_fraktal_batch_per_image_scale` to include all 5 new fields (file: `aglogen_core/python/src/lib.rs`) (commit f88483f)
- [x] T2.3 — `as_str()` helper methods already exist from P1 on `FailureReason` and `AnalysisQuality` enums — no-op (verified in result.rs lines 16-25, 44-54)
- [x] T2.4 — Cargo tests: 6 new tests added (as_str helpers, quality field, diagnostic fields, error image quality, per-image-scale diagnostics) — 22 python-crate tests passing (commit 0d7f92c)

## Phase P3 — Backend: migration + model + serializers + per-batch counters + stats

- [x] T3.1 — Create migration `0011_add_bisection_diagnostic_fields.py` adding 5 nullable fields: `quality`, `bisection_iterations`, `bisection_residual`, `failure_reason`, `df_estimate` to `FraktalBatchImage` (file: `backend/apps/fractal_analysis/migrations/0011_add_bisection_diagnostic_fields.py`) (commit ed7607c)
- [x] T3.2 — Add 5 nullable fields to `FraktalBatchImage` model with appropriate null defaults (file: `backend/apps/fractal_analysis/models.py`) (commit ed7607c)
- [x] T3.3 — Update `persist_batch_results` in `services/batch.py` to extract and store new fields from engine result dict (file: `backend/apps/fractal_analysis/services/batch.py`) (commit ed7607c)
- [x] T3.4 — Update `batch_image_detail_view` in `views.py` to include new fields in drill-down response (file: `backend/apps/fractal_analysis/views.py`) (commit 7b2dd66)
- [x] T3.5 — Update `batch_detail_view` in `views.py` to compute per-quality counters (`n_converged`, `n_approximate`, `n_excluded`, `n_failed`) and `mean_df_inclusive` (file: `backend/apps/fractal_analysis/views.py`) (commit 287d7ae)
- [x] T3.6 — mean_df semantic shift (converged-only) + mean_df_inclusive (converged + approximate) in batch_detail_view stats block (commit 287d7ae)
- [x] T3.7 — Document `mean_df` semantic shift in code comments (now converged-only; `mean_df_inclusive` includes approximate) (file: `backend/apps/fractal_analysis/views.py`) (commit 287d7ae)
- [x] T3.8 — Write pytest: migration test, persistence test per quality state, response shape, stats correctness (file: `backend/apps/fractal_analysis/tests/`) (commit c1a4654)

## Phase P4 — Backend: CSV export with new columns

- [x] T4.1 — Update `services/csv_export.py`: add 5 columns appended at end of `BATCH_IMAGE_COLUMNS` and `SINGLE_IMAGE_COLUMNS` (quality, bisection_iterations, bisection_residual, failure_reason, df_estimate) (file: `backend/apps/fractal_analysis/services/csv_export.py`) (commit 29080f5)
- [x] T4.2 — Implement locale-aware formatting for numeric fields (residual, df_estimate) using existing locale config (file: `backend/apps/fractal_analysis/services/csv_export.py`) (commit 29080f5)
- [x] T4.3 — Write pytest byte-equivalence: legacy CSVs unchanged in pre-existing columns, new columns appended correctly (file: `backend/apps/fractal_analysis/tests/`) (commit 29080f5)

## Phase P5 — Frontend: drill-down distinguished UI + results table badge column + distributions yellow overlay

- [ ] T5.1 — Create reusable `<QualityBadge quality={...} />` component with 4 states and colors (green=converged, yellow=approximate, gray=excluded, red=failed) (file: `frontend/src/components/fraktal/QualityBadge.tsx`)
- [ ] T5.2 — Update `FraktalBatchImageDetail.tsx`: replace single error card with category-specific UI (4 distinct visual states + diagnostic info per category) (file: `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx`)
- [ ] T5.3 — Update `FraktalBatchResultsView.tsx`: add Quality column with QualityBadge (sortable) (file: `frontend/src/components/fraktal/FraktalBatchResultsView.tsx`)
- [ ] T5.4 — Update `FraktalBatchDistributions.tsx`: render approximate as yellow overlay alongside converged main bars (file: `frontend/src/components/fraktal/FraktalBatchDistributions.tsx`)
- [ ] T5.5 — Update mean stats display: show both `mean_df` (primary) and `mean_df_inclusive` (secondary) in stats panel (file: `frontend/src/components/fraktal/FraktalBatchDistributions.tsx`)
- [ ] T5.6 — Update tooltip on histograms: show count breakdown by quality (file: `frontend/src/components/fraktal/FraktalBatchDistributions.tsx`)
- [ ] T5.7 — Update `frontend/src/lib/api.ts` to extend `FraktalBatchImageDetail` interface + batch summary types with new fields (file: `frontend/src/lib/api.ts`)
- [ ] T5.8 — Write vitest: QualityBadge rendering, drill-down per state, table badge column, histogram dual-color, mean dual-display (file: `frontend/src/components/fraktal/__tests__/`)

## Phase P6 — Tests integration + docs + CHANGELOG + Jira PYA-13 close

- [ ] T6.1 — Cross-cutting integration test: synthetic batch with mix of quality states; assert each tier propagates correctly engine→backend→frontend (or engine→backend with mocks) (file: `backend/apps/fractal_analysis/tests/test_bisection_integration.py`)
- [ ] T6.2 — Documentation: `docs/fraktal-bisection-ux.md` (~80-100 lines) covering Why/Categories/Threshold rationale/Migration/Backward compat/Validation (file: `docs/fraktal-bisection-ux.md`)
- [ ] T6.3 — CHANGELOG entry under `fraktal-bisection-ux (unreleased)` describing all changes (file: `CHANGELOG.md`)
- [ ] T6.4 — Close Jira PYA-13 with comment summarizing fix + commit range; transition to "Finalizada" using jira_transition_issue (file: Jira issue PYA-13)