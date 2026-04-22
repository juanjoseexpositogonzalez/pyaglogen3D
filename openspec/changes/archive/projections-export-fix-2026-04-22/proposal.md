# Proposal: projections-export-fix

## Intent

The current projection batch export silently drops projections due to a half-baked pole-dedup in `project_batch_internal` that only fires when the elevation sweep lands exactly on ±90. The UI advertises `n_az × n_el` but the backend emits fewer — users see "24 will be generated" and receive 19. Scientific tooling must not lie about what it delivers: the count shown must equal the count produced, and both poles must be represented exactly once.

Adding a Fibonacci lattice option unlocks uniform direction sampling — the standard in computer graphics for sphere coverage — and delivers strictly N projections regardless of angular discretization. Together with a corrected grid mode (`n_az × (n_el − 2) + 2`) and a `metadata.json` that maps index → (az, el), the export becomes a contract rather than a guess.

## Scope

### In Scope
- Rust engine: `generate_direction_grid(n_az, n_el)` with pole dedup (poles = 1 projection each)
- Rust engine: `generate_direction_fibonacci(n)` via golden-angle spiral, exact N output
- Rust engine: `project_directions_internal(coords, radii, &[Direction])` as shared plug point
- PyO3 bindings: `project_grid`, `project_fibonacci`, `project_directions`; keep `project_batch` for legacy
- Backend endpoint: accept `?mode=grid|fibonacci|legacy` with per-mode params (`n_az+n_el` | `n` | legacy sweep)
- ZIP assembly: filenames `proj_{idx:03d}_Az{AAA}_El{±EEE}.{fmt}` (index-prefixed to prevent Fibonacci float collisions)
- ZIP includes `metadata.json` with `{mode, n_requested, n_generated, parameters, directions[]}`
- Sync execution for N ≤ 200; Celery async task for N > 200 returning job_id + polling endpoint
- Frontend: mode selector + conditional N inputs + progress indicator for async
- Tests: Rust unit (direction counts, pole dedup, Fibonacci uniformity), backend integration per mode, frontend Vitest

### Out of Scope
- DPI / color / background customization (separate change)
- Multi-simulation batch export (single-sim MVP per Q1)
- Projection of aggregate pairs or comparison (belongs to `visualize-multiple`)
- Sharing projection URLs via query params
- ZIP format alternatives (tar.gz, individual downloads)
- Caching of previous export requests

## Capabilities

### New Capabilities
- `projection-export-contract`: direction-generation semantics (grid pole dedup, Fibonacci lattice), filename convention, `metadata.json` shape, mode switching, sync/async strategy.

### Modified Capabilities
- None (existing endpoint continues to work via `mode=legacy`, which remains the default when no mode is specified)

## Approach

**Phase 1 — Rust direction generators.** New module `aglogen_core/engine/src/projection/directions.rs` with `Direction { azimuth, elevation }` and two pure functions. Grid uses `linspace(-90, 90, n_el)` for elevations (endpoints are poles) and `linspace(0, 360, n_az+1)[..n_az]` for azimuths; poles emit 1 projection each, interior elevations emit `n_az`. Fibonacci uses golden-angle `phi = PI·(3−√5)`, `y = 1 − (2i+1)/N`, converts to (az, el) via `atan2`/`asin`. Unit tests cover `n_el ∈ {2,3,4,5,7}` including the degenerate `n_el=2` (poles only).

**Phase 2 — PyO3 bindings + shared dispatcher.** Add `project_directions_internal` as the single iteration point; `project_grid` and `project_fibonacci` are thin wrappers that generate directions and call it. Keep `project_batch` unchanged for backcompat with `fractal_analysis` and external consumers.

**Phase 3 — Backend endpoint + services refactor.** Extract ZIP assembly and `metadata.json` emission into new `backend/apps/simulations/services/projections.py`. Endpoint dispatches on `mode`: legacy path unchanged; grid/fibonacci call new Rust entries. When `n_generated > 200`, enqueue Celery task (same pattern as `compute_import_metrics_task`), return `202 {job_id}`; add `/projections-status/{job_id}/` polling endpoint that returns progress and a download URL when ready. Always `plt.close(fig)` in `finally` to prevent leaks on large batches.

