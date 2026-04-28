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
**AND** columns are: `analysis_id, created_at, algorithm, image_filename, fractal_dimension, prefactor, r_squared, n_particles_counted, error, dpo_used, autocalibrate_source, scale_factor_nm, pixels_per_100nm, rg, ap, volume, mass, surface_area, sim_id, sim_target_df, sim_box_counting_df, calibration_source`,
**AND** numbers + delimiter respect R1.

#### Scenario 3.1 — Analysis linked to simulation
- **Expected**: `sim_id`, `sim_target_df`, `sim_box_counting_df` populated.

#### Scenario 3.2 — Analysis without simulation link
- **Expected**: those three columns empty.

#### Scenario 3.3 — Failed analysis
- **Input**: analysis with non-empty `error`, null metrics.
- **Expected**: `error` column populated; metric columns empty.

#### Scenario 3.4 — Cross-project access
- **Expected**: 403; no CSV body.

### R4. Batch CSV endpoint returns N data rows + summary row

**GIVEN** a `FraktalBatch` with N images,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/csv/`,
**THEN** the response is HTTP 200, `Content-Type: text/csv`, with: header row + N image rows + 1 blank row + 1 summary row,
**AND** image columns are: `index, filename, azimuth, elevation, fractal_dimension, prefactor, r_squared, n_particles_counted, error, dpo_used, autocalibrate_source, scale_factor_nm, pixels_per_100nm`,
**AND** summary row begins with the literal `SUMMARY` and contains: `n_images, mean_df, std_df, median_df, min_df, max_df, sim_id, sim_target_df, sim_box_counting_df`,
**AND** numbers + delimiter respect R1.

#### Scenario 4.1 — Complete batch
- **Input**: N=10, all-success.
- **Expected**: 11 image-region lines (header + 10) + blank + summary; `n_images=10`.

#### Scenario 4.2 — Partial-failure batch
- **Input**: N=10, 3 failures.
- **Expected**: 10 image rows; failed rows have `error` populated and metric columns empty; summary stats over successful 7.

#### Scenario 4.3 — Batch linked to simulation
- **Expected**: `sim_id`, `sim_target_df`, `sim_box_counting_df` populated in summary row.

#### Scenario 4.4 — Cross-project access
- **Expected**: 403.

### R5. Existing simulations CSV is byte-equivalent after locale hoist

**GIVEN** existing simulation export endpoints,
**WHEN** they run after the `csv_locale` module is hoisted out of `apps/simulations/views.py`,
**THEN** the output bytes are identical to pre-hoist output for identical inputs.

#### Scenario 5.1 — Snapshot equivalence
- **Input**: Known simulation; pre-hoist CSV captured as fixture.
- **Expected**: Post-hoist CSV bytes equal the fixture bytes for the same user locale prefs.
