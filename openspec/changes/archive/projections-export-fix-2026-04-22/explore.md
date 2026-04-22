# Exploration: projections-export-fix

## 1. Executive summary

- **Pole dedup exists but is half-baked and buggy.** `project_batch_internal` in `aglogen_core/engine/src/projection/mod.rs:111-126` tries to skip duplicate poles, but only skips them when the CURRENT elevation sample lands exactly on ±90 AND is not the first azimuth. If the user-chosen elevation range + step does not land on 90 exactly, NO dedup happens. If it does land, the dedup is partial (keeps 1 pole projection, not the cleaner "one per pole").
- **No Fibonacci lattice exists anywhere.** All generation is `while az` × `while el` nested loops in Rust, driven from the HTTP endpoint with start/end/step params.
- **The "missing projections" bug is a combo of two things**:
  1. The view allows elevations in `[-90, 90]` individually, but `el_end = 150` is also allowed (view only checks `el_start ∈ [-90, 90]` per-variable, not the full sweep). UI defaults to `el_end=90` so in practice it's fine, but backend accepts garbage.
  2. The UI counts `numAz × numEl` (line 80 of `ProjectionControls.tsx`) but the backend emits fewer because of the pole skip (e.g., defaults `0..150/30 az × 0..90/30 el = 6×4 = 24` → backend emits 19). So UI advertises 24, user gets 19 → "missing projections".
- **No `metadata.json` exists.** ZIP is just PNGs named `{simId[:8]}_Az{az}_El{el}.{fmt}` via `create_projection_filename` in `backend/apps/simulations/services/projection.py:157-174`. `int()` truncates toward zero (so El=-30.5 → "-30", losing sign/precision info) and uses `03d` which works for 0..360 az but is awkward for signed elevation (-90 shows as "-90", 30 shows as "030", no sign for positive).
- **Rendering is matplotlib**, single-threaded, `dpi=150`, facecolor red, background white. Resolution is not exposed to the endpoint.

## 2. Current architecture

### File map

Backend (Django)
- `backend/apps/simulations/views.py:595-712` — `SimulationViewSet.projection_batch` action, POSTed from frontend
- `backend/apps/simulations/urls.py:37-40` — route `/projects/{pid}/simulations/{sid}/projection/batch/`
- `backend/apps/simulations/services/projection.py` — matplotlib PNG/SVG renderer + filename builder
- `backend/apps/simulations/services/__init__.py:2` — re-exports renderers

Rust engine
- `aglogen_core/engine/src/projection/mod.rs` — `project_to_2d_internal`, `project_batch_internal`, `build_view_matrix`
- `aglogen_core/python/src/lib.rs:699-763` — PyO3 wrappers `project_to_2d` and `project_batch`

Frontend (Next.js 14)
- `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx:124-148` — `handleBatchDownload` (button handler)
- `frontend/src/components/projection/ProjectionControls.tsx` — UI (sliders + 6 inputs for az/el start/end/step), line 80 computes `totalProjections = numAz * numEl`
- `frontend/src/lib/api.ts:227-271` — `simulationsApi.getProjectionBatch` POST body: `{azimuth_start, azimuth_end, azimuth_step, elevation_start, elevation_end, elevation_step, format}`

### Call graph

```
[User click "Download ZIP"]
  → ProjectionControls.handleDownloadBatch  (frontend)
  → simulationsApi.getProjectionBatch       (frontend/lib/api.ts)
  → POST /projects/.../projection/batch/    (Django URL)
  → SimulationViewSet.projection_batch      (views.py:595)
    → validates params (az ∈ [0,360], el ∈ [-90,90] per variable; step > 0)
    → _load_geometry → (coords, radii) numpy arrays
    → aglogen_core.project_batch(coords, radii, az_start, az_end, az_step, el_start, el_end, el_step)
      → project_batch_internal (Rust)
        → nested while loops, calls project_to_2d_internal per (az,el)
    → for each ProjectionResult: render_projection_png/svg + create_projection_filename
    → zipfile.ZipFile.writestr per projection
  → HttpResponse (application/zip)
```

