# Design: projections-export-fix

## Architecture overview

The export pipeline splits direction generation from projection rendering. Today `project_batch_internal` conflates both (broken pole dedup, elevation-landing-on-90 heuristic). The redesign introduces a pure `Direction` list as the interface between "how we pick viewpoints" (grid / fibonacci / legacy) and "how we render them" (`project_directions_internal`). The backend selects the generator by `mode`, dispatches sync vs. async based on N, and assembles a ZIP with a `metadata.json` manifest that makes the export self-describing.

Async storage, progress granularity, and filename-helper location are locked: reuse `compute_import_metrics_task`'s pattern (local disk, same as `Simulation.geometry`), report progress every 10 projections, and keep the filename helper on the Python side for fixture testing.

```
Frontend ProjectionControls  ──POST /export-projections/?mode=…──▶  Django view
                                                                         │
                                                          ┌──────────────┼──────────────┐
                                                          ▼              ▼              ▼
                                                    mode=legacy     mode=grid       mode=fibonacci
                                                    project_batch   generate_direction_grid   generate_direction_fibonacci
                                                          │              │              │
                                                          └──────────────┼──────────────┘
                                                                         ▼
                                                          project_directions_internal (Rust)
                                                                         │
                                                                         ▼
                                                          matplotlib render PNGs  ─┐
                                                                         │         │ finally: plt.close(fig)
                                                                         ▼         │
                                                          build_projection_zip ◀───┘
                                                                         │
                                                        N ≤ 200 ─────────┼───────── N > 200
                                                            │                            │
                                                            ▼                            ▼
                                                    200 ZIP (sync)           202 {job_id} + Celery
                                                                                        │
                                                      Frontend polls /projections-status/{job_id}/
```

## Key components

### Component 1: `aglogen_core/engine/src/projection/directions.rs` — NEW
**Purpose**: pure direction generation, no rendering.
**Public API**:
```rust
pub struct Direction { pub azimuth_deg: f64, pub elevation_deg: f64 }
pub fn generate_grid(n_az: usize, n_el: usize) -> Vec<Direction>;
pub fn generate_fibonacci(n: usize) -> Vec<Direction>;
```
**Grid math**: elevations = `linspace(-90, 90, n_el)`; azimuths = `linspace(0, 360, n_az+1)[..n_az]`. For each elevation: if `|el| == 90` emit ONE `Direction { azimuth=0, elevation=±90 }`; else emit `n_az` directions (one per azimuth). Output order: poles at indices 0 and N−1, interior sorted by `(elevation asc, azimuth asc)`.
**Fibonacci math**: `phi = PI*(3 - sqrt(5))`; for `i in 0..n`: `y = 1 - (2i+1)/n`; `theta = i*phi`; `x = cos(theta)*sqrt(1-y²)`; `z = sin(theta)*sqrt(1-y²)`; `azimuth = atan2(z, x).to_degrees().rem_euclid(360)`; `elevation = y.asin().to_degrees()`. Output in natural lattice order.

### Component 2: `project_directions_internal` in `aglogen_core/engine/src/projection/mod.rs` — NEW
**Purpose**: single iteration point over any Direction list.
**Signature**:
```rust
pub fn project_directions_internal(
    coords: &[[f64; 3]],
    radii: &[f64],
    directions: &[Direction],
) -> Vec<ProjectionResult>;
```
**Behavior**: for each `Direction`, call existing `project_to_2d_internal(coords, radii, az, el)`. No image rendering here — callers get raw `ProjectionResult` and render in Python.
**Backcompat**: `project_batch_internal` stays byte-for-byte unchanged for legacy consumers (`fractal_analysis`, external scripts).

### Component 3: PyO3 bindings in `aglogen_core/python/src/lib.rs` — MODIFIED
**New functions**:
```rust
#[pyfunction] fn generate_direction_grid(n_az: usize, n_el: usize) -> Vec<(f64, f64)>
#[pyfunction] fn generate_direction_fibonacci(n: usize) -> Vec<(f64, f64)>
#[pyfunction] fn project_directions(
    py: Python, coordinates: PyReadonlyArray2<f64>, radii: PyReadonlyArray1<f64>,
    directions: Vec<(f64, f64)>,
) -> PyResult<Vec<PyProjectionResult>>
```
Tuple `(az, el)` over a typed struct keeps the binding lean; Python side wraps.
**Kept**: `project_to_2d`, `project_batch` unchanged.

