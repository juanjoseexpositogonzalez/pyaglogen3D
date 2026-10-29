# Design: Batch Projection Export Across Simulations

## Technical Approach

Extend the existing single-sim async projection pipeline to work across multiple simulations in a ParametricStudy. New `export_projections` action on `ParametricStudyViewSet` dispatches a new Celery task that loops sims, reuses the per-sim render helper from `services/projection.py`, and packs results into a single ZIP with `sim_{uuid}/` subfolders + `manifest.json`. Frontend adds `BatchProjectionExportPanel` to the batch results page. Existing polling/download endpoints are reused with two small backward-compatible patches: `current_sim_id` in progress meta and `download_filename` in result dict.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|----------|--------|----------------------|-----------|
| Polling endpoint | Extend `projections_status_view` with `current_sim_id` field | New batch-specific endpoint | Existing status view already reads `meta` dict generically. Adding unknown fields is backward-compatible — single-sim consumers ignore them. Less code, same contract. |
| ZIP filename | Task sets `download_filename` in result; download view reads it with fallback | Hardcode in download view per task type | Generalizes `projections_download_view` for any task. One-line change: `data.get("download_filename", f"projections_{job_id}.zip")`. |
| Per-sim render reuse | New `render_sim_projections()` in `services/projection.py` extracted from `build_projections_zip_task` phases 1-3 | Call `build_projections_zip_task` as subtask per sim | Subtask chaining adds Celery complexity + loses per-sim progress. Direct function call in the loop is simpler, testable, and matches the existing sync `_render_and_zip_sync` pattern. |
| Filesystem reuse (R6 efficiency) | Check `create_projection_filename` output path existence before rendering | DB-based cache / hash table | Filename is deterministic (`sim_{id[:8]}_Az{az:03d}_El{el:03d}.png`). Filesystem check is O(1), no schema change, no cache invalidation logic. False-positive risk is benign (same direction → same image). |
| Batch task — always async | POST always returns 202, task always via Celery | Sync for small batches (≤5 sims) | Even 3 sims × 30 directions = 90 renders (~15s). HTTP timeout risk + simpler frontend (always polls). |

## Data Flow

```
Frontend (BatchProjectionExportPanel)
    │ POST /projects/{pk}/studies/{pk}/export-projections/
    │   {simulation_ids, mode, config}
    ▼
ParametricStudyViewSet.export_projections()
    │ validate sim_ids ∈ study, mode+config
    │ dispatch build_batch_projections_zip.delay()
    │ return 202 {job_id, status: "queued", total_sims}
    ▼
Celery: build_batch_projections_zip
    │ for each sim:
    │   update_state(PROGRESS, {current, total, current_sim_id})
    │   render_sim_projections(sim, mode, config) → list[Path]
    │   add files to ZIP under sim_{uuid}/
    │ write manifest.json
    │ return {zip_path, download_filename, successful_sims, failed_sims}
    ▼
Frontend polls GET /projections-status/{job_id}/
    │ → {status: "processing", current, total, current_sim_id}
    │ → {status: "done", download_url}
    ▼
Frontend GET /projections-status/{job_id}/download/
    │ Content-Disposition: study_{id}_projections_{date}.zip
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/apps/simulations/views.py` | Modify | Add `export_projections` action to `ParametricStudyViewSet` (~40 lines). Patch `projections_download_view` to read `download_filename` from result dict (1 line). |
| `backend/apps/simulations/tasks.py` | Modify | Add `build_batch_projections_zip` task (~80 lines). |
| `backend/apps/simulations/serializers.py` | Modify | Add `BatchProjectionExportRequestSerializer` (~30 lines). |
| `backend/apps/simulations/services/projection.py` | Modify | Extract `render_sim_projections(sim_id, mode, config, storage_dir) → list[Path]` helper from existing task logic (~40 lines). |
| `backend/apps/simulations/urls.py` | Modify | Add `export-projections/` route under studies (2 lines). |
| `frontend/src/components/batch/BatchProjectionExportPanel.tsx` | Create | Sim checkboxes + mode selector (reuse `ProjectionControls`) + polling progress + auto-download (~180 lines). |
| `frontend/src/lib/api.ts` | Modify | Add `triggerBatchProjectionExport()` method + `BatchExportRequest` type (~25 lines). Reuse existing `pollProjectionsUntilDone`. |
| `frontend/src/app/projects/[id]/batch/page.tsx` | Modify | Mount `BatchProjectionExportPanel` when a study is selected and has ≥1 completed sim (~10 lines). |

## Interfaces / Contracts

```python
# Serializer
class BatchProjectionExportRequestSerializer(serializers.Serializer):
    simulation_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=50
    )
    mode = serializers.ChoiceField(choices=["grid", "fibonacci", "legacy"])
    config = serializers.DictField()  # mode-specific validation in validate()
```

```python
# Task result shape
{
    "zip_path": str,
    "download_filename": "study_{study_id}_projections_{date}.zip",
    "download_url": "/api/v1/projections-status/{job_id}/download/",
    "total_sims_processed": int,
    "successful_sims": int,
    "failed_sims": [{"sim_id": str, "error": str}],
}
```

```typescript
// Frontend API
interface BatchExportRequest {
  simulation_ids: string[]
  mode: 'grid' | 'fibonacci' | 'legacy'
  config: Record<string, number>
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Serializer validation (6 error paths from spec R1/R2) | pytest, no DB |
| Unit | `render_sim_projections` with mock geometry | pytest, mock `aglogen_core` |
| Integration | ViewSet action → queues task, returns 202 | pytest + DRF APIClient, mock `.delay()` |
| Integration | Cross-study sim validation → 400 | pytest + APIClient |
| Integration | Celery task: 2 sims, 1 fails → partial ZIP + manifest | pytest, mock renderer |
| Integration | Download view reads `download_filename` → correct Content-Disposition | pytest |
| Frontend | Panel renders, select all/deselect, counter, disabled button | vitest + RTL |
| Frontend | POST fires, polls, auto-downloads | vitest, MSW mocks |

## Migration / Rollout

No migration required. No DB schema changes. New endpoint + new task + new component. Revert = revert merge commit.

## Open Questions

None — all decision points resolved above.
