# Delta Spec: fraktal-batch-extensions → capability fraktal-batch-contract

> C1 **reencaminada** (una sim por batch — decisión de la persona 2026-10-19 tras spec-review r1 B1),
> C3 **in-place** (r1 B3/B4 + r2). Extensiones aditivas; el bloque de esquema vive en la delta de
> `fraktal-batch-persistence`. Población de valores Df según R7 canónica (r2 BLOCKER-1: approximate
> lleva `df_estimate`, no `fractal_dimension`).

## ADDED Requirements

### Requirement: R12. Batch-vs-linked-simulation comparison (C1)

A batch links **at most one** simulation (`FraktalBatch.sim_id`, `models.py:307`). The summary
payload SHALL gain an additive `study_comparison` block, built by ONE shared pure function
`_build_study_comparison(sim_id, image_rows)` (r2 MAJOR: builder 1 runs BEFORE the batch row
exists — `views.py:666→672`, `tasks.py:718→740` — so the helper takes primitives, not a
`FraktalBatch` instance) consumed by ALL THREE payload builders (`_build_batch_response`
`views.py:531` with `images_out`, `_serialize_batch_from_db` `views.py:840`, inline
`batch_detail_view` `views.py:1084-1096`):

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

- **Population (r2 BLOCKER-1):** a value for image Df is `fractal_dimension` when
  `quality == "converged"` and `df_estimate` when `quality == "approximate"` (canonical R7
  / `fraktal-batch-contract.md:200,240` precedent; approximate rows carry
  `fractal_dimension = null` when `quality == "approximate"` — canonical
  `fraktal-batch-contract.md:178`, R6.3; query at `views.py:882-887`). `images_with_df` = count of contributing
  values; `n_converged`/`n_approximate` = per-quality breakdown of contributors.
- `sim_df.value` = `metrics["fractal_dimension"]` of the sim (`views.py:1132`); the `0.0`
  sentinel counts as MISSING (r1 m4). `target_df` = the sim's target Df when available
  (`sim.parameters`), else `null`.
- `deltas` = per-image `value − sim_df.value` (contributors only); `mean_delta` = mean of
  `deltas`, `null` when empty. NO tolerance percentage (Fase 0: no evidenced 2D-vs-3D tolerance).
- `show_sorensen_note: true` (renamed from `sorensen_note` — r1 M5 collision with the R11
  string key) signals the UI to render the canonical R11 note at batch level.
- NO `per_config` (r1 B1/M2 — one sim per batch; multi-config comparison lives in the
  Change A study tab, R5/R7 of `batch-box-counting`).

#### Scenario R12.1 — Block present

- **GIVEN** a batch linked to a sim (`fractal_dimension = 2.42`) with 26 converged images
  (carrying `fractal_dimension`) and 4 approximate images (carrying `df_estimate`)
- **AND** `images_without_df = total_images − images_with_df` and `image_df.n == images_with_df`
  (r3 minor 12 — both keys defined, no silent duplication)
- **WHEN** any of the three builders serializes the batch
- **THEN** `images_with_df: 30`, `image_df.n_converged: 26, n_approximate: 4`, the stats
  computed over the 30 contributing values (26 `fractal_dimension` + 4 `df_estimate`), and
  ALL THREE builders emit IDENTICAL `study_comparison` content
- **AND** every pre-existing summary key is unchanged

#### Scenario R12.2 — No sim, no metric, or empty

- **GIVEN** a batch without `sim_id`, whose sim row was deleted, whose sim lacks
  `fractal_dimension` (or carries the 0.0 sentinel), or with zero contributing image values
- **WHEN** the summary is serialized
- **THEN** `study_comparison` is `null` (deleted-sim case mirrors `build_comparison_data`'s
  `DoesNotExist` handling, `services/batch.py:264`, function starting ~:239 — r3 minor 9)

### Requirement: R13. In-place bulk re-analysis of failed images (C3)

