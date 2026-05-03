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
**THEN** N `FraktalBatchImage` rows exist, each with: `batch` (FK), `index` (int, unique together with `batch`), `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`, `dpo_used`, `error`, `png_bytes` (`BinaryField`), `png_scientific_bytes` (`BinaryField`, nullable), `rg_nm` (`FloatField`, nullable), `analysis_input_variant` (string, NOT NULL),
**AND** when the batch ZIP contains a scientific PNG for a direction, `png_scientific_bytes` MUST be populated with the threshold-applied binary bytes (post-render: pixels > 127 → 255, pixels ≤ 127 → 0; output is EXACTLY 0 or 255 per pixel — no tolerance),
**AND** when the batch ZIP does NOT contain a scientific PNG for a direction (legacy batch), `png_scientific_bytes` MUST be NULL (not empty bytes — NULL),
**AND** `analysis_input_variant` MUST be set to `"scientific"` when `png_scientific_bytes` was fed to the FRAKTAL engine for this image, and `"presentation"` when `png_bytes` was used instead,
**AND** `rg_nm` MUST be populated from the engine result when the analyzer returns a valid radius of gyration for that image,
**AND** `rg_nm` MUST be stored as NULL when the analyzer does not produce an Rg value for that image (analysis failure, or engine version that does not output Rg),
**AND** existing rows written before this migration have `rg_nm = NULL` and MUST remain fully accessible without error (additive field, no destructive migration),
**AND** existing rows written before migration `0008` have `analysis_input_variant = "presentation"` as the migration default and MUST remain fully accessible without error (additive field).

(Previously: R2 did not include `analysis_input_variant` or `rg_nm`; which PNG variant was fed to the analyzer was not recorded anywhere, and per-image Rg values were not persisted.)

#### Scenario 2.1 — New batch: scientific bytes used → variant recorded

- GIVEN a new-mode ZIP where direction `i` has both presentation and scientific PNGs
- WHEN the batch task completes (sync or async)
- THEN the `FraktalBatchImage` row for direction `i` has `png_scientific_bytes` non-NULL
- AND `analysis_input_variant = "scientific"`

#### Scenario 2.2 — Legacy batch: presentation used → variant recorded

- GIVEN a legacy ZIP with no `*.scientific.png` files
- WHEN the batch task completes
- THEN every `FraktalBatchImage` row has `png_scientific_bytes = NULL`
- AND `analysis_input_variant = "presentation"`

#### Scenario 2.3 — Pre-migration rows: default variant applied

- GIVEN existing `FraktalBatchImage` rows written before migration `0008`
- WHEN the drill-down endpoint is queried for any of these rows
- THEN HTTP 200 is returned; `analysis_input_variant = "presentation"` (migration default)
- AND `png_bytes` serves correctly; no error

#### Scenario 2.4 — Index uniqueness unchanged

- GIVEN a new-mode batch
- WHEN two rows with the same `(batch, index)` are attempted
- THEN the unique constraint is violated; second insert is rejected (unchanged behavior)

### R3. Drill-down endpoint returns single-image detail

