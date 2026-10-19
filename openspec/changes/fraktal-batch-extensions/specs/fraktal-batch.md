# Delta Spec: fraktal-batch-extensions → capabilities fraktal-batch-contract + fraktal-batch-distributions

> Persona-locked 2026-10-19: C1 **reencaminada** (el modelo enlaza UNA sim por batch — spec-review
> r1 B1/B2; decisión de la persona: "C1 contra la sim del batch"), C2 (overlay con bins explícitos),
> C3 (persistencia in-place definida) — **sin estimator 2D nuevo**, extensiones aditivas salvo la
> migración nullable de R13. Anclaje: Engram `batch-fractal/exploration` + spec-review r1 (mvf21s3n-f-ztnz).

## ADDED Requirements (capability fraktal-batch-contract)

### Requirement: R12. Batch-vs-linked-simulation comparison (C1, reshaped)

A batch links **at most one** simulation (`FraktalBatch.sim_id`, `models.py:307`). The summary
payload SHALL gain an additive `study_comparison` block comparing the batch's image Df values
against that single simulation, built by ONE shared helper used by ALL THREE payload builders
(`_build_batch_response` `views.py:531`, `_serialize_batch_from_db` `views.py:840`, and the
inline payload of `batch_detail_view` `views.py:1084-1096` — r1 B2):

```json
{
  "sim_id": "…uuid or null…",
  "images_with_df": 30,
  "images_without_df": 2,
  "image_df": {"n": 30, "mean": …, "median": …, "min": …, "max": …, "n_converged": 26, "n_approximate": 4},
  "sim_df": {"value": 2.42, "target_df": 2.30},
  "mean_delta": 0.11,
  "deltas": [0.05, -0.12, …],
  "show_sorensen_note": true
}
```

- `image_df`: stats over ALL images with non-null `fractal_dimension` (converged + approximate
  INCLUSIVE, population pinned per r1 M1), with per-quality breakdown counts.
- `sim_df.value` = `metrics["fractal_dimension"]` of the batch's sim (`views.py:1132`); the
  `0.0` sentinel (empty/limiting geometry) counts as MISSING (r1 m4): the whole block is
  `null` when the batch has no sim or the sim metric is missing/sentinel.
- `deltas` = per-image `image_df − sim_df.value` (images without Df excluded); `mean_delta` =
  mean of `deltas`. NO tolerance percentage (Fase 0: no locked 2D-vs-3D tolerance exists).
- `show_sorensen_note: true` signals the UI to render the canonical R11 educational note at
  batch level (renamed from `sorensen_note` — r1 M5 collision with the R11 string key).
- NO `per_config`: a batch has one sim; multi-config comparison belongs to the study-level
  Fractal Analysis tab (Change A, R5/R7) — r1 B1/M2.

#### Scenario R12.1 — Block present

- **GIVEN** a batch with 30 images carrying Df (26 converged, 4 approximate) linked to a sim
  with `fractal_dimension = 2.42`
- **WHEN** any of the three builders serializes the batch
- **THEN** the block matches the shape above and all THREE builders emit IDENTICAL
  `study_comparison` content for the same batch state
- **AND** every pre-existing summary key is unchanged

#### Scenario R12.2 — No sim or no metric

- **GIVEN** a batch without `sim_id`, or whose sim lacks `fractal_dimension` (or carries the 0.0 sentinel)
- **WHEN** the summary is serialized
- **THEN** `study_comparison` is `null`

### Requirement: R13. In-place bulk re-analysis of failed images (C3)

Project-nested action `POST projects/<project_pk>/fraktal/batches/<pk>/reanalyze-failed/`
(permission `IsProjectOwnerOrShared` — r1 m1) that re-runs the per-image analysis ONLY for
images with `quality: "failed"`, **in place**:

- **Persistence mode (r1 B3 — no existing path supports in-place; this is new, specified here):**
  a service function re-runs the existing per-image analysis routine for each failed image,
  DELETES its row and re-inserts it under the SAME `(batch, index)` unique key, and then
  RECOMPUTES the batch aggregates over the FULL row set (batch `n_images` unchanged; subset
  aggregates never overwrite batch totals). No new `FraktalBatch` is created.
- **Boundary:** ≤30 failed images → sync; >30 → async via a thin Celery wrapper of the same
  service, with the CANONICAL job payload: `202 {job_id, status: "queued"}` (r1 B4 — not
  `{task_id, total}`).
- **Calibration (r1 M6):** new nullable field `pixels_per_100nm` on `FraktalBatchImage`
  (migration, populated at every analysis from then on); re-analysis uses the persisted
  per-image scale when present, else falls back to the batch scale, recording
  `calibration_source` per the existing semantics. Legacy rows without the field are
  re-analyzed at batch scale — documented limitation, visible via `calibration_source`.

#### Scenario R13.1 — Bulk re-analysis honors the boundary and stays in place

- **GIVEN** a batch with 45 failed images
- **WHEN** the action is called
- **THEN** the response is `202 {job_id, status: "queued"}` and the canonical status endpoint
  reports progress; on completion the SAME batch holds re-analyzed rows for the previously
  failed images (same `batch`, same indexes), aggregates recomputed over the full set, and
  the failed set shrinks to still-failing images
- **AND** passing images are never re-queued

#### Scenario R13.2 — Nothing to do

- **GIVEN** a batch with zero failed images
- **WHEN** the action is called
- **THEN** the response is 400 with an explicit `no_failed_images` error

## ADDED Requirements (capability fraktal-batch-distributions)

### Requirement: R-DELTA-C2. Sim-Df overlay in the image Df histogram (C2)

The batch result payload feeding the distributions component SHALL gain an additive
`sim_df_values: […]` array (`sim_box_counting_df` source, exclusions per canonical R3; empty
when no sim/metric), delivered through the same three builders as R12. The FraktalBatchDistributions
component SHALL render the sim series as an OVERLAY in the same histogram with an EXPLICIT
shared bin range computed from the union of both series (fixes the single-`nbinsx`-from-images
behavior, r1 M4) and PER-SERIES data-volume gates: image series per the existing per-metric
gate (`MIN_N_SUCCESSFUL = 5`, `:97/:241`); sim series renders only at `n ≥ 5`, shows a
"Not enough data" chip at `1 ≤ n < 5`, and the overlay is hidden at `n = 0`; the global
no-data gate (`:166-181`) applies only when BOTH series are empty. Tooltips attribute each
bar to its source series (R-DELTA-M).

#### Scenario R-DELTA-C2.1 — Overlay with sparse sim data

- **GIVEN** a batch with 30 image Df values and 3 sim values
- **WHEN** the histogram renders with the overlay enabled
- **THEN** the image series renders normally, the sim series shows its "Not enough data" chip,
  the bin range covers the union of both series, and neither series corrupts the other

## Out of Scope (locked by the person)

- Estimador 2D windowed nuevo; cambios en `aglogen_core/`.
- Enlace imagen→simulación por imagen (FK nueva) — rechazado por la persona 2026-10-19; la
  comparativa multi-config vive en el tab del Change A (R5/R7 de `batch-box-counting`).
- Cambios en requisitos existentes R1–R11 / R-DELTA-I..M.
- CSV export.