### Component 4: `backend/apps/simulations/services/projections.py` — NEW
**Purpose**: ZIP assembly, `metadata.json`, filename helper.
**Interface**:
```python
def build_projection_filename(index: int, azimuth: float, elevation: float, fmt: str = "png") -> str: ...
def build_metadata_json(mode: str, n_requested: int, directions: list, parameters: dict) -> dict: ...
def build_projection_zip(directions: list[tuple[float, float]], images: list[bytes],
                        mode: str, n_requested: int, parameters: dict) -> bytes: ...
```
**Filename implementation**:
```python
def build_projection_filename(index, azimuth, elevation, fmt="png"):
    az_int = int(round(azimuth)) % 360
    el_int = int(round(elevation))          # already in [-90, +90]
    sign = "+" if el_int >= 0 else "-"
    return f"proj_{index:03d}_Az{az_int:03d}_El{sign}{abs(el_int):03d}.{fmt}"
```
Index prefix guarantees uniqueness for Fibonacci floats that round to identical `(az, el)` integers.

### Component 5: `backend/apps/simulations/views.py` — MODIFIED
**Endpoint**: `POST /api/v1/projects/{pid}/simulations/{sid}/export-projections/?mode=…`
**Dispatch**:
- `mode` absent or `legacy` → existing `project_batch` path unchanged; no `metadata.json`, old filenames.
- `mode=grid` → `generate_direction_grid(n_az, n_el)` → N = `n_az*(n_el-2)+2` (or fewer if `n_el==2`).
- `mode=fibonacci` → `generate_direction_fibonacci(n)` → N = n.
- If `N ≤ 200`: render synchronously → `build_projection_zip` → `StreamingResponse`, `200 OK`.
- If `N > 200`: enqueue Celery → return `202 {"job_id": …}`.
- New endpoint `GET /api/v1/projections-status/{job_id}/` returns `{status, progress, download_url?, error?}`.
- Matplotlib rendering loop uses `try { fig = ...; ... } finally: plt.close(fig)` to prevent leaks.
- Validation: `n_az ≥ 1`, `n_el ≥ 2`, `n ≥ 1`, upper cap `n ≤ 1000` (invalid → 400).

### Component 6: `backend/apps/simulations/tasks.py` — MODIFIED (new task)
```python
@shared_task(bind=True)
def build_projections_zip_task(self, sim_id: str, mode: str, n_requested: int,
                               directions: list[tuple[float, float]],
                               parameters: dict) -> dict:
    # Load simulation.geometry from local disk (same as compute_import_metrics_task)
    # Render PNGs in a loop; every 10: self.update_state(state="PROGRESS",
    #                                      meta={"progress": i/total, "current": i, "total": total})
    # Write ZIP to same storage location Simulation.geometry uses
    # Return {"download_url": "...", "n_generated": total}
```
Reuses `compute_import_metrics_task` storage convention — no new infrastructure.

### Component 7: `backend/apps/simulations/urls.py` — MODIFIED
Add: `path("projections-status/<str:job_id>/", ProjectionsStatusView.as_view(), name="projections-status")`.
View body: `AsyncResult(job_id).{status, info}` → JSON.

### Component 8: `frontend/src/components/projection/ProjectionControls.tsx` — MODIFIED
**Mode selector** (shadcn `Select`): Grid (default) | Fibonacci | Legacy.
**Conditional inputs**:
- Grid: `n_az`, `n_el` + preview text `Will generate {n_az*(n_el-2)+2} projections`.
- Fibonacci: `n` + preview `{n} projections (uniform spherical)`.
- Legacy: existing 6 inputs, unchanged.
**Submit**: build payload per mode. For async jobs, show a progress bar fed by the polling helper.

### Component 9: `frontend/src/lib/api.ts` — MODIFIED
```ts
async function exportProjections(
  simId: string, payload: ExportProjectionsPayload, onProgress?: (p: number) => void,
): Promise<Blob> {
  const resp = await post(`/simulations/${simId}/export-projections/`, payload);
  if (resp.status === 200) return resp.blob();
  if (resp.status === 202) {
    const { job_id } = await resp.json();
    return pollUntilDone(job_id, onProgress);
  }
  throw new Error(`Unexpected status ${resp.status}`);
}
```
`pollUntilDone` hits `/projections-status/{job_id}/` every 1s, calls `onProgress` with `meta.progress`, resolves with blob fetched from `download_url` when `status === "done"`, rejects on `"failed"`.

