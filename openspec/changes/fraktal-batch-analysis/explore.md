# Exploration: fraktal-batch-analysis

> Mode: sdd-explore · Tied to change `fraktal-batch-analysis` · Orchestrator locked Q1–Q4

## 1. Executive Summary

- **Current FRAKTAL UX is single-image, single-result.** The user uploads one PNG/JPEG or picks one (az, el) from a simulation and gets one `FraktalAnalysis` row with one Df. There is no batch, no distribution, no link back to the exporting simulation beyond the FK on `FraktalAnalysis.simulation`.
- **The Rust core (`aglogen_core::fractal::fraktal`) already matches the MATLAB `dimfrac2012` / `buscafractal2012` algorithm closely.** Same prefactor coefficients, same bisection structure, same `kf = a·Df² + b·Df + c`, same Jf coordination index formula, same Apo overlap formula. Both granulated_2012 and voxel_2018 entry points exist and are wired through PyO3. A batch mode is a loop + aggregation layer on top, not a new analyzer.
- **MATLAB has NO batch-of-images mode either** — it is a single-image GUI (`FRAKTAL.m` → `Tipo_fractal_build` → …). We are genuinely adding net-new behavior; there is no MATLAB reference for Q1-B.
- **The projection export already ships `pixels_per_100nm` and `scale_factor_nm` in `metadata.json`** (grid + fibonacci modes, commit `a19a9e5`). CORRECTION to the user brief: both values live under `metadata.parameters.*`, **not at the root**. This is a small but important contract detail for the new batch reader.
- **No existing backend endpoint accepts a ZIP.** The current `FraktalAnalysisCreateSerializer` expects either base64 image bytes (`uploaded_image`) or a `simulation_id` + `projection_params` (`simulation_projection`). We'll need a new entry point; the existing `FraktalAnalysis` row fits the per-image results but does not model the batch as a first-class entity.

Estimated effort for PROPOSE: **M (medium)** — no new science, mostly wiring + a new parent model + results aggregation UI.

## 2. Current FRAKTAL architecture in pyaglogen3D

### 2.1 Frontend (single-image)

- `frontend/src/app/projects/[id]/fraktal/new/page.tsx` — entry page, renders the form.
- `frontend/src/components/fraktal/FraktalAnalysisForm.tsx:1-599` — the whole wizard is ONE form with five `Card`s stacked vertically:
  1. Analysis Name
  2. Image Source (`uploaded_image` vs `simulation_projection` — mutually exclusive)
  3. Model (granulated_2012 vs voxel_2018)
  4. **Scale Calibration** (`FraktalAnalysisForm.tsx:327-483`) — "measure scale bar in pixels + its nm value" → computes `npix` (pixels per 100 nm). There is also a "Manual npix override" input. This is the calibration step the user wants to skip for our own ZIPs.
  5. Model Parameters + Segmentation (`delta`, `dpo`, `npo_limit`, `pixel_min`, `pixel_max`, `m_exponent`, `correction_3d`, `auto_calibrate`).
- `FraktalAnalysisForm.tsx:412-465` — **Autocalibrate dpo** is a boolean that routes the submission to `run_fraktal_auto_calibrate_task` instead of `run_fraktal_analysis_task`. It is a `dpo` sweep (not image-level), not a scale-bar autodetect. The user's note "Autocalibrate dpo" matches this, not a MATLAB Otsu-style image thresholding.
- `frontend/src/components/fraktal/FraktalResultsView.tsx:1-627` — single-analysis detail page. Renders `results.df`, `kf`, `npo`, etc. via `MetricsCard`. No histogram, no multi-row table.
- `frontend/src/app/projects/[id]/page.tsx` already shows a list of fraktal analyses at the project level (simple list, not grouped by batch).

### 2.2 Backend (Django)

- Models in `backend/apps/fractal_analysis/models.py:99-230`:
  - `FraktalAnalysis`: one row = one image = one Df. `source_type ∈ {uploaded_image, simulation_projection}`. Has `npix`, `escala`, `dpo`, `delta`, `correction_3d`, `pixel_min`, `pixel_max`, `npo_limit`, `m_exponent`, `auto_calibrate`. Projection params (`azimuth`, `elevation`, `resolution`) live in `projection_params` JSONField.
  - `ComparisonSet`: M2M to FraktalAnalysis — can be repurposed to group a batch, OR we can add a new `FraktalBatchAnalysis` parent model. See §6.
