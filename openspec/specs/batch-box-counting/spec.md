# Spec: batch-box-counting

## Purpose
Opt-in dual-estimator box-counting over parametric-study runs: the study's
box-counting flow gains a Matlab-aligned **windowed estimator** executed
alongside the legacy one, with a three-way comparison surface (Rg-evolution
vs BC legacy vs BC windowed), per-config distributions, study-gated CSV
columns, a dedicated frontend tab, and an async execution boundary.

Context: `../changes/archive/2026-10-19-batch-windowed-box-counting/`
(approval, 4 spec-review rounds, dual blind adversarial review — 2 fix
rounds, both fresh-pass CONFIRMADO). Engine basis: additive
`effective_levels` field; window semantics locked by the Cycle 3.2
diagnostic (`bc_window_alignment_audit`).

This spec describes observable behavior — what a caller sees in HTTP
responses, polling payloads, stored metrics, and the results view.

## Requirements



### Requirement: R1. Windowed parameter and precedence

The run-box-counting flow SHALL accept an optional boolean `windowed` with precedence:
**request body > `study.box_counting_params.windowed` > absent (legacy-only)**. When the
effective value is `true`, every BC execution for the study runs BOTH the legacy estimator
and the windowed estimator (design D2/D3), and the study's stored `box_counting_params`
SHALL be updated preserving `windowed` (not overwritten without it). An explicit
`windowed: false` in the body overrides the study value for that run AND is persisted to
the study params (explicit values win; absence preserves).

The request body schema is `{points_per_sphere?, precision?, windowed?, force?}`; `force`
(R2.3) is accepted in the body but is NEVER persisted to `box_counting_params`. The
unknown-key rejection below applies to the persisted `box_counting_params` shape (i.e.
`{points_per_sphere, precision, windowed}` after `force` is popped); the same rejection
enforces the request body (which shares the validator) and the persisted shape.

This change also ADDS unknown-key rejection to `validate_box_counting_params` (precedent:
`validate_limiting_cases_config`): keys other than `points_per_sphere`, `precision`,
`windowed` are rejected with 400.

#### Scenario R1.1 — Absent parameter is a no-op

- **GIVEN** a study and a request without `windowed` (and study params without it)
- **WHEN** `POST /run-box-counting/` executes
- **THEN** behavior and stored results are identical to pre-change (legacy block only)

#### Scenario R1.2 — Unknown-key rejection (NEW behavior, documented)

- **GIVEN** a request body or persisted `box_counting_params` containing any key outside
  `{points_per_sphere, precision, windowed}` (after popping `force`, which is never persisted)
- **WHEN** validation runs
- **THEN** the response is 400 naming the offending key
- **AND** pre-change, extra keys in the body were silently ignored and only
  `points_per_sphere`/`precision` were stored — this rejection is an
  intentional behavior change introduced by this requirement, enforced by
  `validate_box_counting_params` (called by both the StudySerializer create/update path and
  the run-box-counting action)

#### Scenario R1.3 — Precedence and persistence

- **GIVEN** `study.box_counting_params.windowed = true` and a request body with `windowed` absent
- **WHEN** the POST completes
- **THEN** the dual run executed for simulations WITHOUT an existing legacy block (or with
  `force: true`; sims already holding a legacy block are skipped per R2.3)
- **AND** the study's stored `box_counting_params` retains `windowed: true` with
  `points_per_sphere`/`precision` from the request
- **AND** a request body with `windowed: false` overrides the study value for that run and is
  persisted to the study params

### Requirement: R2. Dual-estimator results storage

