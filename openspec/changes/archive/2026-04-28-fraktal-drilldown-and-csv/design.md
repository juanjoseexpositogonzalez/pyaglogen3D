# Design: fraktal-drilldown-and-csv

## Architecture overview

The change moves FRAKTAL batch results from transient (sync inline / async JSON-on-disk) to first-class DB entities (`FraktalBatch` + `FraktalBatchImage`), persists per-image rasterized PNG bytes, and adds drill-down + re-analyze + CSV export endpoints. Both the sync handler and the Celery task funnel through a single `_persist_batch(...)` helper that writes the new rows in one transaction. The polling shape stays compatible (adds `batch_id` on SUCCESS); the existing `FraktalBatchResultsView` still works against the new endpoint.

CSV locale handling is hoisted from `apps/simulations/views.py` into a shared `apps/core/services/csv_locale.py` module. Two CSV builders live in `apps/fractal_analysis/services/csv_export.py` (single-image + batch-with-summary). The frontend gains a bookmarkable drill-down route, an "Open original / Re-analyze" affordance that creates a real `FraktalAnalysis` row from the cached PNG, plus CSV download buttons on both single-image and batch results pages.

```
ZIP upload ──▶ analyze_batch (sync ≤30 / async >30)
                   │
                   ▼
              _persist_batch(...)  ─── txn ───▶  FraktalBatch  ◀── 1:N ──▶  FraktalBatchImage(image_png)
                   │                                  │
                   ▼                                  ▼
              200 + batch_id                    GET /batches/{id}/        ─▶ FraktalBatchResultsView (table click)
                                                GET /images/{idx}/        ─▶ FraktalBatchImageDetail
                                                GET /images/{idx}/png/    ─▶ <img src="">
                                                POST /images/{idx}/reanalyze/ ─▶ FraktalAnalysis (existing flow)
                                                GET /batches/{id}/csv/    ─▶ build_batch_csv → text/csv
                                                GET /{analysisId}/csv/    ─▶ build_single_image_csv → text/csv
```

## Key components

### Component 1: FraktalBatch + FraktalBatchImage models — NEW
**Location**: `backend/apps/fractal_analysis/models.py`
**Schema**:
```python
class FraktalBatch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="fraktal_batches")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    algorithm = models.CharField(max_length=32)  # 'granulated_2012' | 'voxel_2018'
    calibration_source = models.CharField(max_length=16)  # 'metadata' | 'manual' | 'autocalibrate'
    pixels_per_100nm = models.FloatField()
    dpo_used = models.FloatField()
    autocalibrate_source = models.CharField(max_length=16, null=True, blank=True)
    autocalibrate_image_index = models.IntegerField(null=True, blank=True)

    sim_id = models.UUIDField(null=True, blank=True)

    n_images = models.IntegerField(default=0)
    n_successful = models.IntegerField(default=0)
    mean_df = models.FloatField(null=True, blank=True)
    std_df = models.FloatField(null=True, blank=True)
    median_df = models.FloatField(null=True, blank=True)
    min_df = models.FloatField(null=True, blank=True)
    max_df = models.FloatField(null=True, blank=True)

    original_zip_filename = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["project", "-created_at"])]


class FraktalBatchImage(models.Model):
    batch = models.ForeignKey(FraktalBatch, on_delete=models.CASCADE, related_name="images")
    index = models.IntegerField()
    filename = models.CharField(max_length=255)

    azimuth = models.FloatField(null=True, blank=True)
    elevation = models.FloatField(null=True, blank=True)

    fractal_dimension = models.FloatField(null=True, blank=True)
    prefactor = models.FloatField(null=True, blank=True)
    r_squared = models.FloatField(null=True, blank=True)
    n_particles_counted = models.IntegerField(null=True, blank=True)
    dpo_used = models.FloatField()
    error = models.TextField(blank=True)

    image_png = models.BinaryField()  # ~50-100KB typical

    class Meta:
        unique_together = [("batch", "index")]
        ordering = ["index"]
```
**Migration**: `00XX_fraktalbatch_fraktalbatchimage.py` (Django auto-generated).

### Component 2: Celery task adapt — MODIFIED
**Location**: `backend/apps/fractal_analysis/tasks.py::analyze_fraktal_batch_task`
**Changes**:
- After Rust returns, call shared `_persist_batch(...)` (no more JSON-on-disk write).
- Returns `{batch_id, results_url: f"/api/v1/projects/{project_id}/fraktal/batches/{batch_id}/"}`.
- Polling SUCCESS payload gains `batch_id`.