- Views in `backend/apps/fractal_analysis/views.py:94-199`:
  - `FraktalAnalysisViewSet.perform_create()` enqueues `run_fraktal_analysis_task` OR `run_fraktal_auto_calibrate_task` based on `auto_calibrate`, with sync fallback when Celery broker is down.
- Tasks in `backend/apps/fractal_analysis/tasks.py:124-525`:
  - `run_fraktal_analysis_task` (line 359): loads image (upload OR generates projection via `aglogen_core.project_to_2d(..., format="raw")`), converts to grayscale numpy, calls `aglogen_core.fraktal_granulated_2012(...)` or `fraktal_voxel_2018(...)`, stores results. **NOTE**: `tasks.py:402-408` still uses `format="raw"` — this is the historical path that Batch 2 of `stabilize-scientific-integration-contracts` centralized in `projection_contract.py`, see engram #266.
  - `run_fraktal_auto_calibrate_task` (line 124): identical but sweeps 4 `dpo` values (0.5×, 0.7×, 1.0×, 1.4×) and picks the one with best `|npo − npo_visual| / npo_visual` alignment.
- Serializers: `backend/apps/fractal_analysis/serializers.py` — `FraktalAnalysisCreateSerializer` accepts base64 image OR simulation_id, normalizes `projection_params.resolution` via the shared adapter.

### 2.3 Rust core (`aglogen_core`)

- `aglogen_core/engine/src/fractal/fraktal/mod.rs:1-20` re-exports:
  - `analyze_granulated_2012` (in `granulated_2012.rs:175-413`)
  - `analyze_voxel_2018` (in `voxel_2018.rs`)
- `granulated_2012.rs` implements the MATLAB `dimfrac2012` + `buscafractal2012` flow: smart segmentation (`image_processing::smart_segment`), geometry (`calculate_geometry` — computes `Ap`, `Rg`, pixel→nm conversion via `escala/npix`), visual particle count estimate (`estimate_particles_and_dpo`), 3D Rg correction (`apply_3d_correction_granulated`), prefactor coefficients (lines 57-145), iterative Df bisection with multiple `npo` initial estimates (lines 225-320).
- Input shape: `ArrayView2<u8>` — a raw grayscale image array. PyO3 binding accepts a numpy `u8` array.
- The segmentation is "smart" (auto threshold) — it already tolerates minor thresholding differences, so our PNG output from the renderer should not need preprocessing.

### 2.4 Projection export (source of our ZIPs)

- `backend/apps/simulations/services/projections.py:1-133` — ZIP assembly:
  - Filenames: `proj_{idx:03d}_Az{AAA}_El{±EEE}.png` (R4 of `projection-export-contract`).
  - `metadata.json` shape:
    ```json
    {
      "mode": "grid" | "fibonacci" | "legacy",
      "n_requested": N,
      "n_generated": N,
      "parameters": { "img_size": 512, "n_az": ..., "n_el": ..., "pixels_per_100nm": 492.31, "scale_factor_nm": 25.0 },
      "directions": [ { "index": 0, "filename": "...", "azimuth": 0.0, "elevation": -90.0 }, ... ]
    }
    ```
- `pixels_per_100nm` is **stamped in the endpoint** (`backend/apps/simulations/views.py:186-237` — `_stamp_scale_metadata`), based on the 3D axis-aligned bbox + max radius margin + 2% padding × `scale_factor_nm = dpo/2`. One scalar per aggregate (constant across directions) — this is exactly what FRAKTAL's `npix` parameter needs. See `docs/projections-export.md:83-108`.
- **Caveat**: the field is nested in `parameters`, not at the root. The user brief said "root-level" — the contract is actually `metadata["parameters"]["pixels_per_100nm"]`. Flag in §9 — Q1.
- **Caveat**: `pixels_per_100nm` is emitted for grid + fibonacci only. Legacy mode has no `metadata.json`. Batch mode must reject legacy ZIPs (or fall back to manual calibration).

## 3. MATLAB FRAKTAL reference

Location: `/home/juanjo/code/aglogen3D/FRAKTAL/` (READ-ONLY).

### 3.1 Structure

MATLAB FRAKTAL is a **single-image GUI** built with MATLAB's legacy uicontrol. Entry `FRAKTAL.m` → `Tipo_fractal_build.m` → language-specific wizards (`Datos_imagenes_*.m`) → analysis builder (`Datos_entrada_*.m`) → results (`salida_build.m`).

