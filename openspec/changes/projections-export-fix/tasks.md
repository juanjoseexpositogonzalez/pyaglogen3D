# Tasks: Projections Export Fix

## Phase 1: Rust Direction Generators

- [ ] 1.1 [M] Create `aglogen_core/engine/src/projection/directions.rs` with `Direction { dx, dy, dz, azimuth_deg, elevation_deg }` struct, `generate_grid(n_az, n_el)` (exact pole dedup, R1), and `generate_fibonacci(n)` (golden-angle lattice, `azimuth = atan2(z, x).to_degrees().rem_euclid(360)`, R2). Math per design Component 1.
  - Depends on: none
  - Done when: `cargo build -p aglogen-engine` compiles clean.

- [ ] 1.2 [M] Create `aglogen_core/engine/src/projection/mod.rs` exposing `project_directions_internal(coords, radii, &[Direction], img_size) -> Vec<Projection2D>` as the shared plug point. Wire module from `lib.rs`. Leave `project_batch_internal` untouched (legacy backcompat, R3).
  - Depends on: 1.1
  - Done when: `cargo build -p aglogen-engine` compiles clean; `project_batch_internal` signature unchanged.

- [ ] 1.3 [tests][S] Add unit tests in `directions.rs`:
  - R1: grid count formula `n_az*(n_el-2) + 2` for `n_el ∈ {2,3,4,5,7}`, `n_az ∈ {4,10}`.
  - R2: fibonacci returns exact N for `n ∈ {1,2,50,500}`; all directions unique within epsilon.
  - R7: azimuth/elevation math — poles (0,0,±1) → el=±90; cardinals (1,0,0)/(0,1,0) → az=0/90.
  - Use `approx::assert_relative_eq` with `epsilon = 1e-9`.
  - Depends on: 1.1
  - Done when: `cargo test -p aglogen-engine projection::directions` all pass.

## Phase 2: PyO3 Bindings

- [ ] 2.1 [M] Expose in `aglogen_core/python/src/lib.rs`:
  - `generate_direction_grid(n_az: usize, n_el: usize) -> Vec<(f64, f64)>` returning `(azimuth_deg, elevation_deg)`.
  - `generate_direction_fibonacci(n: usize) -> Vec<(f64, f64)>`.
  - `project_directions(coords, radii, directions: Vec<(f64,f64)>, img_size) -> list[dict]` mirroring `project_batch` output shape.
  - Leave `project_batch` binding unchanged.
  - Depends on: 1.2
  - Done when: `maturin develop` succeeds; `python -c "from aglogen_core import generate_direction_grid; print(generate_direction_grid(10,5))"` prints 32 tuples.

- [ ] 2.2 [tests][S] Create `aglogen_core/python/tests/test_projection_directions.py` — round-trip smoke tests: count matches spec for grid & fibonacci; every tuple is `(float, float)`; azimuth ∈ [0,360), elevation ∈ [-90,90]; `project_directions` output count equals input direction count.
  - Depends on: 2.1
  - Done when: `uv run pytest aglogen_core/python/tests/test_projection_directions.py` passes.

## Phase 3: Backend Services, Endpoint, Celery

- [ ] 3.1 [S] Create `backend/apps/simulations/services/projections.py` with:
  - `build_projection_filename(index: int, azimuth: float, elevation: float, fmt: str = "png") -> str` → `proj_{idx:03d}_Az{AAA}_El{±EEE}.{fmt}` (R4).
  - `build_metadata_json(mode, n_requested, directions, parameters) -> dict` (R5 shape).
  - `build_projection_zip(directions, image_bytes_list, mode, n_requested, parameters) -> bytes` — writes named PNGs + `metadata.json` into in-memory ZIP.
  - Depends on: none
  - Done when: module imports without error; functions callable.

- [ ] 3.2 [tests][S] Create `backend/apps/simulations/tests/test_projection_services.py`:
  - Filename format for `(0, 45.0, -30.0)` → `proj_000_Az045_El-030.png` (R4).
  - `Az360` wraps to `Az000`; elevation sign preserved.
  - Metadata JSON has keys `{mode, n_requested, n_generated, directions[], parameters}` (R5).
  - ZIP contains all expected filenames + `metadata.json`; PNG count matches direction count.
  - Depends on: 3.1
  - Done when: `uv run pytest backend/apps/simulations/tests/test_projection_services.py --no-migrations` passes.

