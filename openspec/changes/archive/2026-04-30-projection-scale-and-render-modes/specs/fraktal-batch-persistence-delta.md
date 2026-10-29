# Delta for fraktal-batch-persistence

Existing capability `fraktal-batch-persistence` still applies in full. This delta records
three changes introduced by `projection-scale-and-render-modes`:

1. `FraktalBatchImage` gains `png_scientific_bytes BinaryField(null=True, blank=True)`.
2. Drill-down detail response gains `has_scientific_png: bool` flag.
3. Batch task persists both presentation and scientific PNG bytes when ZIP contains both.

Migration: `0007_add_scientific_png_field.py` (additive, no destructive changes).

Companion new-capability specs: `./projection-scale-per-image/spec.md`,
`./projection-render-dual/spec.md`.

---

## MODIFIED Requirements

### R2. FraktalBatchImage rows store per-image data + PNG bytes

Modifies **R2 of [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md)**.

**GIVEN** N images in a batch,
**WHEN** the batch task completes,
**THEN** N `FraktalBatchImage` rows exist, each with: `batch` (FK), `index` (int, unique
together with `batch`), `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`,
`r_squared`, `n_particles_counted`, `dpo_used`, `error`, `png_bytes` (`BinaryField`),
`png_scientific_bytes` (`BinaryField`, nullable),
**AND** when the batch ZIP contains a scientific PNG for a direction, `png_scientific_bytes`
MUST be populated with the threshold-applied binary bytes (post-render: pixels > 127 → 255,
pixels ≤ 127 → 0; output is EXACTLY 0 or 255 per pixel — no tolerance),
**AND** when the batch ZIP does NOT contain a scientific PNG for a direction (legacy batch),
`png_scientific_bytes` MUST be NULL (not empty bytes — NULL),
**AND** existing rows written before this migration have `png_scientific_bytes = NULL` and
MUST remain fully accessible without error (additive field, no destructive migration).

(Previously: `FraktalBatchImage` had only `image_png` (now renamed `png_bytes`); no
`png_scientific_bytes` field existed.)

#### Scenario 2.1 — New batch: scientific bytes populated

- GIVEN a new-mode ZIP (grid/fibonacci) with both `*.png` and `*.scientific.png` per direction
- WHEN the batch task completes (sync or async)
- THEN every `FraktalBatchImage` row has `png_scientific_bytes` populated
- AND every `png_scientific_bytes` value is strictly binary: every byte is 0 or 255
- AND `png_bytes` (presentation) is also populated

#### Scenario 2.2 — Legacy batch: scientific bytes NULL

- GIVEN a legacy ZIP with no `*.scientific.png` files
- WHEN the batch task completes
- THEN every `FraktalBatchImage` row has `png_scientific_bytes = NULL` (not empty bytes)
- AND `png_bytes` (presentation) is populated as before

#### Scenario 2.3 — Index uniqueness unchanged

- GIVEN a new-mode batch
- WHEN two rows with the same `(batch, index)` are attempted
- THEN the unique constraint is violated; second insert is rejected (unchanged behavior)

#### Scenario 2.4 — Pre-migration rows remain accessible

- GIVEN existing `FraktalBatchImage` rows written before migration `0007`
- WHEN the drill-down endpoint is queried for any of these rows
- THEN HTTP 200 is returned; `png_scientific_bytes` is NULL for these rows; no error
- AND `png_bytes` (presentation) serves correctly from the pre-existing field

---

### R3. Drill-down endpoint returns single-image detail

Modifies **R3 of [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md)**.

