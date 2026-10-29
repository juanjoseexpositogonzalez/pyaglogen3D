# Archive Report — projections-export-fix

**Change**: `projections-export-fix`
**Archived on**: 2026-04-22
**Archive location**: `openspec/changes/archive/projections-export-fix-2026-04-22/`
**Previous archives retained**:
- `verify-rg-2026-04-20` (rg-unit-contract foundation)
- `import-aggregate-2026-04-21` (import-aggregate-contract + shim extension)
- `visualize-multiple-2026-04-22` (multi-aggregate-comparison + viewer3d-state)

## Scope summary

Fixed the long-standing bug where the projection export emitted fewer PNGs than the UI promised (e.g., "generate 24" → ZIP contained 19) due to a half-baked pole dedup in `projection/mod.rs`. Introduced two first-class sampling modes — **Grid** (exact azimuth × elevation with correct pole math) and **Fibonacci lattice** (uniform N over the sphere via golden-angle spiral) — while preserving the original path as **Legacy** for byte-for-byte backwards compatibility. Added `metadata.json` to every ZIP (per-projection `{index, filename, azimuth, elevation}`), an async Celery dispatch for N > 200 with a polling status endpoint, and a frontend mode selector with a live preview count that matches the backend exactly.

## Task summary (20 total)

| # | Task | Status |
|---|------|--------|
| 1.1 | [engine] `directions.rs` with `Direction` struct + `generate_grid` + `generate_fibonacci` | ✅ |
| 1.2 | [engine] `project_directions_internal` plug point; legacy `project_batch_internal` untouched | ✅ |
| 1.3 | [engine/tests] Unit tests — grid count formula, fibonacci exactness, azimuth/elevation math | ✅ |
| 2.1 | [pyo3] Expose `generate_direction_grid` + `generate_direction_fibonacci` + `project_directions` | ✅ |
| 2.2 | [backend/tests] PyO3 binding round-trip smoke tests | ✅ |
| 3.1 | [backend] `services/projections.py` — filename, metadata, ZIP builder | ✅ |
| 3.2 | [backend/tests] Service unit tests (filename format, metadata shape, ZIP contents) | ✅ |
| 3.3 | [backend] Endpoint `mode` dispatch with validation + matplotlib `plt.close` in `finally` | ✅ |
| 3.4 | [backend] Celery `build_projections_zip_task` with progress meta every 10 projections | ✅ |
| 3.5 | [backend] Polling endpoint `GET /projections-status/{job_id}/` | ✅ |
| 3.6 | [backend/tests] Mode dispatch + validation tests (grid/fibonacci/legacy/400s/202) | ✅ |
| 3.7 | [backend/tests] Polling endpoint state machine tests | ✅ |
| 4.1 | [frontend] `ProjectionControls` mode selector + conditional inputs + live preview count | ✅ |
| 4.2 | [frontend] `exportProjections()` with sync + async polling | ✅ |
| 4.3 | [frontend/tests] `ProjectionControls` tests (mode switching, preview count, payload shape) | ✅ |
| 4.4 | [frontend/tests] `api-projections` tests (sync blob, async poll, failure) | ✅ |
| 5.1 | [docs] `docs/projections-export.md` user guide | ✅ |
| 5.2 | [verify] Full test suite (engine + backend + frontend) | ✅ |
| 5.3 | [verify] `tsc --noEmit` clean | ✅ |
| 5.4 | [changelog] `CHANGELOG.md` entry prepended | ✅ |

**All 20 tasks complete.**

## Commits (6 total)

| Hash | Message |
|------|---------|
| `4f657bc` | feat: Phase 1 Rust direction generators |
| `d875cbd` | feat: Phase 2 PyO3 bindings |
| `950da14` | feat: Phase 3 backend services |
| `4d6dae0` | feat: Phase 3 endpoint + Celery + polling |
| `72c3ea4` | feat: Phase 4 frontend mode selector + polling |
| `(pending)` | docs(projections-export-fix): add user guide + changelog + archive (T5.1, T5.4) |

## Test count delta

| Layer | Before | After | Δ |
|-------|--------|-------|---|
| Engine (Rust / cargo, `-p aglogen-engine`) | 165 | 172 | +7 |
| Backend (Python / pytest, `apps/simulations/tests/`) | 119 | 142 | +23 |
| Frontend (TypeScript / vitest) | 146 | 166 | +20 |
| **Total** | **430** | **480** | **+50** |

All three layers received new tests: Rust unit tests for `directions.rs`; backend tests for services, endpoint mode dispatch, and polling state machine; frontend tests for `ProjectionControls` mode selector and the sync/async `exportProjections` helper.

## Canonical spec changes

- **New canonical spec**: `openspec/specs/projection-export-contract.md` (copied verbatim from `specs/projection-export-contract.md`, 298 lines, 8 requirements R1–R8). Prior to this change, projection export had no formal contract — the behaviour lived in `projection/mod.rs` and the Django view. The new canonical spec codifies: grid pole math (R1), fibonacci exactness (R2), legacy backcompat (R3), filename format (R4), metadata.json shape (R5), async polling state machine (R6), azimuth/elevation math (R7), and endpoint validation (R8).

## Known deviations documented

1. **ZIP stored on disk, not Postgres**. The Celery async path persists the generated ZIP alongside `simulation.geometry` on the same local disk (same pattern as `compute_import_metrics_task`). A future change may move this to object storage (S3 / R2) when the deployment target requires it.
2. **Celery progress meta shape — first occurrence in project**. `build_projections_zip_task` uses `{"progress": float, "current": int, "total": int}` in `self.update_state(meta=...)`. This is the first task in the codebase that reports sub-task progress; prior long-running tasks only reported state transitions. The frontend polls at ~1 Hz and reads `progress` from this meta.
3. **SVG only in legacy mode**. The new Grid and Fibonacci modes emit PNG exclusively; SVG output (available in legacy for one specific matplotlib path) was not ported. If SVG is requested in a future change, it should be added to the service-layer builder rather than conditionally in the endpoint.

## Known follow-ups (deferred)

1. **Custom DPI and color maps**. The ZIP currently bakes in the matplotlib defaults (white-on-black, `dpi=100`). Users asking for publication-quality output will eventually need per-request DPI, figure size, and color-map overrides. **Deferred.**
2. **Multi-simulation batch export**. Users may want to export projections for several simulations in a single request / single ZIP. Today each simulation needs its own export call. **Deferred.**
3. **Aggregate projections rendered into the compare-page overlay**. The `visualize-multiple` overlay mode renders 3D geometry directly; users could benefit from a 2D projection overlay as well (same direction for all aggregates, stacked as subplots). **Deferred.**
4. **Shareable projection URLs**. Today the export is a one-shot download. Persisting a rendered ZIP with a shareable URL (similar to how `/compare?sims=...` persists a comparison) would let users collaborate on projections without re-running. **Deferred.**

## Appendix — automated verification (T5.2, T5.3)

### Engine (Rust / cargo)

`cargo test -p aglogen-engine projection` — **172 passed** (delta +7 from prior baseline of 165).

### Backend (Python / pytest)

`uv run pytest backend/apps/simulations/tests/ --no-migrations` — **142 passed** (delta +23 from prior baseline of 119).

### Frontend (TypeScript / vitest)

`npm test` — **Test Files passed; Tests 166 passed (166)** (delta +20 from prior baseline of 146).

### TypeScript

`npx tsc --noEmit` — exit code 0, no type errors.

---

**SDD cycle complete.** Ready for the next change.