## 3. Current direction generation (the bug)

### Exact code (`aglogen_core/engine/src/projection/mod.rs:108-129`)

```rust
pub fn project_batch_internal(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth_start: f64, azimuth_end: f64, azimuth_step: f64,
    elevation_start: f64, elevation_end: f64, elevation_step: f64,
) -> Vec<ProjectionResult> {
    let mut results = Vec::new();

    let mut az = azimuth_start;
    while az <= azimuth_end + 1e-10 {
        let mut el = elevation_start;
        while el <= elevation_end + 1e-10 {
            if (el.abs() - 90.0).abs() < 1e-10 && az > azimuth_start + 1e-10 {
                el += elevation_step;
                continue;
            }
            let result = project_to_2d_internal(coordinates, radii, az, el);
            results.push(result);
            el += elevation_step;
        }
        az += azimuth_step;
    }
    results
}
```

### Bug diagnosis

**Bug A — "missing projections" mismatch between UI count and backend emit**

The UI preview count formula is:
```
numAz * numEl   (ProjectionControls.tsx:80)
```
where `numAz = floor((azEnd - azStart) / azStep) + 1`. This ignores pole dedup entirely.

With frontend defaults `az:[0,150]/30, el:[0,90]/30`:
- `numAz = 6`, `numEl = 4` → UI says **"24 projections will be generated"**
- Backend loop: at el=90, first az (0) emits 1 projection; azs 30, 60, 90, 120, 150 all skip (5 skipped). Total emitted = `6×4 - 5 = 19`.
- → User sees "24" in UI, gets ZIP with 19 files. **Bug confirmed.**

If user changes defaults to `el:[0,90]/15` (elevations 0,15,...,90), same: el=90 hit once per az → 5 dupes skipped. `numAz × numEl = 6×7 = 42`; emitted = 37.

**Bug B — pole dedup is broken for ranges that don't land on ±90**

If user sets `el:[-85, 85]/10`, NO elevation equals ±90, so dedup never fires. That's actually correct. BUT if user sets `el:[-90, 90]/45` → elevations -90, -45, 0, 45, 90. BOTH -90 and +90 are hit. So the dedup fires for BOTH poles, which IS the desired behavior… but the code only keeps the FIRST azimuth per pole (az=azimuth_start), not a single pole per pole. So actually the existing dedup is semantically correct; it just doesn't match the UI counter and it doesn't generalize if elevations don't land exactly on 90.

**Bug C — elevation > 90 is accepted**

`views.py:638` validates `el_start` and `el_end` individually against `[-90, 90]`, so `el_end=150` is rejected. Good — this is NOT a live bug. But it was inherited from an earlier iteration; the code comment still references defaults `el_end=150` (see docstring line 605). **Dead-code inconsistency only**, not a real bug.

**Bug D — `int(elevation)` truncation in filename**

`create_projection_filename` (backend/apps/simulations/services/projection.py:174) uses:
```python
f"{base_name}_Az{int(azimuth):03d}_El{int(elevation):03d}.{format}"
```
- `int(-30.5)` → `-30` (truncation toward zero, not floor)
- For elevation `-30`, format `03d` produces `"-30"` which is 3 chars but misleading compared to positive which pads: `30 → "030"`, `-30 → "-30"`
- Pole at El=-90: filename `"_El-90"` (3 chars with sign). Pole at El=90: `"_El090"` (padded). **Inconsistent formatting** but not a data bug.
- Non-integer angles (e.g., Fibonacci lattice points at El=23.7°) will lose precision entirely.

### Pole-dedup math (what it should be)

For the grid mode the user specified in Q3:
- `n_az` azimuths, `n_el` elevations where elevations go `-90 + i·(180/(n_el-1))` for `i ∈ [0, n_el-1]` (linspace inclusive of both poles).
- The two poles (elevations = ±90) each represent a SINGLE viewing direction regardless of azimuth.
- Intermediate elevations (`-90 < el < +90`) each get `n_az` azimuths.
- Total = `n_az * (n_el - 2) + 2`, assuming `n_el ≥ 2` so poles exist.