**GIVEN** a batch + image index,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/`,
**THEN** the response includes the image's metrics (R6 of `fraktal-batch-contract`) plus navigation hints `prev_index` and `next_index` (each may be null at the boundaries),
**AND** the response MUST include `has_scientific_png: bool`,
**AND** `has_scientific_png` is `true` when `png_scientific_bytes IS NOT NULL` for this row,
**AND** `has_scientific_png` is `false` when `png_scientific_bytes IS NULL`,
**AND** `has_scientific_png` MUST always be present in the response (never omitted, even for legacy rows),
**AND** the response MUST include `analysis_input_variant: "presentation" | "scientific"`,
**AND** `analysis_input_variant` MUST always be present (never omitted, never null),
**AND** the response MUST include `rg_nm: float | null`,
**AND** `rg_nm` is the stored value from `FraktalBatchImage.rg_nm` — null for legacy rows or failed images,
**AND** `rg_nm` MUST always be present in the response (never omitted, even for legacy rows),
**AND** for legacy rows (pre-migration `0008`), `analysis_input_variant` MUST equal `"presentation"`.

(Previously: drill-down response included `has_scientific_png` but not `analysis_input_variant` or `rg_nm`.
This delta adds both fields to the response.)

#### Scenario 3.1 — New-mode batch: scientific used

- GIVEN `index = 0`, new-mode batch, `png_scientific_bytes` non-NULL
- WHEN drill-down endpoint is called
- THEN HTTP 200; `has_scientific_png = true`; `analysis_input_variant = "scientific"`
- AND `prev_index = null`; `next_index = 1`

#### Scenario 3.2 — Legacy row: presentation variant

- GIVEN a `FraktalBatchImage` row created before migration `0008` (or from a legacy-mode batch)
- WHEN drill-down is called for that row
- THEN HTTP 200; `has_scientific_png = false`; `analysis_input_variant = "presentation"`
- AND no error is raised; navigation unaffected

#### Scenario 3.3 — Mixed batch: variant reflects per-image selection

- GIVEN a batch with N=10 where directions 0-7 have scientific bytes and directions 8-9 do not
- WHEN drill-down is called for index=0 and index=9
- THEN index=0 returns `analysis_input_variant = "scientific"`
- AND index=9 returns `analysis_input_variant = "presentation"`

#### Scenario 3.4 — Out-of-range index

- GIVEN `index = 99`, N = 10
- WHEN drill-down is called
- THEN HTTP 404 (unchanged from R3 of main spec)

#### Scenario 3.5 — Cross-project access

- GIVEN batch belongs to another project
- WHEN drill-down is called
- THEN HTTP 403 (unchanged from R3 of main spec)

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
**THEN** the response body MATCHES the current shape: `{images[], stats, histogram, comparison, calibration_used, calibration_source}`,
**AND** the `stats` block MUST be extended to include per-metric aggregates for all four metrics: `{mean, std, median, min, max}` for each of `df`, `kf`, `rg`, `npo`,
**AND** aggregate fields for a metric are `null` when `n_successful = 0` for that metric,
**AND** `images[]` entries MUST include `rg_nm: float | null` per image (R3 delta above),
**AND** existing fields in `stats` (`n_images`, `n_successful`, `mean_df`, `std_df`, `median_df`, `q1_df`, `q3_df`, `min_df`, `max_df`) MUST remain present unchanged (backward-compatible extension, not replacement).

(Previously: `stats` contained only Df aggregates; `images[]` entries had no `rg_nm`.)

#### Scenario 8.1 — Sync-origin batch
- **Expected**: Body shape equivalent to inline sync response for the same input; stats extended with per-metric aggregates.

#### Scenario 8.2 — Async-origin batch
- **Expected**: Body shape equivalent to sync, regardless of execution path; stats include all four metrics.

#### Scenario 8.3 — Partial-failure batch
- **Expected**: `images[]` includes failed entries with `error` populated; `stats` computed over successful only per metric.

#### Scenario 8.4 — Full stats for all four metrics

- GIVEN a batch with n_successful ≥ 1 for Df, kf, Rg, and npo
- WHEN the batch detail endpoint is called
- THEN `stats.kf = {mean, std, median, min, max}` is present
- AND `stats.rg = {mean, std, median, min, max}` is present (units: nm)
- AND `stats.npo = {mean, std, median, min, max}` is present
- AND legacy `stats.mean_df`, `stats.std_df`, etc., are still present unchanged

#### Scenario 8.5 — Rg stats null when all Rg values are null (legacy batch)

- GIVEN a batch where all `FraktalBatchImage.rg_nm = NULL` (pre-migration rows)
- WHEN the batch detail endpoint is called
- THEN `stats.rg = {mean: null, std: null, median: null, min: null, max: null}`
- AND `stats.df` and other metrics are computed normally if their data exists

#### Scenario 8.6 — Partial failure: per-metric null handling

- GIVEN a batch of 10 images where 3 have null Rg but only 1 has null Df
- WHEN the batch detail endpoint is called
- THEN `stats.rg` is computed over the 7 non-null Rg values
- AND `stats.df` (and legacy `mean_df` etc.) computed over 9 non-null Df values

#### Scenario 8.7 — Backward compat: legacy client only reads df stats

- GIVEN a client that reads only `stats.mean_df`, `stats.std_df`, `stats.n_successful`
- WHEN the batch detail endpoint returns the new shape
- THEN the client reads its fields without error; new fields are additive and ignorable

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

---

### R-DELTA-F. Migration 0007 is additive: nullable column, no data loss

**GIVEN** the production database has existing `FraktalBatchImage` rows (pre-migration),
**WHEN** migration `0007_add_scientific_png_field.py` is applied,
**THEN** a nullable `BinaryField` column `png_scientific_bytes` MUST be added to the
`fractal_analysis_fraktalbatchimage` table,
**AND** all existing rows MUST have `png_scientific_bytes = NULL` after the migration (no
value is backfilled — NULL is the correct sentinel for "no scientific PNG available"),
**AND** no existing rows, foreign keys, indexes, or constraints are dropped or modified,
**AND** migration MUST be reversible: the reverse operation drops only the
`png_scientific_bytes` column and restores the pre-migration table state without data loss
in any other column.

#### Scenario F.1 — Forward migration on production rows
- **Input**: database with 500 existing `FraktalBatchImage` rows.
- **Expected**: all 500 rows gain `png_scientific_bytes = NULL`; migration completes without error; all rows still queryable.

#### Scenario F.2 — Reverse migration
- **Given** migration `0007` has been applied.
- **When** `manage.py migrate fractal_analysis 0006` runs (reverse).
- **Then** the `png_scientific_bytes` column is dropped; pre-migration table state is restored; no data loss in other columns.

---

### R-DELTA-H. Migration 0008 adds `analysis_input_variant` — additive, not destructive

**GIVEN** the production database has existing `FraktalBatchImage` rows (pre-migration),
**WHEN** migration `0008_add_analysis_input_variant_field.py` is applied,
**THEN** a NOT NULL `CharField` (or equivalent string column) `analysis_input_variant` with
`default="presentation"` MUST be added to the `fractal_analysis_fraktalbatchimage` table,
**AND** all existing rows MUST have `analysis_input_variant = "presentation"` after the migration
(no backfill required — the column default provides this value),
**AND** no existing rows, foreign keys, indexes, or constraints are dropped or modified,
**AND** the migration MUST be reversible: the reverse operation drops only `analysis_input_variant`
and restores the pre-migration table state without data loss in any other column,
**AND** new rows inserted after migration MUST explicitly set `analysis_input_variant` to either
`"scientific"` or `"presentation"` — the default `"presentation"` is a fallback for legacy rows
only and SHOULD NOT be relied upon for new batch task code.

#### Scenario H.1 — Forward migration on production rows

- GIVEN a database with 500 existing `FraktalBatchImage` rows
- WHEN `manage.py migrate fractal_analysis 0008` runs
- THEN all 500 rows gain `analysis_input_variant = "presentation"` (column default)
- AND migration completes without error
- AND all rows remain queryable via drill-down and PNG endpoints

#### Scenario H.2 — Reverse migration

- GIVEN migration `0008` has been applied
- WHEN `manage.py migrate fractal_analysis 0007` runs (reverse)
- THEN the `analysis_input_variant` column is dropped
- AND all other columns and data are intact
- AND HTTP endpoints that do not reference `analysis_input_variant` continue to work

#### Scenario H.3 — New batch after migration: variant explicitly set

- GIVEN migration `0008` is applied and a new-mode ZIP is submitted
- WHEN the batch task stores results
- THEN new rows with scientific input have `analysis_input_variant = "scientific"` (explicit, not from default)
- AND new rows with presentation fallback have `analysis_input_variant = "presentation"` (explicit)
- AND old pre-migration rows still have `analysis_input_variant = "presentation"` (from default)

#### Scenario H.4 — Drill-down during rolling deploy (migration window)

- GIVEN migration `0008` is applied while the app is serving requests
- WHEN a drill-down request hits a row created before the migration (column default fills in)
- THEN HTTP 200; `analysis_input_variant = "presentation"`; no AttributeError or column error

---

### R-DELTA-H. Migration 0008 adds `analysis_input_variant` — additive, not destructive

**GIVEN** the production database has existing `FraktalBatchImage` rows (pre-migration),
**WHEN** migration `0008_add_analysis_input_variant_field.py` is applied,
**THEN** a NOT NULL `CharField` (or equivalent string column) `analysis_input_variant` with
`default="presentation"` MUST be added to the `fractal_analysis_fraktalbatchimage` table,
**AND** all existing rows MUST have `analysis_input_variant = "presentation"` after the migration
(no backfill required — the column default provides this value),
**AND** no existing rows, foreign keys, indexes, or constraints are dropped or modified,
**AND** the migration MUST be reversible: the reverse operation drops only `analysis_input_variant`
and restores the pre-migration table state without data loss in any other column,
**AND** new rows inserted after migration MUST explicitly set `analysis_input_variant` to either
`"scientific"` or `"presentation"` — the default `"presentation"` is a fallback for legacy rows
only and SHOULD NOT be relied upon for new batch task code.

#### Scenario H.1 — Forward migration on production rows

- GIVEN a database with 500 existing `FraktalBatchImage` rows
- WHEN `manage.py migrate fractal_analysis 0008` runs
- THEN all 500 rows gain `analysis_input_variant = "presentation"` (column default)
- AND migration completes without error
- AND all rows remain queryable via drill-down and PNG endpoints

#### Scenario H.2 — Reverse migration

- GIVEN migration `0008` has been applied
- WHEN `manage.py migrate fractal_analysis 0007` runs (reverse)
- THEN the `analysis_input_variant` column is dropped
- AND all other columns and data are intact
- AND HTTP endpoints that do not reference `analysis_input_variant` continue to work

#### Scenario H.3 — New batch after migration: variant explicitly set

- GIVEN migration `0008` is applied and a new-mode ZIP is submitted
- WHEN the batch task stores results
- THEN new rows with scientific input have `analysis_input_variant = "scientific"` (explicit, not from default)
- AND new rows with presentation fallback have `analysis_input_variant = "presentation"` (explicit)
- AND old pre-migration rows still have `analysis_input_variant = "presentation"` (from default)

#### Scenario H.4 — Drill-down during rolling deploy (migration window)

- GIVEN migration `0008` is applied while the app is serving requests
- WHEN a drill-down request hits a row created before the migration (column default fills in)
- THEN HTTP 200; `analysis_input_variant = "presentation"`; no AttributeError or column error

---

### R-DELTA-I. Migration adds nullable rg_nm column to FraktalBatchImage

**GIVEN** the production database has existing `FraktalBatchImage` rows (pre-migration),
**WHEN** migration `0009_add_rg_nm_field.py` (or equivalent) is applied,
**THEN** a nullable `FloatField` column `rg_nm` MUST be added to the
`fractal_analysis_fraktalbatchimage` table,
**AND** all existing rows MUST have `rg_nm = NULL` after the migration (no backfill),
**AND** no existing rows, foreign keys, indexes, or constraints are dropped or modified,
**AND** migration MUST be reversible: the reverse drops only `rg_nm` and restores the
pre-migration state without data loss in any other column.

#### Scenario I.1 — Forward migration on production rows

- GIVEN a database with existing `FraktalBatchImage` rows
- WHEN the `rg_nm` migration is applied
- THEN all existing rows gain `rg_nm = NULL`
- AND the migration completes without error
- AND all rows remain queryable via drill-down and list endpoints

#### Scenario I.2 — Reverse migration

- GIVEN the `rg_nm` migration has been applied
- WHEN the reverse migration runs
- THEN the `rg_nm` column is dropped
- AND all other columns and data are intact
- AND endpoints that do not reference `rg_nm` continue to work

#### Scenario I.3 — New batch after migration: rg_nm stored

- GIVEN the migration is applied and a new batch is submitted
- WHEN the batch task stores results
- THEN new `FraktalBatchImage` rows have `rg_nm` populated (non-null for successful images)
- AND old rows (pre-migration) still have `rg_nm = NULL`

<!-- Last sync: 2026-05-03 from change fraktal-batch-distributions-and-entry -->