### Component 10: `docs/projections-export.md` — NEW
User-facing guide: modes, filename contract, `metadata.json` shape, sync/async threshold, limits.

## Data model

### `metadata.json`
```json
{
  "mode": "grid" | "fibonacci" | "legacy",
  "n_requested": 32,
  "n_generated": 32,
  "parameters": {
    "img_size": 512
    // grid:     "n_az": 10, "n_el": 5
    // fibonacci:"n": 50
    // legacy:   "azimuth_start", ..., "elevation_step"
  },
  "directions": [
    { "index": 0, "filename": "proj_000_Az000_El-090.png", "azimuth": 0.0, "elevation": -90.0 },
    { "index": 1, "filename": "proj_001_Az000_El-045.png", "azimuth": 0.0, "elevation": -45.0 }
  ]
}
```

### Filename contract
`proj_{idx:03d}_Az{AAA}_El{±EEE}.{fmt}` — e.g. `proj_015_Az090_El+030.png`.

## Edge cases

- `n_el == 2` in grid → only poles, 2 projections.
- `n_az == 1` in grid → 1 projection per interior elevation + 2 poles.
- `n == 1` in fibonacci → 1 projection (first lattice point).
- `n > 1000` → rejected with 400.
- Simulation without geometry → 400 before dispatch.
- Celery task dies mid-run → status=`failed`, error surfaced to frontend, no orphan ZIP.
- Client navigates away during async → task keeps running; user can hit `/projections-status/{job_id}/` later if job_id was saved.
- Duplicate filenames impossible thanks to index prefix (Fibonacci float collisions resolved).

## Backwards compatibility

- Callers that omit `mode` (or send `mode=legacy`) hit the unchanged `project_batch` path → byte-for-byte identical output (filenames, count, shape). No `metadata.json` in legacy ZIPs.
- Rust `project_batch_internal` untouched.
- `PyProjectionResult` unchanged — new functions reuse it.
- External scripts parsing old filenames: unaffected on legacy mode.

## Testing strategy

| Layer | What | Approach |
|-------|------|----------|
| Rust unit | `generate_grid` count matches `n_az*(n_el-2)+2` for `(10,5),(6,3),(4,7),(1,2)` | `#[test]` in `directions.rs` |
| Rust unit | Grid poles appear exactly once at `el=±90` regardless of `n_az` | exhaustive over `n_el ∈ {2,3,4,5,7}` |
| Rust unit | `generate_fibonacci(n)` returns exactly n directions, azimuths in [0,360), elevations in [-90,90] | per `n ∈ {1, 2, 50, 500}` |
| Rust unit | Fibonacci uniformity sanity: sum of pairwise dot products within expected envelope | statistical bound |
| PyO3 integ | `project_directions` produces N `PyProjectionResult`, round-trip of tuples | pytest in `aglogen_core/python/tests/` |
| Backend | `mode=grid n_az=10 n_el=5` → 32 PNGs + metadata.json with 32 entries | DRF test client |
| Backend | `mode=fibonacci n=50` → 50 PNGs, unique filenames, metadata complete | DRF test client |
| Backend | `mode=legacy` byte-equivalent to pre-change output (hash assertion) | fixture comparison |
| Backend | Sync/async threshold: `n=200` returns 200 OK with ZIP; `n=201` returns 202 with `job_id` | parametrized |
| Backend | Polling endpoint returns `processing`/`done`/`failed` states | mock Celery `AsyncResult` |
| Backend | Invalid mode / `n_el=1` / `n=0` / `n>1000` → 400 | negative cases |
| Frontend Vitest | Mode switch renders conditional inputs | `@testing-library/react` |
| Frontend Vitest | Grid preview count formula matches backend emit | snapshot + computation |
| Frontend Vitest | `exportProjections` polls 202 → resolves with blob | MSW mock |
| Manual | Grid 10×5 → 32 files; Fibonacci 500 → progress bar → download | happy-path acceptance |

## Migration / Rollout

No data migration. Feature-flaggable at frontend level if needed (default `Grid`, fallback to Legacy). Endpoint is additive — legacy path is the default.

## Open questions (for TASKS)

- [ ] Exact field names in Celery progress meta — align with `compute_import_metrics_task` convention (likely `{"progress", "current", "total"}`).
- [ ] Whether to add a pre-flight preview endpoint so the UI count is authoritative (current plan: UI computes locally with the same formula as backend).