Example `n_az=10, n_el=5` (elevations -90, -45, 0, 45, 90):
- 3 intermediate elevations (-45, 0, 45) × 10 azimuths = 30
- 2 poles × 1 = 2
- Total = **32** ✓ (matches user brief)

Example `n_az=6, n_el=4` (no pole in the interior): if elevations are -90, -30, 30, 90 → 2 interior × 6 az + 2 poles = 14. If user sets `el_start=0, el_end=90, n_el=4` (0, 30, 60, 90) → 1 pole at 90, NO pole at -90 → 3 interior × 6 + 1 = 19. The grid generator must detect which endpoints are at ±90 and count correctly.

## 4. Rendering pipeline

- **Library**: matplotlib with `Agg` backend (non-interactive, headless-safe).
- **Primitives**: `matplotlib.patches.Circle` per particle, grouped in a `PatchCollection` for perf.
- **Defaults**: `dpi=150`, `facecolor="red"`, `edgecolor="darkred"`, `background="white"`, `linewidth=0.5`, `alpha=0.9`.
- **Figure size**: auto, `base_size=8 inches`, aspect-corrected from bounds.
- **Axis**: `aspect='equal'`, `axis('off')`, 2% padding.
- **Options exposed to HTTP**: NONE. DPI/colors/size are hardcoded. The Rust side provides bounds; renderer uses those.
- **CoM centering**: None explicit. The bounds come from min/max of `x_proj ± r` and `y_proj ± r`. Particles are NOT re-centered to CoM. If user expects a CoM-centered projection, that's a separate feature.

## 5. Proposed solution

### 5.1 Direction generation (Rust, new module)

Create `aglogen_core/engine/src/projection/directions.rs` exposing:

```rust
pub struct Direction { pub azimuth: f64, pub elevation: f64 }

/// Grid with proper pole dedup.
/// n_el ≥ 2 (we need both endpoints). n_az ≥ 1.
/// Elevations: linspace(-90, 90, n_el)  [inclusive endpoints → poles at i=0, i=n_el-1]
/// Azimuths:   linspace(0, 360, n_az+1)[..n_az]  [exclude 360 == 0]
pub fn generate_direction_grid(n_az: usize, n_el: usize) -> Vec<Direction> {
    // poles: 1 point each
    // interior: n_az points each
}

/// Fibonacci lattice, N uniformly-distributed points on unit sphere, each
/// converted to (azimuth [0,360), elevation [-90,90]).
/// Golden-angle construction: phi = PI*(3-sqrt(5)); for i in 0..N,
///   y  = 1 - (2i+1)/N     (z' component, i.e. sin(elevation))
///   r  = sqrt(1 - y*y)
///   th = i * phi
///   x  = r * cos(th), z = r * sin(th)
///   azimuth   = atan2(z, x) in degrees, normalized to [0,360)
///   elevation = asin(y) in degrees ∈ [-90, 90]
pub fn generate_direction_fibonacci(n: usize) -> Vec<Direction>;
```

Keep `project_batch_internal` as a thin wrapper OR deprecate — introduce a NEW `project_directions_internal(coords, radii, &[Direction]) -> Vec<ProjectionResult>` that just iterates and calls `project_to_2d_internal`. This is the single "plug point" both grid and Fibonacci use.

### 5.2 Python binding (aglogen_core/python/src/lib.rs)

- Add `project_directions(coords, radii, directions: Vec<(f64,f64)>) -> Vec<PyProjectionResult>`
- Add `project_grid(coords, radii, n_az, n_el) -> Vec<PyProjectionResult>`
- Add `project_fibonacci(coords, radii, n) -> Vec<PyProjectionResult>`
- KEEP `project_batch` (backwards compat — downstream callers, fractal_analysis `project_to_2d`, etc. still work).

### 5.3 Backend endpoint (backend/apps/simulations/views.py)

