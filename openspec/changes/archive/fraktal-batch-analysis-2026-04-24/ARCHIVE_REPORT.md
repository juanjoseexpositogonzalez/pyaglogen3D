# Archive Report: fraktal-batch-analysis

**Archived**: 2026-04-24
**Scope**: Medium (~5 days)
**Status**: Complete ✓

## Summary

Batch FRAKTAL analysis for projection ZIPs. Extends the legacy single-image FRAKTAL flow with a parallel upload-a-ZIP path that processes all images, auto-calibrates from metadata, and renders a distribution + comparison against the source simulation.

## Tasks (25 total)

### Phase 1 — Rust batch orchestrator
- [x] T1.1 batch.rs: BatchInput/Output/AutocalibrateSource + analyze_batch
- [x] T1.2 6 unit tests in batch.rs
- [x] T1.3 pub mod batch; in fraktal/mod.rs

### Phase 2 — PyO3 binding
- [x] T2.1 analyze_fraktal_batch pyfunction
- [x] T2.2 5 smoke tests

### Phase 3 — Backend
- [x] T3.1 services/batch.py (6 helpers)
- [x] T3.2 44 unit tests
- [x] T3.3 analyze_batch action on FraktalAnalysisViewSet
- [x] T3.4 analyze_fraktal_batch_task Celery task
- [x] T3.5 /fraktal-status/{job_id}/ polling
- [x] T3.6 /fraktal-status/{job_id}/results/ download
- [x] T3.7 URL registration
- [x] T3.8 25 integration tests

### Phase 4 — Frontend
- [x] T4.1 fraktalApi.analyzeBatch + polling helper
- [x] T4.2 FraktalBatchUpload component
- [x] T4.3 FraktalBatchResultsView component
- [x] T4.4 FraktalComparisonCard component
- [x] T4.5 Batch route pages
- [x] T4.6 CTA on legacy FRAKTAL new page
- [x] T4.7 16 component tests
- [x] T4.8 5 api tests

### Phase 5 — Docs + verify
- [x] T5.1 docs/fraktal-batch.md
- [x] T5.2 Full test suite verified
- [x] T5.3 CHANGELOG entry
- [x] T5.4 Archive (this file)

## Commits

- cfd7428 Batch A — Rust orchestrator + PyO3 binding
- 888df89 Batch B1 — backend services layer
- 9aaa7f2 Batch B2 — endpoint + Celery + polling
- f0b7f19 Batch C1 — api + Upload + ComparisonCard
- 78e9f4e Batch C2 — ResultsView + routes + tests

## Test delta

| Suite | Before | After | Δ |
|-------|--------|-------|---|
| Engine | 172 | 179 | +7 |
| Backend | 150 | 224 | +74 |
| Frontend | 169 | 190 | +21 |
| **Total** | **491** | **593** | **+102** |

## Known follow-ups (deferred)

- **Per-image progress during 'analyzing' stage**: currently the Rust batch is a single call so progress jumps from 0 to 100% at the end of that stage. Granular progress would require looping single-image bindings in Python and re-implementing the one-shot dpo cache there. Acceptable as-is.
- **CSV export of batch results**: deferred to a future scope (Full).
- **Persist batch results to a new FraktalBatch model**: currently view-and-forget via task result file on disk. DB persistence deferred.
- **Embed FRAKTAL batch Df summary on the simulation detail page**: deferred.
- **Mobile-optimized batch UI**: desktop-first; mobile works but not optimized.
