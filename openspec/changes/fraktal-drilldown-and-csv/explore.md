# Exploration: fraktal-drilldown-and-csv

## 1. Executive Summary

- **The batch flow has NO server-side persistence for sync runs.** When `N ≤ 30`,
  `analyze_batch` returns the full payload inline and the frontend holds it in
  React state (`useState<FraktalBatchResult>` in `app/projects/[id]/fraktal/batch/page.tsx:28`).
  No DB row, no JSON on disk. **A bookmarkable `/batch/{jobId}/image/{index}` URL
  cannot work for sync batches without backend persistence.**
- **Async batch results DO persist** as `{MEDIA_ROOT}/fraktal_batches/{task_id}.json`
  (`tasks.py:704`). They are served unauthenticated-by-job-id via
  `GET /api/v1/fraktal-status/{job_id}/results/` (`views.py:598`) but expire only
  with the file (no cleanup policy visible).
- **Per-image rendered PNGs are NOT stored.** Batch input bytes are decoded once
  via PIL into numpy arrays and discarded after the Rust call. The async task
  base64-encodes the **raw numpy buffer** into the Celery args (`views.py:295`)
  but neither the source PNG nor the rasterized image is written alongside the
  result JSON. Drill-down image previews require either re-storing them or
  reconstructing from the Rust-side data we don't currently expose.
- **Per-image diagnostics gap is severe.** The single-image flow stores
  `rg, ap, df, npo, npo_visual, kf, zf, jf, volume, mass, surface_area,
  status, model, npo_ratio, npo_aligned, dpo_estimated` plus calibration
  attempts (`tasks.py:529-546`). Batch per-image stores only
  `fractal_dimension, prefactor (kf), r_squared, n_particles_counted, error`
  plus filename/az/el (`views.py:447-463`). No Rg, Ap, npo_visual, alignment,
  no per-image dpo, no calibration attempts. The Rust binding
  `analyze_fraktal_batch` may compute more — needs a Rust-layer audit before
  finalizing — but the Python contract today drops it.
- **CSV locale infra is ready to reuse.** `_get_user_csv_locale` and
  `_write_localized_row` in `apps/simulations/views.py:90-133` are already
  battle-tested by 15 simulation tests. The User model has
  `csv_decimal_separator` and `csv_column_delimiter` (`accounts/models.py:83`).
  We should hoist these helpers to a shared module rather than duplicate
  them in `fractal_analysis/views.py`.

**Most important architectural decision flagged:**
> Drill-down quality is bounded by what we persist, not by what we render.
> Pick the persistence model FIRST (re-store batch as a `BatchJob` DB entity vs
> reuse the JSON-on-disk pattern vs metrics-only-no-image), then design URL +
> UI. Everything else follows.

---

## 2. Current Architecture

### 2.1 Single-image FRAKTAL flow

**Backend**
- Model: `FraktalAnalysis` (`backend/apps/fractal_analysis/models.py:99-230`).
  Persists `original_image` (BinaryField), `results` (JSONField with full
  metric set), `error_message`, `npix`, `dpo`, `delta`, `pixel_min/max`,
  `escala`, etc.
- Endpoint: `POST /api/v1/projects/{project_id}/fraktal/` →
  `FraktalAnalysisViewSet.perform_create` (`views.py:131-151`) which spawns
  `run_fraktal_analysis_task` or `run_fraktal_auto_calibrate_task`.
- Detail GET: `GET /api/v1/projects/{project_id}/fraktal/{id}/` returns the
  full `FraktalAnalysis` row including `results` JSON.
- Auto-calibration: `tasks.py:171-420` tries 4 dpo values, stores
  `calibration_attempts` array per attempt with `dpo, npo, npo_ratio,
  npo_aligned`.
- Image serving: `GET .../{id}/original_image/` (`views.py:340-359`).
- Re-run: `POST .../{id}/rerun/` (`views.py:361-392`).

**Frontend**
- Form: `frontend/src/components/fraktal/FraktalAnalysisForm.tsx`
- Results page: `app/projects/[id]/fraktal/[analysisId]/page.tsx` →
  `FraktalResultsView.tsx`. Renders 7 cards (status header, image,
  primary metrics Df/kf/npo/zf, geometry Rg/Ap/Jf, physical
  volume/surface/mass, parameters, auto-calibration table, projection
  params, NPO mismatch warning, comparison re-run UI).

### 2.2 Batch flow (sync, N ≤ 30)

