# Delta for fraktal-batch-persistence

Existing capability `fraktal-batch-persistence` still applies in full. This delta records
two changes introduced by `fraktal-batch-distributions-and-entry`:

1. `FraktalBatchImage` gains `rg_nm: float | null` field (radius of gyration in nm).
2. `FraktalBatch` (batch detail response) gains aggregate stats for all four metrics
   (Df, kf, Rg, npo): mean, std, median, min, max — used by histogram for axis hints
   and summary cards.

Migration: additive nullable column on `FraktalBatchImage`; additive aggregate fields on
`FraktalBatch` model or computed in serializer — no destructive changes.

---

## MODIFIED Requirements

### R2. FraktalBatchImage rows store per-image data + PNG bytes

Modifies **R2 of [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md)**.

**GIVEN** N images in a batch,
**WHEN** the batch task completes,
**THEN** N `FraktalBatchImage` rows exist, each with: `batch` (FK), `index` (int, unique
together with `batch`), `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`,
`r_squared`, `n_particles_counted`, `dpo_used`, `error`, `png_bytes` (`BinaryField`),
`png_scientific_bytes` (`BinaryField`, nullable), `rg_nm` (`FloatField`, nullable),
**AND** `rg_nm` MUST be populated from the engine result when the analyzer returns a valid
radius of gyration for that image,
**AND** `rg_nm` MUST be stored as NULL when the analyzer does not produce an Rg value for
that image (analysis failure, or engine version that does not output Rg),
**AND** existing rows written before this migration have `rg_nm = NULL` and MUST remain
fully accessible without error (additive field, no destructive migration).

(Previously: `FraktalBatchImage` had no `rg_nm` field; only Df, kf, prefactor, r_squared,
n_particles_counted were persisted per image.)

#### Scenario 2.1 — New batch: rg_nm populated

- GIVEN a batch where the engine returns `rg_nm` for each successfully analyzed image
- WHEN the batch task stores results
- THEN every `FraktalBatchImage` row with a successful analysis has `rg_nm` populated
  as a positive float (nanometers)
- AND `png_bytes`, `fractal_dimension`, and all other existing fields remain unchanged

#### Scenario 2.2 — Failed image: rg_nm is NULL

- GIVEN a batch where image `i` fails analysis (engine error or null Df)
- WHEN the batch task stores results for image `i`
- THEN `rg_nm = NULL` for that row
- AND the `error` field is populated with the failure reason

#### Scenario 2.3 — Pre-migration rows remain accessible

- GIVEN existing `FraktalBatchImage` rows written before the `rg_nm` migration
- WHEN the drill-down endpoint is queried for any of these rows
- THEN HTTP 200 is returned; `rg_nm = NULL` for these rows; no error
- AND `png_bytes`, `fractal_dimension`, and all other fields serve correctly

#### Scenario 2.4 — Index uniqueness unchanged

- GIVEN a new-mode batch
- WHEN two rows with the same `(batch, index)` are attempted
- THEN the unique constraint is violated; second insert is rejected (unchanged behavior)

---

### R3. Drill-down endpoint returns single-image detail

Modifies **R3 of [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md)**.

**GIVEN** a batch + image index,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/`,
**THEN** the response includes the image's metrics (R6 of `fraktal-batch-contract`) plus
navigation hints `prev_index` and `next_index` (each may be null at the boundaries),
**AND** the response MUST include `has_scientific_png: bool` (unchanged from frente-8 delta),
**AND** the response MUST include `rg_nm: float | null`,
**AND** `rg_nm` is the stored value from `FraktalBatchImage.rg_nm` — null for legacy rows
or failed images,
**AND** `rg_nm` MUST always be present in the response (never omitted, even for legacy rows).

(Previously: drill-down response included `has_scientific_png` but had no `rg_nm` field.)

#### Scenario 3.1 — rg_nm present for new successful image

- GIVEN `index = 0`, successful analysis, new batch with `rg_nm = 145.7`
- WHEN drill-down endpoint is called
- THEN HTTP 200; response includes `rg_nm: 145.7`
- AND `prev_index`, `next_index`, `has_scientific_png` are also present (unchanged)

#### Scenario 3.2 — rg_nm null for failed image

- GIVEN `index = 3`, image failed analysis
- WHEN drill-down is called
- THEN HTTP 200; `rg_nm: null`; `error` field describes the failure

#### Scenario 3.3 — rg_nm null for legacy row

- GIVEN a `FraktalBatchImage` row created before the `rg_nm` migration
- WHEN drill-down is called
- THEN HTTP 200; `rg_nm: null`; no error; `has_scientific_png` behavior unchanged

#### Scenario 3.4 — Out-of-range index

- GIVEN `index = 99`, N = 10
- WHEN drill-down is called
- THEN HTTP 404 (unchanged from R3 of main spec)

#### Scenario 3.5 — Cross-project access

- GIVEN batch belongs to another project
- WHEN drill-down is called
- THEN HTTP 403 (unchanged from R3 of main spec)

---

### R8. Batch detail endpoint serves DB-backed results in current shape

Modifies **R8 of [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md)**.

**GIVEN** an existing `FraktalBatch`,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/`,
**THEN** the response body MATCHES the current shape: `{images[], stats, histogram,
comparison, calibration_used, calibration_source}`,
**AND** the `stats` block MUST be extended to include per-metric aggregates for all four
metrics: `{mean, std, median, min, max}` for each of `df`, `kf`, `rg`, `npo`,
**AND** aggregate fields for a metric are `null` when `n_successful = 0` for that metric,
**AND** `images[]` entries MUST include `rg_nm: float | null` per image (R3 delta above),
**AND** existing fields in `stats` (`n_images`, `n_successful`, `mean_df`, `std_df`,
`median_df`, `q1_df`, `q3_df`, `min_df`, `max_df`) MUST remain present unchanged
(backward-compatible extension, not replacement).

