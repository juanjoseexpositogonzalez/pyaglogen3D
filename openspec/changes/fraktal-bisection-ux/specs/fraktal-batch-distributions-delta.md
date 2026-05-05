# Delta for fraktal-batch-distributions

Existing capability `fraktal-batch-distributions` still applies in full. This delta records
three changes introduced by `fraktal-bisection-ux`:

1. Df histogram renders `approximate` images with a yellow overlay alongside `converged`
   (main color). `excluded` and `failed` images remain excluded from histograms.
2. Stats display in the distribution component shows BOTH `mean_df` (converged-only,
   primary) AND `mean_df_inclusive` (converged + approximate, secondary).
3. Histogram tooltip shows per-quality count breakdown in mixed batches.

`kf`, `Rg`, and `npo` histograms are NOT affected by quality overlay — only `Df` histogram
receives the dual-color treatment, as quality classification is bisection-specific.

---

## MODIFIED Requirements

### R3. Failed images excluded from histograms; counted separately

Modifies **R3 of [`fraktal-batch-distributions.md`](../../../specs/fraktal-batch-distributions.md)**.

For each metric histogram, only images where that metric's value is non-null (successful
analysis) MUST contribute to the histogram data. The component MUST display a metadata
label in the format `"N successful of M total"` below or above each histogram panel,
where N is the count of non-null values for that metric and M is the total image count
in the batch. Images where analysis failed entirely (null Df, null kf, null Rg, null npo)
MUST be excluded from all four histograms.

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

Modifies **R4 of [`fraktal-batch-distributions.md`](../../../specs/fraktal-batch-distributions.md)**.

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

## ADDED Requirements

### R-DELTA-L. Df histogram stats display: both mean_df and mean_df_inclusive shown

Adds to [`fraktal-batch-distributions.md`](../../../specs/fraktal-batch-distributions.md).

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

Adds to [`fraktal-batch-distributions.md`](../../../specs/fraktal-batch-distributions.md).

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
