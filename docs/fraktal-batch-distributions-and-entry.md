# FRAKTAL Batch Distributions + Sim Entry Point (Frente 9)

Adds persistent metric distributions (Df, kf, Rg, npo) to the batch
summary view, surfaces Rg in the per-image results table, and provides
a sim-results → batch-upload entry point so the autocalibrate=OFF path
introduced in frente 8 P5 is finally reachable from the UI.

## Why

Three user-reported gaps from the post-frente-8 sessions:

1. **Distribution disappeared on revisit**: the Df histogram was only
   visible "fresh" right after a batch completed. Navigating away and
   back to the batch summary route (frente 6 fix) wiped the chart —
   it was never persisted/recomputed for that view.

2. **Rg missing from results**: the per-image table had Df, kf, R²,
   and counts, but no radius of gyration column. Rg was computed by
   the engine but discarded by the binding before reaching Python.

3. **Path A unreachable**: frente 8 P5 implemented the "Using known
   dpo from simulation" pre-fill but no UI element triggered it.
   Users who clicked "Batch FRAKTAL" entered through the generic
   upload page with `origin=external` always.

## What changed

### Engine + binding

- `BatchImageResult` (Rust) gains `rg_nm: Option<f64>`, wired from the
  underlying `FraktalResult.rg` (already in nm, no conversion).
- Both `analyze_fraktal_batch` and
  `analyze_fraktal_batch_per_image_scale` Python bindings now expose
  `rg_nm` in each per-image dict (`None` for failed images).

### Backend

- New migration `0010_add_rg_nm_field.py` adds `rg_nm FloatField
  null=True` to `FraktalBatchImage`. Additive, nullable, reversible.
- `services/batch.py::persist_batch_results` now stores `rg_nm` from
  the engine output.
- `services/batch.py::compute_metric_stats(images, key)` is a new pure
  helper that computes mean/std/median/min/max for a metric, excluding
  failed images.
- All three response paths (`batch_detail_view`,
  `batch_image_detail_view`, `_serialize_batch_from_db`,
  `_build_batch_response`) include `rg_nm` per image AND a `stats.{kf,
  rg, npo}` aggregate block. The legacy `mean_df`/`std_df`/etc. fields
  are preserved for backward compat.

### Frontend

- New component `FraktalBatchDistributions` renders 4 Plotly
  histograms (Df, kf, Rg, npo) in a responsive 2x2 grid:
    * Bucket count via Sturges' rule (`k = clamp(ceil(log2(n) + 1), 3,
      30)`), computed independently per metric.
    * Failed images excluded from histograms; "(N succ / M total)"
      shown in each plot title.
    * < 5 successful values per metric → "Not enough data" placeholder
      (consistent with the existing R8 threshold in
      `fraktal-batch-contract`).
    * 0 successful values overall → single "No data — all images
      failed" card replaces the grid.
    * Single-value distributions (zero variance) → Plotly renders a
      single bar naturally.
- `FraktalBatchSummaryPage` now mounts the distributions component
  inside a labeled `<section role="region" aria-label="Metric
  distributions">` between the batch header and the results table.
  Visible on every visit to the route.
- `FraktalBatchResultsView` adds a sortable Rg column between kf and
  R², format `fmt(rg_nm, 1)` (1-decimal nm), null → "—".
- New "Analyze projections" button (BarChart3 icon) in the simulation
  detail action bar, visible when `simulation.status === 'completed'`.
  Click navigates to
  `/projects/{id}/fraktal/batch?origin=simulation&sim_id={simId}`.
- The batch upload page (`fraktal/batch/page.tsx`) now reads the query
  params via `useSearchParams()`. When `origin=simulation` AND
  `sim_id` is present:
    * Fetch the simulation via `simulationsApi.get`.
    * Resolve dpo via `getPrimaryParticleDiameterNm` (handles v1/v2
      schemas).
    * Pass `origin="simulation"` + `simulation={id, parameters:
      {dpo_nm}}` props to `FraktalBatchUpload`.
  Soft fallback: if the sim fetch rejects, log a warning and continue
  in `external` mode (does NOT block the user).

## Migration notes

After deploy, apply the migration:

```bash
python manage.py migrate fractal_analysis 0010
```

The migration is additive (no destructive changes). Existing
`FraktalBatchImage` rows have `rg_nm = NULL` until reanalyzed.

## Backward compatibility

- **Legacy DB rows** (no `rg_nm` populated): the field is nullable;
  the API returns `rg_nm: null`; the frontend table shows "—" and
  excludes the row from the Rg histogram.
- **Legacy server responses** (no `stats.{kf,rg,npo}` block): the
  `FraktalBatchDistributions` component computes stats client-side
  from the images array as a fallback.
- **External ZIP uploads** (no sim context): the upload form keeps
  the previous behavior — `autocalibrate=ON` default, manual dpo
  input shown when the toggle is off.

## Validation

Cross-cutting integration test at
`backend/tests/integration/test_fraktal_batch_distributions.py`
exercises the engine→binding portion: synthetic 2D binary projections
fed through `analyze_fraktal_batch_per_image_scale` produce per-image
result dicts that include `rg_nm` (positive finite for successful
images, None for failures).

Frontend behavior is covered by 3 vitest test files:

- `FraktalBatchDistributions.test.tsx` — 12 cases (Sturges helper,
  4-plot rendering, edge-case messages, mixed-availability defense).
- `FraktalBatchResultsView.test.tsx` and
  `FraktalBatchSummaryPage.test.tsx` — 3 new cases each (Rg column
  header, Rg value rendering with null fallback, Distributions
  section accessibility).
- `app/projects/[id]/fraktal/batch/__tests__/page.test.tsx` — 5
  cases (external default, sim-mode, sim 404 fallback, partial
  params).

## Known limitations

- **Synthetic geometry edge case**: pure binary 2D projections fed
  through `input_variants=["scientific"]` may produce
  `n_particles_counted=1` and identical `rg_nm` across different
  geometries due to a separate engine detector behavior on
  bypass-Otsu binary inputs. This does NOT affect production
  pipelines that operate on actual projection PNGs (with the matrix
  + AA halo in the presentation variant). Tracked in engram
  `pyaglogen3D/backlog/engine-synthetic-geometry-bug`.
