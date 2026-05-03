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

#### Scenario 3.1 — Partial failure batch

- GIVEN a batch of M=10 images where 3 images have null Df (failed)
  and 2 images have null Rg (different failed set)
- WHEN the Df histogram is rendered
- THEN it uses only the 7 non-null Df values
- AND shows "7 successful of 10 total" near the Df histogram

#### Scenario 3.2 — Different failure sets per metric

- GIVEN batch where image A has null kf but valid Df, and image B has null Df but valid kf
- WHEN histograms are rendered
- THEN Df histogram uses N-1 values (excluding image B's null)
- AND kf histogram uses N-1 values (excluding image A's null)
- AND each histogram's "N successful of M total" reflects its own metric's count

#### Scenario 3.3 — All images successful

- GIVEN a batch where all images produce non-null values for all four metrics
- WHEN histograms are rendered
- THEN "M successful of M total" is shown for each histogram
- AND no failure note is prominent (only the metadata label)

#### Scenario 3.4 — Failed count label present even at threshold boundary

- GIVEN a batch with exactly 5 successful Df values out of 8 total
- WHEN the Df histogram is shown
- THEN the label reads "5 successful of 8 total"

---

### R4. Empty data (all failures for a metric) → no histogram, show message

When `n_successful = 0` for a specific metric (all images failed to produce a value for it),
the histogram panel for that metric MUST NOT render a chart. Instead, it MUST display a
message such as: "No data available — all images failed for this metric." The other three
metric histograms are unaffected and MUST be rendered normally if their own data permits.

#### Scenario 4.1 — All images failed for one metric

- GIVEN a batch with valid Df/kf/npo but all Rg values are null
- WHEN the summary page renders
- THEN Rg panel shows the empty-data message
- AND Df, kf, npo histograms render normally

#### Scenario 4.2 — All images failed for all metrics

- GIVEN a batch where every image returned null for every metric
- WHEN the summary page renders
- THEN all four panels show the empty-data message
- AND no histogram chart is rendered for any metric

#### Scenario 4.3 — n_successful below threshold (< 5) treated as empty

- GIVEN a batch with `n_successful = 3` for kf (below the minimum-display threshold
  inherited from the existing R8 pattern in `fraktal-batch-contract`)
- WHEN the kf panel renders
- THEN no histogram chart is shown for kf
- AND the panel displays the "insufficient data" message noting 3 images

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

<!-- Last sync: 2026-05-03 from change fraktal-batch-distributions-and-entry -->