- **No batch mode** in MATLAB. Each run = one image.
- No CSV export of results, no histogram, no multi-image aggregation. The program is designed for TEM microscopists analyzing one micrograph at a time.
- The scale is input manually: the user types `escala` (nm) and `npix` (pixels corresponding to that scale bar) — same two fields the pyaglogen3D UI exposes today.

### 3.2 Algorithmic core (already ported to Rust)

- `dimfrac2012.m:1-183` — main per-image analyzer. Pseudocode:
  1. `a2 = roicolor(img, filmin=10, filmax=240)` — binarize (kept pixel range, not a true threshold). **Rust port** uses `smart_segment` with auto threshold — SUPERIOR (the MATLAB range fails on very dark/light images).
  2. Geometry: compute pixel count, CoM, radius of gyration in pixels, convert to nm via `longitud_pixel = escala/npix`.
  3. 3D Rg correction (empirical polynomial in `Rg`) if enabled.
  4. Call `buscafractal2012` (bisection in `dfmat = 1:0.05:3`) to find Df where `kf·(dp/dpo)^Df = (Ap/Apo)^zp`.
  5. Compute coordination index `Jf`, volume, mass, surface area from the converged Df.
- `buscafractal2012.m:1-114` — the bisection core. **Ported 1:1 to `granulated_2012.rs:57-413`** (I compared formulas side-by-side; all constants match: `A=1.85, B=0.0191, C=1.45, D=1.5, a=17, b=3.609, c=-0.3901, d=6.2`).
- `buscafractal2018.m` — voxel variant, ported to `voxel_2018.rs`.

### 3.3 What MATLAB does NOT have that the Rust port adds

- `estimate_particles_and_dpo` (visual particle count via connected-component analysis) → used for `npo_visual` alignment score, which powers the `auto_calibrate` dpo sweep. MATLAB has no equivalent.
- `smart_segment` with auto-threshold (Otsu-like) detection and dark-on-light vs light-on-dark auto-detection. MATLAB uses fixed `[filmin=10, filmax=240]` range.
- Multiple `npo_initial` estimates for robustness (lines 225-244) — the Rust version tries visual estimate ±30%, then geometric estimates. MATLAB only uses a single `npo=1000000` initial seed.

### 3.4 What the Rust port does NOT have that MATLAB has

- Per-image PDF/figure output (`salida_build.m`). Irrelevant for us; we render React components.
- Spanish/English language toggle in the GUI. Irrelevant.

## 4. Gap analysis (for batch)

| Capability | Today | Needed for batch | Effort |
|---|---|---|---|
| Per-image analyzer (Rust) | ✅ `analyze_granulated_2012` + `analyze_voxel_2018` | Reusable as-is. Call in a Python loop. | — |
| Auto scale from metadata | ❌ | Read `metadata.parameters.pixels_per_100nm`, set `npix` | S |
| Batch upload (ZIP) endpoint | ❌ | New `POST /api/v1/fractal/batch-analyze/` | M |
| Persistence (one row per image) | ✅ `FraktalAnalysis` | Per-image rows + a parent "batch" row | M |
| Parent aggregation model | ❌ | New `FraktalBatch` with FK on `Simulation`, reverse M2M to `FraktalAnalysis` | M |
| Results table | ❌ | New component `FraktalBatchTable` | S |
| Df histogram | ❌ | New component `FraktalDfHistogram` (reuse Recharts already in deps) | S |
| Comparison card (batch mean vs sim Df) | ❌ | New component reading `simulation.metrics.fractal_dimension` + `simulation.parameters.target_df` | S |
| CSV export of batch | ❌ | New endpoint `/batches/{id}/export-csv/` | S |
| Async processing (N large) | Partial (per-analysis Celery) | New Celery task operating on the whole batch | S |
| Fallback to manual Scale Calibration for ZIPs without metadata | N/A | Keep existing form, add error path when metadata missing | S |

## 5. Proposed batch upload flow (end-to-end)

### 5.1 User journey (locked Q1-B)