Keep existing POST body, add new optional fields:
```json
{
  "mode": "grid" | "fibonacci" | "legacy",   // default "legacy" for backcompat
  "n_az": int,   // if mode=grid
  "n_el": int,   // if mode=grid (must be ≥ 2)
  "n": int,      // if mode=fibonacci
  "format": "png"|"svg"
}
```
- `mode=legacy` uses old start/end/step path (unchanged).
- `mode=grid` calls `aglogen_core.project_grid(n_az, n_el)`.
- `mode=fibonacci` calls `aglogen_core.project_fibonacci(n)`.
- Validation: `n_az ≥ 1`, `n_el ≥ 2` (grid); `n ≥ 1` (fibonacci). Reasonable upper bound, e.g. `n ≤ 1000` to prevent DoS. Each rendered PNG is ~tens of KB so 1000 × 30KB ≈ 30MB is borderline acceptable synchronously.
- The validator for `azimuth_end` in legacy mode is currently permissive of `150` even though max is 360 — leave as-is for backcompat.

### 5.4 Filename convention

New helper `create_projection_filename_v2(base, az, el, fmt, index)` producing:

`proj_Az{AAA}_El{+/-EEE}.png` — e.g. `proj_Az090_El+030.png`, `proj_Az000_El-090.png`.

Rules:
- **Az**: rounded to integer, 3 digits zero-padded, always positive `[0, 360)` (normalize 360 → 0).
- **El**: rounded to integer, explicit sign char (`+` or `-`), then 3 digits — so 4 chars total after `El`.
- Use `round` not `int` (so 89.5 → 90, not 89).
- For Fibonacci floats that don't round cleanly (e.g., two points at az=45.3 and az=45.7 both round to 045), the filename would collide. Resolution: append `_idx{NNN}` when in Fibonacci mode, or ALWAYS round and trust that collisions are rare in practice. Recommend: use higher-precision filename for Fibonacci — `proj_Az045.3_El+023.7.png` with 1 decimal. OR always prefix with 3-digit index: `proj_0001_Az045_El+030.png`.
- **Decision for PROPOSE**: go with `{index:03d}_Az{AAA}_El{±EEE}.{fmt}` as the canonical name — stable sort, no collisions, same for both modes. User's Q2 locked `proj_Az{X}_El{Y}` but didn't consider float collisions; flag as Open Q1.

### 5.5 metadata.json

Written to the ZIP root as `metadata.json`:

```json
{
  "simulation_id": "abc123...",
  "mode": "grid" | "fibonacci" | "legacy",
  "format": "png",
  "n": 32,
  "generated_at": "2026-04-22T...",
  "parameters": {
    "n_az": 10, "n_el": 5                      // grid
    // OR "n": 100                             // fibonacci
    // OR "azimuth_start": 0, ... "elevation_step": 30   // legacy
  },
  "directions": [
    {"index": 0, "filename": "000_Az000_El-090.png", "azimuth": 0.0, "elevation": -90.0},
    ...
  ]
}
```

## 6. Frontend UX impact

Current UI has 6 number inputs for grid-legacy sweep. Minimal-scope change:
- **Add a mode selector** (radio: "Grid" | "Fibonacci" | "Custom sweep (legacy)").
- **Grid mode**: show 2 inputs (`n_az`, `n_el`) + computed preview `n_az*(n_el-2) + 2`.
- **Fibonacci mode**: show 1 input (`n`) + "N projections uniformly on sphere" helper text.
- **Custom sweep**: the existing 6 inputs (kept for power users / backcompat).
- Default mode: **Grid** with `n_az=10, n_el=5` → 32 projections (matches user brief example).

Sensible defaults:
- Grid: `n_az=8, n_el=5` → 26 projections. Fast, complete coverage.
- Fibonacci: `n=42` (or 50). Memorable, uniform.

Client-side count matches server (preview = exact emitted count).

## 7. Testing strategy

### Rust unit tests (`aglogen_core/engine/src/projection/directions.rs`)

