# Spec: csv-export-locale

## Purpose

Defines observable behavior for shared CSV locale helpers and CSV export endpoints (single-image FRAKTAL + batch FRAKTAL). Honors `User.csv_decimal_separator` + `User.csv_column_delimiter`. Hoists existing simulations CSV locale logic into a shared module without changing simulations CSV output.

Context: `../proposal.md`, `../explore.md`. Companion: `./fraktal-batch-persistence.md`.

This spec describes **observable behavior** — locale resolution, CSV bytes, HTTP contracts — not implementation.

## Requirements

### R1. Shared csv_locale module exposes user-pref accessors

**GIVEN** a Request,
**WHEN** `csv_locale.get_user_csv_locale(request)` is called,
**THEN** it returns `(decimal: str, delimiter: str)` resolved from `User.csv_decimal_separator` and `User.csv_column_delimiter` for authenticated users, or `('.', ',')` for anonymous requests.

#### Scenario 1.1 — Anonymous request
- **Expected**: `('.', ',')`.

#### Scenario 1.2 — European prefs
- **Input**: User with `csv_decimal_separator=','`, `csv_column_delimiter=';'`.
- **Expected**: `(',', ';')`.

#### Scenario 1.3 — Mixed prefs
- **Input**: `csv_decimal_separator='.'`, `csv_column_delimiter=';'`.
- **Expected**: `('.', ';')`.

### R2. Localized row writer formats numbers per locale

**GIVEN** a `csv.writer`-like writer, a row of mixed-type values, and a decimal separator,
**WHEN** `csv_locale.write_localized_row(writer, row, decimal)` runs,
**THEN** floats are rendered with the chosen decimal separator, ints unchanged, strings unchanged, and `None` rendered as an empty string.

#### Scenario 2.1 — Standard floats with `,`
- **Input**: row `[1.5, 2.0]`, decimal `,`.
- **Expected**: cells render as `1,5` and `2,0`.

#### Scenario 2.2 — Very small float
- **Input**: `1e-10` with decimal `,`.
- **Expected**: scientific or fixed-form string with `,` as the decimal mark.

#### Scenario 2.3 — Very large float
- **Input**: `1e10` with decimal `.`.
- **Expected**: rendered without altering the integer portion.

#### Scenario 2.4 — None values
- **Input**: row `["x", None, 3.14]`.
- **Expected**: middle cell is the empty string.

### R3. Single-image CSV endpoint returns one data row with full columns

