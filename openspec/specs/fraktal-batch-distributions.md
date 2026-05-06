# Spec: fraktal-batch-distributions

## Purpose

New capability defining the observable behavior for per-metric distribution histograms in
FRAKTAL batch analysis. Covers which metrics are visualized, the bucket algorithm, failed-image
exclusion, empty-data edge cases, and degenerate single-value batches.

This spec describes **observable behavior** — what the user sees in the UI and what the
component receives as data — not internal implementation.

## Requirements

### R1. Four metric histograms displayed in batch summary

The batch summary view MUST render one histogram for each of the following four metrics:
`Df` (fractal dimension), `kf` (prefactor), `Rg` (radius of gyration in nm), and `npo`
(number of primary particles). All four histograms MUST be persistent — they MUST appear
on the `FraktalBatchSummaryPage` route (the DB-backed page, not just the inline post-upload
transient view).

#### Scenario 1.1 — All four histograms present for successful batch

- GIVEN a completed batch with `n_successful ≥ 5` for all four metrics
- WHEN the `FraktalBatchSummaryPage` is rendered
- THEN four histogram panels are visible: Df, kf, Rg, npo
- AND each panel displays its axis label with the correct unit (Df: dimensionless, kf:
  dimensionless, Rg: nm, npo: count)

#### Scenario 1.2 — Histograms survive navigation

- GIVEN a user uploads a batch and views inline post-upload results
- WHEN the user navigates to the persisted route
  `/projects/{id}/fraktal/batches/{batchId}`
- THEN the four histograms are rendered from the persisted batch data
- AND the histograms match what was shown inline

#### Scenario 1.3 — Partial metric availability

- GIVEN a batch where `Rg` values are all null (e.g., legacy rows without `rg_nm`)
  but the other three metrics have `n_successful ≥ 5`
- WHEN the summary page renders
- THEN histograms for Df, kf, npo are shown
- AND the Rg panel shows the empty-data message (R4) instead of a histogram

---

### R2. Bucket count derived from Sturges' rule, bounded [3, 30]

For each metric histogram, the number of buckets MUST be computed using Sturges' rule:
`k = ceil(log2(n) + 1)` where `n` is the count of successful (non-null) values for that
metric. The result MUST be clamped to the range `[3, 30]` (minimum 3 buckets,
maximum 30 buckets). Bucket boundaries MUST be adaptive — evenly spaced over the
`[min, max]` range of the metric's successful values. Each metric's bucket count is
computed independently using its own `n_successful`.

#### Scenario 2.1 — Typical batch (n=20)

- GIVEN a batch with 20 successful Df values
- WHEN the Df histogram is computed
- THEN `k = ceil(log2(20) + 1) = ceil(5.32) = 6` buckets are used
- AND bucket boundaries span `[min_df, max_df]` evenly

#### Scenario 2.2 — Small batch at minimum bound (n=5)

- GIVEN a batch with 5 successful values for a metric
- WHEN the histogram is computed
- THEN `k = ceil(log2(5) + 1) = ceil(3.32) = 4` buckets are used
- AND bucket count is ≥ 3 (minimum bound satisfied)

#### Scenario 2.3 — Minimum-bound enforcement (n=2, k formula < 3)

- GIVEN a batch with 2 successful values
- WHEN Sturges' rule yields `ceil(log2(2) + 1) = 2`
- THEN the bucket count is clamped to 3 (minimum bound)

#### Scenario 2.4 — Maximum-bound enforcement (very large batch)

- GIVEN a batch with n=2000 successful values
- WHEN Sturges' rule yields `ceil(log2(2000) + 1) = ceil(11.97) = 12`
- THEN the bucket count is 12 (within [3, 30], no clamping needed)

#### Scenario 2.5 — Maximum clamp (n extremely large)

- GIVEN a hypothetical batch with n=2^29 ≈ 500M (pathological)
- WHEN Sturges' rule yields k > 30
- THEN the bucket count is clamped to 30

---

