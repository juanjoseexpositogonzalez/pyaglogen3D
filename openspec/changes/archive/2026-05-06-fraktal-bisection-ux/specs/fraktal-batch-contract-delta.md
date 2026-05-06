# Delta for fraktal-batch-contract

Existing capability `fraktal-batch-contract` still applies in full. This delta records
two changes introduced by `fraktal-bisection-ux`:

1. Per-image drill-down response gains 6 bisection diagnostic fields: `bisection_iterations`,
   `bisection_residual`, `failure_reason`, `df_estimate`, `quality`, `quality_score`.
2. Batch stats block gains 4 quality counters (`n_converged`, `n_approximate`, `n_excluded`,
   `n_failed`) and a new `mean_df_inclusive` aggregate. Existing `mean_df` semantic shifts
   to converged-only (was: all non-null Df values).

Quality classification:
- `converged`: residual < 0.1 (CONVERGENCE_THRESHOLD)
- `approximate`: 0.1 ≤ residual ≤ EXCLUDED_RESIDUAL_THRESHOLD (1.0, configurable)
- `excluded`: residual > 1.0 OR failure_reason = no_sign_change
- `failed`: failure_reason = kf_negative OR engine crash

`quality_score` is derived from residual: `max(0.0, 1.0 - residual / EXCLUDED_RESIDUAL_THRESHOLD)`,
clamped to [0.0, 1.0]; always 0.0 for excluded/failed.

---

## MODIFIED Requirements

### R6. Per-image result shape

Modifies **R6 of [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md)**.

**GIVEN** a batch job completes (sync or async),
**WHEN** per-image results are assembled,
**THEN** each entry MUST contain exactly: `filename`, `azimuth`, `elevation`,
`fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`,
`calibration_used: {pixels_per_100nm, dpo_nm}`,
**AND** `azimuth` / `elevation` are pulled from `metadata.directions[]` matched by filename
when available, else `null`,
**AND** `fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted` MAY be `null`
when the analyzer cannot produce a value,
**AND** entries are sourced from the DB-backed `FraktalBatchImage` rows persisted per
`fraktal-batch-persistence` (no JSON-on-disk file is read or written),
**AND** each entry MUST additionally contain:
- `quality: enum (converged | approximate | excluded | failed)` — NEVER null
- `quality_score: float [0.0, 1.0]` — 0.0 for excluded/failed; derived from residual
- `bisection_iterations: int | null` — null when engine did not surface the value
- `bisection_residual: float | null` — null for failed/excluded images without residual data
- `failure_reason: enum (no_sign_change | kf_negative | iteration_limit | none) | null` —
  null for images where the engine crashed without categorizing the failure; `none` for converged
- `df_estimate: float | null` — best Df approximation even if not converged; null when no
  estimate is computable (e.g., no_sign_change)

(Previously: R6 did not include `quality`, `quality_score`, `bisection_iterations`,
`bisection_residual`, `failure_reason`, or `df_estimate`. `fractal_dimension` was the only
Df-related field.)

#### Scenario 6.1 — Image matched to metadata direction

- GIVEN image index 0, direction from metadata present
- WHEN per-image result assembled
- THEN `azimuth` and `elevation` populated from `metadata.directions[0]`

#### Scenario 6.2 — Converged image fields

- GIVEN an image whose bisection converged with residual 0.04, iterations 12, Df 1.82
- WHEN per-image result is assembled
- THEN `quality = "converged"`, `quality_score ≈ 0.96`, `bisection_iterations = 12`,
  `bisection_residual = 0.04`, `failure_reason = "none"`, `df_estimate = 1.82`,
  `fractal_dimension = 1.82`

#### Scenario 6.3 — Approximate image (residual 0.5)

- GIVEN an image whose bisection did not converge (residual = 0.5 < 1.0 threshold)
- WHEN per-image result is assembled
- THEN `quality = "approximate"`, `quality_score = 0.5`, `bisection_residual = 0.5`,
  `failure_reason = "iteration_limit"`, `df_estimate` is non-null, `fractal_dimension = null`