**GIVEN** a batch + image index,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/`,
**THEN** the response includes the image's metrics (R6 of `fraktal-batch-contract`) plus
navigation hints `prev_index` and `next_index` (each may be null at the boundaries),
**AND** the response MUST include `has_scientific_png: bool`,
**AND** `has_scientific_png` is `true` when `png_scientific_bytes IS NOT NULL` for this row,
**AND** `has_scientific_png` is `false` when `png_scientific_bytes IS NULL`,
**AND** `has_scientific_png` MUST always be present in the response (never omitted, even
for legacy rows).

(Previously: drill-down response had no `has_scientific_png` field; scientific PNG did not
exist.)

#### Scenario 3.1 — First image (new-mode batch)

- GIVEN `index = 0`, N = 10, new-mode batch
- WHEN drill-down endpoint is called
- THEN HTTP 200; `prev_index = null`; `next_index = 1`
- AND `has_scientific_png = true` (row has `png_scientific_bytes` populated)

#### Scenario 3.2 — Last image (new-mode batch)

- GIVEN `index = 9`, N = 10, new-mode batch
- WHEN drill-down endpoint is called
- THEN HTTP 200; `prev_index = 8`; `next_index = null`
- AND `has_scientific_png = true`

#### Scenario 3.3 — Legacy row: has_scientific_png is false

- GIVEN a `FraktalBatchImage` row created before migration `0007` (or from a legacy-mode batch)
- WHEN drill-down is called for that row
- THEN HTTP 200; `has_scientific_png = false`
- AND no error is raised; `prev_index` / `next_index` navigation is unaffected

#### Scenario 3.4 — Out-of-range index

- GIVEN `index = 99`, N = 10
- WHEN drill-down is called
- THEN HTTP 404 (unchanged from R3 of main spec)

#### Scenario 3.5 — Cross-project access

- GIVEN batch belongs to another project
- WHEN drill-down is called
- THEN HTTP 403 (unchanged from R3 of main spec)

---

## ADDED Requirements

### R-DELTA-F. Migration 0007 is additive: nullable column, no data loss

Adds to [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md).

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

- GIVEN a database with 500 existing `FraktalBatchImage` rows
- WHEN `manage.py migrate fractal_analysis 0007` runs
- THEN all 500 rows gain `png_scientific_bytes = NULL`
- AND the migration completes without error
- AND all rows are still queryable via the drill-down and PNG endpoints

#### Scenario F.2 — Reverse migration

- GIVEN migration `0007` has been applied
- WHEN `manage.py migrate fractal_analysis 0006` runs (reverse)
- THEN the `png_scientific_bytes` column is dropped
- AND all other columns and data are intact
- AND HTTP endpoints that do not reference `png_scientific_bytes` continue to work

#### Scenario F.3 — New batch after migration: scientific bytes stored

- GIVEN migration `0007` is applied and a new-mode ZIP is submitted
- WHEN the batch task stores results
- THEN new `FraktalBatchImage` rows have `png_scientific_bytes` non-NULL
- AND old rows (from before migration) still have `png_scientific_bytes = NULL`

#### Scenario F.4 — Concurrent access during migration window

- GIVEN migration `0007` is applied while the app is serving requests (rolling deploy)
- WHEN a drill-down request hits a row created before the migration
- THEN HTTP 200 is returned; `has_scientific_png = false`; no AttributeError or column error

---

### R-DELTA-G. Batch task persistence: dual-PNG storage when ZIP contains scientific variant

Adds to [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md).

**GIVEN** the Celery batch task receives a ZIP and processes it,
**WHEN** the task stores `FraktalBatchImage` rows,
**THEN** if the ZIP contains `directions[i].filename_scientific` AND that file is present
in the ZIP, BOTH `png_bytes` (from the presentation PNG) AND `png_scientific_bytes` (from
the scientific PNG) MUST be stored in the row,
**AND** before storing `png_scientific_bytes`, the task MUST apply the post-render binary
threshold: pixels > 127 → 255, pixels ≤ 127 → 0 (EXACTLY — no tolerance, no rounding),
**AND** if the ZIP contains ONLY the presentation PNG for a direction (legacy or partial
export), `png_scientific_bytes` MUST be stored as NULL,
**AND** `png_bytes` (presentation) MUST always be stored regardless of scientific PNG
availability.

#### Scenario G.1 — New-mode ZIP: both fields stored

- GIVEN a new-mode ZIP with direction `i` having both `.png` and `.scientific.png`
- WHEN the batch task processes direction `i`
- THEN `png_bytes = bytes_of(presentation_png)` and
  `png_scientific_bytes = threshold_applied(scientific_png_bytes)` in the row
- AND every byte in `png_scientific_bytes` is exactly 0 or 255

#### Scenario G.2 — Legacy ZIP: only presentation stored

- GIVEN a legacy ZIP with no `*.scientific.png` for any direction
- WHEN the batch task processes all directions
- THEN every `FraktalBatchImage` row has `png_bytes` populated and `png_scientific_bytes = NULL`
- AND no error is raised during storage

#### Scenario G.3 — Threshold binary verification

- GIVEN a scientific PNG that contains pixels with values 128, 200, 127, 50, 255, 0
- WHEN the threshold is applied
- THEN stored bytes are 255, 255, 0, 0, 255, 0 respectively (> 127 → 255; ≤ 127 → 0)
- AND no intermediate values (1–254) appear in the stored `png_scientific_bytes`

#### Scenario G.4 — Partial batch failure: presentation stored even when scientific missing

- GIVEN a ZIP where direction `i` has a presentation PNG but the scientific PNG is missing
  (corrupt export)
- WHEN the batch task processes direction `i`
- THEN `png_bytes` is stored from the presentation PNG
- AND `png_scientific_bytes = NULL`
- AND the per-image error field is populated with a warning
- AND the batch continues processing remaining directions