### R3. Failed images excluded from histograms; counted separately

For each metric histogram, only images where that metric's value is non-null
(successful analysis) MUST contribute to the histogram data. The component MUST
display a metadata label in the format `"N successful of M total"` below or above
each histogram panel, where N is the count of non-null values for that metric and
M is the total image count in the batch. Images where analysis failed entirely
(null Df, null kf, null Rg, null npo) MUST be excluded from all four histograms.

For the `Df` histogram specifically:
- `converged` images (residual < 0.1) MUST be included and rendered in the main histogram color.
- `approximate` images (residual 0.1–1.0) MUST be included and rendered with a yellow
  overlay on the relevant buckets where they fall.
- `excluded` and `failed` images MUST NOT contribute to the Df histogram (excluded from
  counts and bucket assignments).

(Previously: R3 excluded only images with null `fractal_dimension`. There was no quality-based
overlay distinction — all non-null Df values were rendered identically.)

#### Scenario 3.1 — All-converged batch: no yellow overlay

- GIVEN a batch where all 10 images have `quality = "converged"`
- WHEN the Df histogram is rendered
- THEN all 10 values contribute to the histogram in the main color only
- AND no yellow overlay is shown (n_approximate = 0)
- AND "10 successful of 10 total" label is shown

#### Scenario 3.2 — Mixed batch: yellow overlay visible

- GIVEN a batch of 15 images: 10 converged, 3 approximate, 1 excluded, 1 failed
- WHEN the Df histogram is rendered
- THEN the histogram is built from the 13 non-excluded/failed images (10 + 3)
- AND each bucket displays a yellow sub-bar for the approximate values that fall in it
- AND the main-color sub-bar represents the converged values in that bucket
- AND "13 successful of 15 total" label is shown (excluded+failed omitted)

#### Scenario 3.3 — All-approximate batch: only yellow bars

- GIVEN a batch of 8 images all with `quality = "approximate"`
- WHEN the Df histogram is rendered
- THEN all 8 df_estimate values contribute to the histogram in yellow only (no main-color bars)
- AND "8 successful of 8 total" label is shown

#### Scenario 3.4 — All-excluded/failed batch: empty histogram

- GIVEN a batch of 6 images all with `quality = "excluded"` or `"failed"`
- WHEN the Df histogram would be rendered
- THEN no chart is rendered (n_successful = 0 for Df)
- AND the panel displays the "No data available" message (R4 of main spec)

#### Scenario 3.5 — Non-Df metrics unaffected by quality overlay

- GIVEN a mixed batch with converged and approximate images
- WHEN the kf, Rg, and npo histograms are rendered
- THEN those histograms use the existing non-null exclusion logic only (no quality overlay)
- AND the Df histogram has the yellow overlay; the other three do not

---

### R4. Empty data (all failures for a metric) → no histogram, show message

When `n_successful = 0` for a specific metric (all images failed to produce a value for it),
the histogram panel for that metric MUST NOT render a chart. Instead, it MUST display a
message such as: "No data available — all images failed for this metric." The other three
metric histograms are unaffected and MUST be rendered normally if their own data permits.

For the Df metric specifically, `n_successful` counts images with `quality = "converged"`
OR `"approximate"` (i.e., images contributing to the histogram). `excluded` and `failed`
images do NOT count toward `n_successful` for Df histogram purposes.

(Previously: `n_successful` for Df counted any image with a non-null `fractal_dimension`.
This delta redefines it to include approximate df_estimate values as well, while excluding
the excluded/failed quality states.)

#### Scenario 4.1 — All-excluded Df batch: empty panel

- GIVEN a batch where all images have `quality = "excluded"` or `"failed"`
- WHEN the Df panel renders
- THEN "No data available" message is shown; no histogram chart
- AND other metric panels (kf, Rg, npo) are unaffected

#### Scenario 4.2 — Mixed metrics: Df has data, Rg does not

- GIVEN a batch with 8 converged Df values but all Rg null (legacy batch)
- WHEN histograms render
- THEN Df histogram renders with 8 bars; Rg panel shows "No data available"

