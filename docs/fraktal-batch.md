# FRAKTAL Batch Analysis

Automate box-counting Df analysis across many projection images at once.
Perfect for analyzing the full output of a projection export (grid or
fibonacci) without calibrating each image by hand.

## How to use

1. Simulate an aggregate
2. Export projections (grid or fibonacci mode) → ZIP downloaded
3. Go to **FRAKTAL** in the project sidebar
4. Click **Try batch analysis** link on the single-image page
5. Drag and drop the ZIP
6. If the ZIP has metadata from our exporter, calibration is automatic
7. Click **Analyze batch** → results page with table + histogram + comparison card

## Auto-calibration

ZIPs produced by the projection export include a `metadata.json` with
`parameters.pixels_per_100nm`. The upload component detects this
client-side and shows a badge "Auto-calibrated from metadata: X px/100nm".
No user input needed.

For ZIPs from other sources (MATLAB direct export, manually assembled
collections), the upload form shows a manual `pixels_per_100nm` input.

## Autocalibrate dpo

Optional. When enabled, the first image in the ZIP is analyzed with the
existing autocalibrate routine (Otsu + particle counting) to derive the
primary particle diameter. That single value is then reused for all
images in the batch — the aggregate is the same from every viewing
angle, so its dpo doesn't change per projection. Saves ~4N seconds vs
per-image calibration.

If image[0]'s autocalibrate fails (e.g., pure noise, odd edge cases),
the system retries on image[N/2]. If both fail, the batch errors out
with a clear message.

## Sync vs async

- **N ≤ 30 images**: synchronous. Results returned immediately
  (typically under 30 seconds).
- **N > 30 images**: queued via Celery. The UI shows a progress bar
  with current/total + stage (autocalibrate → analyzing → aggregating).

## Output

Three views combined:

### 1. Batch Summary
Mean ± std Df, median, Q1/Q3, min/max. Plus calibration provenance
(source: metadata/manual/autocalibrate, pixels_per_100nm, dpo used).

### 2. Df Distribution (histogram)
- N < 5: histogram hidden (not enough data)
- 5 ≤ N < 10: Sturges' rule (`k = ceil(log2(n) + 1)`)
- N ≥ 10: Freedman-Diaconis rule (`bin_width = 2·IQR/n^(1/3)`)

### 3. Per-image table
Sortable columns: index, filename, azimuth, elevation, Df, kf, R², N
particles counted. Click any column header to sort ascending; click
again to reverse.

### 4. Df Comparison card (when sim linked)

When the ZIP filename matches `{uuid}_projections.zip` pattern OR you
provide a sim_id manually:

| Metric | Source | Typical |
| ------ | ------ | ------- |
| FRAKTAL mean | 2D box-counting of N projections | lower |
| Sim target | user-specified Df target | user-defined |
| Sim 3D box-counting | engine's own box-counting on the 3D aggregate | higher |

> Note: 2D projection fractal dimension is systematically lower than
> the 3D aggregate Df (Sorensen 1992). Typical gap: 0.1–0.3. This is
> expected and does NOT indicate simulation error.

## Legacy single-image mode

The original single-image FRAKTAL workflow is unchanged. Access it
from the same FRAKTAL page — the batch CTA only adds a link to the
batch route.

## Related specs

- `openspec/specs/fraktal-batch-contract.md` — the observable contract
- `openspec/changes/archive/fraktal-batch-analysis-2026-04-24/` — change history
