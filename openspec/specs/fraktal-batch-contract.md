# Spec: fraktal-batch-contract

## Overview

New capability defining the observable contract for FRAKTAL batch analysis. Covers ZIP ingestion, metadata-driven auto-calibration, one-shot dpo fallback, sync/async execution boundary, progress reporting, per-image result shape, batch statistics, histogram binning, simulation comparison, and the Sorensen educational note.

Context: see `../proposal.md` for scope and affected areas; see `../explore.md` for background.

This spec describes **observable behavior** — what a caller sees in HTTP responses, polling payloads, and the results view — not internal implementation.

## Requirements

### R1. Batch endpoint accepts ZIP with pyaglogen metadata

**GIVEN** a caller uploads a ZIP previously produced by pyaglogen3D's projection export,
**AND** the ZIP contains `metadata.json` with `parameters.pixels_per_100nm` present and positive,
**WHEN** the batch endpoint processes the upload,
**THEN** the scale for each image is taken from `directions[i].pixels_per_100nm` when that
field is present in the corresponding `directions[]` entry (new-mode ZIP),
**AND** when `directions[i].pixels_per_100nm` is absent for an entry (legacy-mode ZIP), the
top-level `parameters.pixels_per_100nm` is broadcast to that image (legacy fallback — no
parse error, no calibration failure),
**AND** `calibration_source: "metadata"` is reported in both cases,
**AND** the response body includes `calibration_source: "metadata"`.

(Previously: only `parameters.pixels_per_100nm` was read and applied uniformly to every
image; per-image `directions[i].pixels_per_100nm` did not exist.)

#### Scenario 1.1 — New-mode ZIP: per-image scales consumed
- **Input**: ZIP from `mode=grid, n_az=10, n_el=5` (32 directions) where each `directions[i].pixels_per_100nm` has a distinct value (non-spherical aggregate).
- **Expected**: Each of the 32 analyzer calls receives its own per-image scale; `calibration_source = "metadata"`.

#### Scenario 1.2 — Legacy ZIP: top-level broadcast
- **Input**: ZIP with `metadata.parameters.pixels_per_100nm = 38.5` and NO per-direction `pixels_per_100nm` fields.
- **Expected**: Batch runs with scale 38.5 broadcast to all images; `calibration_source = "metadata"`.

#### Scenario 1.3 — Mixed ZIP (partial per-direction)
- **Input**: ZIP where some `directions[i]` have `pixels_per_100nm` and some do not.
- **Expected**: Entries WITH the field use their individual scale; entries WITHOUT it fall back to `parameters.pixels_per_100nm`; no HTTP 400.

#### Scenario 1.4 — Metadata present but top-level scale non-positive
- **Input**: ZIP where `metadata.parameters.pixels_per_100nm = 0`.
- **Expected**: Metadata treated as missing; fallback path per R2 applies.

### R2. Fallback to manual calibration when metadata missing or invalid

**GIVEN** a ZIP without `metadata.json` OR with missing/invalid `parameters.pixels_per_100nm`,
**WHEN** the batch endpoint is called,
**THEN** the request MUST supply either a positive `pixels_per_100nm` OR `autocalibrate_dpo: true` in the request body,
**AND** the response body includes `calibration_source: "manual"` or `calibration_source: "autocalibrate"` accordingly,
**AND** if neither is supplied, the endpoint returns HTTP 400 with a clear error message.

#### Scenario 2.1 — Legacy ZIP with no metadata, user supplies scale
- **Input**: ZIP lacking `metadata.json`; body `pixels_per_100nm = 40.0`.
- **Expected**: HTTP 200/202; `calibration_source = "manual"`.

#### Scenario 2.2 — Metadata present but no `parameters.pixels_per_100nm`
- **Input**: ZIP whose `metadata.json` lacks the key; body `autocalibrate_dpo: true`.
- **Expected**: `calibration_source = "autocalibrate"`; dpo determined per R3.

