# Delta for fraktal-batch-contract

Existing capability `fraktal-batch-contract` still applies. This delta records two storage-and-polling changes introduced by `fraktal-drilldown-and-csv`. Per-image result shape (R6 of the main spec) is unchanged on the wire — only its persistence backend changes from JSON-on-disk to DB-backed `FraktalBatch` + `FraktalBatchImage` (see `./fraktal-batch-persistence.md`).

## MODIFIED Requirements

### R5. Async execution path for N > 30

**GIVEN** a ZIP containing `N > 30` valid images,
**WHEN** the endpoint is called,
**THEN** the response is HTTP 202 with body `{job_id}`,
**AND** the polling endpoint `GET /api/v1/fraktal-status/{job_id}/` returns:
- during execution: `{status: "processing", progress: <float 0.0–1.0>, current: <int>, total: <int>, stage: "autocalibrate" | "analyzing" | "aggregating"}`,
- on success: `{status: "done", batch_id: <uuid>, results_url: <string>}`,
- on failure: `{status: "failed", error: <string>}`,
**AND** `progress` advances at least once per completed image,
**AND** `results_url` points at the new DB-backed batch detail endpoint `/api/v1/projects/{project_pk}/fraktal/batches/{batch_id}/`.

(Previously: success payload was `{status, results_url}` only; results lived in JSON-on-disk.)

#### Scenario 5.1 — Async boundary (`N=31`)
- **Expected**: 202 with `job_id`; polling reaches `status: "done"` with `batch_id` populated and `results_url` resolves the new DB-backed batch endpoint.

#### Scenario 5.2 — Mid-size async (`N=100`)
- **Expected**: Status transitions through `autocalibrate` → `analyzing` → `aggregating`; `progress` reaches 1.0 at completion; final payload includes `batch_id`.

#### Scenario 5.3 — Stress async (`N=500`)
- **Expected**: Runs to completion without timeout; progress increments per image; `batch_id` returned at done.

#### Scenario 5.4 — Failure during run
- **Expected**: Polling returns `{status: "failed", error: "..."}`; `batch_id` absent; error message non-empty.

### R6. Per-image result shape

**GIVEN** a batch job completes (sync or async),
**WHEN** per-image results are assembled,
**THEN** each entry MUST contain exactly: `filename`, `azimuth`, `elevation`, `fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted`, `calibration_used: {pixels_per_100nm, dpo_nm}`,
**AND** `azimuth` / `elevation` are pulled from `metadata.directions[]` matched by filename when available, else `null`,
**AND** `fractal_dimension`, `prefactor`, `r_squared`, `n_particles_counted` MAY be `null` when the analyzer cannot produce a value,
**AND** entries are sourced from the DB-backed `FraktalBatchImage` rows persisted per `fraktal-batch-persistence` (no JSON-on-disk file is read or written).

(Previously: results were assembled from a JSON file written to shared media; this delta keeps the wire shape and moves the source of truth to the DB.)

#### Scenario 6.1 — Image matched to metadata direction
- **Expected**: `azimuth` and `elevation` populated from `metadata.directions[i]`.

#### Scenario 6.2 — Image with no metadata entry
- **Input**: ZIP without `metadata.json`.
- **Expected**: `azimuth = null`, `elevation = null`; analyzer fields still populated when analysis succeeds.

#### Scenario 6.3 — Analyzer returns null Df
- **Expected**: Entry present with `fractal_dimension = null`; entry is flagged as unsuccessful for R7 aggregation.

#### Scenario 6.4 — Storage source
- **Expected**: For any sync or async batch, the entry is materialized from a `FraktalBatchImage` row; no JSON-on-disk artifact is created.
