# Spec: fraktal-batch-persistence

## Purpose

Defines observable behavior for DB-backed FRAKTAL batch persistence: `FraktalBatch` + `FraktalBatchImage` models, drill-down endpoints, per-image PNG access, re-analyze, and manual delete. Replaces JSON-on-disk batch results with first-class artifacts owned by `Project` + `User`.

Context: `../proposal.md`, `../explore.md`. Companion delta: `./fraktal-batch-contract-delta.md`.

This spec describes **observable behavior** — HTTP contracts and persistence guarantees — not internal implementation.

## Requirements

### R1. FraktalBatch row records project, user, and summary metadata

**GIVEN** a batch upload completes (sync or async),
**WHEN** persistence runs,
**THEN** a `FraktalBatch` row exists with: `project` (FK), `created_by` (FK to `User`), `batch_id` (uuid), `algorithm`, `calibration_source`, `n_images`, `n_successful`, `mean_df`, `std_df`, `median_df`, `q1_df`, `q3_df`, `min_df`, `max_df`, `sim_id`, `sim_target_df`, `sim_box_counting_df`, `created_at`,
**AND** the batch is reachable from the project owner via project-level permissions.

#### Scenario 1.1 — Sync batch (N ≤ 30)
- **Input**: Sync upload with N=12.
- **Expected**: `FraktalBatch` row created BEFORE the HTTP 200 response returns.

#### Scenario 1.2 — Async batch (N > 30)
- **Input**: Async upload with N=100.
- **Expected**: Row created at Celery task completion; HTTP 202 response carries `job_id` only.

#### Scenario 1.3 — Permission isolation
- **Input**: User A creates batch in project P; user B (no access to P) requests it.
- **Expected**: 403; `FraktalBatch` not exposed.

### R2. FraktalBatchImage rows store per-image data + PNG bytes

**GIVEN** N images in a batch,
**WHEN** the batch task completes,
**THEN** N `FraktalBatchImage` rows exist, each with: `batch` (FK), `index` (int, unique together with `batch`), `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`, `dpo_used`, `error`, `image_png` (`BinaryField`).

#### Scenario 2.1 — All-success batch
- **Expected**: N rows, every `image_png` populated, `error` is null/empty.

#### Scenario 2.2 — Partial-failure batch
- **Input**: N=10, 3 analyzer failures.
- **Expected**: 10 rows; failed rows have `error` populated and `fractal_dimension = null`; `image_png` still populated when rasterization succeeded.

#### Scenario 2.3 — Index uniqueness
- **Expected**: Inserting two rows with same `(batch, index)` violates the unique constraint.

### R3. Drill-down endpoint returns single-image detail

**GIVEN** a batch + image index,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/`,
**THEN** the response includes the image's metrics (R6 of `fraktal-batch-contract`) plus navigation hints `prev_index` and `next_index` (each may be null at the boundaries).

#### Scenario 3.1 — First image
- **Input**: `index = 0`, N = 10.
- **Expected**: 200; `prev_index = null`; `next_index = 1`.

#### Scenario 3.2 — Last image
- **Input**: `index = 9`, N = 10.
- **Expected**: 200; `prev_index = 8`; `next_index = null`.

#### Scenario 3.3 — Out-of-range index
- **Input**: `index = 99`, N = 10.
- **Expected**: 404.

#### Scenario 3.4 — Cross-project access
- **Input**: batch belongs to another project.
- **Expected**: 403.

### R4. Per-image PNG endpoint streams bytes

**GIVEN** a batch + image index,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/png/`,
**THEN** the response is HTTP 200 with `Content-Type: image/png` and the body equals the persisted bytes.

#### Scenario 4.1 — PNG present
- **Expected**: 200; body bytes equal the stored `image_png`.

#### Scenario 4.2 — PNG bytes empty
- **Input**: `image_png` is null/empty (rasterization failed).
- **Expected**: 404.

#### Scenario 4.3 — Non-owner
- **Expected**: 403.

### R5. Re-analyze creates persistent FraktalAnalysis using batch dpo