### Component 3: Sync path adapt — MODIFIED
**Location**: `backend/apps/fractal_analysis/views.py::analyze_batch`
**Changes**:
- Same `_persist_batch(...)` call after Rust returns.
- Sync 200 includes `batch_id` so frontend builds the URL.

### Component 4: New endpoints — NEW
**Location**: `backend/apps/fractal_analysis/views.py` + `urls.py`
**Endpoints**:
- `GET  /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/` — full batch detail (mirror current FraktalBatchResultsView shape).
- `GET  /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/images/{index}/` — drill-down detail with prev/next refs.
- `GET  /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/images/{index}/png/` — bytes (Content-Type: image/png, Cache-Control: private, max-age=3600).
- `POST /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/images/{index}/reanalyze/` — creates new `FraktalAnalysis` from cached PNG + inherited dpo.
- `DELETE /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/` — cascade.
- `GET  /api/v1/projects/{project_pk}/fraktal/{analysisId}/csv/` — single-image CSV.
- `GET  /api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/csv/` — batch CSV.

All scoped via `project_pk` filter; cross-project access returns 404 (no leak).

### Component 5: Hoisted csv_locale module — NEW
**Location**: `backend/apps/core/services/csv_locale.py` (new `services/` package).
**Functions**:
```python
def get_user_csv_locale(request) -> tuple[str, str]:
    """Returns (decimal_sep, column_delimiter) honoring User prefs.
    Anonymous → ('.', ',')."""

def write_localized_row(writer: csv.writer, row: list, decimal: str) -> None:
    """Write a row with decimal localization. Floats → str with chosen decimal,
    strings unchanged, ints unchanged, None → empty string."""

def stream_localized_csv(rows: Iterable[list], header: list, decimal: str, delimiter: str) -> StringIO:
    """Helper: build a complete CSV in-memory and return as StringIO."""
```
**Migration**: existing `_get_user_csv_locale`, `_localize_numeric_cell`, `_write_localized_row` (and `_NUMERIC_CELL_RE`) move here; old call sites in `apps/simulations/views.py` import from new location with a thin alias to preserve the underscore-private names referenced in tests.

### Component 6: csv_export service — NEW
**Location**: `backend/apps/fractal_analysis/services/csv_export.py`
**Functions**:
```python
def build_single_image_csv(analysis: FraktalAnalysis, decimal: str, delimiter: str) -> str:
    """text/csv body, header + 1 row.
    Columns: analysis_id, created_at, algorithm, image_filename, Df, kf, R²,
             n_particles, error, dpo_used, autocalibrate_source, scale_factor_nm,
             pixels_per_100nm, rg, ap, volume, mass, surface_area, sim_id,
             sim_target_df, sim_box_counting_df, calibration_source"""

def build_batch_csv(batch: FraktalBatch, decimal: str, delimiter: str) -> str:
    """text/csv body, header + N image rows + blank line + summary row.
    Image columns: index, filename, az, el, Df, kf, R², n_particles, error,
                   dpo_used, autocalibrate_source, scale_factor_nm, pixels_per_100nm
    Summary row: SUMMARY, n_images, mean_df, std_df, median_df, min_df, max_df,
                 sim_id, sim_target_df, sim_box_counting_df"""
```
Floats pre-formatted with f-strings (`f"{v:.4f}"`) so `_localize_numeric_cell` is predictable.

### Component 7: Frontend batch results page — MODIFIED
**Location**: `frontend/src/components/fraktal/FraktalBatchResultsView.tsx`
**Changes**:
- Wrap each table row in `<Link href={`/projects/${projectId}/fraktal/batch/${batchId}/image/${index}`}>`.
- Add "Download CSV" button (top-right, near histogram toggle).
- Add "Delete batch" button with confirmation modal.

### Component 8: Frontend drill-down — NEW
**Location**: `frontend/src/app/projects/[id]/fraktal/batch/[batchId]/image/[index]/page.tsx` (route).
**Component**: `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` (new).
**Layout**:
- Breadcrumb: Project / FRAKTAL / Batch {N} / Image {index}
- Image preview (auth-fetched from `/png/` endpoint; Blob URL).
- Per-image metric cards (Df, kf, R², n_particles).
- Calibration card (dpo, scale, source).
- Comparison card (sim Df comparison if applicable).
- Failure card (if `error`: error text + possible-causes dictionary).
- Buttons: Re-analyze, Previous (←), Next (→), Back to Batch.

### Component 9: Frontend single-image CSV button — MODIFIED
**Location**: `frontend/src/components/fraktal/FraktalResultsView.tsx`
**Changes**: "Download CSV" button (top-right of results card) → `fraktalApi.downloadSingleCsv(...)` → blob download.