1. User is on `/projects/{id}/fraktal/new` (existing page) or a new `/projects/{id}/fraktal/new-batch` page.
2. User selects "Batch from simulation ZIP" (new tab/option). Uploads the ZIP.
3. Frontend validates quickly client-side: ZIP structure, presence of `metadata.json`, mode ∈ {grid, fibonacci}. If legacy or malformed: error + offer fallback to manual flow.
4. Frontend POSTs the ZIP to `/api/v1/projects/{project_id}/fractal/batch-analyze/` together with:
   - `model`: `granulated_2012` | `voxel_2018`
   - `dpo`: user-supplied (mandatory for granulated_2012 unless `auto_calibrate` is on)
   - `delta`, `correction_3d`, `pixel_min`, `pixel_max`, `npo_limit`, `m_exponent`, `escala`, `auto_calibrate` — same defaults as current form
   - `simulation_id`: optional but recommended — enables the comparison card (Q4)
5. Backend creates `FraktalBatch(status=QUEUED, n_requested=N)` + N `FraktalAnalysis` rows with `source_type=BATCH_PROJECTION`, `batch=<parent>`, per-image `projection_params={azimuth, elevation}` from `directions[]`, and `npix = pixels_per_100nm` from metadata.
6. Small N (≤ 30 or configurable): sync execution in the request. Large N (> 30): Celery task `run_fraktal_batch_task` with per-image subtasks; return `202 {batch_id}`.
7. Frontend polls `/api/v1/projects/{project_id}/fractal/batches/{batch_id}/` every 2 s (same polling helper already used in `FraktalResultsView.tsx:58-71`).
8. When complete, UI navigates to `/projects/{id}/fraktal/batches/{batch_id}` showing (Q3-C):
   - **Comparison card** (top): batch mean Df ± std, `simulation.metrics.fractal_dimension` (3D box-counting), `simulation.parameters.target_df`, short explainer note (Q4).
   - **Histogram** (left/top): Df distribution with mean/std overlay.
   - **Table** (right/bottom): sortable cols — index, az, el, Df, kf, npo, R² proxy (if we compute it), status, thumbnail link.
   - **CSV export** button.

### 5.2 UX fallbacks

- **No metadata.json → manual calibration**: redirect the user to the existing `FraktalAnalysisForm` with all images still attached but each as an individual analysis, or reject with a clear error. Recommended: reject with a message directing user to re-export with grid/fibonacci mode. Don't silently degrade scientific rigor.
- **Auto-calibrate dpo in batch**: for N > 1 we can run it on ONE image (e.g. az=0, el=0 if present, else index 0) and reuse the selected `dpo` for the whole batch. Alternative: per-image auto-calibrate (4N Rust calls, expensive). Recommended: single-image calibration shared across batch. Defer to PROPOSE.

## 6. Backend integration points

### 6.1 Endpoint

- `POST /api/v1/projects/{project_id}/fractal/batch-analyze/` — accepts `multipart/form-data`:
  - `zip_file`: the ZIP blob
  - `model`, `dpo`, `delta`, … all fraktal params as JSON in a `params` field
  - `simulation_id` (optional — link back for comparison)
  - `name` (optional — batch label)
- Response:
  - `201 {batch}` if sync (N ≤ threshold)
  - `202 {batch_id, status: "queued"}` if async
- `GET /api/v1/projects/{project_id}/fractal/batches/{batch_id}/` — batch detail + all child analyses.
- `GET /api/v1/projects/{project_id}/fractal/batches/{batch_id}/export-csv/` — streaming CSV.

### 6.2 Model

Option A (recommended): New `FraktalBatch` model.

```python
class FraktalBatch(models.Model):
    id = UUIDField(primary_key=True, default=uuid.uuid4)
    project = FK(Project)
    name = CharField(blank=True)
    simulation = FK(Simulation, null=True, SET_NULL)  # for comparison
    # Input metadata
    mode = CharField(choices=[grid, fibonacci])
    n_requested = PositiveIntegerField()
    pixels_per_100nm = FloatField()
    scale_factor_nm = FloatField()
    # Shared params (mirrors FraktalAnalysis)
    model = CharField(choices=[granulated_2012, voxel_2018])
    dpo = FloatField(null=True)
    delta = FloatField(default=1.1)
    correction_3d = BooleanField(default=False)
    pixel_min = PositiveSmallIntegerField(default=10)
    pixel_max = PositiveSmallIntegerField(default=240)
    npo_limit = PositiveIntegerField(default=5)
    m_exponent = FloatField(default=1.0)
    escala = FloatField(default=100.0)
    auto_calibrate = BooleanField(default=False)
    # Aggregated results (computed when all children done)
    df_mean = FloatField(null=True)
    df_std = FloatField(null=True)
    df_min = FloatField(null=True)
    df_max = FloatField(null=True)
    kf_mean = FloatField(null=True)
    n_successful = PositiveIntegerField(default=0)
    n_failed = PositiveIntegerField(default=0)
    status = CharField(choices=AnalysisStatus)
    # ... timestamps
```

