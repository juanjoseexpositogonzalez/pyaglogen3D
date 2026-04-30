# Delta for fraktal-batch-contract

Existing capability `fraktal-batch-contract` still applies in full. This delta records
five changes introduced by `fraktal-detector-fix` (PYA-9):

1. Detector input uses `png_scientific_bytes` (binary-thresholded) when available; falls back to presentation PNG.
2. Engine NMS radius reduced from `2.0 × estimated_radius` to `1.0 × estimated_radius`.
3. Primary radius estimated as median of ALL detected peaks (was top-30% selection).
4. Autocalibrate default for batch-from-simulation is `OFF`; pre-fills `dpo` from `sim.parameters.dpo`.
5. Detector output for synthetic known geometry MUST be within ±10% of true dpo.

Companion delta: `./fraktal-batch-persistence-delta.md`.

---

## MODIFIED Requirements

### R-DELTA-D. ZIP unpacking: prefer scientific PNG per direction when available; fall back to presentation

Modifies **R-DELTA-D of [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md)**.

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

---

## ADDED Requirements

### R-DELTA-E1. Engine NMS radius is `1.0 × estimated_radius`

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

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

---

### R-DELTA-E2. Primary radius estimated as median of ALL detected peaks

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

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

---

### R-DELTA-E3. Autocalibrate default for batch-from-simulation is OFF

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

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

---

### R-DELTA-E4. Detector validation: synthetic geometry within ±10% of true dpo

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

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
