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
**WHEN** the task selects the bytes to feed the FRAKTAL analyzer for direction `i`,
**THEN** the task MUST use `png_scientific_bytes` from the persisted `FraktalBatchImage` row when
that field is non-NULL (i.e., the ZIP contained a binary-thresholded scientific PNG for that direction),
**AND** when `png_scientific_bytes` is NULL (legacy ZIP or direction with no scientific file), the
task MUST fall back silently to `png_bytes` (presentation PNG),
**AND** this selection MUST be recorded as `analysis_input_variant: "scientific"` or
`"presentation"` respectively in the persisted row and in the drill-down response,
**AND** the fallback is silent — no HTTP 4xx, no logged error, no change to calibration fields,
**AND** `calibration_source`, per-image metrics, and batch statistics are unaffected by which
variant was selected.

(Previously: R-DELTA-D specified that scientific bytes were used to feed the analyzer — but the
variant selection was not recorded and the field `analysis_input_variant` did not exist. This
delta adds variant tracking.)

#### Scenario D.1 — Scientific PNG present: used as analyzer input

- GIVEN a new-mode ZIP where `png_scientific_bytes` is non-NULL for direction `i`
- WHEN the batch task processes direction `i`
- THEN the bytes fed to the FRAKTAL engine are from `png_scientific_bytes` (binary-thresholded, no AA halo)
- AND `analysis_input_variant = "scientific"` is persisted for that row

#### Scenario D.2 — Legacy ZIP: presentation PNG used as fallback

- GIVEN a legacy ZIP where `png_scientific_bytes` is NULL for direction `i`
- WHEN the batch task processes direction `i`
- THEN the bytes fed to the FRAKTAL engine are from `png_bytes` (presentation PNG)
- AND `analysis_input_variant = "presentation"` is persisted for that row
- AND no error is raised

#### Scenario D.3 — Fallback is silent for mixed-mode ZIP

- GIVEN a ZIP where direction 0 has scientific bytes but direction 1 does not
- WHEN the batch task processes both directions
- THEN direction 0 uses scientific bytes with `analysis_input_variant = "scientific"`
- AND direction 1 uses presentation bytes with `analysis_input_variant = "presentation"`
- AND no error or warning is emitted for the mixed state; both rows are persisted normally

#### Scenario D.4 — analysis_input_variant is always present in drill-down

- GIVEN any `FraktalBatchImage` row (new or legacy)
- WHEN the drill-down endpoint is called
- THEN `analysis_input_variant` MUST be present in the response body
- AND its value is `"scientific"` or `"presentation"` (never null, never omitted)

### R-DELTA-E1. Engine NMS radius is `1.0 × estimated_radius`

**GIVEN** the engine's peak detection step in `image_processing.rs`,
**WHEN** Non-Maximum Suppression (NMS) is applied to distance-transform peaks,
**THEN** the minimum separation between accepted peaks MUST be `1.0 × estimated_radius`
(was `2.0 × estimated_radius`),
**AND** this change applies to all batch analysis calls — both autocalibrate and manual dpo paths,
**AND** re-running a prior batch with this engine version MAY produce slightly different Df values
compared to the prior run; this is expected and documented (more accurate peak resolution).

#### Scenario E1.1 — Adjacent touching-sphere peaks are resolved

- GIVEN a synthetic projection of a dense aggregate where primary center-to-center distance ≈ 1.9 × radius
- WHEN the engine runs NMS with radius 1.0
- THEN both adjacent peaks are accepted (separation 1.9 × radius > NMS threshold 1.0 × radius)
- AND the estimated dpo reflects individual primaries, not fused clusters

#### Scenario E1.2 — NMS still suppresses true noise peaks

- GIVEN a projection with spurious sub-radius noise peaks within 0.5 × estimated_radius of a true peak
- WHEN NMS with radius 1.0 runs
- THEN spurious peaks within 1.0 × radius of any accepted peak are suppressed
- AND the accepted peak count does not include noise-only entries

#### Scenario E1.3 — Re-run of prior batch produces different (more accurate) Df

- GIVEN a prior batch produced `dpo_used = 54.6nm` with the old engine (NMS 2.0)
- WHEN the same images are re-analyzed with NMS 1.0
- THEN `dpo_used` converges closer to the true dpo; Df is no longer systematically saturated at ~2.0
- AND the result difference is not treated as an error — it is expected behavior

### R-DELTA-E2. Primary radius estimated as median of ALL detected peaks

**GIVEN** the engine's radius estimation step after NMS yields a set of accepted peaks,
**WHEN** the primary radius (and hence `dpo_nm`) is computed,
**THEN** the radius MUST be the median distance value over ALL accepted peaks (no percentile selection),
**AND** this replaces the prior top-30% selection: no peaks are excluded from the median computation
on the basis of their distance rank,
**AND** when the accepted peak count is 1, the median is that single peak's distance value (no error),
**AND** when the accepted peak count is 0, the autocalibrate call MUST return an error (unchanged
from prior behavior).