- Add `FraktalAnalysis.batch = FK(FraktalBatch, null=True, related_name="analyses", on_delete=CASCADE)`.
- Add `SourceType.BATCH_PROJECTION` choice.
- Reuse existing `ComparisonSet.fraktal_analyses` if user wants to group across batches.

Option B: reuse `ComparisonSet` + a tag. Less clean; the batch has its own lifecycle (queued/running), not just a tag.

**Recommendation**: Option A.

### 6.3 Celery task

- New `run_fraktal_batch_task(batch_id)`:
  1. Load batch row.
  2. Open ZIP, parse `metadata.json`, validate.
  3. For each PNG:
     - Read into numpy via PIL → `u8` grayscale.
     - Build `FraktalAnalysis` row (or pre-create all of them with status=QUEUED before this loop, which makes progress queryable).
     - Call `aglogen_core.fraktal_granulated_2012(...)` / `fraktal_voxel_2018(...)`.
     - Persist per-image results.
  4. When loop ends: compute aggregates (mean, std, min, max over successful `df` values), save batch.
- **Threshold for sync vs Celery**: propose 30 images (≈ 30 × 2 s per analysis ≈ 60 s — right at the edge of sync-acceptable). Legacy threshold from `projections-export-fix` was 200 — keep batch lower because each image is heavier than a projection render. Lock in PROPOSE.

### 6.4 PyO3 considerations

- Per-image loop in Python is fine. Each Rust call takes 200 ms – 2 s. For N=100, that's 20 s – 3 min serial. Parallelizing at the Rust side (Rayon) could help for large batches but is out of scope — Python-side thread pool is simpler and reuses the existing Celery worker pool.

## 7. Frontend changes

### 7.1 Entry point

Option A: Add a "Batch mode" tab on `/projects/{id}/fraktal/new` — toggle at the very top of the form, switches between "Single image" (existing) and "Batch from ZIP" (new).

Option B: New dedicated page `/projects/{id}/fraktal/new-batch`.

**Recommendation**: Option A (tab). Keeps navigation simple; users find both paths from one screen.

### 7.2 New components

- `components/fraktal/FraktalBatchUpload.tsx` — ZIP upload + metadata preview (show `n_generated`, `pixels_per_100nm`, `simulation_id` once detected).
- `components/fraktal/FraktalBatchTable.tsx` — sortable table; reuse Radix/Shadcn `Table`.
- `components/fraktal/FraktalDfHistogram.tsx` — Recharts bar chart with mean ± std overlay. Recharts is already a dep (see `chart` components directory).
- `components/fraktal/FraktalComparisonCard.tsx` — shows batch mean Df, sim 3D Df, sim target Df, explainer text per Q4. Lives on both the batch detail page AND optionally as a tab on the simulation detail page (stretch goal, defer).
- `app/projects/[id]/fraktal/batches/[batchId]/page.tsx` — batch detail route.

### 7.3 Types

Add to `lib/types.ts`:

```ts
export interface FraktalBatch {
  id: string
  name?: string
  simulation_id?: string
  mode: 'grid' | 'fibonacci'
  n_requested: number
  n_successful: number
  n_failed: number
  pixels_per_100nm: number
  df_mean?: number
  df_std?: number
  df_min?: number
  df_max?: number
  status: AnalysisStatus
  analyses: FraktalAnalysis[]
  created_at: string
}
```

### 7.4 Hooks

- `useFraktalBatch(projectId, batchId)` — GET + polling while queued/running.
- `useCreateFraktalBatch(projectId)` — POST multipart.
- `useFraktalBatches(projectId)` — list.

## 8. Testing strategy

### 8.1 Rust

- No new tests needed in `aglogen_core` — we reuse `analyze_granulated_2012` / `analyze_voxel_2018`. Existing tests in `integration_tests.rs` cover correctness.

### 8.2 Backend

