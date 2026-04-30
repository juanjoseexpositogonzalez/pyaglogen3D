# Exploration: Why frente 7 bbox-2D fix still produces wrong `pixels_per_100nm`

**Date**: 2026-04-30
**Status**: ROOT CAUSE IDENTIFIED
**Severity**: High — scale is wrong by 1.47× in legacy mode

---

## Executive Summary

The frente 7 SDD cycle (`projection-scale-and-render-modes`) correctly implemented per-direction 2D-bbox scale computation for the **async Celery path** (N > 200, `build_projections_zip_task`). However, **both the legacy mode AND the sync grid/fibonacci path (N ≤ 200)** still use `_stamp_scale_metadata()` in `views.py`, which computes `pixels_per_100nm` from the **3D axis-aligned bounding box** — the exact bug PYA-8 was supposed to fix.

The user's empirical 80/54.3 = 1.47× mismatch is the 3D-vs-2D bbox ratio for a non-spherical aggregate viewed from a single direction.

---

## Root Cause

### The smoking gun: `_stamp_scale_metadata()` in `views.py` lines 138–189

```python
# views.py:175-185 — THE BUG
max_extent_engine = float(
    max(
        coords[:, 0].max() - coords[:, 0].min(),  # 3D X span
        coords[:, 1].max() - coords[:, 1].min(),  # 3D Y span
        coords[:, 2].max() - coords[:, 2].min(),  # 3D Z span
    )
    + 2.0 * float(np.max(radii))
)
span_engine = max_extent_engine * 1.04
span_nm = span_engine * scale_factor_nm
pixels_per_100nm = 100.0 * float(img_size) / span_nm if span_nm > 0 else None
```

