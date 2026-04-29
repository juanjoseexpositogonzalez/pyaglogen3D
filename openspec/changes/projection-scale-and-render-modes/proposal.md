# Proposal: Projection Per-Image Scale & Render Dual Modes

## Intent

PYA-8: the projection metadata declares `pixels_per_100nm` from the **3D axis-aligned bounding box**, but the renderer maps pixels to the **2D projected bounding box** (direction-dependent, always smaller). Result: scale is under-reported by ~1.43x, FRAKTAL autocalibrate measures inflated primaries (29 px observed vs 20.34 px expected). Secondary: anti-aliasing halo and border stroke bleed into scientific measurements. Both sync and async (Celery) paths are affected.

## Scope

### In Scope

- **Engine Rust**: dual render function (presentation vs scientific mode). Scientific = solid black on white, no AA, no border, no alpha.
- **Engine Rust**: per-view scale computed from real 2D projected bbox, not 3D.
- **Python binding**: expose dual render + batch fn accepting `Vec<f64>` per-image scales (legacy single float = broadcast).
- **Backend simulations**: emit 2 PNGs per direction (`{name}.png` + `{name}.scientific.png`). Per-direction `pixels_per_100nm` in `metadata.json` `directions[]`. Global field = `max(per-image)` for backward compat. Celery task reorder: render ALL first, then measure per-image scale, then stamp metadata.
- **Backend fractal_analysis**: `FraktalBatchImage.png_scientific_bytes` (nullable `BinaryField`, additive migration). Batch task consumes per-image scale from metadata. Drill-down endpoint gains `?variant=presentation|scientific` query param.
- **Frontend**: drill-down toggle "Show scientific image". API client passes `?variant=` param.

### Out of Scope

- PYA-9 (FRAKTAL detector overestimation) — validate AFTER this fix ships
- PYA-10 + PYA-11 (CC tunable algorithm bugs) — separate cycle
- Pre-existing single-image `FraktalAnalysis` path — untouched (R10 of fraktal-batch-contract)
- Distributions of Df/kf for tunable algorithms — backlog
- C1-C2 drill-down UI bugs (error metadata, back nav) — separate fix or bundled later

## Capabilities

### New Capabilities

- `projection-scale-per-image`: per-direction scale contract in metadata + engine per-view 2D bbox computation
- `projection-render-dual`: presentation + scientific PNG render modes in engine and projection service

### Modified Capabilities

- `projection-export-contract`: R-DELTA — `directions[]` gains `pixels_per_100nm` per entry; ZIP contains `*.scientific.png` files; global scale = max(per-image)
- `fraktal-batch-contract`: R-DELTA — R1 updated to consume per-image scale from `directions[].pixels_per_100nm`; batch engine accepts `Vec<f64>` scales; uses `.scientific.png` automatically
- `fraktal-batch-persistence`: R-DELTA — R2 adds `png_scientific_bytes BinaryField` (nullable); R4 PNG endpoint gains `?variant=` param

## Approach

7 phases, bottom-up (engine → binding → backend → frontend):

| Phase | Description | Depends on |
|-------|-------------|------------|
| P1 | Engine Rust: dual render fn + per-view 2D bbox scale | — |
| P2 | Python binding: expose dual render + `Vec<f64>` batch API | P1 |
| P3 | Backend simulations: dual PNG export + per-direction metadata + Celery reorder | P2 |
| P4 | Backend fractal_analysis: migration + model field (`png_scientific_bytes`) | — |
| P5 | Backend fractal_analysis: batch task plumbing (per-image scale, scientific PNG, variant endpoint) | P3, P4 |
| P6 | Frontend: drill-down toggle + API client variant param | P5 |
| P7 | Tests + docs + CHANGELOG + Jira PYA-8 close | P1-P6 |

P1 and P4 are independent (can parallelize). P3 and P4 feed P5. P7 is the tail.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/projection/` | Modified | Dual render mode, per-view 2D bbox scale calc |
| `aglogen_core/python/src/lib.rs` | Modified | Expose dual render + `Vec<f64>` batch scales |
| `backend/apps/simulations/services/projection.py` | Modified | Emit 2 PNGs, per-direction scale, render-first reorder |
| `backend/apps/simulations/views.py` | Modified | `_stamp_scale_metadata` uses 2D bbox; per-direction fields |
| `backend/apps/simulations/tasks.py` | Modified | Celery path: render-first, per-image scale stamp |
| `backend/apps/fractal_analysis/models.py` | Modified | `png_scientific_bytes` BinaryField |
| `backend/apps/fractal_analysis/migrations/` | New | Additive migration for new field |
| `backend/apps/fractal_analysis/views.py` | Modified | `?variant=` query param on PNG endpoint |
| `backend/apps/fractal_analysis/tasks.py` | Modified | Batch task consumes per-image scale + scientific PNG |
| `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` | Modified | Toggle presentation/scientific |
| `frontend/src/lib/api.ts` | Modified | `variant` query param support |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Backward compat: existing batches lack scientific PNG | High (all existing data) | `png_scientific_bytes` nullable; fallback to presentation PNG when null. Frontend toggle disabled when unavailable. |
| Storage 2x: each batch stores 2 PNGs per image | Medium | Acceptable tradeoff — scientific PNG is critical for accurate FRAKTAL. Documented in CHANGELOG. |
| Engine API break: `Vec<f64>` replaces single `f64` | Low | Internal API, single Python call site. Legacy single float broadcasts to all images. |
| AA halo in presentation PNG | Low | Known; documented. Users analyzing presentation PNGs externally warned. Scientific PNG eliminates this. |
| Celery render-first reorder | Low | Linear sequential pipeline — simpler than current interleaved approach. Revert = restore old ordering. |

## Rollback Plan

1. Revert migration: `png_scientific_bytes` is nullable additive — column can stay (no data loss) or be dropped via reverse migration.
2. Engine: dual render is additive — presentation-only callers unaffected. Revert Python binding to single-mode.
3. Backend: remove `*.scientific.png` from ZIP assembly; revert metadata to global-only scale. Celery path: restore original ordering.
4. Frontend: remove toggle; revert API client to no-variant calls.

All changes are additive — rollback is safe at any phase boundary.

## Dependencies

- None external. All changes are internal to the pyaglogen3D monorepo.

## Success Criteria

- [ ] `pixels_per_100nm` per direction in metadata matches actual renderer scale (±1% tolerance)
- [ ] FRAKTAL batch with pyaglogen ZIP uses per-image scale from metadata (no global assumption)
- [ ] Scientific PNG has no AA halo, no border, no alpha — solid black on white background
- [ ] Existing batches (pre-migration) continue to work with broadcast/fallback
- [ ] `?variant=scientific` endpoint returns scientific PNG when available, 404 when not
- [ ] Frontend toggle shows correct variant; disabled when scientific PNG unavailable
- [ ] All test suites green: `cargo test`, `uv run pytest`, `npm test`