- `backend/tests/test_fraktal_batch.py`:
  - `test_batch_accepts_valid_grid_zip` — ZIP with metadata + 32 PNGs → 32 `FraktalAnalysis` rows + 1 `FraktalBatch` with mean Df reported.
  - `test_batch_rejects_legacy_zip` — ZIP without `metadata.json` returns 400 with clear error.
  - `test_batch_uses_pixels_per_100nm_from_metadata` — `FraktalAnalysis.npix == metadata.parameters.pixels_per_100nm` for each child.
  - `test_batch_links_simulation` — when `simulation_id` passed, `FraktalBatch.simulation_id` set AND the comparison card fields are queryable.
  - `test_batch_aggregates_df_mean_std` — mean/std of successful children match numpy reference.
  - `test_batch_sync_vs_async` — N ≤ threshold returns 201; N > threshold returns 202 + job_id.
  - `test_batch_failed_images_counted` — 2 failing images out of 10 → `n_failed=2, n_successful=8, status=COMPLETED` (batch completes even with partial failures).
  - `test_batch_csv_export` — per-image rows + summary header.

### 8.3 Frontend

- `FraktalBatchUpload.test.tsx` — drag-drop ZIP, reject non-ZIP, parse `metadata.json` client-side to show preview, error when mode=legacy.
- `FraktalBatchTable.test.tsx` — sorting by each column.
- `FraktalDfHistogram.test.tsx` — bucket count correctness.
- `FraktalComparisonCard.test.tsx` — renders the three Df values and the explainer.

## 9. Open questions for the user (≤ 3; Q1–Q4 already locked)

1. **Metadata location mismatch**: the brief says `pixels_per_100nm` is root-level, but in the actual contract it lives in `metadata.parameters.pixels_per_100nm`. Confirm we read the nested path, OR add a migration to duplicate the key at root for convenience (non-breaking). Recommended: read nested, no duplication.
2. **Async threshold**: sync for N ≤ ? before we go to Celery. Projection export chose 200 projections; FRAKTAL analysis is heavier per item (~10–50× slower than a render). Options: 30 (conservative), 50 (balanced), 100 (optimistic, relies on request timeout tolerance). Recommended: 30.
3. **Auto-calibrate in batch**: run on ONE representative image (index 0 or az=0/el=0) and reuse `dpo` for the whole batch, OR run per-image (4N Rust calls)? Recommended: single-image calibration, apply to all. Defer multi-image calibration to a future enhancement.

## 10. Recommendations for PROPOSE

### Scope options (pick one for the proposal)

**Minimal (S — ~2 days):**
- New `FraktalBatch` model + sync-only endpoint (N ≤ 30 enforced).
- Backend reads `metadata.parameters.pixels_per_100nm`.
- Basic UI: upload + results table only (no histogram, no comparison card).
- No `simulation_id` linkage.
- Tests: happy path + one error case.

**Medium (M — ~5 days, recommended):**
- Everything in Minimal.
- PLUS histogram (Recharts).
- PLUS comparison card wired to `simulation.metrics.fractal_dimension` + `simulation.parameters.target_df` (Q4).
- PLUS Celery async path with polling (reuse `projections-export-fix` pattern).
- PLUS CSV export.
- PLUS auto-calibrate single-image-then-apply-to-batch.
- Tests: happy path + legacy rejection + simulation linkage + aggregate correctness + CSV shape.

**Full (L — ~10 days):**
- Everything in Medium.
- PLUS cross-reference: FRAKTAL batch mean Df displayed on the Simulation detail page as a new "Projection-based Df" card (bidirectional link).
- PLUS per-image thumbnails in the batch table (pre-extracted from the ZIP during ingestion).
- PLUS comparison: `ComparisonSet` can now include a `FraktalBatch` directly instead of individual analyses.
- PLUS histogram kernel density overlay (scipy/gaussian) next to the bar histogram.
- Tests: full matrix including visual regression on the histogram component.

**Recommendation**: **Medium**. Delivers the full Q3-C + Q4 UX without over-engineering the cross-reference (which can land in a follow-up change). Matches the user's scientific integrity priority (pixels-per-100nm auto-calibration from metadata — no silent fallback) without bloating the feature surface.

## Ready for Proposal

**Yes.** One blocker to surface before PROPOSE: the root-level vs nested `pixels_per_100nm` discrepancy (Q1). Everything else can proceed with the recommended defaults. The orchestrator should confirm Q1 in a short exchange with the user (it's a 1-line answer), then launch `sdd-propose` with scope=Medium.