**Request → Response in one HTTP call:**
1. `POST /api/v1/projects/{project_id}/fraktal/analyze-batch/`
   (`views.py:170-338`).
2. `extract_zip_images` → numpy arrays + metadata + filenames
   (`services/batch.py`).
3. Calibration resolution (`views.py:210-234`).
4. `_run_batch_sync` calls `aglogen_core.analyze_fraktal_batch(images,
   scale, autocalibrate_dpo, dpo_hint, algorithm)` exactly once
   (`views.py:488-515`).
5. `_build_batch_response` shapes Rust output into the contract
   (`views.py:426-485`).
6. **Returns 200 with the full payload inline. Nothing is persisted.**

**Frontend**
- `app/projects/[id]/fraktal/batch/page.tsx:28` holds result in
  `useState`. Refresh page → result is gone.
- `FraktalBatchResultsView.tsx` renders stats, histogram, sortable table,
  comparison card.
- Each row shows `index, filename, az, el, fractal_dimension, prefactor,
  r_squared, n_particles_counted` plus an `error` tooltip.

### 2.3 Batch flow (async, N > 30)

1. Same endpoint returns `202 {"job_id": <celery-task-id>}` (`views.py:298-338`).
2. `analyze_fraktal_batch_task` runs in Celery (`tasks.py:600-717`).
3. Result JSON written to `{MEDIA_ROOT}/fraktal_batches/{task_id}.json`.
4. Polling: `GET /api/v1/fraktal-status/{job_id}/` returns processing /
   done / failed.
5. Done payload includes `results_url:
   /api/v1/fraktal-status/{job_id}/results/` which streams the JSON
   (`views.py:596-621`).
6. Frontend polls via `pollFraktalBatchUntilDone`
   (`frontend/src/lib/api.ts:763-794`) and resolves with
   `FraktalBatchResult` — same shape as sync.

> Async results survive across reloads as long as the file exists. The
> `job_id` is a Celery task UUID and is the closest thing we have to a
> stable batch identifier today, but it's not surfaced to the user
> anywhere — the frontend uses it transparently and discards it after
> polling completes.

---

## 3. Data Gap Analysis

### 3.1 What single-image stores vs what batch stores per image