- [ ] 3.3 [M] Modify `backend/apps/simulations/views.py` export-projections endpoint to accept `mode` query/body param:
  - `mode` omitted or `legacy` → current code path unchanged (R3 backcompat).
  - `mode=grid` → require `n_az, n_el`; call `generate_direction_grid`; N = `n_az*(n_el-2)+2`.
  - `mode=fibonacci` → require `n`; call `generate_direction_fibonacci`; N = n.
  - Dispatch: N ≤ 200 → sync (build ZIP in request, return `200` with `application/zip`); N > 200 → async (enqueue Celery, return `202` with `{job_id}`).
  - Validate per R8: reject invalid `mode` (400), missing required fields (400), out-of-range values (400 — `n_az<1`, `n_el<2`, `n<1`, `n>10000`).
  - Wrap matplotlib rendering in `try/finally` with `plt.close(fig)` to prevent figure leaks.
  - Depends on: 2.1, 3.1
  - Done when: endpoint returns correct status codes for each branch; manual `curl` test with grid/fibonacci/legacy succeeds.

- [ ] 3.4 [M] Add `build_projections_zip_task(self, sim_id, mode, n_requested, directions, parameters)` to `backend/apps/simulations/tasks.py`:
  - Mirror `compute_import_metrics_task` local-disk storage pattern for the resulting ZIP (same directory as `simulation.geometry`).
  - Progress reporting every 10 projections via `self.update_state(state="PROGRESS", meta={"progress": float, "current": int, "total": int})` — match exact keys used by `compute_import_metrics_task`.
  - On completion, persist ZIP path on the simulation record and return `{download_url: ...}`.
  - On failure, state transitions to FAILURE with error message (R6).
  - Depends on: 3.1, 3.3
  - Done when: task importable by Celery worker; dispatch from endpoint produces a job_id.

- [ ] 3.5 [S] Add polling endpoint `GET /api/v1/projections-status/{job_id}/` in `views.py` + register in `urls.py`. Returns `{state: "processing"|"done"|"failed", progress: 0.0..1.0, download_url?: str, error?: str}` per R6. Use Celery `AsyncResult(job_id)` to read state/meta.
  - Depends on: 3.4
  - Done when: polling a valid running/completed job_id returns correct JSON shape.

- [ ] 3.6 [tests][M] Create `backend/apps/simulations/tests/test_export_projections_modes.py`:
  - Grid `n_az=10, n_el=5` → sync, 200, ZIP has 32 PNGs + metadata.json.
  - Fibonacci `n=50` → sync, 200, ZIP has 50 PNGs.
  - Legacy (no `mode`) → byte-equivalent to pre-change baseline (snapshot compare on deterministic seed — R3).
  - Fibonacci `n=201` → async, 202, response includes `job_id`.
  - Invalid `mode=foo` → 400.
  - `mode=grid` without `n_el` → 400.
  - `mode=fibonacci` without `n` → 400.
  - `mode=grid` with `n_el=1` → 400.
  - Depends on: 3.3, 3.4, 3.5
  - Done when: `uv run pytest backend/apps/simulations/tests/test_export_projections_modes.py --no-migrations` passes.

- [ ] 3.7 [tests][S] Create `backend/apps/simulations/tests/test_projections_status_polling.py`:
  - Running job → `state=processing`, progress increases on repeated poll.
  - Completed job → `state=done`, `download_url` present.
  - Failed job → `state=failed`, `error` populated.
  - Unknown job_id → 404.
  - Depends on: 3.5
  - Done when: test file passes under `--no-migrations`.

## Phase 4: Frontend Mode Selector + Polling

- [ ] 4.1 [M] Modify `frontend/src/components/projection/ProjectionControls.tsx`:
  - Add mode selector: `Grid` (default) | `Fibonacci` | `Legacy`.
  - Conditional inputs: Grid shows `n_az, n_el`; Fibonacci shows `n`; Legacy shows current controls unchanged.
  - Client-side preview count: Grid = `n_az * (n_el - 2) + 2`; Fibonacci = `n`; Legacy = existing formula.
  - Submit payload per mode matches backend contract (R8).
  - Depends on: 3.3 contract stable
  - Done when: component renders each mode's inputs; preview count updates live.

