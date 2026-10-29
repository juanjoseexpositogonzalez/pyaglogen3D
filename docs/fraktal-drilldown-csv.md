# FRAKTAL Drill-down, Re-analyze & CSV Export

Extends batch FRAKTAL analysis with per-image drill-down, re-analyze,
batch/single CSV export, and batch delete.

## Drill-down

After a batch analysis completes, click any row in the results table to
open the drill-down view for that image.

**Route**: `/projects/{id}/fraktal/batch/{batchId}/image/{index}`

The drill-down page shows:

- Full-size PNG preview (served from the DB-persisted rasterization)
- Per-image metrics: Df, kf, R², N particles counted
- Calibration info: dpo used, scale factor, pixels/100nm
- Comparison card (when the batch is linked to a simulation)
- Error details (when the image's analysis failed)

### Navigation

- **Previous / Next** links step through images in the batch
- **← →** keyboard shortcuts navigate to previous / next image
- At the first image, Previous is disabled; at the last, Next is disabled
- **Back to Batch** link returns to the results table

## CSV Export

Two CSV endpoints, both locale-aware (honoring user preferences from
Settings → CSV Export Preferences):

### Single-image CSV

`GET /api/v1/projects/{pk}/fraktal/{analysisId}/csv/`

Header + 1 data row. Columns: `analysis_id`, `created_at`, `algorithm`,
`image_filename`, `fractal_dimension`, `prefactor`, `r_squared`,
`n_particles_counted`, `error`, `dpo_used`, `autocalibrate_source`,
`scale_factor_nm`, `pixels_per_100nm`, `rg`, `ap`, `volume`, `mass`,
`surface_area`, `sim_id`, `sim_target_df`, `sim_box_counting_df`,
`calibration_source`.

### Batch CSV

`GET /api/v1/projects/{pk}/fraktal/batches/{batchId}/csv/`

Header + N image rows + blank line + SUMMARY row.

Image columns: `index`, `filename`, `azimuth`, `elevation`,
`fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`,
`error`, `dpo_used`, `autocalibrate_source`, `scale_factor_nm`,
`pixels_per_100nm`.

The SUMMARY row begins with the literal `SUMMARY` and contains:
`n_images`, `mean_df`, `std_df`, `median_df`, `min_df`, `max_df`,
`sim_id`, `sim_target_df`, `sim_box_counting_df`.

### Locale handling

- **es-AR** (or any EU-style): decimal `,`, delimiter `;`
- **en-US** (default): decimal `.`, delimiter `,`
- Anonymous users get the US default

## Re-analyze

On the drill-down page, click **Re-analyze** to create a persistent
`FraktalAnalysis` row from the cached PNG.

- Uses the batch's `dpo_used` (no fresh autocalibrate)
- Inherits the batch algorithm
- Multiple re-analyses on the same image create independent rows
- The new analysis appears in the project's FRAKTAL analysis list

## Delete Batch

On the batch results page, click **Delete batch** → confirm.

- Deletes the `FraktalBatch` row and all `FraktalBatchImage` rows
- Any re-analyzed `FraktalAnalysis` rows survive (independent)
- No automatic retention policy — deletion is manual only

## PNG Cache

The per-image PNG endpoint uses `Cache-Control: public, max-age=31536000,
immutable`. This means browsers and CDNs will cache the PNG for 1 year.

If you suspect data corruption, a hard refresh or a new URL (e.g.
re-uploading the batch) is needed — the cached PNG will not be re-fetched
within the TTL.

## Operational Notes

- The legacy `var/batch_results/` directory that stored JSON-on-disk batch
  results is deprecated. New batches write exclusively to the DB. Old files
  can be manually deleted after confirming no in-flight jobs reference them.
- Migration: run `python manage.py migrate fractal_analysis` after deploy
  to create the `FraktalBatch` and `FraktalBatchImage` tables.