### Component 10: Frontend api.ts — MODIFIED
**Location**: `frontend/src/lib/api.ts::fraktalApi`
**New methods**:
```typescript
getBatch(projectId, batchId): Promise<FraktalBatchResult>
getBatchImage(projectId, batchId, index): Promise<FraktalBatchImageDetail>
getBatchImagePngUrl(projectId, batchId, index): string
reanalyzeBatchImage(projectId, batchId, index): Promise<{ analysisId: string }>
deleteBatch(projectId, batchId): Promise<void>
downloadSingleCsv(projectId, analysisId): Promise<Blob>
downloadBatchCsv(projectId, batchId): Promise<Blob>
```

### Component 11: Documentation — NEW
**Location**: `docs/fraktal-drilldown-csv.md` (~80 lines): drill-down navigation, re-analyze workflow, CSV format/columns, locale handling, delete affordance.

## Data shapes

### FraktalBatch detail response
```typescript
{
  batch_id: string;
  project_id: string;
  algorithm: "granulated_2012" | "voxel_2018";
  created_at: string;
  images: FraktalBatchImageResult[];
  stats: { n_images, n_successful, mean_df, std_df, median_df, q1_df, q3_df, min_df, max_df };
  histogram: { bin_edges: number[], counts: number[], rule_used } | null;
  comparison: { sim_id, sim_target_df, sim_box_counting_df, batch_mean_df, batch_std_df, sorensen_note } | null;
  calibration: { source, pixels_per_100nm, dpo_used, autocalibrate_image: number | null };
  original_zip_filename: string;  // NEW
}
```

### FraktalBatchImageDetail response
```typescript
{
  batch_id: string;
  index: number;
  filename: string;
  azimuth: number | null;
  elevation: number | null;
  fractal_dimension: number | null;
  prefactor: number | null;
  r_squared: number | null;
  n_particles_counted: number | null;
  error: string | null;
  dpo_used: number;
  // PNG via separate /png/ endpoint
  prev_index: number | null;
  next_index: number | null;
  sim_target_df: number | null;
  sim_box_counting_df: number | null;
  sorensen_note: string;
}
```

## Edge cases

- Re-analyze on image with empty `image_png` → 400 with helpful error.
- Drill-down to index ≥ N → 404 ("image index out of range").
- Delete batch with reanalyzed `FraktalAnalysis` children → batch + images deleted, `FraktalAnalysis` rows untouched (independent).
- CSV download for all-failed batch → header + N rows with error column populated + summary row with `mean_df = ""`.
- Cross-project access (batch from project A, request via project B) → 404 (avoid existence leak).
- Sync batch N=30 → DB write must add < 500ms total (R10 soft guarantee).
- **Migration on prod**: old JSON-on-disk results LOST. Document in CHANGELOG. Mitigation: only ones since shared-volume hotfix exist; users re-run if needed.

## Backwards compatibility

- Single-image `FraktalAnalysis` flow unchanged (model + endpoints + UI).
- Polling endpoint `GET /api/v1/fraktal-status/{job_id}/` retains shape; adds `batch_id` to SUCCESS state.
- Existing simulations CSV exports unchanged — snapshot test before/after the locale-helpers hoist.
- `FraktalBatchResultsView` gets table-row links + new buttons; existing layout preserved.

## Testing strategy

### Backend
- **Models**: `FraktalBatch` + `FraktalBatchImage` create, FK relationships, cascade delete, BinaryField round-trip.
- **Endpoints**: drill-down GET (happy + edge), PNG endpoint (happy + missing), reanalyze POST (creates `FraktalAnalysis`), delete (cascade), cross-project 404.
- **CSV**: single-image with all columns + locale; batch with N rows + summary row + locale.
- **csv_locale**: anonymous, US, EU, mixed; floats/ints/None/strings rendering.
- **Integration**: snapshot test for simulations CSV export (verify hoist preserves output).
- **Service**: `build_batch_csv` with happy / all-failed / partial-failure inputs.

### Frontend
- `FraktalBatchImageDetail`: PNG fetch + render, metric cards, prev/next nav, re-analyze button.
- `FraktalBatchResultsView` modified: clickable rows, CSV button, Delete confirmation.
- `FraktalResultsView` modified: CSV button on single-image.
- `api.ts` new methods: blob downloads (CSV), drill-down GET, reanalyze POST.

## Open questions (for TASKS)

- Compare-with-original view on the re-analyzed `FraktalAnalysis` (side-by-side Df) — likely defer.
- Cache headers for the PNG endpoint — locked to `Cache-Control: private, max-age=3600` here; tasks confirm.
- Django admin entry for `FraktalBatch` — useful for prod debugging, low cost; tasks decide.
