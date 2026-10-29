# Delta for fraktal-batch-persistence

Existing capability `fraktal-batch-persistence` still applies in full. This delta records
three changes introduced by `fraktal-detector-fix` (PYA-9):

1. `FraktalBatchImage` gains `analysis_input_variant` string field (NOT NULL, default "presentation").
2. Drill-down response gains `analysis_input_variant: "presentation" | "scientific"`.
3. Migration `0008_add_analysis_input_variant_field.py` — additive, not destructive.

Companion delta: `./fraktal-batch-contract-delta.md`.

---

## MODIFIED Requirements

### R2. FraktalBatchImage rows store per-image data + PNG bytes

Modifies **R2 of [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md)**.

**GIVEN** N images in a batch,
**WHEN** the batch task completes,
**THEN** N `FraktalBatchImage` rows exist, each with: `batch` (FK), `index` (int, unique
together with `batch`), `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`,
`r_squared`, `n_particles_counted`, `dpo_used`, `error`, `png_bytes` (`BinaryField`),
`png_scientific_bytes` (`BinaryField`, nullable), `analysis_input_variant` (string, NOT NULL),
**AND** when the batch ZIP contains a scientific PNG for a direction, `png_scientific_bytes`
MUST be populated with the threshold-applied binary bytes (post-render: pixels > 127 → 255,
pixels ≤ 127 → 0; output is EXACTLY 0 or 255 per pixel — no tolerance),
**AND** when the batch ZIP does NOT contain a scientific PNG for a direction (legacy batch),
`png_scientific_bytes` MUST be NULL (not empty bytes — NULL),
**AND** `analysis_input_variant` MUST be set to `"scientific"` when `png_scientific_bytes` was
fed to the FRAKTAL engine for this image, and `"presentation"` when `png_bytes` was used instead,
**AND** existing rows written before migration `0008` have `analysis_input_variant = "presentation"`
as the migration default and MUST remain fully accessible without error (additive field).

(Previously: R2 did not include `analysis_input_variant`; which PNG variant was fed to the
analyzer was not recorded anywhere.)

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
**AND** `has_scientific_png` MUST always be present in the response (never omitted, even for legacy rows),
**AND** the response MUST include `analysis_input_variant: "presentation" | "scientific"`,
**AND** `analysis_input_variant` MUST always be present (never omitted, never null),
**AND** for legacy rows (pre-migration `0008`), `analysis_input_variant` MUST equal `"presentation"`.

(Previously: drill-down response included `has_scientific_png` but not `analysis_input_variant`.
This delta adds `analysis_input_variant` to the response.)

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

---

## ADDED Requirements

### R-DELTA-H. Migration 0008 adds `analysis_input_variant` — additive, not destructive

Adds to [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md).

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