#### Scenario E2.1 — All-peaks median with symmetric distribution

- GIVEN NMS yields 20 accepted peaks with distance values forming a roughly symmetric distribution around 10px
- WHEN the radius is estimated
- THEN the result is the median of all 20 values ≈ 10px
- AND no top-N filter is applied before the median

#### Scenario E2.2 — All-peaks median reduces upward bias vs top-30%

- GIVEN NMS yields 10 accepted peaks sorted descending: [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]px
- WHEN the radius is estimated using all-peaks median
- THEN result = 9.5px (median of all 10 values)
- AND the top-30% result would have been median([14, 13, 12]) = 13px — 37% higher

#### Scenario E2.3 — Single accepted peak

- GIVEN NMS accepts exactly 1 peak with distance 10px
- WHEN the radius is estimated
- THEN result = 10px; no error

#### Scenario E2.4 — Zero accepted peaks

- GIVEN NMS accepts 0 peaks (completely empty or uniform image)
- WHEN the radius estimation is called
- THEN the autocalibrate function returns an error; the batch task falls back per R3 (retry on image[N/2])

### R-DELTA-E3. Autocalibrate default for batch-from-simulation is OFF

**GIVEN** a batch upload request where the frontend explicitly indicates the batch originates
from a simulation (i.e., the request includes `origin: "simulation"` AND `sim_dpo_nm: <positive float>`),
**WHEN** the batch endpoint processes the calibration mode,
**THEN** the effective autocalibrate mode MUST default to `OFF` — the engine does NOT call
`estimate_particles_and_dpo` on any image for the initial dpo estimation,
**AND** the `sim_dpo_nm` value MUST be used as the manual dpo for all images in the batch,
**AND** the user MAY override this default by explicitly passing `autocalibrate_dpo: true` in the
request body — in which case autocalibrate runs per R3 of the main spec,
**AND** for all other batch origins (external ZIP uploads without `origin: "simulation"`),
the default remains `autocalibrate=ON` (unchanged),
**AND** `calibration_source: "manual"` MUST be reported in the response when the sim dpo default is used.

#### Scenario E3.1 — Batch from simulation: sim dpo used by default

- GIVEN a request with `origin: "simulation"`, `sim_dpo_nm: 25.0`
- WHEN the batch endpoint processes the request (no `autocalibrate_dpo` field supplied)
- THEN all images are analyzed with `dpo = 25.0nm`
- AND `calibration_source = "manual"` in the response
- AND `estimate_particles_and_dpo` is NOT called for any image

#### Scenario E3.2 — Sim batch with explicit autocalibrate override

- GIVEN a request with `origin: "simulation"`, `sim_dpo_nm: 25.0`, `autocalibrate_dpo: true`
- WHEN the batch endpoint processes the request
- THEN autocalibrate runs per R3 (called on `image[0]`, retries on `image[N/2]` on failure)
- AND `calibration_source = "autocalibrate"` in the response

#### Scenario E3.3 — External ZIP upload: autocalibrate default unchanged

- GIVEN a request without `origin: "simulation"` (e.g., `origin: "external_zip"` or field absent)
- WHEN the batch endpoint processes the request without explicit calibration flags
- THEN the prior default applies: `autocalibrate_dpo: true` if no scale supplied (R2 of main spec)
- AND `sim_dpo_nm` field is ignored if present

#### Scenario E3.4 — Missing sim_dpo_nm with simulation origin

- GIVEN a request with `origin: "simulation"` but `sim_dpo_nm` absent or non-positive
- WHEN the batch endpoint validates the request
- THEN HTTP 400 with error indicating `sim_dpo_nm` is required for simulation-origin batches

#### Scenario E3.5 — Sim default visually surfaced by frontend (contract anchor)

- GIVEN the frontend submits a sim-origin batch without explicit autocalibrate
- WHEN the response returns with `calibration_source = "manual"` and `calibration_used.dpo_nm = sim_dpo_nm`
- THEN the frontend displays: "Using known dpo = {sim_dpo_nm} nm from simulation. Override?"
- AND the toggle to enable autocalibrate is visible and functional

### R-DELTA-E4. Detector validation: synthetic geometry within ±10% of true dpo

**GIVEN** a synthetic projection generated from a known geometry (dpo=25nm, scale=80px/100nm,
implying true primary radius = `25/2 × 80/100 = 10px`),
**WHEN** `estimate_particles_and_dpo` is called on this projection,
**THEN** the returned `dpo_nm` MUST be within ±10% of the true dpo (i.e., 22.5nm ≤ result ≤ 27.5nm),
**AND** this property is enforced by an integration test in `aglogen_core/engine/tests/`
that generates the synthetic projection programmatically and asserts the ±10% bound,
**AND** this test MUST pass in CI (`cargo test`) to validate the combined effect of:
NMS radius 1.0, all-peaks median, and scientific PNG (binary-thresholded) input.

#### Scenario E4.1 — Synthetic geometry: dpo within tolerance

