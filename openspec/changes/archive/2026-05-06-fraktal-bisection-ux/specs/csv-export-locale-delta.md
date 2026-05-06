# Delta for csv-export-locale

Existing capability `csv-export-locale` still applies in full. This delta records one
change introduced by `fraktal-bisection-ux`:

1. Single-image CSV and batch CSV exports each gain 5 bisection quality columns appended
   at the end of their existing column sets. Old parsers that ignore unknown columns are
   unaffected.

Locale rules: numeric fields (`bisection_residual`, `df_estimate`) respect the user's
`csv_decimal_separator` via `write_localized_row`. String fields (`quality`,
`failure_reason`) use the literal enum value unchanged (no locale transformation).
Integer fields (`bisection_iterations`) use int formatting (unchanged per R2 of main spec).

---

## MODIFIED Requirements

### R3. Single-image CSV endpoint returns one data row with full columns

Modifies **R3 of [`csv-export-locale.md`](../../../specs/csv-export-locale.md)**.

**GIVEN** a `FraktalAnalysis` row owned by the requester,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/{analysisId}/csv/`,
**THEN** the response is HTTP 200, `Content-Type: text/csv`, with a header row + exactly
1 data row,
**AND** columns are: `analysis_id, created_at, algorithm, image_filename, fractal_dimension,
prefactor, r_squared, n_particles_counted, error, dpo_used, autocalibrate_source,
scale_factor_nm, pixels_per_100nm, rg, ap, volume, mass, surface_area, sim_id,
sim_target_df, sim_box_counting_df, calibration_source, quality, bisection_iterations,
bisection_residual, failure_reason, df_estimate`,
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

---

### R4. Batch CSV endpoint returns N data rows + summary row

Modifies **R4 of [`csv-export-locale.md`](../../../specs/csv-export-locale.md)**.

**GIVEN** a `FraktalBatch` with N images,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/csv/`,
**THEN** the response is HTTP 200, `Content-Type: text/csv`, with: header row + N image
rows + 1 blank row + 1 summary row,
**AND** image row columns are: `index, filename, azimuth, elevation, fractal_dimension,
prefactor, r_squared, n_particles_counted, error, dpo_used, autocalibrate_source,
scale_factor_nm, pixels_per_100nm, quality, bisection_iterations, bisection_residual,
failure_reason, df_estimate`,
**AND** the 5 new columns are appended AFTER `pixels_per_100nm` (end of existing image row set),
**AND** summary row columns extend with: `n_converged, n_approximate, n_excluded, n_failed,
mean_df_inclusive` appended after existing summary fields,
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

- GIVEN a `FraktalBatchImage` row from before migration `0010`
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
