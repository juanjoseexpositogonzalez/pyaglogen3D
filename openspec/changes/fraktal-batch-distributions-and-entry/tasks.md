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

- [ ] T5.1 — Add "Analyze projections" button in simulation results page action bar (file: `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx`)
- [ ] T5.2 — Button disabled if sim status != completed OR no projections exist (file: `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx`)
- [ ] T5.3 — Click navigates to `/projects/{id}/fraktal/batch?origin=simulation&sim_id={X}` (file: `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx`)
- [ ] T5.4 — Upload page reads query params via `useSearchParams()`, passes origin + sim_id as props to FraktalBatchUpload (file: `frontend/src/app/projects/[id]/fraktal/batch/page.tsx`)
- [ ] T5.5 — vitest: button enabled/disabled states, navigation URL correctness, query param parsing, props propagation to component (file: `frontend/src/app/projects/[id]/simulations/[simId]/page.test.tsx`)

## Phase 6 — Tests + docs + CHANGELOG

- [ ] T6.1 — Cross-cutting integration test: complete flow sim results → click button → upload → batch processes → drill-down summary shows distributions + Rg column (file: `frontend/tests/e2e/fraktal-batch-flow.spec.ts`)
- [ ] T6.2 — Documentation: `docs/fraktal-batch-distributions-and-entry.md` (~80 lines) covering all new features (file: `docs/fraktal-batch-distributions-and-entry.md`)
- [ ] T6.3 — CHANGELOG entry under fraktal-batch-distributions-and-entry heading (file: `CHANGELOG.md`)
- [ ] T6.4 — Final test run: all 3 layers (Cargo, pytest, vitest) green, mark all P1-P6 tasks [x] in this file

---

Total tasks: 27 (P1: 4, P2: 5, P3: 5, P4: 4, P5: 5, P6: 4)