When windowed is enabled, each processed simulation SHALL store the windowed block at
`metrics["box_counting_windowed"]` — **ONE schema for all three statuses** (spec-review r3,
MEDIA): always the 11 keys `{dimension, r_squared, std_error, confidence_interval, log_scales,
log_values, execution_time_ms, parameters, status, fit_window_used, error_message}`, where
`dimension, r_squared, std_error, confidence_interval, log_scales, log_values` are `null` when
`status != "ok"`, and `error_message` is a string only when `status == "error"` (`null`
otherwise); `fit_window_used` is `[s, e]` only when `status == "ok"` (no window is derived for
the other statuses), `null` otherwise. `status` enum: `ok | insufficient_levels | error` — `error` covers any windowed-side
failure other than `InsufficientLevels` (engine or pyo3), NEVER aborts the run, and never
overwrites the legacy block. The block SHALL be built by a single shared helper
`build_bc_block(result, params, status, fit_window_used)` — key parity is enforced by code,
not by prose (spec-review r2). `metrics["box_counting"]` is not altered.

#### Scenario R2.1 — Successful windowed fit

- **GIVEN** a simulation with ≥3 count-valid levels after clamping (design D2)
- **WHEN** the dual run completes
- **THEN** `status: "ok"` with the windowed Df/R²/CI and `fit_window_used: [s, e]`
- **AND** the legacy block equals (bit-identically) the pre-change legacy result for the same inputs

#### Scenario R2.2 — Insufficient levels (small aggregates; Cycle 3.2 Log L4)

- **GIVEN** a simulation with `effective_levels < 3` (e.g. very small N where the legacy fit
  itself is degenerate)
- **WHEN** the windowed estimator refuses (`InsufficientLevels`)
- **THEN** the run completes WITHOUT error; the windowed block stores `status:
  "insufficient_levels"` with the 11-key schema and `dimension`/`r_squared`/
  `std_error`/`confidence_interval`/`log_scales`/`log_values`/`fit_window_used` = `null` (R2)
- **AND** the legacy block is stored normally
- **NOTE**: with `effective_levels == 3` the clamp (D2) yields window `(0, 2)` → `status: "ok"`
  with a fit equal to the legacy fit (archive Log L4) — refusal only happens below 3 levels

#### Scenario R2.3 — Re-run and backfill semantics

- **GIVEN** a simulation that already holds `metrics["box_counting"]` (pre-change or legacy-only run)
- **WHEN** a windowed run executes with `force` absent (default `false`)
- **THEN** the simulation is skipped exactly as today (the response's `skipped` counter
  increments, `views.py:2175/2183`)
- **AND** with `force: true` in the request body, legacy AND windowed blocks are recomputed
  and overwritten for that sim (backfill path)

### Requirement: R3. Execution boundary and job lifecycle

The batch run SHALL execute synchronously inside the POST when the **work set** — completed
simulations of the study **with `geometry` present** (`status="completed", geometry__isnull=False`),
the same filter as the processing loop — has ≤30 members, and asynchronously via Celery when >30,
mirroring the FRAKTAL batch boundary (`fraktal-batch-contract.md` R4/R5). The async job state
SHALL use Celery `AsyncResult` + `update_state(meta=...)` (payload mapping pattern:
`fractal_analysis/views.py:719-777`; producer side: `update_state` called from the new Celery
task in `backend/apps/simulations/tasks.py`)
— NOT Django cache (LocMemCache is per-process and invisible across the 2 Gunicorn workers).

The async status payload SHALL inherit the canonical shape: `{status: processing|done|failed,
progress: 0..1, current, total, error?}`.

#### Scenario R3.1 — Sync path

- **GIVEN** a work set of ≤30 sims (geometry-less sims do NOT count toward the boundary)
- **WHEN** `POST /run-box-counting/` is called
- **THEN** the response returns the full per-sim summary in the same request (as today)

#### Scenario R3.2 — Async path

- **GIVEN** a work set of 31 completed sims WITH geometry plus 5 completed sims WITHOUT geometry
- **WHEN** `POST /run-box-counting/` is called
- **THEN** the response is `202 Accepted` with `{task_id, total: 31}` (geometry-less sims excluded)
- **AND** `GET .../run-box-counting/<task_id>/` returns the canonical status payload; while
  `status: "processing"`, `current` reflects incrementally-processed sims