Project-nested action `POST projects/<project_pk>/fraktal/batches/<pk>/reanalyze-failed/`
(r1 m1) with an **enforceable** permission check (r2 MAJOR): `IsProjectOwnerOrShared` only
implements `has_object_permission` (`apps/accounts/permissions.py:6-33`) and this family uses
function views with `IsAuthenticated` only — the view SHALL fetch the `Project` by
`project_pk` and call `IsProjectOwnerOrShared().has_object_permission(request, None, project)`
explicitly; a non-shared authenticated user gets **403**.

Behavior — only images with `quality: "failed"` are re-analyzed, **in place by UPDATE** (r2
minor — replaces the delete/reinsert wording; avoids `unique_together` churn entirely):

- Each failed `FraktalBatchImage` row is UPDATED by pk with the new analysis result fields
  (`fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`, `dpo_used`, `error`,
  `rg_nm`, `quality`, `df_estimate`, `bisection_iterations`, `bisection_residual`,
  `failure_reason`, and the new nullable `pixels_per_100nm` per the persistence delta — r3
  MAJOR 3: the four diagnostic fields MUST be updated or a re-analyzed approximate image
  would feed a STALE `df_estimate` into `mean_df_inclusive` and drill-down diagnostics).
- **Preserved unchanged (r2 minor):** `png_bytes`, `png_scientific_bytes` (no
  re-rasterization — the PNG endpoint serves `Cache-Control: immutable` and canonical
  persistence requires hash-equal bytes), `analysis_input_variant` (reused as-is),
  `filename`, `azimuth`, `elevation`, `index`. Analysis inputs: `dpo = batch.dpo_used`,
  `autocalibrate_dpo = false`.
- **Aggregate recompute (r2 MAJOR / r3 MAJOR 4):** after the row updates, batch aggregates are
  recomputed over the FULL row set — EXACTLY the aggregate fields `persist_batch_results`
  writes (`n_images`, `n_successful`, `mean_df`, `mean_df_inclusive`, `std_df`, `median_df`,
  `min_df`, `max_df`, `q1_df`, `q3_df`; `services/batch.py:519-546`), with the canonical R7
  populations (`mean_df` converged-only over `fractal_dimension`, `mean_df_inclusive`
  inclusive incl. `df_estimate`) and `ddof=0`. The subset MUST NOT be passed to
  `persist_batch_results` as-is (it overwrites `n_images` with the list length,
  `services/batch.py:~470-546`); either a `rows_scope="full"` mode or an explicit full-set
  recompute in the new service — implementer's choice, contract pins the observable outcome
  (no `min_df > mean_df`-class incoherence in the same payload).
- **Boundary:** ≤30 failed images → sync, response `200` with the updated batch summary
  payload (including `study_comparison`); >30 → async via a thin Celery wrapper, response
  `202 {job_id, status: "queued"}` (canonical shape, r1 B4; `fraktal_status_view` reusable
  if the wrapper reports `{"batch_id": …}` as `tasks.py:770-775` does).
- **Errors:** zero failed images → `400 {"detail": …, "code": "no_failed_images"}` (r2 minor:
  body shape pinned to the sibling `{"detail": …}` convention, `views.py:1247-1252`). Any
  other failure → the canonical `failed` job payload (async) or a 500 (sync).
- **Calibration (r1 M6 / r2 minor):** the new nullable per-image `pixels_per_100nm` (see the
  persistence delta) is used when present, else the batch scale; batch-level
  `calibration_source` is LEFT UNCHANGED — per-image provenance is observable ONLY through
  the new nullable field.

#### Scenario R13.1 — Async bulk re-analysis stays in place

- **GIVEN** a batch with 45 failed images
- **WHEN** the action is called by a shared project user
- **THEN** the response is `202 {job_id, status: "queued"}`; on completion the SAME batch
  holds updated rows (same pks, PNG bytes hash-equal), `n_images` unchanged, aggregates
  recomputed over the full set with R7 populations, and the failed set shrinks to
  still-failing images

#### Scenario R13.2 — Sync and empty cases

- **GIVEN** 12 failed images → `200` with the updated summary payload
- **GIVEN** 0 failed images → `400 {"detail": …, "code": "no_failed_images"}`
- **GIVEN** an authenticated user without project access → `403`
