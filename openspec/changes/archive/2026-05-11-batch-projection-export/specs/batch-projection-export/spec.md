# Batch Projection Export Specification

## Purpose

Defines behavior for bulk 2D-projection ZIP export across multiple simulations in a ParametricStudy — endpoint contract, async task, ZIP structure, reuse logic, polling/download reuse, and frontend interaction.

---

## Requirements

### Requirement: Batch Export Endpoint

The system MUST expose `POST /api/v1/projects/{project_pk}/studies/{study_pk}/export-projections/` accepting `{simulation_ids: [uuid, ...], mode: "grid"|"fibonacci"|"legacy", config: {...}}`, return 202 with `{job_id, status: "queued", total_sims}`, and enqueue a Celery task.

#### Scenario: Happy path — valid request

- GIVEN authenticated user with study access and 3 completed sims in the study
- WHEN POST with `{simulation_ids: [id1, id2, id3], mode: "grid", config: {az_step: 30, el_step: 30}}`
- THEN 202 Accepted, body `{job_id: str, status: "queued", total_sims: 3}`
- AND `build_batch_projections_zip` is enqueued with correct arguments

#### Scenario: Empty simulation_ids

- GIVEN authenticated user
- WHEN POST with `{simulation_ids: [], mode: "grid", config: {az_step: 30, el_step: 30}}`
- THEN 400 with `{detail: "simulation_ids must be a non-empty list"}`

#### Scenario: Sim ID not in study

- GIVEN sim `X` belongs to a different study
- WHEN POST includes `simulation_ids: [X]`
- THEN 400 with `{detail: "Some simulation_ids do not belong to study <study_pk>"}`

#### Scenario: Exceeds 50-sim limit

- WHEN POST with 51 `simulation_ids`
- THEN 400 with `{detail: "Maximum 50 simulations per batch export"}`

#### Scenario: Unauthenticated

- WHEN POST without auth token
- THEN 401 Unauthorized

#### Scenario: Invalid mode

- WHEN POST with `mode: "spherical"`
- THEN 400 response

---

### Requirement: Mode Config Validation

The system MUST validate config per mode: `grid`/`legacy` require `{az_step > 0, el_step > 0}`; `fibonacci` requires `{n: int, 1 ≤ n ≤ 1000}`. Unknown extra keys in config MUST be ignored.

#### Scenario: Grid with missing az_step

- WHEN POST with `mode: "grid", config: {el_step: 30}` (no `az_step`)
- THEN 400 response

#### Scenario: Fibonacci with n out of range

- WHEN POST with `mode: "fibonacci", config: {n: 0}`
- THEN 400 response

#### Scenario: Extra config keys ignored

- WHEN POST with `mode: "fibonacci", config: {n: 100, unknown_key: "x"}`
- THEN 202 Accepted (extra key silently ignored)

---

### Requirement: Async Task — build_batch_projections_zip

The task MUST accept `(study_id, simulation_ids, mode, config, job_id)`, iterate simulations sequentially, reuse existing PNGs whose filename matches the deterministic pattern from `create_projection_filename` (base=`sim_{uuid[:8]}`, same mode+params), report `PROGRESS` state after each sim, and produce a final SUCCESS result.

#### Scenario: All sims succeed

- GIVEN 3 sims with no existing cached PNGs
- WHEN task runs
- THEN each sim's projections are rendered, task state transitions PENDING → PROGRESS(×3) → SUCCESS
- AND result contains `{zip_path, total_sims_processed: 3, successful_sims: 3, failed_sims: [], duration_sec: float}`

#### Scenario: Per-sim failure isolation

- GIVEN sim 2 of 3 has no geometry (render fails)
- WHEN task runs
- THEN sim 2 error is appended to `failed_sims`, sims 1 and 3 succeed
- AND task state is SUCCESS (not FAILURE), `successful_sims: 2`, `failed_sims: [{sim_id, error}]`