This computes a SINGLE global `pixels_per_100nm` from the **3D AABB** of the aggregate. The 3D AABB is ALWAYS larger than or equal to the 2D projected bbox for any direction, because a 3D bounding box encloses the full volume while the 2D projection collapses one axis. For anisotropic aggregates (like the user's Df=1.8 tunable_pc), the 3D AABB overestimates the per-view span → **underestimates** `pixels_per_100nm`.

### Three code paths, only ONE has the fix

| Code path | Mode | Scale source | Correct? |
|---|---|---|---|
| `_export_projections_legacy()` → `_stamp_scale_metadata()` | `legacy` | 3D AABB | **NO** — uses `views.py:175` |
| `_export_projections_modern()` → `_stamp_scale_metadata()` → `_render_and_zip_sync()` | `grid`/`fibonacci`, N ≤ 200 | 3D AABB | **NO** — uses `views.py:989` which calls `_stamp_scale_metadata()` |
| `build_projections_zip_task()` | `grid`/`fibonacci`, N > 200 | 2D bbox per direction | **YES** — uses `tasks.py:2096-2110` |

### Why the user sees the wrong value

The user generated a batch with `mode=legacy`. This path:

1. `_export_projections_legacy()` (views.py:708) calls `_stamp_scale_metadata()` at line 857
2. `_stamp_scale_metadata()` computes from 3D AABB (views.py:175-185)
3. `build_metadata_json()` receives the already-wrong `parameters["pixels_per_100nm"]` and stamps it into metadata.json
4. Legacy mode does NOT pass `per_direction_scale` to `build_metadata_json()` → no per-direction fields
5. Result: metadata.json has a single global `pixels_per_100nm = 54.3` based on 3D AABB

Meanwhile, matplotlib renders using the **2D projected bbox** (via `project_to_2d_internal` → `bounds` → `set_xlim/set_ylim` with 2% padding). The rendered image is therefore at the CORRECT scale (80 px/100nm from GIMP measurement), but metadata.json reports the WRONG scale (54.3 px/100nm from 3D AABB).

### Mathematical confirmation

For the user's aggregate (dpo=25nm, N=350, tunable_pc Df=1.8):
- `scale_factor_nm = 25 / 2 = 12.5` nm/engine-unit
- From GIMP: primary diameter ≈ 20 px → `pixel_scale = 20 / 25 = 0.8 px/nm` → `pixels_per_100nm = 80`
- From metadata.json: `pixels_per_100nm = 54.3`
- Ratio: `80 / 54.3 = 1.473`

This ratio equals `3D_AABB_max_extent / 2D_bbox_max_extent` for the specific view direction. The 3D AABB overestimates by 47% because the third axis (collapsed in projection) adds extent that doesn't appear in the rendered 2D view.

---

## Why Frente 7 Didn't Catch This

### 1. The spec (R3, R5) was scoped to grid/fibonacci mode only

From `projection-scale-per-image/spec.md` R3:
> "GIVEN a projection direction … WHEN pixels_per_100nm is computed for that direction …"

All R3 scenarios reference grid/fibonacci modes. R4 explicitly says:
> "Legacy mode export does not add per-direction fields" (Scenario 4.3)

The spec intentionally excluded legacy from the per-direction fix.

### 2. `_stamp_scale_metadata()` was not touched by frente 7

Frente 7 tasks (T3.6, T3.7, T3.9) only modified:
- `render_projection_dual_png` (new function, only called by async task)
- `build_projections_zip_task` (Celery, N > 200 async path)
- `build_metadata_json` (added `per_direction_scale` param)

The `_stamp_scale_metadata()` function in `views.py` was LEFT UNCHANGED. It was the original PYA-8 workaround that used 3D AABB as a "conservative lower bound" (see its docstring: "conservative lower bound on the true scale").

### 3. The sync grid/fibonacci path ALSO uses the wrong stamper

Even for grid/fibonacci mode with N ≤ 200 (sync path), `_export_projections_modern()` at views.py:989 calls `_stamp_scale_metadata()` BEFORE calling `_render_and_zip_sync()`. This stamps the 3D-AABB-based global `parameters["pixels_per_100nm"]` into the parameters dict, and `_render_and_zip_sync()` passes it through to `build_projection_zip()` WITHOUT overriding with per-direction values.

The sync path does NOT call `render_projection_dual_png()` — it calls `_render_projection_bytes()` which uses the old single-render path. Therefore:
- No scientific PNGs are generated in sync mode
- No per-direction bbox is computed
- The 3D AABB scale leaks into metadata.json

### 4. No test verified the ACTUAL pixel-to-nm mapping

The integration test `test_projection_scale_render_modes.py` (T7.1) likely tests that metadata.json has the fields, but does NOT compare the stamped value against the actual rendered pixel scale (e.g., by measuring particle diameter in GIMP / PIL). A test that compares `metadata.pixels_per_100nm` against `actual_primary_diameter_px / dpo_nm * 100` would have caught this.

---

## Affected Files

| File | Line(s) | Issue |
|---|---|---|
| `backend/apps/simulations/views.py` | 138–189 | `_stamp_scale_metadata()` uses 3D AABB — root cause |
| `backend/apps/simulations/views.py` | 853–858 | Legacy mode calls `_stamp_scale_metadata()` |
| `backend/apps/simulations/views.py` | 989 | Sync grid/fibonacci calls `_stamp_scale_metadata()` |
| `backend/apps/simulations/views.py` | 1032–1066 | `_render_and_zip_sync()` doesn't compute per-direction scale |
| `backend/apps/simulations/tasks.py` | 2096–2110 | CORRECT path — only for async N>200 |
| `backend/apps/simulations/services/projection.py` | 192–261 | `render_projection_dual_png()` — only called by async task |

---

## Recommended Fix

### Scope: Hotfix — not a full SDD cycle

The fix is mechanical: make the sync path use the same per-direction 2D-bbox scale logic as the async path.

### Changes required (~80 lines of change):

1. **`views.py` — `_render_and_zip_sync()`**: Replace `_render_projection_bytes()` with `render_projection_dual_png()`. Collect per-direction `(bbox_w, bbox_h)` and compute `per_direction_scale` list. Pass it to `build_projection_zip()`.

2. **`views.py` — `_export_projections_legacy()`**: After rendering all PNGs in the legacy loop, compute per-direction scale from each `proj.bounds` (already available from `aglogen_core.project_batch`). Pass `per_direction_scale` to `build_metadata_json()`. Remove call to `_stamp_scale_metadata()`.

3. **`views.py` — `_stamp_scale_metadata()`**: Either delete entirely or keep ONLY as a fallback for consumers that don't have per-direction fields. Add a deprecation comment.

4. **`views.py` — `_export_projections_modern()` line 989**: Remove `_stamp_scale_metadata()` call. The sync renderer should derive scale from actual 2D bbox, same as async.

### Tests required to lock the regression:

1. **Pixel-accuracy test**: Render a known aggregate → measure primary particle diameter in the output PNG (via PIL) → compare against `metadata.pixels_per_100nm * dpo_nm / 100`. Must match within 5%.

2. **Legacy mode scale test**: Assert `metadata.pixels_per_100nm` in legacy mode equals the per-direction value for that direction's 2D bbox, NOT the 3D AABB value.

3. **Sync vs async parity test**: Same aggregate, same direction — sync (N≤200) and async (N>200) must produce identical `pixels_per_100nm` within ±0.01%.

4. **Non-spherical aggregate direction variance test**: For an anisotropic aggregate (e.g. Df=1.0 chain), per-direction scales MUST vary by at least 10% across directions. If they don't, the 3D AABB is still being used.

---

## Open Questions

1. **Does any FRAKTAL batch consumer already depend on `parameters.pixels_per_100nm` being conservative (i.e., underestimated)?** If so, switching to per-direction accurate values might change box-counting results. Need to check if FRAKTAL's `calibration_source` logic handles per-direction correctly.

2. **The sync grid/fibonacci path doesn't generate scientific PNGs**. Is this intentional or an oversight? The async path generates both presentation and scientific PNGs. This means N≤200 exports are missing scientific images.
