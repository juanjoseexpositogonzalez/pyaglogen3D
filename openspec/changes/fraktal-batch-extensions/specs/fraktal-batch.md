# Delta Spec: fraktal-batch-extensions → capabilities fraktal-batch-contract + fraktal-batch-distributions

> Persona-locked 2026-10-19: candidatos C1+C2+C3 (los tres), **sin estimator 2D nuevo**.
> Anclaje: Engram `batch-fractal/exploration`; specs canónicas `fraktal-batch-contract.md` /
> `fraktal-batch-distributions.md`. Extensiones aditivas — ningún requisito existente cambia.

## ADDED Requirements (capability fraktal-batch-contract)

### Requirement: R12. Batch-level study comparison (C1)

The batch summary payload (`_build_batch_response` / `_serialize_batch_from_db`,
`fractal_analysis/views.py:531/840`) SHALL gain an additive `study_comparison` block over
images linked to simulations (`sim_id` present, R9):

```json
{
  "linked_images": 18,
  "unlinked_images": 4,
  "image_df": {"n": 18, "mean": …, "median": …, "min": …, "max": …},
  "sim_df":   {"n": 12, "mean": …, "median": …, "min": …, "max": …, "missing_sim_metrics": 6},
  "mean_delta": …,
  "per_config": [{"config": {…sim.parameters…}, "image_df": {…}, "sim_df": {…}, "mean_delta": …}],
  "sorensen_note": true
}
```

- `sim_df` reads `metrics["fractal_dimension"]` of each linked sim (same source as
  `sim_box_counting_df`, `fractal_analysis/views.py:1132`); sims without the metric count in
  `missing_sim_metrics` and are excluded from stats.
- `mean_delta = sim_df.mean − image_df.mean`. Quartiles omitted (percentiles live in the
  distributions spec, not here); stats formula = same helper family as batch stats (R7).
- `per_config` groups by the linked sim's `parameters` dict (same keys as `param_keys`,
  `views.py:2010-2011`); omitted when no sim is linked.
- `sorensen_note: true` signals the UI to render the R11 educational note at batch level
  (2D image Df vs 3D sim Df are not directly comparable).

#### Scenario R12.1 — Block present with mixed links

- **GIVEN** a batch with 18 linked + 4 unlinked images, 12 linked sims carrying the metric
- **WHEN** the summary is serialized
- **THEN** the block matches the shape above with `linked_images: 18, unlinked_images: 4,
  missing_sim_metrics: 6`
- **AND** every pre-existing summary key is unchanged (additive payload)

#### Scenario R12.2 — No links, no block noise

- **GIVEN** a batch with zero linked images
- **WHEN** the summary is serialized
- **THEN** `study_comparison` is `null` (not an empty block)

### Requirement: R13. Bulk re-analysis of failed images (C3)

The batch SHALL expose `POST batches/<pk>/reanalyze-failed/` that re-runs the existing
analysis task restricted to images with `quality: "failed"`: sync when ≤30 failed images,
async (>30) via the existing Celery task with the canonical job payload (R4/R5 of the
canonical contract). Results are updated in place (persistence spec); the response/summary
reflects the new pass.

#### Scenario R13.1 — Bulk re-analysis honors the boundary

- **GIVEN** a batch with 45 failed images
- **WHEN** the action is called
- **THEN** the response is `202 {task_id, total: 45}` and the canonical status endpoint
  reports progress; on completion the failed set shrinks to the still-failing images
- **AND** only failed images are re-queued — passing images are never re-analyzed

#### Scenario R13.2 — Nothing to do

- **GIVEN** a batch with zero failed images
- **WHEN** the action is called
- **THEN** the response is 400 with an explicit `no_failed_images` error (not a silent no-op)

## ADDED Requirements (capability fraktal-batch-distributions)

### Requirement: R-DELTA-C2. Cross-source histogram overlay (C2)

The Df distribution payload SHALL gain an additive `sim_df_values: […]` array (the
`sim_box_counting_df` of linked sims, exclusions per R3 of the canonical distributions spec).
The FraktalBatchDistributions component SHALL offer an overlay toggle that renders the sim
series in the same histogram with a distinct color and per-bar tooltip breakdown (R-DELTA-M),
inheriting the data-volume behaviors (R4/R5) for EACH series independently. The overlay and
the toggle are hidden when `sim_df_values` is empty.

#### Scenario R-DELTA-C2.1 — Overlay with sparse sim data

- **GIVEN** a batch with image Df for 30 images and sim values for 3 sims
- **WHEN** the overlay is enabled
- **THEN** the image histogram renders normally (n≥5) and the sim series renders its own
  state (1≤n<5 → "Not enough data" panel semantics for that series, per the component gates
  `MIN_N_SUCCESSFUL=5`) — one series never corrupts the other
- **AND** the tooltip breakdown attributes each bar to its source series

## Out of Scope (locked by the person)

- Estimador 2D windowed nuevo (engine work excluido; `engine/src/fractal/box_counting.rs` untouched).
- Cambios en requisitos existentes R1–R11 / R-DELTA-I..M (todo aditivo).
- CSV export (sin columnas nuevas en este change).