**GIVEN** a batch image with PNG bytes,
**WHEN** `POST /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/reanalyze/`,
**THEN** a new `FraktalAnalysis` row is created using the persisted PNG + the batch's `dpo_used` + the batch's algorithm (no fresh autocalibration),
**AND** the response is HTTP 201 with `{analysisId}`.

#### Scenario 5.1 — Happy path
- **Expected**: 201; new `FraktalAnalysis` row exists; `analysisId` returned.

#### Scenario 5.2 — Missing PNG bytes
- **Input**: `image_png` is null/empty.
- **Expected**: 400 with actionable error.

#### Scenario 5.3 — Multiple re-analyses
- **Input**: Same image re-analyzed three times.
- **Expected**: Three distinct `FraktalAnalysis` rows; each independent.

#### Scenario 5.4 — Non-owner
- **Expected**: 403.

### R6. Delete batch cascades to images, preserves re-analyses

**GIVEN** a `FraktalBatch` with N images,
**WHEN** `DELETE /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/`,
**THEN** the batch row + all N `FraktalBatchImage` rows + all PNG bytes are removed,
**AND** any `FraktalAnalysis` rows previously created via re-analyze (R5) remain.

#### Scenario 6.1 — Empty batch
- **Expected**: 204; row removed.

#### Scenario 6.2 — Batch with images and prior re-analyses
- **Input**: N=5 with 2 prior re-analyses.
- **Expected**: 204; batch + 5 image rows gone; the 2 `FraktalAnalysis` rows still exist.

#### Scenario 6.3 — Non-owner
- **Expected**: 403; nothing deleted.

### R7. Polling response shape preserved with batch_id added

**GIVEN** an async batch in progress,
**WHEN** `GET /api/v1/fraktal-status/{job_id}/`,
**THEN** during processing the response shape is unchanged: `{status, progress, current, total, stage}`,
**AND** when `status = "done"` the response additionally includes `batch_id` (uuid),
**AND** `results_url` is preserved and points at the new DB-backed batch detail endpoint.

#### Scenario 7.1 — Mid-flight
- **Expected**: `{status: "processing", progress, current, total, stage}`; no `batch_id` yet.

#### Scenario 7.2 — Done
- **Expected**: `{status: "done", batch_id: "<uuid>", results_url: "/api/v1/projects/{pk}/fraktal/batches/<uuid>/"}`.

#### Scenario 7.3 — Failed
- **Expected**: `{status: "failed", error: "..."}`; no `batch_id`.

### R8. Batch detail endpoint serves DB-backed results in current shape

**GIVEN** an existing `FraktalBatch`,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/`,
**THEN** the response body MATCHES the current frente-5 sync 200 response: `{images[], stats, histogram, comparison, calibration_used, calibration_source}`.

#### Scenario 8.1 — Sync-origin batch
- **Expected**: Body shape equivalent to inline sync response for the same input.

#### Scenario 8.2 — Async-origin batch
- **Expected**: Body shape equivalent to sync, regardless of execution path.

#### Scenario 8.3 — Partial-failure batch
- **Expected**: `images[]` includes failed entries with `error` populated; `stats` computed over successful only.

### R9. Persisted PNG matches the analyzer-rendered image (round-trip)

**GIVEN** a batch image with PNG persisted,
**WHEN** drill-down PNG endpoint serves the bytes,
**THEN** those bytes hash-equal the bytes that the analyzer rasterized and consumed at batch time (rasterize once, store once, serve).

#### Scenario 9.1 — Round-trip hash
- **Input**: Take SHA-256 of analyzer-input PNG at batch time; compare to SHA-256 of bytes returned by R4.
- **Expected**: Hashes are equal.

### R10. Persistence overhead bounded for sync path

**GIVEN** a sync batch with N=30 images,
**WHEN** comparing total response time vs pre-frente-6 baseline,
**THEN** the additional DB writes SHOULD add less than 500 ms total.
This is a soft guarantee documented in the spec, not a CI hard gate.

#### Scenario 10.1 — Sync N=30 overhead budget
- **Expected**: Observed delta within budget; if exceeded, treat as a perf bug, not a correctness regression.