---

### R5. Single unique value → degenerate histogram with one bar

When `n_successful ≥ 5` but all successful values for a metric are identical (zero variance),
the histogram MUST render a single bar spanning that value (bucket of width 0 or minimal
display width). The component MUST NOT error or omit the histogram in this case.
The "N successful of M total" label MUST still appear.

#### Scenario 5.1 — All Df values identical

- GIVEN a batch where all 10 successful images have `Df = 1.80`
- WHEN the Df histogram is computed
- THEN a single bar is rendered at `Df = 1.80`
- AND bucket count is 3 (minimum per R2, since the range is zero)

#### Scenario 5.2 — One metric degenerate, others normal

- GIVEN a batch where all kf values are identical but Df/Rg/npo have variance
- WHEN histograms are rendered
- THEN kf shows a single-bar degenerate histogram
- AND the other three histograms render normally with multiple buckets

#### Scenario 5.3 — Degenerate at minimum threshold boundary

- GIVEN n_successful = 5, all values equal
- WHEN histogram renders
- THEN a single bar is shown; no error; label reads "5 successful of M total"

---

## ADDED Requirements

### R-DELTA-L. Df histogram stats display: both mean_df and mean_df_inclusive shown

**GIVEN** a batch result with a non-empty Df histogram,
**WHEN** the `FraktalBatchDistributions` component renders the Df histogram panel,
**THEN** the panel MUST display `mean_df` as a primary statistic label (converged-only mean),
**AND** the panel MUST display `mean_df_inclusive` as a secondary statistic label
(converged + approximate mean) if `n_approximate > 0`,
**AND** the two values MUST be visually distinct (e.g., different color, label, font weight),
**AND** when `n_approximate = 0`, `mean_df_inclusive` is equal to `mean_df`; the secondary
label SHOULD NOT be shown in that case to avoid visual redundancy.

#### Scenario L.1 — All-converged: single mean shown

- GIVEN a batch where `n_approximate = 0`
- WHEN the Df histogram panel renders
- THEN only `mean_df` is shown (primary label only; no secondary label)

#### Scenario L.2 — Mixed batch: both means shown

- GIVEN a batch with `n_converged = 6` (mean_df = 1.80), `n_approximate = 3`
  (mean_df_inclusive = 1.74)
- WHEN the Df histogram panel renders
- THEN `mean_df = 1.80` is shown as the primary label
- AND `mean_df_inclusive = 1.74` is shown as the secondary label with visual distinction

### R-DELTA-M. Df histogram tooltip shows per-quality count breakdown

**GIVEN** a Df histogram bucket that contains both `converged` and `approximate` images,
**WHEN** the user hovers over that bucket,
**THEN** the tooltip MUST display a count breakdown in the format:
`"{converged_count} converged, {approximate_count} approximate"` for the values
falling in that bucket,
**AND** when a bucket contains only converged images, the tooltip MUST show only
`"{count} converged"` (omitting the approximate line),
**AND** when a bucket contains only approximate images, the tooltip MUST show only
`"{count} approximate"` (omitting the converged line),
**AND** the total count shown in the tooltip MUST equal `converged_count + approximate_count`.

#### Scenario M.1 — Bucket with mixed quality

- GIVEN bucket at Df range [1.70, 1.80] contains 4 converged and 2 approximate values
- WHEN user hovers over that bucket
- THEN tooltip reads "4 converged, 2 approximate" (total 6)

#### Scenario M.2 — Bucket with converged only

- GIVEN bucket at Df range [1.80, 1.90] contains 5 converged values only
- WHEN user hovers over that bucket
- THEN tooltip reads "5 converged"

#### Scenario M.3 — Bucket with approximate only

- GIVEN a batch that is entirely approximate
- WHEN user hovers over any bucket
- THEN tooltip reads "{count} approximate"; no converged line appears

<!-- Last sync: 2026-05-06 from change fraktal-bisection-ux -->