(Previously: `stats` contained only Df aggregates; `images[]` entries had no `rg_nm`.)

#### Scenario 8.1 — Full stats for all four metrics

- GIVEN a batch with n_successful ≥ 1 for Df, kf, Rg, and npo
- WHEN the batch detail endpoint is called
- THEN `stats.kf = {mean, std, median, min, max}` is present
- AND `stats.rg = {mean, std, median, min, max}` is present (units: nm)
- AND `stats.npo = {mean, std, median, min, max}` is present
- AND legacy `stats.mean_df`, `stats.std_df`, etc., are still present unchanged

#### Scenario 8.2 — Rg stats null when all Rg values are null (legacy batch)

- GIVEN a batch where all `FraktalBatchImage.rg_nm = NULL` (pre-migration rows)
- WHEN the batch detail endpoint is called
- THEN `stats.rg = {mean: null, std: null, median: null, min: null, max: null}`
- AND `stats.df` and other metrics are computed normally if their data exists

#### Scenario 8.3 — Partial failure: per-metric null handling

- GIVEN a batch of 10 images where 3 have null Rg but only 1 has null Df
- WHEN the batch detail endpoint is called
- THEN `stats.rg` is computed over the 7 non-null Rg values
- AND `stats.df` (and legacy `mean_df` etc.) computed over 9 non-null Df values

#### Scenario 8.4 — Backward compat: legacy client only reads df stats

- GIVEN a client that reads only `stats.mean_df`, `stats.std_df`, `stats.n_successful`
- WHEN the batch detail endpoint returns the new shape
- THEN the client reads its fields without error; new fields are additive and ignorable

---

## ADDED Requirements

### R-DELTA-H. Migration adds nullable rg_nm column to FraktalBatchImage

Adds to [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md).

**GIVEN** the production database has existing `FraktalBatchImage` rows (pre-migration),
**WHEN** migration `0008_add_rg_nm_field.py` (or equivalent) is applied,
**THEN** a nullable `FloatField` column `rg_nm` MUST be added to the
`fractal_analysis_fraktalbatchimage` table,
**AND** all existing rows MUST have `rg_nm = NULL` after the migration (no backfill),
**AND** no existing rows, foreign keys, indexes, or constraints are dropped or modified,
**AND** migration MUST be reversible: the reverse drops only `rg_nm` and restores the
pre-migration state without data loss in any other column.

#### Scenario H.1 — Forward migration on production rows

- GIVEN a database with existing `FraktalBatchImage` rows
- WHEN the `rg_nm` migration is applied
- THEN all existing rows gain `rg_nm = NULL`
- AND the migration completes without error
- AND all rows remain queryable via drill-down and list endpoints

#### Scenario H.2 — Reverse migration

- GIVEN the `rg_nm` migration has been applied
- WHEN the reverse migration runs
- THEN the `rg_nm` column is dropped
- AND all other columns and data are intact
- AND endpoints that do not reference `rg_nm` continue to work

#### Scenario H.3 — New batch after migration: rg_nm stored

- GIVEN the migration is applied and a new batch is submitted
- WHEN the batch task stores results
- THEN new `FraktalBatchImage` rows have `rg_nm` populated (non-null for successful images)
- AND old rows (pre-migration) still have `rg_nm = NULL`