1. `generate_direction_grid(n_az=10, n_el=5) → 32 directions`
2. `generate_direction_grid(n_az=6, n_el=4) → 6*2 + 2 = 14` (if poles at both endpoints)
3. `generate_direction_grid(1, 2) → 2` (two poles only)
4. Two poles have `elevation ∈ {-90, +90}` and a SINGLE azimuth each (any value, canonical 0)
5. Interior elevations: `n_az` azimuths each, azimuths = `linspace(0, 360, n_az+1)[..n_az]`
6. `generate_direction_fibonacci(n) → n directions`, no duplicates, all on unit sphere (within tolerance)
7. Fibonacci `n=1000`: azimuths cover [0,360), elevations cover [-90,90] roughly uniformly (statistical test)

### Rust integration

1. `project_directions_internal(coords, radii, grid(3,3))` returns correct count and each ProjectionResult has the right az/el set.

### Python tests (`backend/apps/simulations/tests/test_projection_batch.py`)

1. POST with `mode=grid, n_az=10, n_el=5` → ZIP has 33 entries (32 PNGs + metadata.json), metadata has 32 directions, each PNG exists and is readable.
2. POST with `mode=fibonacci, n=42` → 43 entries, filenames unique, metadata has 42 directions with unique (az, el).
3. POST with `mode=legacy` (or no mode) → backwards compat, same behavior as current.
4. Invalid: `n_el=1`, `n_az=0`, `n=0`, `n > 1000` → 400 error.
5. Filename format regression: `proj_000_Az045_El+030.png` shape.

### Frontend (Vitest)

1. `ProjectionControls` with mode=grid renders 2 inputs, count preview matches formula.
2. Mode switch updates API payload shape.
3. Legacy mode still works (no regression).

## 8. Open questions for the user

1. **Filename format with index prefix**: User's Q2 locked `proj_Az{X}_El{Y}.{fmt}`. For Fibonacci mode, two points may round to the same integer angles → filename collision. OK to use `proj_{idx:03d}_Az{AAA}_El{±EEE}.{fmt}` to guarantee uniqueness? (Keeps Az/El readable, adds 4 chars.)
2. **Upper bound on `n`**: Cap at 1000 projections (≈30MB ZIP, seconds of CPU) synchronously, or do we need a Celery task + polling for > N? Proposal: synchronous up to 200, Celery otherwise. OR just cap at 200 and be done.
3. **Image options exposed via API**: DPI, facecolor, background currently hardcoded. Expose now or leave for a separate change? (Out of scope for this fix; flag for later.)

## 9. Recommendations for PROPOSE

### Minimal scope (fix the reported bugs, small PR)

- Fix Rust `project_batch_internal` pole-dedup path so the emit count matches a documented formula.
- Fix frontend `totalProjections` computation to match backend (subtract `n_az - 1` per pole hit).
- Add `metadata.json` to the existing ZIP.
- Leave grid/Fibonacci modes for a follow-up.

### Medium scope (recommended) ⭐

- Add `generate_direction_grid` + `generate_direction_fibonacci` in Rust with proper pole dedup.
- Add `project_grid`, `project_fibonacci` to Python bindings.
- Extend endpoint with `mode` param, keep legacy path.
- Add `metadata.json` to ZIP.
- Update filename format to the agreed convention.
- Update frontend with mode selector.
- Full test coverage.

### Full scope

Medium + expose rendering options (DPI, color, background) + async Celery path for large `n` + preview grid (small thumbnail of all N projections). Probably too much for one change — split.

**Recommendation**: go with **Medium**. The user's brief describes both modes explicitly; skipping them would mean a second change. The filename convention change is visible and deserves being locked now, not later.

---

**Risks**:
- Changing `create_projection_filename` breaks any external script that parses old filenames. Mitigation: keep old helper name working for the legacy endpoint mode; use new helper for grid/fibonacci.
- Rust workspace requires `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1` for the python crate (per state.yaml) — dev setup note for implementers.
- Matplotlib `plt.close(fig)` is already done, but batch of 1000 figures may leak under error paths. Use `try/finally` in render helpers when loop is introduced.
