# Tasks: fraktal-drilldown-and-csv

## Phase 1 — DB Foundation

- [x] T1.1 — Add FraktalBatch model to `apps/fractal_analysis/models.py` (project FK, user FK, dpo_used JSON, created_at, status, summary_json; Meta class with ordering=-created_at)
- [x] T1.2 — Add FraktalBatchImage model to `apps/fractal_analysis/models.py` (batch FK, index, unique_together=(batch, index), png Blob, metrics_json, error_text, dpo_used JSON)
- [x] T1.3 — Create Django migration for new models `apps/fractal_analysis/migrations/XXXXX_fraktal_batch_models.py`
- [x] T1.4 — Register FraktalBatch + FraktalBatchImage in Django admin `apps/fractal_analysis/admin.py`
- [x] T1.5 — Write model unit tests for FraktalBatch + FraktalBatchImage in `apps/fractal_analysis/tests/test_models.py` (test_create, test_cascade_delete, test_png_field)

## Phase 2 — CSV Locale Hoist

- [x] T2.1 — Create `apps/core/services/__init__.py` (empty, marks package)
- [x] T2.2 — Hoist `_get_user_csv_locale` from `apps/simulations/views.py` line ~80 to `apps/core/services/csv_locale.py` as `get_user_csv_locale(user_or_none)`
- [x] T2.3 — Hoist `_write_localized_row` from `apps/simulations/views.py` to `apps/core/services/csv_locale.py` as `write_localized_row(row, locale)`
- [x] T2.4 — Add backward-compatible aliases in `apps/simulations/views.py` (import from core.services.csv_locale)
- [x] T2.5 — Run simulations CSV export and capture hex digest snapshot to `tests/snapshots/simulations_csv.before.txt`
- [x] T2.6 — Verify simulations CSV output unchanged after hoist (compare hex digest)

## Phase 3 — Backend Batch Task Adapt

- [x] T3.1 — Rewrite `analyze_fraktal_batch_task` in `apps/fractal_analysis/tasks.py` to create FraktalBatch DB row on start
- [x] T3.2 — Add `persist_batch_results(batch, images)` helper in `apps/fractal_analysis/services/batch.py` (writes PNG bytes to FraktalBatchImage records)
- [x] T3.3 — Adapt sync path in `apps/fractal_analysis/views.py::analyze_batch` to write DB instead of JSON-on-disk
- [x] T3.4 — Add `batch_id` field to polling SUCCESS payload per R-DELTA
- [x] T3.5 — Update polling view to include batch_id on status=done
- [x] T3.6 — Document legacy JSON dir deprecation in CHANGELOG (manual cleanup, no destructive migration)
- [x] T3.7 — Test sync + async batch paths write to DB in `apps/fractal_analysis/tests/test_batch_persist.py`

## Phase 4 — Backend New Endpoints

- [x] T4.1 — Add drill-down GET `/api/v1/projects/{pk}/fraktal/batches/{batchId}/` endpoint in `apps/fractal_analysis/views.py`
- [x] T4.2 — Add GET `/api/v1/projects/{pk}/fraktal/batches/{batchId}/images/{index}/` endpoint in `apps/fractal_analysis/views.py`
- [x] T4.3 — Add GET `/api/v1/projects/{pk}/fraktal/batches/{batchId}/images/{index}/png/` with `Cache-Control: public, max-age=31536000, immutable`
- [x] T4.4 — Add POST `/api/v1/projects/{pk}/fraktal/batches/{batchId}/images/{index}/reanalyze/` (creates new FraktalAnalysis, redirects)
- [x] T4.5 — Add DELETE `/api/v1/projects/{pk}/fraktal/batches/{batchId}/` endpoint (cascades to images, preserves re-analyses)
- [x] T4.6 — Add GET `/api/v1/projects/{pk}/fraktal/batches/{batchId}/csv/` batch CSV endpoint via csv_export.py
- [x] T4.7 — Add GET `/api/v1/projects/{pk}/fraktal/{analysisId}/csv/` single CSV endpoint (reuse csv_export.py)
- [x] T4.8 — Add serializers for FraktalBatch + FraktalBatchImage in `apps/fractal_analysis/serializers.py`
- [x] T4.9 — Register new URLs in `apps/fractal_analysis/urls.py`
- [x] T4.10 — Write endpoint integration tests covering 50 spec scenarios in `apps/fractal_analysis/tests/test_batch_endpoints.py`

## Phase 5 — Frontend API + Drill-down Route

- [x] T5.1 — Extend `lib/api/fraktalApi.ts` with 7 new methods: getBatch, getBatchImage, getBatchImagePng, reanalyzeBatchImage, deleteBatch, getBatchCsv, getSingleCsv
- [x] T5.2 — Create drill-down route page `app/projects/[id]/fraktal/batch/[batchId]/image/[index]/page.tsx`
- [x] T5.3 — Create `FraktalBatchImageDetail.tsx` component (renders PNG via data URL, displays metrics JSON, error_text, dpo_used, calibration info)
- [x] T5.4 — Add prev/next navigation links in FraktalBatchImageDetail (batch image list queries adjacent indexes)
- [x] T5.5 — Add loading/error states in drill-down component
- [x] T5.6 — Run frontend vitest for API methods in `lib/api/fraktalApi.test.ts`

## Phase 6 — Frontend Buttons

- [x] T6.1 — Make FraktalBatchResultsView table rows clickable (tr click → drill-down route) in `app/projects/[id]/fraktal/batch/page.tsx`
- [x] T6.2 — Add "Download CSV" button to FraktalBatchResultsView header (batch CSV endpoint)
- [x] T6.3 — Add "Delete batch" button in FraktalBatchResultsView (DELETE endpoint, confirm dialog)
- [x] T6.4 — Add "Download CSV" button to FraktalResultsView single-image header (single CSV endpoint)
- [x] T6.5 — Add "Re-analyze" button on FraktalBatchImageDetail page (reanalyze endpoint, redirect on complete)
- [x] T6.6 — Add "Download PNG" button on FraktalBatchImageDetail (direct PNG link)
- [x] T6.7 — Write button interaction tests in `app/projects/[id]/fraktal/fraktal.test.tsx`

## Phase 7 — Tests + Docs

- [ ] T7.1 — Run full backend integration test suite (all 600+ tests pass including new endpoint tests)
- [ ] T7.2 — Run full frontend vitest suite (all existing + new component tests pass)
- [ ] T7.3 — Verify CSV output byte-equivalence (single + batch) against known-good fixtures
- [ ] T7.4 — Verify DELETE cascade preserves re-analysis FraktalAnalysis rows
- [ ] T7.5 — Write user guide `docs/fraktal-drilldown-csv.md` (~80 lines): batch workflow, drill-down navigation, CSV format, re-analyze behavior, delete behavior
- [ ] T7.6 — Add CHANGELOG entry for fraktal-drilldown-and-csv under UNRELEASED section