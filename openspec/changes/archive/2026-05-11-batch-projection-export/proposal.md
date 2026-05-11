# Proposal: Batch Projection Export Across Simulations

## Intent

Users must generate projection ZIPs one simulation at a time from a Parametric Study. For studies with 10–50 sims, this is tedious and error-prone. Add a single-action batch export: select sims → pick mode → get one ZIP with all projections organized by sim.

## Scope

### In Scope
- `POST /api/v1/projects/{project_pk}/studies/{study_pk}/export-projections/` — accepts `simulation_ids`, `mode`, `config`; dispatches async Celery task; returns `{job_id, status, total_sims}`
- New Celery task `build_batch_projections_zip` — loops selected sims, reuses `build_projections_zip_task` logic per sim, packs into ONE zip (`sim_{id}/...` structure)
- Reuse existing polling (`projections-status/{job_id}/`) and download endpoints — same Celery result backend
- Skip regeneration when projection files already exist on disk (deterministic filenames)
- Per-sim failure isolation — failed sims logged, ZIP includes the rest
- Progress reporting: `current_sim / total_sims` via `PROGRESS` state
- Frontend `BatchProjectionExportPanel` in parametric study page — sim checkboxes, select-all/deselect-all, mode selector (reuse `ProjectionControls`), generate button, polling progress, auto-download
- Backend + frontend tests

### Out of Scope
- New projection modes (use existing grid/fibonacci/legacy)
- Per-direction selection (mode determines directions)
- ZIP caching or email notification
- Background pre-generation
- Modifying single-sim projection logic
- F2 graph viz, F4 batch stats

## Capabilities

### New Capabilities
- `batch-projection-export`: Multi-sim projection ZIP export from a ParametricStudy — endpoint, Celery task, frontend panel

### Modified Capabilities
- None — single-sim export (`projection-export-contract`) is untouched; we wrap it

## Approach

**Backend**: New action on `ParametricStudyViewSet` → validates sim IDs belong to study + mode/config → dispatches `build_batch_projections_zip.delay()`. Task loops sims, calls existing per-sim render logic, writes `sim_{uuid}/` sub-dirs in ZIP. Reuses `AsyncResult` + existing polling/download views. Max 50 sims per request.

**Frontend**: `BatchProjectionExportPanel.tsx` mounted in batch page. Reuses `ProjectionControls` for mode config. Polls `projections-status/{job_id}/` every 3s, shows progress bar, triggers download on completion.

**Storage**: Same pattern as single-sim — ZIP to `MEDIA_ROOT/projections/`, served once, cleaned up after retrieval.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/apps/simulations/views.py` | Modified | New `export_projections` action on `ParametricStudyViewSet` |
| `backend/apps/simulations/tasks.py` | Modified | New `build_batch_projections_zip` Celery task |
| `backend/apps/simulations/serializers.py` | Modified | Request serializer for batch export payload |
| `frontend/src/components/batch/BatchProjectionExportPanel.tsx` | New | Sim selection + mode config + polling UI |
| `frontend/src/app/projects/[id]/batch/page.tsx` | Modified | Mount export panel |
| `frontend/src/lib/api.ts` | Modified | API call for batch export endpoint |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 20 sims × 30 dirs = 600 renders (~60s) | Med | Sequential sims, parallel dirs per sim (existing). Show estimated time in UI |
| Disk: 600 PNGs × 100KB = 60MB transient | Low | Existing cleanup-after-download pattern |
| Orphan Celery tasks on user nav-away | Low | Out of scope; document as future enhancement |
| Mode-config mismatch (e.g. fibonacci + az_step) | Low | Validate at endpoint, reject with 400 |
| Sim ID not in study | Low | Validate ownership at endpoint level |

## Rollback Plan

New endpoint + new component + new task. Revert merge commit. No DB schema changes. Existing single-sim export untouched.

## Dependencies

- Existing `build_projections_zip_task` per-sim logic (tasks.py:2102)
- Existing polling endpoints (`projections_status_view`, `projections_download_view`)
- Existing `ProjectionControls` component

## Success Criteria

- [ ] Select N sims from a study → trigger batch export → ZIP downloads with `sim_{uuid}/` structure
- [ ] Existing-projection reuse confirmed (second run faster)
- [ ] Per-sim failure doesn't abort the batch; `failed_sims` list in response
- [ ] Frontend polling shows "Processing sim X of Y", auto-downloads on completion
- [ ] Mode validation rejects mismatched config (400)
- [ ] Backend integration test + frontend component tests pass
- [ ] No regression on single-sim export