#### Scenario 2.3 — Metadata scale is negative
- **Input**: ZIP where `pixels_per_100nm = -1`; body omits scale and omits flag.
- **Expected**: HTTP 400; error names the missing scale/flag.

#### Scenario 2.4 — No metadata and user omits both
- **Input**: Legacy ZIP; body has neither `pixels_per_100nm` nor `autocalibrate_dpo`.
- **Expected**: HTTP 400 with actionable message.

### R3. One-shot dpo auto-calibration reused across the batch

**GIVEN** batch mode with `autocalibrate_dpo: true`,
**WHEN** the orchestrator prepares the batch,
**THEN** `estimate_particles_and_dpo` SHALL be called on `image[0]` exactly once,
**AND** the returned dpo is reused for every image's analyzer call,
**AND** on failure of `image[0]`, exactly one retry SHALL be attempted on `image[N/2]`,
**AND** if both fail the endpoint returns HTTP 400 with guidance to supply a manual scale.

#### Scenario 3.1 — Happy path
- **Input**: Batch of 20 images, `image[0]` autocalibrates to `dpo = 25.5`.
- **Expected**: All 20 analyzer calls use `dpo = 25.5`; response `calibration_used.dpo_nm = 25.5`.

#### Scenario 3.2 — Retry on middle image
- **Input**: Batch of 40 images; `image[0]` autocalibration fails; `image[20]` succeeds with `dpo = 30.0`.
- **Expected**: All 40 analyzer calls use `dpo = 30.0`.

#### Scenario 3.3 — Double failure
- **Input**: Batch where both `image[0]` and `image[N/2]` fail autocalibration.
- **Expected**: HTTP 400; error explains both attempts failed and suggests manual `pixels_per_100nm`.

#### Scenario 3.4 — Single-image batch
- **Input**: `N = 1` with `autocalibrate_dpo: true`.
- **Expected**: `estimate_particles_and_dpo` called once on that image; its dpo used for the single analyzer call.

### R4. Sync execution path for N ≤ 30

**GIVEN** a ZIP containing `N ≤ 30` valid images,
**WHEN** the endpoint processes it,
**THEN** the response is HTTP 200 with the full batch results body,
**AND** the body contains: per-image results array (R6), batch statistics (R7), histogram data when applicable (R8), and comparison data when applicable (R9).

#### Scenario 4.1 — Minimal sync batch (`N=1`)
- **Expected**: 200 with one entry in results array; stats reflect single value.

#### Scenario 4.2 — Sync boundary (`N=30`)
- **Expected**: 200 with all 30 results; no `job_id` returned.

#### Scenario 4.3 — Typical sync batch (`N=12`)
- **Expected**: 200 with 12 results; response completes inline.

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

### R7. Batch statistics

**GIVEN** `N ≥ 1` per-image results,
**WHEN** batch statistics are computed,
**THEN** the response includes: `{n_images, n_successful, mean_df, std_df, median_df, q1_df, q3_df, min_df, max_df}`,
**AND** statistics are computed only over entries with non-null `fractal_dimension`,
**AND** if `n_successful = 0`, all Df statistics are `null`,
**AND** if `n_successful = 1`, `std_df = 0`.

#### Scenario 7.1 — Single successful image
- **Input**: `N=1`, analyzer succeeded.
- **Expected**: `mean_df = df`, `std_df = 0`, `median_df = df`, `min_df = max_df = df`.

#### Scenario 7.2 — All-successful batch
- **Input**: `N=10`, all Df non-null.
- **Expected**: All statistics populated; `n_successful = 10`.

#### Scenario 7.3 — Partial failure
- **Input**: `N=10`, 3 entries with `Df = null`.
- **Expected**: `n_successful = 7`; statistics computed over the 7 successful values.

#### Scenario 7.4 — All-failed batch
- **Input**: `N=5`, every entry has `Df = null`.
- **Expected**: `n_successful = 0`; `mean_df, std_df, median_df, q1_df, q3_df, min_df, max_df` all `null`.