#### Scenario 6.4 — Excluded image (no_sign_change)

- GIVEN an image where bisection failed with no_sign_change error
- WHEN per-image result is assembled
- THEN `quality = "excluded"`, `quality_score = 0.0`, `failure_reason = "no_sign_change"`,
  `df_estimate = null`, `fractal_dimension = null`, `bisection_residual = null`

#### Scenario 6.5 — Failed image (kf_negative)

- GIVEN an image where bisection raised kf_negative error
- WHEN per-image result is assembled
- THEN `quality = "failed"`, `quality_score = 0.0`, `failure_reason = "kf_negative"`,
  `df_estimate = null`, `fractal_dimension = null`

#### Scenario 6.6 — Engine crash (no category)

- GIVEN an image where the engine panicked or raised an uncategorized exception
- WHEN per-image result is assembled
- THEN `quality = "failed"`, `failure_reason = null` (not `"none"` — null indicates
  no category was surfaced by the engine)

---

### R7. Batch statistics

Modifies **R7 of [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md)**.

**GIVEN** `N ≥ 1` per-image results,
**WHEN** batch statistics are computed,
**THEN** the response includes: `{n_images, n_successful, mean_df, std_df, median_df,
q1_df, q3_df, min_df, max_df}`,
**AND** `mean_df` is computed ONLY over entries with `quality = "converged"` (NOT approximate),
**AND** the response MUST additionally include:
- `n_converged: int` — count of images with `quality = "converged"`
- `n_approximate: int` — count of images with `quality = "approximate"`
- `n_excluded: int` — count of images with `quality = "excluded"`
- `n_failed: int` — count of images with `quality = "failed"`
- `mean_df_inclusive: float | null` — mean Df computed over `converged + approximate`
  images; null when both counts are zero
**AND** if `n_converged = 0`, `mean_df` is `null`,
**AND** `mean_df_inclusive` is `null` when `n_converged + n_approximate = 0`,
**AND** if `n_successful = 1` and that image is converged, `std_df = 0`.

(Previously: `mean_df` was computed over ALL entries with non-null `fractal_dimension`,
including approximate results. This delta narrows `mean_df` to converged-only and
introduces `mean_df_inclusive` for the broader aggregate.)

#### Scenario 7.1 — All-converged batch (N=10)

- GIVEN 10 images all with `quality = "converged"`
- WHEN batch stats computed
- THEN `n_converged = 10`, `n_approximate = 0`, `n_excluded = 0`, `n_failed = 0`,
  `mean_df` computed over all 10, `mean_df_inclusive = mean_df` (same set)

#### Scenario 7.2 — Mixed quality batch

- GIVEN batch of 10: 6 converged (mean Df 1.80), 2 approximate (mean Df 1.71), 1 excluded, 1 failed
- WHEN batch stats computed
- THEN `n_converged = 6`, `n_approximate = 2`, `n_excluded = 1`, `n_failed = 1`,
  `mean_df` is mean of the 6 converged values only,
  `mean_df_inclusive` is mean of the 8 (converged + approximate) values,
  `mean_df ≠ mean_df_inclusive`

#### Scenario 7.3 — All-failed batch

- GIVEN batch where all images have `quality = "failed"` or `"excluded"`
- WHEN batch stats computed
- THEN `n_converged = 0`, `n_approximate = 0`, `mean_df = null`, `mean_df_inclusive = null`,
  `n_excluded + n_failed = N`

#### Scenario 7.4 — Converged-only, single image

- GIVEN N=1, one converged image with Df 1.75
- WHEN batch stats computed
- THEN `mean_df = 1.75`, `std_df = 0`, `mean_df_inclusive = 1.75`

#### Scenario 7.5 — All-approximate batch

- GIVEN batch of 5 images all with `quality = "approximate"`
- WHEN batch stats computed
- THEN `n_converged = 0`, `n_approximate = 5`, `mean_df = null` (no converged),
  `mean_df_inclusive` is mean of the 5 approximate df_estimate values
