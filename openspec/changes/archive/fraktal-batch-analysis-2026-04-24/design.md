# Design: fraktal-batch-analysis

## Architecture overview

FRAKTAL batch is an additive layer over the existing single-image analyzers. The frontend POSTs a multipart ZIP to a new `/fractal-analysis/analyze-batch/` action. The backend extracts the archive, parses `metadata.json` (when present) for `parameters.pixels_per_100nm`, detects an optional `sim_id` from the filename (or accepts a manual override), and dispatches to a new Rust orchestrator `batch.rs` that wraps the current per-image analyzers. `N ≤ 30` runs inline and returns 200 with the full aggregated payload; `N > 30` goes to a dedicated Celery task with per-image progress and is retrieved through a new `/fraktal-status/{job_id}/` pair of endpoints. The frontend mounts two new routes (`/fraktal/batch`, `/fraktal/batch/{jobId}`) and renders a sortable table, a Freedman-Diaconis/Sturges histogram, and a comparison card against the originating simulation.

```
Frontend (React)
   │  POST /fractal-analysis/analyze-batch/  (multipart ZIP)
   ▼
Django view (FractalAnalysisViewSet.analyze_batch)
   │  services.batch.extract_zip_images / extract_scale_from_metadata
   │  services.batch.detect_sim_id_from_filename
   ├─ N ≤ 30 → aglogen_core.analyze_fraktal_batch() ──► 200 full payload
   └─ N > 30 → Celery.delay(analyze_fraktal_batch_task)
                │   self.update_state(PROGRESS, meta={stage, current, total})
                ▼
            results.json on disk ◄── GET /fraktal-status/{job_id}/[results/]
                ▼
Frontend polls → FraktalBatchResultsView (table + histogram + comparison card)
```

## Key components

### Component 1: Rust `batch.rs` — NEW
**Location**: `aglogen_core/engine/src/fractal/fraktal/batch.rs`
**Purpose**: one-shot dpo + per-image analyzer loop.
**Public API**:
```rust
pub enum BatchAlgorithm { Granulated2012, Voxel2018 }

pub enum AutocalibrateSource { Image0, ImageNHalf, Manual, Metadata }

pub struct BatchInput {
    pub images: Vec<Vec<u8>>,          // PNG bytes per image
    pub pixels_per_100nm: f64,
    pub autocalibrate_dpo: bool,
    pub algorithm: BatchAlgorithm,
}

pub struct BatchImageResult {
    pub index: usize,
    pub fractal_dimension: Option<f64>,
    pub prefactor: Option<f64>,
    pub r_squared: Option<f64>,
    pub n_particles_counted: Option<usize>,
    pub dpo_used: f64,
    pub error: Option<String>,
}

pub struct BatchOutput {
    pub results: Vec<BatchImageResult>,
    pub dpo_used: f64,
    pub autocalibrate_source: AutocalibrateSource,
}

pub fn analyze_batch(input: BatchInput) -> BatchOutput;
```
**Behavior**: if `autocalibrate_dpo`, call `estimate_particles_and_dpo` on `images[0]`; on `Err`, retry `images[N/2]`; on second `Err`, fail the whole batch with a clear message. Then iterate images and call `analyze_granulated_2012` / `analyze_voxel_2018` with the cached dpo. A per-image error is captured in `error: Some(msg)` without killing the batch.

### Component 2: PyO3 binding — MODIFIED
**Location**: `aglogen_core/python/src/lib.rs`
**New pyfunction**: `analyze_fraktal_batch(images: list[bytes], pixels_per_100nm, autocalibrate_dpo, algorithm) -> dict`. Thin wrapper over `batch::analyze_batch`. Release the GIL via `py.allow_threads`. `analyze_granulated_2012` / `analyze_voxel_2018` remain untouched (backcompat for the legacy single-image path).

### Component 3: backend service `batch.py` — NEW
**Location**: `backend/apps/fractal_analysis/services/batch.py`
```python
def extract_zip_images(zip_bytes: bytes) -> tuple[list[bytes], dict | None, list[str]]: ...
def extract_scale_from_metadata(metadata: dict) -> float | None: ...    # metadata.parameters.pixels_per_100nm
def detect_sim_id_from_filename(zip_filename: str) -> uuid.UUID | None: ...   # {uuid}_projections.zip
def build_comparison_data(sim_id: UUID | None, batch_mean, batch_std) -> dict | None: ...
def compute_batch_statistics(results: list[dict]) -> dict: ...          # null-tolerant
def compute_histogram(df_values: list[float]) -> dict | None:           # FD N≥10; Sturges 5≤N<10; None N<5
    ...
```

