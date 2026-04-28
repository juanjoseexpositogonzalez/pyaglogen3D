# Proposal: fraktal-drilldown-and-csv

## Intent

Today's batch results are useful at the aggregate level (mean Df, histogram) but the user can't investigate WHY a particular projection failed or extract per-image numbers for downstream tools. Drill-down + CSV close that loop: per-image diagnostics + spreadsheet-friendly export.

Persisting batch results (incl. PNGs) in a real DB model unlocks bookmarkable URLs, project-level permissions, listing, and a "Delete batch" affordance — moving from JSON-on-disk transient outputs to first-class artifacts.

## Scope

### In Scope
- New `FraktalBatch` + `FraktalBatchImage` models (FK to `Project` + `User`); per-image PNG persisted
- Migration; Celery task and sync path BOTH write to DB (not JSON-on-disk)
- Endpoints: status/results adapted to DB; new drill-down `GET .../images/{index}/`, `POST .../reanalyze/`, `GET .../png/`, `DELETE .../batches/{batchId}/`
- CSV endpoints: single-image `GET .../fraktal/{analysisId}/csv/` and batch `GET .../batches/{batchId}/csv/`
- Shared `apps/core/services/csv_locale.py` (hoisted from `apps/simulations/views.py`)
- Frontend route `/projects/{id}/fraktal/batch/{batchId}/image/{index}` + `FraktalBatchImageDetail` component
- "Download CSV", "Re-analyze", "Delete batch" buttons (single-image and batch results pages)
- Backend + frontend tests; user-guide doc

### Out of Scope
- Automatic batch retention (TTL/auto-delete) — manual delete only
- Bulk re-analyze, diff view, batch listing UI, per-particle CSV

## Capabilities

### New Capabilities
- `fraktal-batch-persistence`: DB-backed FraktalBatch model + drill-down + per-image PNG access + CSV export contract
- `csv-export-locale`: shared CSV locale helpers contract across apps

### Modified Capabilities
- `fraktal-batch-contract`: supersede JSON-on-disk results with DB-backed model; polling shape preserved, results URL repointed

## Approach

Five phases: (1) Django model + migration + storage choice (BinaryField vs FileField — design decides); (2) Adapt analyze_batch + Celery task + status/results to DB; (3) Hoist CSV locale module + add CSV builders; (4) Frontend drill-down route + component + Re-analyze/Delete; (5) CSV download buttons + tests + docs.

Persistence: `FraktalBatch` (project, user, summary metadata) + sibling `FraktalBatchImage` (FK + index unique-together, PNG bytes, metrics, error). Re-analyze flow: drill-down POSTs to `.../reanalyze/` → creates a fresh `FraktalAnalysis` row from the persisted bytes + same scale/dpo, then redirects to standard single-image results page. Migration is destructive vs old JSON-on-disk results — documented in CHANGELOG.

### Key decisions (locked)
- Q1=B (persist PNGs in DB), Q2=B (CSV full + geometry + physical), Q3=A (re-analyze creates persistent FraktalAnalysis), Q4=manual delete only
- Drill-down route: `/projects/{id}/fraktal/batch/{batchId}/image/{index}`
- CSV honors `User.csv_decimal_separator` + `csv_column_delimiter`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/fractal_analysis/models.py` | Modify | NEW FraktalBatch + FraktalBatchImage |
| `backend/apps/fractal_analysis/migrations/00XX_*` | New | Creates both models |
| `backend/apps/fractal_analysis/tasks.py` | Modify | Celery writes to DB |
| `backend/apps/fractal_analysis/views.py` | Modify | Adapt analyze_batch + status + results; add drill-down/reanalyze/png/csv/delete |
| `backend/apps/fractal_analysis/urls.py` | Modify | Register endpoints |
| `backend/apps/fractal_analysis/serializers.py` | Modify | NEW batch serializers |
| `backend/apps/fractal_analysis/services/batch.py` | Modify | Build DB rows instead of dict |
| `backend/apps/core/services/csv_locale.py` | New | Hoisted shared CSV helpers |
| `backend/apps/simulations/views.py` | Modify | Use hoisted module |
| `backend/apps/fractal_analysis/services/csv_export.py` | New | Single + batch CSV builders |
| `frontend/src/app/projects/[id]/fraktal/batch/[batchId]/image/[index]/page.tsx` | New | Drill-down route |
| `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` | New | Drill-down component |
| `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` | Modify | Clickable rows + CSV/Delete buttons |
| `frontend/src/components/fraktal/FraktalResultsView.tsx` | Modify | CSV download button |
| `frontend/src/lib/api.ts` | Modify | New API methods |
| `docs/fraktal-drilldown-csv.md` | New | User guide |

## Success Criteria

- [ ] `FraktalBatch` + `FraktalBatchImage` exist with project/user permissions
- [ ] Sync (≤30) and async (>30) batch upload write to DB (no JSON-on-disk)
- [ ] GET batch by `{batchId}` returns existing shape (compat with `FraktalBatchResultsView`)
- [ ] Row click → bookmarkable `/.../batch/{batchId}/image/{index}` page with image, metrics, calibration, error
- [ ] Re-analyze → new `FraktalAnalysis` row + redirect to single-image results
- [ ] CSV (single + batch) downloads honor user locale prefs
- [ ] Delete batch cascades to all images
- [ ] Legacy single-image FRAKTAL flow unchanged
- [ ] All backend + frontend tests pass

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| BinaryField PNG bloats Postgres | Medium | ~10MB/batch acceptable; manual delete; future cleanup task |
| Migration destroys old JSON-on-disk results | Low | Document in CHANGELOG; users re-run if needed |
| CSV locale hoist breaks simulations export | Medium | Snapshot test before/after the hoist |
| Re-analyze orphan if user navigates away | Low | Atomic create + clear UI progress/error |
| Drill-down PNG endpoint hit hard | Low | Cache headers; per-batch permissions |

## Rollback Plan

1. Revert frontend route + components (drill-down 404s, no other UI impact)
2. Revert backend endpoints (drill-down/CSV calls 404)
3. Migration rollback drops new tables — DESTRUCTIVE; only if no production batches exist

## Dependencies

- None external. Builds on: User CSV prefs (verify-rg), `FraktalAnalysis` model, shared media volume (kept for sync projection ZIP exports >200)

## Open questions (deferred to spec/design)

- BinaryField vs FileField for PNG storage
- Pagination on per-image list endpoint
- Whether re-analyze inherits batch dpo or autocalibrates fresh
- Exact "summary row" format in batch CSV
