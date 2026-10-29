# Tasks: Batch Distributions & Simulation Entry Point

## Phase 1 — Engine: surface rg in BatchImageResult

- [x] T1.1 — Add `rg_nm: Option<f64>` field to `BatchImageResult` struct in `aglogen_core/engine/src/fractal/fraktal/batch.rs` (file: `aglogen_core/engine/src/fractal/fraktal/batch.rs`)
- [x] T1.2 — Wire `rg_nm` from `FraktalResult.rg` (exists per design result.rs:47) into batch wrapper on success, `None` on failure (file: `aglogen_core/engine/src/fractal/fraktal/batch.rs`)
- [x] T1.3 — Update Python PyO3 binding to expose `rg_nm` in per-image result dict via `set_item("rg_nm", ...)` (file: `aglogen_core/python/src/lib.rs`)
- [x] T1.4 — Cargo test: synthetic batch returns rg_nm with known input (file: `aglogen_core/engine/src/fractal/fraktal/batch.rs`)

## Phase 2 — Backend: response shape adjustments

- [x] T2.1 — Verify `batch_detail_view` returns `rg_nm` per image; add if missing (file: `backend/apps/fractal_analysis/views.py`)
- [x] T2.2 — Add `compute_metric_stats(images, key)` helper in batch service (file: `backend/apps/fractal_analysis/services/batch.py`)
- [x] T2.3 — Extend `_build_batch_response` to include aggregate stats {mean, std, median, min, max} for kf, rg, npo metrics (file: `backend/apps/fractal_analysis/views.py`)
- [x] T2.4 — Ensure failed images excluded from stats computation (file: `backend/apps/fractal_analysis/services/batch.py`)
- [x] T2.5 — pytest integration tests: response shape verification, aggregate correctness, NULL handling for legacy rows (file: `backend/tests/`)

## Phase 3 — Frontend: FraktalBatchDistributions component

- [x] T3.1 — Create `FraktalBatchDistributions.tsx` component with props: `images: FraktalBatchImageResult[]`, `stats?: FraktalBatchStats` (`totalImages` derived from `images.length`)
- [x] T3.2 — Implement 4 Plotly histograms (Df, kf, Rg, npo) in responsive 2×2 grid (`grid grid-cols-1 md:grid-cols-2`)
- [x] T3.3 — Implement Sturges' rule bucket count: `k = clamp(ceil(log2(n) + 1), 3, 30)` exposed as `sturgesBuckets` helper
- [x] T3.4 — Edge cases: all-failures global message + per-metric "not enough" (< 5) + single-value (zero variance) handled by Plotly natively + missing stats fallback computed inline
- [x] T3.5 — vitest 12 tests passing (sturgesBuckets, happy path, 3 edge cases) + types updated (`rg_nm` optional + `FraktalMetricStats` + `df/kf/rg/npo` blocks in `FraktalBatchStats`)

## Phase 4 — Frontend: integrate distributions in FraktalBatchSummaryView + Rg column

- [x] T4.1 — Mount `FraktalBatchDistributions` between batch header and results table in `FraktalBatchSummaryPage` (wrapped in `<section role="region" aria-label="Metric distributions">` with H2 heading)
- [x] T4.2 — Responsive 2×2 grid (`grid grid-cols-1 md:grid-cols-2`) — already in `FraktalBatchDistributions` from P3
- [x] T4.3 — Rg column in `FraktalBatchResultsView` between kf and R² (sortable; `rg_nm` added to `SortKey`); format `fmt(rg_nm, 1)` decimals, null → "—"
- [x] T4.4 — vitest: 3 new tests passing (Distributions section visible, Rg column header rendered, Rg values + "—" handling)

## Phase 5 — Frontend: sim → batch entry button + upload page propagation

- [x] T5.1 — Added "Analyze projections" button (BarChart3 icon) in sim detail action bar, only when `simulation.status === 'completed'`
- [x] T5.2 — Button only shown when status is completed (sim must have geometry before analysis is meaningful — relies on sim completion which already gates Export CSV; "no projections" is handled in upload page by user file picker)
- [x] T5.3 — Click navigates via `router.push()` to `/projects/{id}/fraktal/batch?origin=simulation&sim_id={simId}` (preserves project context in URL hierarchy)
- [x] T5.4 — Upload page reads query params via `useSearchParams()`, fetches sim with `simulationsApi.get`, resolves dpo via v1/v2-aware `getPrimaryParticleDiameterNm`, passes `origin="simulation"` + `simulation` props. Soft fallback to external on fetch failure (warning banner, does NOT block).
- [x] T5.5 — vitest 5 tests passing: external default (no params), sim mode (origin=simulation+sim_id), sim 404 fallback, partial params (origin without sim_id, sim_id without origin) — all in `app/projects/[id]/fraktal/batch/__tests__/page.test.tsx`

## Phase 6 — Tests + docs + CHANGELOG

- [x] T6.1 — Cross-cutting integration test at `backend/tests/integration/test_fraktal_batch_distributions.py`: 3 cases validate engine→binding plumbing of `rg_nm` (key present, positive finite for successes, per-image not aliased). Frontend behaviors covered by vitest test files instead of e2e (better isolation, no Playwright dependency added).
- [x] T6.2 — Documentation `docs/fraktal-batch-distributions-and-entry.md` (~110 lines) covering Why/What/Migration/Backward compat/Validation/Known limitations
- [x] T6.3 — CHANGELOG entry added at top of `CHANGELOG.md` under `fraktal-batch-distributions-and-entry (unreleased)` heading
- [x] T6.4 — Final test run: engine 201 + backend 470 + frontend 307 = 978 passing, 0 regressions on baseline

---

Total tasks: 27 (P1: 4, P2: 5, P3: 5, P4: 4, P5: 5, P6: 4)