- **AND** on task exception the payload is `status: "failed"` with `error`, and already-written
  per-sim results remain valid

### Requirement: R4. Comparison surface (API)

The study `results` endpoint rows SHALL include the windowed block and `bc_delta =
box_counting_windowed.dimension − box_counting.dimension` ONLY when the windowed block exists
AND `status == "ok"` (a refusal/error block carries no dimension → no delta, r3). The row's
`fractal_dimension` (Rg-evolution Df) is ALREADY returned and is the third comparison term —
no `rg_df` alias is introduced.

### Requirement: R5. Per-config distributions (API)

A new endpoint `GET studies/<pk>/fractal-analysis/` SHALL return, per parameter config:

```json
{
  "config": {…sim.parameters dict…},
  "estimators": {
    "rg":         {"n": 12, "mean": …, "median": …, "q1": …, "q3": …, "min": …, "max": …, "values": […], "insufficient_levels": 0, "errors": 0},
    "bc_legacy":  {"…same shape…"},
    "bc_windowed": {"…same shape…"}
  }
}
```

- `n` counts only sims with a usable value for that estimator; `insufficient_levels` counts
  windowed refusals (`status: "insufficient_levels"`), `errors` counts `status: "error"`
  (separate counters, both excluded from `n` and from all stats; 0 for `rg`/`bc_legacy`);
  refusals/errors are excluded from `n` and from all stats.
- `config` is the sim's `parameters` dict (keys from `study.parameter_grid.keys()` at
  `views.py:2010-2011`, values from `sim.parameters` at `views.py:2065`) — not an unpinned
  projection.
- `rg` reads `metrics["fractal_dimension"]` (the value the results endpoint already returns,
  `views.py:1918`).
- `values` is the raw array; the histogram is computed CLIENT-side with `sturgesBuckets`
  (clamp [3,30], `FraktalBatchDistributions.tsx:52-56`) — the backend does NOT bucket.

#### Scenario R5.1 — Hand-computed aggregate

- **GIVEN** one config with bc_windowed values `[2.30, 2.50, 2.70]` and 1 refusal
- **WHEN** the endpoint returns that config's `bc_windowed` stats
- **THEN** `n: 3, mean: 2.5, median: 2.5, min: 2.30, max: 2.70, insufficient_levels: 1`
  (quartiles with the same percentile formula as the batch stats helper
  `backend/apps/fractal_analysis/services/batch.py:320-343`, `np.percentile(arr, 25/75)`)

### Requirement: R6. CSV export (study-level header gate)

When the study has a windowed run recorded (any row carrying a `box_counting_windowed`
block), the CSV header SHALL append `BC_Win_Df, BC_Win_R2, BC_Win_StdError, BC_Win_Time_ms,
BC_Win_Delta, BC_Win_Status` after the existing `BC_*` columns; rows without a windowed block
emit empty cells in those columns. `BC_Win_Delta` carries the R4 delta (windowed − legacy)
only when that row's windowed `status == "ok"`, else empty. The appended block sits after the
columns gated by `study.include_box_counting` (`views.py:2043-2045`): a study with the flag
toggled off after a windowed run keeps its `BC_Win_*` header (the gate for the windowed block
is the recorded run, not the current flag). A study whose run was legacy-only produces a CSV
**byte-identical** to pre-change (single header, no appended block).

### Requirement: R7. Frontend: dedicated Fractal Analysis tab