- GIVEN a programmatically generated binary image with exactly 10px-radius circles at known positions
- WHEN `estimate_particles_and_dpo` runs on this image with scale=80px/100nm
- THEN returned `dpo_nm` ∈ [22.5, 27.5] (±10% of 25nm)

#### Scenario E4.2 — Detector rejects degenerate synthetic input

- GIVEN a blank (all-white) synthetic image fed to `estimate_particles_and_dpo`
- WHEN the function runs
- THEN it returns an error (0 peaks detected); does not return a value outside the valid range

#### Scenario E4.3 — Tolerance holds across varying particle counts

- GIVEN synthetic projections with N=10, N=50, N=100 circles of 10px radius (all same dpo)
- WHEN `estimate_particles_and_dpo` runs on each
- THEN all three results satisfy dpo_nm ∈ [22.5, 27.5]

---

### R-DELTA-I. Simulation detail page exposes "Analyze projections" entry point

**GIVEN** a simulation detail page at `/projects/{projectId}/simulations/{simId}/`,
**WHEN** the simulation has completed and projection images are available (the simulation
has a non-null projections export or is in a "done" state),
**THEN** the page MUST render an "Analyze projections" button,
**AND** clicking the button MUST navigate to
`/projects/{projectId}/fraktal/batch/upload?origin=simulation&sim_id={simId}`,
**AND** `{simId}` MUST be the UUID of the current simulation,
**AND** the navigation MUST be a client-side route transition (no full page reload).

#### Scenario I.1 — Happy path: button navigates with correct params

- GIVEN a completed simulation with `sim_id = "abc-123"`
- WHEN the user clicks "Analyze projections"
- THEN the browser navigates to
  `/projects/{projectId}/fraktal/batch/upload?origin=simulation&sim_id=abc-123`
- AND the navigation is a client-side transition (Next.js router)

#### Scenario I.2 — Button absent when simulation not yet complete

- GIVEN a simulation whose status is "running" or "pending" (no projections yet)
- WHEN the simulation detail page renders
- THEN the "Analyze projections" button is NOT shown
- AND no navigation to the batch upload page is offered

#### Scenario I.3 — Button present for completed simulation

- GIVEN a simulation with status "done" and projections available
- WHEN the simulation detail page renders
- THEN the "Analyze projections" button IS visible
- AND it carries the correct `href` with both `origin` and `sim_id` params

---

### R-DELTA-J. Batch upload page propagates origin and sim_id query params to component

**GIVEN** the batch upload page at `/projects/{id}/fraktal/batch/upload`,
**WHEN** it is loaded with query params `?origin=simulation&sim_id={X}`,
**THEN** the page MUST parse both `origin` and `sim_id` from the URL query string,
**AND** pass them as props to the `FraktalBatchUpload` component:
`origin: string | null` and `sim_id: string | null`,
**AND** when `origin = "simulation"` AND `sim_id` is a valid non-empty string, the
`FraktalBatchUpload` component MUST operate in simulation-origin mode (pre-fill from sim),
**AND** when `origin` is absent, or `sim_id` is absent or empty, the component MUST
operate in standard external-upload mode (no pre-fill) without error,
**AND** when query params are malformed (e.g., `sim_id=` empty string, unexpected chars),
the component MUST fall back to external mode and MUST NOT throw or show an error page.

#### Scenario J.1 — Both params present: simulation-origin mode activated

- GIVEN navigation to `…/upload?origin=simulation&sim_id=abc-123`
- WHEN the page mounts and parses query params
- THEN `FraktalBatchUpload` receives `origin="simulation"` and `sim_id="abc-123"` as props
- AND the component enters simulation-origin mode

#### Scenario J.2 — Missing sim_id: falls back to external mode

- GIVEN navigation to `…/upload?origin=simulation` (no `sim_id` param)
- WHEN the page mounts
- THEN `FraktalBatchUpload` receives `origin="simulation"` and `sim_id=null`
- AND the component falls back to standard external-upload mode
- AND no error or warning is shown to the user

#### Scenario J.3 — No query params: standard external mode

- GIVEN navigation to `…/upload` (no query params)
- WHEN the page mounts
- THEN `FraktalBatchUpload` receives `origin=null` and `sim_id=null`
- AND the component renders in the standard external-upload mode unchanged

#### Scenario J.4 — Malformed query param: safe fallback

- GIVEN navigation to `…/upload?origin=simulation&sim_id=` (empty sim_id)
- WHEN the page parses the query string
- THEN `sim_id` is treated as null/empty
- AND the component falls back to external mode
- AND the page does NOT throw, does NOT show an error boundary

#### Scenario J.5 — Unknown origin value: ignored, external mode

- GIVEN navigation to `…/upload?origin=unknown_value&sim_id=abc-123`
- WHEN the page passes props to `FraktalBatchUpload`
- THEN the component does not recognize `origin="unknown_value"` as simulation-origin
- AND operates in external mode (sim_id is ignored when origin is not "simulation")

<!-- Last sync: 2026-05-03 from change fraktal-batch-distributions-and-entry -->