### Component 4: backend endpoint — MODIFIED
**Location**: `backend/apps/fractal_analysis/views.py`
New action: `@action(detail=False, methods=["post"], url_path="analyze-batch")`.
Multipart body: `file` (ZIP, required), `pixels_per_100nm?`, `autocalibrate_dpo?`, `algorithm` (`granulated_2012|voxel_2018`), `sim_id?`.
Flow:
1. Extract ZIP → `(images, metadata, filenames)`.
2. Resolve scale: **request body > metadata > 400** (explicit user intent wins).
3. Resolve `sim_id`: **request body > filename detection > None**.
4. If `len(images) ≤ 30`: call `analyze_fraktal_batch` inline, assemble full response, 200.
5. Else: enqueue `analyze_fraktal_batch_task.delay(...)`, return 202 `{job_id}`.

### Component 5: Celery task — NEW
**Location**: `backend/apps/fractal_analysis/tasks.py`
```python
@shared_task(bind=True)
def analyze_fraktal_batch_task(self, images_b64, scale, autocalibrate, algorithm, sim_id):
    self.update_state(state="PROGRESS", meta={"stage": "autocalibrate", "progress": 0, "total": N})
    # ... analyze loop ...
    self.update_state(state="PROGRESS", meta={"stage": "analyzing", "current": i, "total": N, "progress": i/N})
    # ... aggregate ...
    self.update_state(state="PROGRESS", meta={"stage": "aggregating", "progress": 0.99})
    # persist to BASE_DIR/fraktal_batches/{task_id}.json; return {"results_url": ...}
```
Mirrors `simulations.tasks.build_projections_zip_task`.

### Component 6: polling + download endpoints — NEW
**Location**: `backend/apps/fractal_analysis/views.py` + `urls.py`
- `GET /api/v1/fraktal-status/{job_id}/` — mirrors projections-status shape; adds `stage` field.
- `GET /api/v1/fraktal-status/{job_id}/results/` — streams the JSON result file.

### Component 7: serializers — NEW
**Location**: `backend/apps/fractal_analysis/serializers.py`
`FraktalBatchRequestSerializer`, `FraktalBatchResultSerializer`, `ComparisonDataSerializer`.

### Component 8: `FraktalBatchUpload.tsx` — NEW
**Location**: `frontend/src/components/fraktal/FraktalBatchUpload.tsx`
**Props**: `{ projectId, onSuccess }`.
Drag-and-drop ZIP, badge "Auto-calibrated from metadata" when detected, manual scale inputs when absent, algorithm select, optional `sim_id` override dropdown when the filename doesn't match `{uuid}_projections.zip`.

### Component 9: `FraktalBatchResultsView.tsx` — NEW
**Location**: `frontend/src/components/fraktal/FraktalBatchResultsView.tsx`
Sortable table (filename, Az, El, Df, R², n_particles_counted — click header = ASC/DESC). Plotly bar chart using server-provided `bin_edges` + `counts`; hidden when `N < 5`. Comparison card (Component 10).

### Component 10: `FraktalComparisonCard.tsx` — NEW
**Location**: `frontend/src/components/fraktal/FraktalComparisonCard.tsx`
Three badges side-by-side: batch `mean ± std`, `target_df`, sim 3D box-counting Df. Fixed Sorensen note paragraph explaining the 2D/3D gap.

### Component 11: `api.ts` helper — MODIFIED
**Location**: `frontend/src/lib/api.ts`
Add `fraktalApi.analyzeBatch(projectId, file, options, onProgress)` + polling helper (reuse `simulationsApi.exportProjections` pattern, commit `a19a9e5`).

### Component 12: route pages — NEW / MODIFIED
- NEW `frontend/src/app/projects/[id]/fraktal/batch/page.tsx` — wraps `FraktalBatchUpload`.
- NEW `frontend/src/app/projects/[id]/fraktal/batch/[jobId]/page.tsx` — wraps `FraktalBatchResultsView` with async fetch.
- MODIFIED `frontend/src/app/projects/[id]/fraktal/new/page.tsx` — adds "Analyze a batch" CTA.

## Data shapes

