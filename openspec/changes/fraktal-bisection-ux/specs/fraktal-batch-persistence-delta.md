# Delta for fraktal-batch-persistence

Existing capability `fraktal-batch-persistence` still applies in full. This delta records
two changes introduced by `fraktal-bisection-ux`:

1. `FraktalBatchImage` gains 5 new nullable quality/diagnostic fields.
2. The batch task persistence path sets those fields based on the bisection outcome category.

Migration `0010_add_bisection_quality_fields.py`: additive, all nullable (or with safe
defaults), reversible. Existing rows default to `quality = "converged"` (optimistic legacy
assumption: rows written before this migration had no categorization data; treating them as
converged preserves their non-null `fractal_dimension` meaning).

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
`analysis_input_variant` (string, NOT NULL),
**AND** each row MUST additionally contain:
- `quality: CharField max_length=12, default="converged"` —
  choices: `converged | approximate | excluded | failed`
- `bisection_iterations: IntegerField, null=True`
- `bisection_residual: FloatField, null=True`
- `failure_reason: CharField max_length=20, null=True` —
  choices: `no_sign_change | kf_negative | iteration_limit | none | null`
- `df_estimate: FloatField, null=True`
**AND** existing rows written before migration `0010` have `quality = "converged"` (column
default) and all four new nullable fields as NULL; they MUST remain fully accessible
without error.

(Previously: R2 did not include `quality`, `bisection_iterations`, `bisection_residual`,
`failure_reason`, or `df_estimate`. The bisection outcome was discarded after analysis.)

#### Scenario 2.1 — Converged image persistence

- GIVEN an image whose bisection converged (residual 0.04, iterations 12, Df 1.82)
- WHEN the batch task stores the result
- THEN the row has `quality = "converged"`, `bisection_iterations = 12`,
  `bisection_residual = 0.04`, `failure_reason = "none"`, `df_estimate = 1.82`,
  `fractal_dimension = 1.82`

#### Scenario 2.2 — Approximate image persistence

- GIVEN an image where bisection reached iteration limit with residual 0.5 (< 1.0 threshold)
- WHEN the batch task stores the result
- THEN `quality = "approximate"`, `bisection_residual = 0.5`, `failure_reason = "iteration_limit"`,
  `df_estimate` is set to the best Df approximation, `fractal_dimension = null`

#### Scenario 2.3 — Excluded image persistence (no_sign_change)

- GIVEN an image where bisection reported no_sign_change failure
- WHEN the batch task stores the result
- THEN `quality = "excluded"`, `failure_reason = "no_sign_change"`,
  `df_estimate = null`, `bisection_residual = null`, `fractal_dimension = null`

#### Scenario 2.4 — Failed image persistence (kf_negative)

- GIVEN an image where bisection reported kf_negative failure
- WHEN the batch task stores the result
- THEN `quality = "failed"`, `failure_reason = "kf_negative"`,
  `df_estimate = null`, `fractal_dimension = null`

#### Scenario 2.5 — Engine crash persistence

- GIVEN an image where the engine crashed without surfacing a bisection category
- WHEN the batch task stores the result (catching the exception)
- THEN `quality = "failed"`, `failure_reason = null` (not "none"),
  `df_estimate = null`, `bisection_iterations = null`, `bisection_residual = null`

#### Scenario 2.6 — Legacy row backward compatibility

- GIVEN a `FraktalBatchImage` row created before migration `0010`
- WHEN the drill-down or list endpoint is queried for this row
- THEN HTTP 200; `quality = "converged"` (column default); all four new nullable fields are null
- AND `fractal_dimension` and all other pre-migration fields serve correctly without error

#### Scenario 2.7 — Index uniqueness unchanged

- GIVEN a new-mode batch
- WHEN two rows with the same `(batch, index)` are attempted
- THEN the unique constraint is violated; second insert is rejected (unchanged behavior)

---

## ADDED Requirements

### R-DELTA-K. Migration 0010 adds 5 bisection quality fields — additive, reversible

Adds to [`fraktal-batch-persistence.md`](../../../specs/fraktal-batch-persistence.md).

**GIVEN** the production database has existing `FraktalBatchImage` rows (pre-migration),
**WHEN** migration `0010_add_bisection_quality_fields.py` is applied,
**THEN** the following columns MUST be added to the `fractal_analysis_fraktalbatchimage` table:
- `quality CharField(max_length=12, default="converged")` — NOT NULL with default
- `bisection_iterations IntegerField(null=True)`
- `bisection_residual FloatField(null=True)`
- `failure_reason CharField(max_length=20, null=True)`
- `df_estimate FloatField(null=True)`
**AND** all existing rows MUST have `quality = "converged"` after migration (column default,
no backfill of other fields — NULL is the correct sentinel for missing diagnostic data),
**AND** no existing rows, foreign keys, indexes, or constraints are dropped or modified,
**AND** migration MUST be reversible: the reverse drops only these 5 columns and restores
the pre-migration table state without data loss in any other column.

#### Scenario K.1 — Forward migration on production rows

- GIVEN a database with 500 existing `FraktalBatchImage` rows
- WHEN migration `0010` is applied
- THEN all 500 rows gain `quality = "converged"` and four new null-valued fields
- AND migration completes without error; all rows remain queryable
- AND `fractal_dimension`, `png_bytes`, and all pre-migration fields are intact

#### Scenario K.2 — Reverse migration

- GIVEN migration `0010` has been applied
- WHEN the reverse migration runs
- THEN the 5 new columns are dropped; all other columns and data are intact
- AND endpoints that do not reference the new fields continue to work

#### Scenario K.3 — New batch after migration: fields explicitly set

- GIVEN migration `0010` is applied and a new batch is submitted
- WHEN the batch task stores results
- THEN new rows have `quality` explicitly set (not relying on default); diagnostic fields populated
- AND old pre-migration rows still have `quality = "converged"` (from column default)