**GIVEN** a `FraktalAnalysis` row owned by the requester,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/{analysisId}/csv/`,
**THEN** the response is HTTP 200, `Content-Type: text/csv`, with a header row + exactly 1 data row,
**AND** columns are: `analysis_id, created_at, algorithm, image_filename, fractal_dimension, prefactor, r_squared, n_particles_counted, error, dpo_used, autocalibrate_source, scale_factor_nm, pixels_per_100nm, rg, ap, volume, mass, surface_area, sim_id, sim_target_df, sim_box_counting_df, calibration_source, quality, bisection_iterations, bisection_residual, failure_reason, df_estimate`,
**AND** the 5 new columns are appended AFTER `calibration_source` (end of existing list),
**AND** numbers + delimiter respect R1; `quality` and `failure_reason` use literal values.

(Previously: R3 column list ended at `calibration_source`; no quality or bisection
diagnostic columns were present.)

#### Scenario 3.1 — Converged analysis CSV row

- GIVEN a `FraktalAnalysis` with `quality = "converged"`, `bisection_iterations = 12`,
  `bisection_residual = 0.04`, `failure_reason = "none"`, `df_estimate = 1.82`
- WHEN CSV export is requested (decimal separator `.`)
- THEN the row ends with cells: `converged, 12, 0.04, none, 1.82`

#### Scenario 3.2 — Excluded analysis CSV row (no_sign_change)

- GIVEN a `FraktalAnalysis` with `quality = "excluded"`, `failure_reason = "no_sign_change"`,
  `df_estimate = null`, `bisection_residual = null`, `bisection_iterations = null`
- WHEN CSV export is requested
- THEN the row ends with cells: `excluded, (empty), (empty), no_sign_change, (empty)`
- AND `fractal_dimension` column is also empty (null)

#### Scenario 3.3 — European locale (decimal comma)

- GIVEN a converged image with `bisection_residual = 0.04`, `df_estimate = 1.82`
- AND user preference `csv_decimal_separator = ','`
- WHEN CSV export is requested
- THEN `bisection_residual` cell renders as `0,04` and `df_estimate` cell as `1,82`
- AND `quality` cell is `converged` (string, unaffected by locale)

#### Scenario 3.4 — Cross-project access (unchanged)

- GIVEN batch belongs to another project
- WHEN CSV endpoint is called
- THEN HTTP 403; no CSV body (unchanged from R3 of main spec)

### R4. Batch CSV endpoint returns N data rows + summary row

**GIVEN** a `FraktalBatch` with N images,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/csv/`,
**THEN** the response is HTTP 200, `Content-Type: text/csv`, with: header row + N image rows + 1 blank row + 1 summary row,
**AND** image row columns are: `index, filename, azimuth, elevation, fractal_dimension, prefactor, r_squared, n_particles_counted, error, dpo_used, autocalibrate_source, scale_factor_nm, pixels_per_100nm, quality, bisection_iterations, bisection_residual, failure_reason, df_estimate`,
**AND** the 5 new columns are appended AFTER `pixels_per_100nm` (end of existing image row set),
**AND** summary row columns extend with: `n_converged, n_approximate, n_excluded, n_failed, mean_df_inclusive` appended after existing summary fields,
**AND** numbers + delimiter respect R1; string fields (`quality`, `failure_reason`) use literal values.

(Previously: R4 image row columns ended at `pixels_per_100nm`; summary row ended at
`sim_box_counting_df`. No quality or bisection columns were present.)

#### Scenario 4.1 — Converged image row in batch CSV

- GIVEN batch image at index 0 with `quality = "converged"`, `bisection_iterations = 8`,
  `bisection_residual = 0.02`, `failure_reason = "none"`, `df_estimate = 1.75`
- WHEN batch CSV is exported
- THEN the row for index 0 ends with cells: `converged, 8, 0.02, none, 1.75`

#### Scenario 4.2 — Excluded image row in batch CSV

- GIVEN batch image at index 3 with `quality = "excluded"`, `failure_reason = "no_sign_change"`,
  null `df_estimate` and null `bisection_residual`
- WHEN batch CSV is exported
- THEN the row for index 3 ends with: `excluded, (empty), (empty), no_sign_change, (empty)`

#### Scenario 4.3 — Legacy batch row (no quality field)

- GIVEN a `FraktalBatchImage` row from before migration `0011`
  (quality defaults to "converged", diagnostic fields are null)
- WHEN batch CSV is exported
- THEN that row ends with: `converged, (empty), (empty), (empty), (empty)`
- AND no error is raised; CSV is well-formed

#### Scenario 4.4 — Summary row with quality counters

- GIVEN a batch of 10 images: 6 converged, 2 approximate, 1 excluded, 1 failed
- WHEN batch CSV is exported
- THEN the summary row contains `n_converged=6, n_approximate=2, n_excluded=1, n_failed=1`
- AND `mean_df_inclusive` is populated (mean over converged + approximate)
- AND existing summary fields (`n_images`, `mean_df`, etc.) are present and unchanged

### R5. Existing simulations CSV is byte-equivalent after locale hoist

**GIVEN** existing simulation export endpoints,
**WHEN** they run after the `csv_locale` module is hoisted out of `apps/simulations/views.py`,
**THEN** the output bytes are identical to pre-hoist output for identical inputs.

#### Scenario 5.1 — Snapshot equivalence
- **Input**: Known simulation; pre-hoist CSV captured as fixture.
- **Expected**: Post-hoist CSV bytes equal the fixture bytes for the same user locale prefs.

<!-- Last sync: 2026-05-06 from change fraktal-bisection-ux -->