The study page SHALL expose a dedicated tab "Fractal Analysis" containing: (a) the per-sim
comparison table (columns: sim, config, `fractal_dimension` labeled "Rg Df", BC Df, BC R²,
BC Win Df, BC Win R², Δ, status with `insufficient_levels` rendered distinctly), (b) histogram
panels per config per estimator reusing the `sturgesBuckets` semantics, **inheriting the
data-volume behaviors of `fraktal-batch-distributions.md`**: `n = 0` (or all refusals) → R4
"No data available" (NEW tab rule for n=0, not inherited); `1 ≤ n < 5` → the "Not enough data"
panel the component actually renders (per-metric gate `MIN_N_SUCCESSFUL = 5`,
`FraktalBatchDistributions.tsx:97/241` — lines 14-15 are the global no-data gate)
(`FraktalBatchDistributions.tsx:14-15,168`); single-bar rendering per R5 only at `n ≥ 5`,
(c) the CSV export of R6. Frontend types: `StudyFractalAnalysisSummary` (distinct from the
existing `FraktalAnalysisSummary`). Without a windowed run the tab shows legacy + Rg columns
only, with no error state.

#### Scenario R7.1 — Without windowed run

- **GIVEN** a study whose BC runs were legacy-only
- **WHEN** the tab renders
- **THEN** no windowed columns appear and no empty-state error is shown

#### Scenario R7.2 — Degenerate distributions

- **GIVEN** a config where `bc_windowed` has `n: 1` (or all refusals)
- **WHEN** the histogram panel renders
- **THEN** `1 ≤ n < 5` shows the inherited "Not enough data" panel and `n: 0` shows the R4
  "No data available" state — never a blank or crashed panel (single-bar per R5 only at n≥5)

#### Scenario R7.3 — Run windowed control (entry point, JD-A-003)

- **GIVEN** a study without any windowed block
- **WHEN** the user activates the "Run windowed BC" control in the Fractal Analysis tab
- **THEN** the client posts `run-box-counting` with `{windowed: true, force: true}` (dual-response + poller per R3)
- **AND** the control hides once a windowed block exists
- **AND** a 409 in-flight response surfaces the in-flight task_id without breaking the tab

### Requirement: R8. Single-simulation windowed analysis (opt-in)

The single-sim `GET .../box-counting/` endpoint (`views.py:1502`) SHALL accept an optional
`windowed=true` query param (only `"true"` engages it; `windowed=false` or absent = legacy
behavior); the flat response dict gains a `box_counting_windowed` key with the R2 schema (all
statuses: `ok` full keys; `insufficient_levels`/`error` per the R2 null-schema with
`error_message`); when the param is absent, the response is byte-identical to pre-change.

#### Scenario R8.1 — Response unchanged without the flag

- **GIVEN** a GET without `windowed`
- **WHEN** it executes
- **THEN** the response is byte-identical to pre-change

### Requirement: R9. Engine additive field `effective_levels`

`BoxCountingResult3D` SHALL gain a read-only additive field `effective_levels: usize` (number
of count-valid levels BEFORE the Step 4b saturation truncation), mirrored in `PyFractalResult`.
The 2D result's `From` impl populates it as `0` (3D-only semantics). No behavior, signature,
or existing field changes. For `effective_levels < 3` the backend derives NO window and writes
`status: "insufficient_levels"` without calling the windowed estimator (avoids the `eff−1`
underflow and the pyo3 `(usize, usize)` constraint).

#### Scenario R9.1 — Field present on both paths

- **GIVEN** any coordinate set analyzed via the 3D legacy path and via the windowed path
- **WHEN** results are inspected
- **THEN** both carry `effective_levels` with the pre-truncation count-valid level count
- **AND** all existing fields and values are unchanged (byte-identical results otherwise)
- **AND** the acceptance fixture includes a case where Step 4b truncation fires (`effective_levels
  > 6` with a plateau) asserting the field reports the PRE-truncation count (r3: without it, a
  post-truncation implementation would pass R9.1)

## Out of scope call sites (documented)

- `ai_assistant/tools/analysis_tools.py:89` (AI tool BC path) — legacy only, no `windowed`.
- `tasks.py:1139` `compute_import_metrics` (import pipeline) — legacy only, no `windowed`.
- FRAKTAL image analysis (2D) — separate capability; windowed is 3D-only.