#### Scenario: PNG reuse on second run

- GIVEN first run already rendered all PNGs to disk
- WHEN identical batch export is triggered again
- THEN no re-rendering occurs for existing files
- AND second run duration T2 < 0.5 × first run duration T1

#### Scenario: Soft timeout — partial result

- WHEN task exceeds 30-minute soft timeout
- THEN partial ZIP is returned with sims processed so far, state SUCCESS with partial flag

---

### Requirement: ZIP Structure and Manifest

The ZIP MUST contain `sim_{uuid}/` folders with PNGs named per `create_projection_filename` (zero-padded 3-digit angles), a top-level `manifest.json`, and be named `study_{study_id}_projections_{ISO_date}.zip`.

#### Scenario: Manifest contents

- GIVEN successful export with 2 sims
- WHEN ZIP is opened
- THEN `manifest.json` contains `{export_id, study_id, study_name, exported_at, mode, config, simulations: [{sim_id, sim_name, projection_count, status, error}]}`

#### Scenario: All sims fail — manifest only

- GIVEN all sims fail rendering
- WHEN ZIP is built
- THEN ZIP contains only `manifest.json` (no `sim_*/` folders)

---

### Requirement: Polling and Download Reuse

The `job_id` from the batch endpoint MUST be a valid input for `GET /api/v1/projections-status/{job_id}/` (existing endpoint) and `GET /api/v1/projections-status/{job_id}/download/` (existing endpoint). No special-casing is required.

#### Scenario: Polling reports per-sim progress

- GIVEN batch task in PROGRESS state, current_sim=2, total=5
- WHEN GET projections-status/{job_id}/
- THEN response `{status: "processing", progress: 0.4, current: 2, total: 5}`

#### Scenario: Download after completion

- GIVEN batch task in SUCCESS state with zip_path set
- WHEN GET projections-status/{job_id}/download/
- THEN ZIP file is streamed as `application/zip`

---

### Requirement: Frontend Selection Panel

The system MUST render a "Export Projections" panel on the parametric study results view when at least one simulation is completed. The panel MUST include: per-sim checkboxes, select-all/deselect-all controls, a selected-count display, a mode selector reusing `ProjectionControls`, and a "Generate & Export" button disabled when zero sims are selected.

#### Scenario: Panel visibility

- GIVEN study has at least one completed sim
- WHEN user views parametric study results
- THEN "Export Projections" panel is visible/expandable

#### Scenario: Generate button disabled when none selected

- GIVEN panel is open, no checkboxes checked
- THEN "Generate & Export" button is disabled

#### Scenario: Select all

- GIVEN 5 completed sims visible
- WHEN user clicks "Select all"
- THEN all 5 checkboxes are checked and counter shows "5 of 5 selected"

---

### Requirement: Frontend Polling and Download

After POST, the UI MUST poll `projections-status/{job_id}/` every 2 seconds, display "Processing sim X of Y" with a percentage progress bar, stop polling on `done` or `failed`, auto-download on `done`, show an error toast on `failed`, show a partial-failure warning when `failed_sims` is non-empty, and handle network errors with one retry + backoff before surfacing to the user.

#### Scenario: Progress display

- GIVEN export job running, current=3, total=10
- WHEN polling response received
- THEN UI shows "Processing sim 3 of 10" and progress bar at 30%

#### Scenario: Auto-download on completion

- GIVEN polling receives `{status: "done"}`
- THEN browser automatically initiates download of the batch ZIP

#### Scenario: Partial failure warning

- GIVEN result has `failed_sims: [{sim_id: "X", error: "..."}]`
- WHEN download is initiated
- THEN warning toast: "1 sims failed, N succeeded. Download includes successful sims + manifest."

#### Scenario: Network error handling

- GIVEN a poll request fails due to network error
- WHEN error occurs
- THEN one retry with backoff is attempted; if retry also fails, error is surfaced to user and polling stops