| Field | Single-image | Batch per-image |
| --- | :---: | :---: |
| `df` (fractal_dimension) | ✅ | ✅ |
| `kf` (prefactor) | ✅ | ✅ |
| `r_squared` | ❌ (not stored) | ✅ |
| `npo` (n_particles_counted) | ✅ | ✅ |
| `npo_visual` | ✅ | ❌ |
| `npo_ratio`, `npo_aligned` | ✅ | ❌ |
| `dpo_estimated` (per-image) | ✅ | ❌ (one batch-wide `dpo_used`) |
| `rg` (radius of gyration) | ✅ | ❌ |
| `ap` (projected area) | ✅ | ❌ |
| `zf`, `jf` | ✅ | ❌ |
| `volume`, `surface_area`, `mass` | ✅ | ❌ |
| `status` (success/failed string) | ✅ | partial (just `error` string) |
| `model` (granulated_2012/voxel_2018) | ✅ | ❌ (one batch-wide `algorithm`) |
| `execution_time_ms` per image | ✅ | ❌ |
| `engine_version` | ✅ | ❌ |
| `calibration_attempts` (auto-cal) | ✅ | ❌ (no per-image auto-cal) |
| `error_message` | ✅ (free text) | ✅ (`error`) |
| Original PNG bytes | ✅ (BinaryField) | ❌ |
| Processed/segmented image | ❌ (single also doesn't) | ❌ |
| Projection parameters | ✅ (sim source) | partial (`azimuth`, `elevation` only) |

### 3.2 Implications

- A batch drill-down view that **re-uses `FraktalResultsView` as-is is impossible**:
  half of the cards (geometry Rg/Ap/Jf, physical volume/surface/mass,
  auto-calibration, NPO mismatch warning) need fields the batch doesn't have.
- Drill-down can do one of three things (see §4).

### 3.3 Rust binding open question

Does `aglogen_core.analyze_fraktal_batch` already compute the missing
fields per image and we're just not surfacing them? **Action item:**
inspect the `aglogen_core` extension's batch return shape and
`_build_batch_response`'s loss surface. If the Rust layer already
returns rg/ap/zf/etc. per image, this turns from a Rust-change
problem into a Python-mapping problem (very cheap).

---

## 4. Drill-down Options

### Option A — Re-run analysis on drill-down (no persistence)

Drill-down endpoint accepts `(jobId, index)` and pulls the original
image bytes from… nowhere. We don't keep them. **Not viable** unless we
also persist images.

### Option B — Persist batch results in DB (recommended)

Introduce a `FraktalBatch` model (or a typed JSON wrapper around
existing `FraktalAnalysis`) that stores:
- `id` (UUID, replaces Celery's `job_id` in URLs)
- `project` FK
- `created_at`, `completed_at`
- `calibration` (JSON), `algorithm`, `n_images`, `n_successful`
- `images` (JSON list with full per-image data — see §3.1 ideal shape)
- Optional: `image_blobs` (separate table or BinaryField list) for
  drill-down previews. **Heavier but enables full UX.**

URLs:
- Sync path persists, returns `{batch_id}` + the inline payload (no UX change).
- Async path persists too; `job_id` becomes a Celery transient and the
  caller maps it to `batch_id` before navigating.

**Pros:**
- True bookmarkable URL: `/projects/{id}/fraktal/batch/{batchId}/image/{index}`.
- Survives compaction, refresh, share-link.
- Enables future history view ("past batches").
- Migration path from JSON-on-disk: import existing files on first read.

**Cons:**
- DB schema migration.
- Storage cost: a 100-image batch stores ~100 PNGs (~10MB).
- Need a retention policy or batch deletion endpoint.
- Possible permission rework.

**Effort: Medium.**

### Option C — Reuse the JSON-on-disk pattern for sync too

Force every batch (sync OR async) through the same persisted-JSON path:
the sync handler still returns 200 with the inline payload, but ALSO
writes `{batch_id}.json` to disk and (optionally) a sibling
`{batch_id}_images/` dir with the source PNGs.

URL: `/projects/{id}/fraktal/batch/{batchId}/image/{index}` reads from
disk on demand.

**Pros:**
- No DB change.
- Works for both paths uniformly.
- Cheap.

**Cons:**
- Disk-as-DB: no project FK, no permission check, no easy listing,
  brittle on container restarts unless on persistent volume.
- Cleanup is manual.
- Does not scale to multi-instance deploys without shared FS.

**Effort: Low.**

### Option D — Metrics-only drill-down (no image preview)

Render drill-down ONLY from the per-image entry already in the result
payload. No image preview. Failed-image drill-down shows error text +
filename + index.

URL: `/projects/{id}/fraktal/batch/{batchId}/image/{index}` reads from
the same persisted JSON (still requires Option B or C).

**Pros:**
- Half the work of Option B; no image storage.
- Acceptable if users mostly want "why did this image fail?" or "what
  exact Df did image #17 produce?".

**Cons:**
- User asked for "same level of analysis as single-image flow" — that
  includes the image preview. This is a downgrade from that promise.

**Effort: Low.**

### Recommendation

**Option B (DB-backed `FraktalBatch`) for the M scope, with
image-blob storage gated behind a setting** so we can ship metrics-only
first and add previews in a follow-up. Use `batch_id = UUID` as the URL
slug, drop the Celery `job_id` from user-facing URLs.

Fallback if scope must shrink: **Option C** (JSON-on-disk for both
paths) gets us bookmarkable URLs in days, not weeks, at the cost of
cleanup tech debt.

---

## 5. CSV Export Integration

### 5.1 What already exists (reuse, don't rewrite)

- `apps/accounts/models.py:83-92` — User model has
  `csv_decimal_separator` ('.', ',') and `csv_column_delimiter`
  (',', ';', '\\t'). UI already exposes these in the user prefs serializer.
- `apps/simulations/views.py:80-133` — three helpers:
  - `_get_user_csv_locale(request) -> (decimal, delimiter)` with
    safe fallbacks.
  - `_localize_numeric_cell(cell, decimal)` — only rewrites pure
    numeric cells.
  - `_write_localized_row(writer, row, decimal)` — drop-in helper.
- 15 passing tests in `apps/simulations/tests/test_csv_export_locale.py`.

### 5.2 Recommended path

Hoist the three helpers into `apps/common/csv_locale.py` (or
`apps/accounts/csv_locale.py`) and import from both sims and fraktal.
Avoid copy-pasting them into `fractal_analysis/views.py`.

### 5.3 Endpoints to add

- `GET /api/v1/projects/{pk}/fraktal/{analysisId}/export_csv/` — single
  image. One row matching the locked column list.
- `GET /api/v1/projects/{pk}/fraktal/batch/{batchId}/export_csv/` —
  batch. One row per image with the locked column list (full +
  comparison).

Both:
- Use `_get_user_csv_locale(request)`.
- `Content-Disposition: attachment; filename=fraktal_{...}.csv`.
- Pre-format floats as f-strings (`f"{value:.4f}"`) to keep
  `_localize_numeric_cell` predictable.

### 5.4 Locked column list (recap from user spec)

**Batch CSV** — one row per image:
1. `index`
2. `filename`
3. `azimuth`
4. `elevation`
5. `fractal_dimension`
6. `prefactor` (kf)
7. `r_squared`
8. `n_particles_counted`
9. `error`
10. `dpo_used` *(batch-wide value, repeated per row)*
11. `autocalibrate_source` (calibration.source)
12. `scale_factor_nm` *(derived from `pixels_per_100nm`)*
13. `pixels_per_100nm`
14. `sim_id`
15. `sim_target_df`
16. `sim_box_counting_df`

**Single-image CSV** — one row with the equivalent metric values +
calibration + sim comparison if available.

> Open question: for single-image, do we also include the geometry
> (rg, ap) and physical (volume, mass, surface_area) columns? The
> "comparison" subset suggests no, but they're the most useful single-
> image fields.

---

## 6. Failure UX

### 6.1 What batch errors look like today

- `_build_batch_response` at `views.py:461` populates `error` with
  whatever the Rust layer returns (string, may be empty for success).
- Frontend `FraktalBatchResultsView.tsx:224` renders `<tr title={error}>`
  so it's a hover-only tooltip. No traceback, no details.
- Rust-layer messages observed in tests: `"bisection_failed"`,
  `"insufficient_particles"`, `"npo_below_limit"`. Short, machine-y.

### 6.2 Drill-down failure rendering

Failed-image drill-down shows:
- Big "Failed" status badge.
- Error string (mapped to a human-readable message via a small
  dictionary — `bisection_failed` → "Bisection algorithm did not
  converge", etc.).
- Filename + index + az/el (already in the entry).
- Whatever partial data IS present (e.g. n_particles_counted is sometimes
  populated even on failure).
- **If we adopt Option B with image blobs**, also show the input image so
  the user can eyeball "is this image clearly broken?".
- Optional "diagnostics" expander: `npo_ratio`, `npo_visual`, etc.,
  IF the Rust layer surfaces them on failure.

### 6.3 Reasonable next step on failure

Add a "Re-analyze this image individually" button on the drill-down
page. It posts to the existing single-image endpoint with the cached
PNG bytes (Option B/C only) and the same calibration. Routes to the
single-image results page, which already has the full diagnostic
toolkit.

---

## 7. Backend Changes Needed

### 7.1 Minimum viable (Option B + metrics-only)

1. **New model** `FraktalBatch` (Project FK, JSON results, calibration,
   timestamps, status, owner permissions inherited).
2. **Migration** for the new table.
3. **Modify** `analyze_batch` (`views.py:170`) to create a
   `FraktalBatch` row before computing, return `batch_id` instead of
   inline-only payload. Inline payload still returned for
   backward-compat with the current frontend, but now also persists.
4. **Modify** `analyze_fraktal_batch_task` to write to the same model
   instead of (or in addition to) JSON-on-disk.
5. **New endpoint** `GET /api/v1/projects/{pk}/fraktal/batch/{batchId}/`
   — full batch payload.
6. **New endpoint** `GET /api/v1/projects/{pk}/fraktal/batch/{batchId}/image/{index}/`
   — single-image-from-batch detail. Returns the per-image entry plus
   a stable shape that `FraktalResultsView` can adapt to (or a new
   sibling component consumes).
7. **New endpoint** `GET /api/v1/projects/{pk}/fraktal/batch/{batchId}/export_csv/`
   — locale-aware CSV.
8. **New endpoint** `GET /api/v1/projects/{pk}/fraktal/{analysisId}/export_csv/`
   — single-image CSV.
9. **Hoist CSV locale helpers** to a shared module.
10. **Optional (image previews)**: `BinaryField` per image OR sibling
    `FraktalBatchImage` model with `(batch FK, index, original_png)` +
    streaming endpoint.

### 7.2 Audit needed (no code change yet)

- Rust binding: does `analyze_fraktal_batch` return more per-image
  fields than `_build_batch_response` currently extracts? If yes,
  expand the per-image shape with NO Rust change.

---

## 8. Frontend Changes Needed

### 8.1 New route

```
app/projects/[id]/fraktal/batch/[jobId]/image/[index]/page.tsx
```

> Route segment name `jobId` from the user spec is preserved for
> backward-compat with the conversation, but **the value should be the
> persisted `batch_id`, not Celery's task id**. Recommend renaming the
> segment to `[batchId]` for clarity.

### 8.2 New or reused component?

**Recommendation: NEW component** `FraktalBatchImageDetail.tsx`
that:
- Fetches `/api/v1/projects/{pk}/fraktal/batch/{batchId}/image/{index}/`.
- Renders a **subset** of `FraktalResultsView`'s cards based on what's
  available — guarded by `if (data.rg !== undefined)` etc.
- Has its own failure card.
- Has its own "Open original single-image flow with this image"
  button (Option B persistence required).
- Reuses MetricsCard, StatusBadge, comparison card primitives.

Reusing `FraktalResultsView` directly would force us to extend the
`FraktalAnalysis` type with `null`-safe everything; cleaner to keep
the two views separated and share **primitive cards**, not the
container.

### 8.3 Make the existing batch page persist

Currently `app/projects/[id]/fraktal/batch/page.tsx` is upload-only.
Add a `[batchId]/page.tsx` that fetches by id and renders
`FraktalBatchResultsView`. Make table rows clickable (navigate to
`./image/{index}/`). The current upload form keeps pushing to
`/{batchId}/` after success.

### 8.4 CSV download buttons

- `FraktalResultsView`: button → `GET .../{analysisId}/export_csv/`.
- `FraktalBatchResultsView`: button → `GET .../batch/{batchId}/export_csv/`.

Both authenticated via `authFetch`, response saved with browser file
download (existing helper in `lib/api.ts` if there is one — TODO check).

---

## 9. Open Questions for the User

1. **Image preview in drill-down**: spend the storage on persisting per-
   image PNGs (~10MB per 100-image batch) so drill-down shows the
   image, or ship metrics-only first and add previews behind a
   feature flag in a follow-up?

2. **Single-image CSV scope**: include geometry (rg, ap) and physical
   (volume, mass, surface_area) columns, or keep strictly to the
   "metrics + calibration + comparison" subset implied by the batch
   column list?

3. **Batch retention**: `FraktalBatch` rows + (optional) image blobs
   could grow unbounded. Auto-delete after N days? Keep all and add
   manual delete? Match the policy of `FraktalAnalysis` (which has
   no TTL today)?

4. **Re-analyze on drill-down**: should the "Re-analyze this image"
   button on a drill-down page create a new persistent
   `FraktalAnalysis` row (full single-image flow, full diagnostics,
   shows up in the project's analyses list), OR run a transient
   analysis and only show comparison data inline?

---

## 10. Recommendations for PROPOSE

### Scope S — "Bookmarkable batch + CSV, no drill-down image"
- JSON-on-disk persistence for sync batch (Option C).
- New routes: `app/projects/[id]/fraktal/batch/[batchId]/page.tsx`
  (fetches persisted JSON), `.../image/[index]/page.tsx` (metrics-only).
- Single-image and batch CSV endpoints + locale helpers hoisted.
- No DB schema change.
- **Effort: ~3–4 days.**
- **Trade-off: no image preview in drill-down, brittle on container restarts.**

### Scope M — "Drill-down + CSV, no image previews" *(recommended)*
- New `FraktalBatch` model (Option B) without `image_blobs`.
- All endpoints from S, plus `/batch/{batchId}/image/{index}/`.
- New `FraktalBatchImageDetail` component renders metrics + failure UX
  + comparison sims, but no original-PNG card.
- "Re-analyze with single-image flow" button uses cached metadata
  only (no image bytes; user re-uploads if needed).
- **Effort: ~6–8 days.**
- **Trade-off: drill-down won't show the image until M+ ships.**

### Scope L — "Full drill-down with image previews"
- Everything in M plus per-image PNG persistence (`FraktalBatchImage`
  side table + streaming endpoint).
- Drill-down has image card and "Re-analyze in single-image flow"
  works end-to-end without re-upload.
- Retention policy + delete endpoint.
- **Effort: ~10–14 days.**

> **My recommendation: scope M.** The image preview is nice but the
> batch table already shows enough to triage; the user can always go
> to the single-image flow with a manual re-upload until L lands. M
> gets us the bookmarkable URL, the full per-image metric set, the
> CSV exports, and a clean failure UX without the storage churn of L.