**Phase 4 — Frontend mode selector + polling.** `ProjectionControls.tsx` gets a mode dropdown (Grid default). Grid shows `n_az, n_el` + preview formula `n_az·(n_el−2)+2`; Fibonacci shows `n`; Legacy shows the existing 6 inputs. `api.ts` gets a polling helper for async jobs with a progress bar. Vitest validates mode switch updates payload shape.

### Key decisions (locked)
- Three modes: Grid + Fibonacci + Legacy
- Index prefix in filename (`proj_{idx:03d}_...`) to eliminate Fibonacci collisions
- Sync ≤ 200 projections; Celery > 200
- DPI/colors deferred to a future change
- `metadata.json` always included
- `mode=legacy` is the default when client omits `mode` (backcompat)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/projection/mod.rs` | Modify | Keep legacy fn; add `project_directions_internal` |
| `aglogen_core/engine/src/projection/directions.rs` | New | Grid + Fibonacci generators |
| `aglogen_core/python/src/lib.rs` | Modify | Expose `project_grid`, `project_fibonacci`, `project_directions` |
| `backend/apps/simulations/views.py` | Modify | Dispatch on `mode`; 202 + job_id for N>200 |
| `backend/apps/simulations/tasks.py` | Modify | New Celery task for async ZIP assembly |
| `backend/apps/simulations/services/projections.py` | New | ZIP + `metadata.json` assembly, filename helper |
| `backend/apps/simulations/urls.py` | Modify | `/projections-status/{job_id}/` polling endpoint |
| `frontend/src/components/projection/ProjectionControls.tsx` | Modify | Mode selector + conditional inputs |
| `frontend/src/lib/api.ts` | Modify | Export request shape + polling helper |
| `docs/projections-export.md` | New | User guide |

## Success Criteria

- [ ] `mode=grid n_az=10 n_el=5` produces exactly 32 projections (not 50, not 48)
- [ ] `mode=fibonacci n=50` produces exactly 50 projections, uniform distribution sanity-checked
- [ ] `mode=legacy` output is byte-equivalent to current production output (filenames, count, shape)
- [ ] ZIP filenames match `proj_000_Az090_El+030.png` — 3-digit index, 3-digit az, signed 3-digit el
- [ ] `metadata.json` has `{mode, n_requested, n_generated, parameters, directions: [{index, filename, azimuth, elevation}]}`
- [ ] For N > 200: endpoint returns `202 {job_id}`; polling endpoint yields progress or download URL
- [ ] Frontend mode selector updates payload shape and preview count matches backend emit
- [ ] Existing callers that omit `mode` still get current behavior
- [ ] All Rust unit + backend integration + frontend Vitest tests green

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking external scripts parsing old filenames | Medium | `mode=legacy` default preserves old filename shape |
| Matplotlib figure leaks on large batches | Medium | `plt.close(fig)` in `finally`; test with N=500 mock |
| Fibonacci float collisions at same rounded (Az, El) | Low | Index prefix guarantees uniqueness |
| Celery storage backend for async ZIPs | Low | Reuse existing S3/filesystem pattern |
| Async polling UX confusion | Medium | Progress bar + clear loading state |
| Pole dedup off-by-one | Medium | Exhaustive unit tests: `n_el ∈ {2,3,4,5,7}`, edge `n_el=2` |

## Rollback Plan

1. Revert frontend: `ProjectionControls` back to 6 inputs → endpoint receives legacy payload → backcompat path handles it
2. Revert backend dispatch: route all requests to legacy path regardless of `mode`
3. Revert Rust generators: no callers reference them if backend reverted
4. Revert `metadata.json` emission: optional, no consumer requires it
5. Celery task and polling endpoint can be removed independently — sync path covers typical use

## Dependencies

- None external
- Engine `generate_sphere_points` has Fibonacci-like code that may be reusable

## Open Questions (deferred to spec/design)

- Celery `job_id` format and storage backend for large ZIPs (S3 vs local)
- Progress-reporting granularity (per projection vs every 10)
- Filename helper location: Rust side (testable in native units) vs Python (easier fixture testing)