### Request (POST `/analyze-batch/`, multipart)
```typescript
{
  file: File,                                            // ZIP
  pixels_per_100nm?: number,
  autocalibrate_dpo?: boolean,                           // default false
  algorithm: "granulated_2012" | "voxel_2018",
  sim_id?: string,
}
```

### Response (sync 200 or async final)
```typescript
{
  images: Array<{
    index: number; filename: string;
    azimuth: number | null; elevation: number | null;
    fractal_dimension: number | null; prefactor: number | null;
    r_squared: number | null; n_particles_counted: number | null;
    error: string | null;
  }>;
  stats: {
    n_images: number; n_successful: number;
    mean_df: number | null; std_df: number | null;
    median_df: number | null; q1_df: number | null; q3_df: number | null;
    min_df: number | null; max_df: number | null;
  };
  histogram: {
    bin_edges: number[]; counts: number[];
    rule_used: "freedman_diaconis" | "sturges";
  } | null;                                              // null when N < 5
  comparison: {
    sim_id: string | null; sim_name: string | null;
    sim_target_df: number | null; sim_box_counting_df: number | null;
    batch_mean_df: number | null; batch_std_df: number | null;
    sorensen_note: string;                               // fixed text
  } | null;
  calibration: {
    source: "metadata" | "manual" | "autocalibrate";
    pixels_per_100nm: number; dpo_used: number;
    autocalibrate_image: number | null;                  // 0 or N/2 if retried
  };
}
```

## Edge cases

- Corrupt / non-ZIP upload → 400.
- ZIP with 0 PNGs → 400.
- Mixed contents (PNGs + `metadata.json` + other) → filter to PNG only.
- `metadata.json` present but malformed → log warning, fall back to request scale or manual.
- Filename matches UUID but simulation is deleted → `comparison.sim_id = null` + warning field in response.
- All per-image analyses fail → stats = nulls, histogram null, comparison still rendered with `batch_mean_df = null`.
- `N = 1` → sync; `std = 0`; histogram null; valid row.
- Both request `pixels_per_100nm` AND metadata present → **request wins** (explicit user intent).
- Celery task interrupted mid-run → status endpoint returns `failed`; results endpoint returns 404.
- ZIP > 100 MB → backend rejects with 413 before processing.

## Backwards compatibility

- Legacy `POST /fractal-analysis/` single-image: URL, body, response, errors — unchanged.
- `/analyze-batch/` is additive.
- `FraktalAnalysis` model: unchanged (Medium scope does NOT persist batch results; view-and-forget via the task result file).
- Legacy frontend routes `/fraktal/new`, `/fraktal/{analysisId}` untouched; `/fraktal/batch` and `/fraktal/batch/{jobId}` are NEW.

## Testing strategy

| Layer | What to test | Approach |
|------|-------------|---------|
| Rust unit (`batch.rs`) | one-shot dpo on image[0] happy; image[0] fails→image[N/2] retries; double failure errors batch; per-image error does NOT fail batch; N=1 edge; empty input rejected | `#[test]` in `batch.rs` with fixture PNG bytes |
| PyO3 integration | round-trip Python→Rust→Python on a 3-image fixture batch | pytest against built wheel |
| Backend unit (`services/batch.py`) | ZIP extraction (standard, empty, no metadata); scale extraction (valid, missing, malformed); `sim_id` detection (match, non-match, partial); stats (full, partial-null, all-null); histogram (N<5→None, 5–9→Sturges, ≥10→FD) | pytest + parametrize |
| Backend integration | `/analyze-batch/` sync N=10 → 200; async N=50 → 202 + job_id; `/fraktal-status/` lifecycle; results streaming; corrupt ZIP 400; missing scale 400; legacy `/fractal-analysis/` snapshot unchanged | DRF APIClient |
| Frontend component | `FraktalBatchUpload` metadata badge vs manual scale input; `FraktalBatchResultsView` table sort + plotly render with mocked data; `FraktalComparisonCard` 3 metrics + fixed note | vitest + testing-library |
| Manual acceptance | export grid ZIP, upload to `/fraktal/batch`, verify auto-calibration + N Df results; confirm 2D<3D gap rendered | post-deploy |

## Open questions (for TASKS)

- Celery PROGRESS `stage` field values — align on the three phases (`autocalibrate`, `analyzing`, `aggregating`).
- Post-hoc comparison — allow user to re-pick `sim_id` AFTER results arrive? Probably out of Medium scope; confirm in tasks.