### R8. Histogram data uses Freedman–Diaconis with Sturges fallback

**GIVEN** `n_successful` Df values in a batch,
**WHEN** histogram data is prepared,
**THEN**:
- for `n_successful ≥ 10`, bin width SHALL use Freedman–Diaconis (`bin_width = 2·IQR/N^(1/3)`) and `rule_used = "freedman_diaconis"`,
- for `5 ≤ n_successful < 10`, Sturges rule is used and `rule_used = "sturges"`,
- for `n_successful < 5`, the histogram block is omitted entirely from the response.

#### Scenario 8.1 — Freedman–Diaconis path (`n_successful=20`)
- **Expected**: `histogram = {bin_edges, counts, rule_used: "freedman_diaconis"}`; `counts.length + 1 = bin_edges.length`.

#### Scenario 8.2 — Sturges fallback (`n_successful=9`)
- **Expected**: `histogram.rule_used = "sturges"`.

#### Scenario 8.3 — Sturges boundary (`n_successful=5`)
- **Expected**: `histogram.rule_used = "sturges"`; histogram block present.

#### Scenario 8.4 — Below threshold (`n_successful=4`)
- **Expected**: Response body has no `histogram` key; table-only UI.

### R9. Simulation comparison data

**GIVEN** a batch result is assembled,
**WHEN** comparison data is prepared,
**THEN** the response includes a `comparison` block with `{sim_id, sim_target_df, sim_box_counting_df, batch_mean_df, batch_std_df, sorensen_note}`,
**AND** `sim_id` is resolved in this precedence:
1. explicit `sim_id` in the request body (manual override),
2. otherwise, the UUID parsed from a ZIP filename matching `{uuid}_projections.zip` linked to an existing `Simulation`,
3. otherwise, `null`,
**AND** `sim_target_df` is read from `Simulation.parameters.target_df` (nullable),
**AND** `sim_box_counting_df` is read from `Simulation.metrics.fractal_dimension` (nullable),
**AND** when the resolved simulation no longer exists, `sim_id`, `sim_target_df`, `sim_box_counting_df` are `null` and the response includes a warning.

#### Scenario 9.1 — Filename auto-link
- **Input**: ZIP `550e8400-e29b-41d4-a716-446655440000_projections.zip`, simulation exists.
- **Expected**: `sim_id` populated; `sim_target_df` and `sim_box_counting_df` populated from that simulation.

#### Scenario 9.2 — Filename does not match pattern
- **Input**: ZIP `mybatch.zip`; no `sim_id` in body.
- **Expected**: `sim_id = null`; `sim_target_df = null`; `sim_box_counting_df = null`; `batch_mean_df` still present.

#### Scenario 9.3 — Manual override
- **Input**: ZIP `550e8400-...._projections.zip` (sim A exists); body `sim_id = <sim B uuid>`.
- **Expected**: Comparison uses sim B, not sim A.

#### Scenario 9.4 — Linked simulation deleted
- **Input**: Filename UUID no longer corresponds to any simulation.
- **Expected**: `sim_id = null`; response contains `warning` describing the missing simulation; batch stats still present.

### R10. Legacy single-image FRAKTAL endpoint unchanged

**GIVEN** the pre-existing endpoint `POST /api/v1/fractal-analysis/` for single-image analysis,
**WHEN** it is called after this change ships,
**THEN** its request shape, response shape, and validation errors SHALL remain byte-for-byte identical to the pre-change behavior.

#### Scenario 10.1 — Existing contract preserved
- **Expected**: All existing `FraktalAnalysis` endpoint tests pass unchanged.

### R11. Sorensen educational note in comparison card

**GIVEN** a batch response with a non-null `comparison` block (R9),
**WHEN** the results view renders the comparison card,
**THEN** the card MUST include the exact text:

> "Note: 2D projection fractal dimension is systematically lower than the 3D aggregate Df (Sorensen 1992). Typical gap: 0.1–0.3. This is expected and does NOT indicate simulation error."

**AND** this text is always present whenever the comparison card is shown.

#### Scenario 11.1 — Comparison card always includes the note
- **Input**: Any batch with resolved `comparison` block.
- **Expected**: Rendered card contains the exact Sorensen note string.

#### Scenario 11.2 — No comparison, no note
- **Input**: Batch where R9 produces `comparison = null` (or equivalent hidden state).
- **Expected**: Comparison card is not rendered; Sorensen note does not appear.

---

### R-DELTA-C. Engine batch function accepts per-image `Vec<f64>` scales or single broadcast float

**GIVEN** the FRAKTAL batch engine function `analyze_fraktal_batch`,
**WHEN** called from the Python binding layer,
**THEN** it MUST accept a `Vec<f64>` of per-image scale values (one per image in the batch),
**AND** it MUST also accept a single `f64` value in the legacy-broadcast form, silently
expanding it to `[scale; N]` for all N images before the first analyzer call,
**AND** when `Vec<f64>` is provided with length ≠ N (batch image count), the call MUST fail
with a clear error (scale vector length mismatch),
**AND** the single-float legacy form MUST NOT require any caller-side migration — existing
call sites passing a single float continue to work without change.

#### Scenario C.1 — Per-image Vec accepted
- GIVEN a batch of 8 images with scales `[42.1, 41.8, 43.0, 40.5, 44.2, 41.0, 42.9, 43.5]`
- WHEN `analyze_fraktal_batch` is called with the Vec
- THEN each image is analyzed with its own scale value; per-image `calibration_used.pixels_per_100nm` reflects each image's value

#### Scenario C.2 — Legacy single-float broadcast
- GIVEN a legacy batch call passing a single `f64 = 38.5`
- WHEN `analyze_fraktal_batch` is invoked
- THEN the engine internally broadcasts `[38.5; N]` for all N images; results match a Vec call with the same repeated value

#### Scenario C.3 — Vec length mismatch is rejected
- GIVEN a batch of 10 images with a `Vec<f64>` of length 9
- WHEN `analyze_fraktal_batch` is called
- THEN the call returns an error describing the length mismatch; no analyzer calls are made

---

### R-DELTA-D. ZIP unpacking: prefer scientific PNG per direction when available; fall back to presentation

**GIVEN** a ZIP is ingested by the FRAKTAL batch task,
**WHEN** the task unpacks image files for analysis,
**THEN** for each direction entry `i`, the task MUST use `directions[i].filename_scientific`
(the scientific PNG) as the analysis input when that file is present in the ZIP,
**AND** when `directions[i].filename_scientific` is absent OR the referenced file is not
present in the ZIP (legacy mode or pre-change ZIP), the task MUST fall back silently to
`directions[i].filename` (the presentation PNG),
**AND** the fallback MUST NOT emit an HTTP 4xx or raise an exception — it is a silent
compatibility path,
**AND** `calibration_source` and per-image result fields are unaffected by the
presentation/scientific selection.

(Previously: the batch task consumed whichever PNG it found matching the direction filename;
there was no concept of a scientific variant.)

#### Scenario D.1 — New-mode ZIP: scientific PNG consumed
- GIVEN a new-mode ZIP where each direction has both `.png` and `.scientific.png`
- WHEN the batch task unpacks direction `i`
- THEN the bytes fed to the FRAKTAL analyzer are from `{base}.scientific.png` (no AA halo)

#### Scenario D.2 — Legacy ZIP: presentation PNG used as fallback
- GIVEN a legacy ZIP with no `*.scientific.png` files
- WHEN the batch task unpacks any direction
- THEN the bytes fed to the analyzer are from the presentation `.png`

<!-- Last sync: 2026-04-30 from change projection-scale-and-render-modes -->