- [ ] 4.2 [M] Add `exportProjections(simId, payload, onProgress?)` to `frontend/src/lib/api.ts`:
  - Sync path: request returns `200` + `application/zip` → resolve with Blob.
  - Async path: request returns `202` + `{job_id}` → poll `GET /projections-status/{job_id}/` at ~1Hz; call `onProgress(progress)` on each tick; on `state=done` fetch `download_url` and resolve with Blob; on `state=failed` reject with error.
  - Depends on: 3.5 contract stable
  - Done when: function exported; TypeScript types match backend response shape.

- [ ] 4.3 [tests][S] Create `frontend/src/components/projection/__tests__/ProjectionControls.test.tsx`:
  - Switching mode updates visible inputs (Grid hides `n`, Fibonacci hides `n_az/n_el`, Legacy hides both new sets).
  - Preview count for `n_az=10, n_el=5` → `32`; for `n=50` → `50`.
  - Submit payload shape per mode.
  - Depends on: 4.1
  - Done when: `npm test -- ProjectionControls` passes.

- [ ] 4.4 [tests][S] Create `frontend/src/lib/__tests__/api-projections.test.ts`:
  - Mock fetch returning `200` + blob → `exportProjections` resolves with blob; `onProgress` not required.
  - Mock `202` → poll returns `processing` (progress 0.5) → `done` → resolves with blob; `onProgress` called with values in `[0, 1]`.
  - Mock `202` → poll returns `failed` → rejects with error message.
  - Depends on: 4.2
  - Done when: `npm test -- api-projections` passes.

## Phase 5: Docs + Verification

- [ ] 5.1 [S] Create `docs/projections-export.md` user guide per design Component 10 — covers mode selection, grid vs fibonacci tradeoffs, ZIP contents, async polling, and filename format.
  - Depends on: Phase 3 complete
  - Done when: file exists and cross-references spec R-numbers.

- [ ] 5.2 [verify] Run full test suite:
  - `cargo test -p aglogen-engine projection`
  - `uv run pytest backend/apps/simulations/tests/ --no-migrations`
  - `cd frontend && npm test`
  - Depends on: all prior tasks
  - Done when: all three commands exit 0.

- [ ] 5.3 [verify] `cd frontend && npx tsc --noEmit` — zero errors.
  - Depends on: 4.1, 4.2
  - Done when: command exits 0.

- [ ] 5.4 [changelog] Prepend entry to `CHANGELOG.md`:
  - **Added**: Grid mode with exact pole dedup; Fibonacci lattice mode; `metadata.json` in ZIP; async dispatch for N > 200.
  - **Fixed**: silent projection drops in grid discretization; half-baked pole dedup emitting 19 when UI promised 24.
  - **Backcompat**: legacy mode unchanged byte-for-byte.
  - Depends on: all prior tasks
  - Done when: entry appears at top of `CHANGELOG.md`.

## Parallel Batches

Tasks grouped by what sdd-apply can run together in one pass:

1. **Batch 1 — Rust core**: 1.1 → 1.2 → 1.3 (sequential within batch)
2. **Batch 2 — PyO3 bindings**: 2.1 → 2.2
3. **Batch 3 — Backend services**: 3.1 → 3.2 (parallel-safe with Batch 2)
4. **Batch 4 — Backend endpoint + Celery**: 3.3 → 3.4 → 3.5 → 3.6 + 3.7 (3.6/3.7 parallel after 3.5)
5. **Batch 5 — Frontend**: 4.1 + 4.2 parallel; 4.3 after 4.1; 4.4 after 4.2
6. **Batch 6 — Docs + verify**: 5.1 any time after Batch 4; 5.2 + 5.3 parallel at end; 5.4 last

## Effort Summary

| Effort | Count | Tasks |
|--------|-------|-------|
| S      | 9     | 1.3, 2.2, 3.1, 3.2, 3.5, 3.7, 4.3, 4.4, 5.1 |
| M      | 9     | 1.1, 1.2, 2.1, 3.3, 3.4, 3.6, 4.1, 4.2, (none L) |
| L      | 0     | — |
| verify | 2     | 5.2, 5.3 |
| changelog | 1  | 5.4 |
| **Total** | **21** | |

Reference map: R1 (1.1, 1.3), R2 (1.1, 1.3), R3 (1.2, 3.3, 3.6), R4 (3.1, 3.2), R5 (3.1, 3.2), R6 (3.4, 3.5, 3.7), R7 (1.3), R8 (3.3, 3.6, 4.1).
