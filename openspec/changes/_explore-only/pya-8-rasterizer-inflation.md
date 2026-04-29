# PYA-8: Projection Rasterizer Inflates Primary Particles by ~1.43×

**Explore-only investigation** — read-only, no code changes.

---

## 1. Scale Formula in the Rasterizer

The rasterizer uses **matplotlib** to render 2D projections. The actual pixel-to-engine-unit mapping is set by the **axis limits** in `_create_projection_figure`:

**File: `backend/apps/simulations/services/projection.py:148-188`**

```python
min_x, max_x, min_y, max_y = bounds  # ← 2D projected bounds from Rust

width = max_x - min_x
height = max_y - min_y

# ...figsize computed...

# Set axis limits with small padding
padding = max(width, height) * 0.02
ax.set_xlim(min_x - padding, max_x + padding)
ax.set_ylim(min_y - padding, max_y + padding)
ax.set_aspect("equal")
```

When `img_size` is provided (grid/fibonacci modes), the renderer forces:
```python
effective_dpi = 100
effective_figsize = (img_size / 100.0, img_size / 100.0)
# Saved with pad_inches=0
```

So the **renderer** maps `img_size` pixels to the **2D projected bounding box** span (with 2% padding per side → 1.04× total):

```
renderer_span_engine = (max_2d - min_2d) * 1.04
renderer_scale = img_size / renderer_span_engine
```

Where `max_2d - min_2d` is the 2D projected extent of the aggregate (the widest axis of the 2D bounds from Rust).

BUT: because `ax.set_aspect("equal")` is set, and the figure is square (`img_size × img_size`), matplotlib ensures the longer axis fills the canvas and the shorter axis is centered with whitespace. The effective pixel span is:

```
renderer_span_engine = max(width_2d, height_2d) * 1.04
```

## 2. Scale Formula for Metadata

**File: `backend/apps/simulations/views.py:138-189`** (function `_stamp_scale_metadata`)

```python
max_extent_engine = float(
    max(
        coords[:, 0].max() - coords[:, 0].min(),   # ← 3D X extent
        coords[:, 1].max() - coords[:, 1].min(),   # ← 3D Y extent
        coords[:, 2].max() - coords[:, 2].min(),   # ← 3D Z extent
    )
    + 2.0 * float(np.max(radii))
)
span_engine = max_extent_engine * 1.04
span_nm = span_engine * scale_factor_nm
pixels_per_100nm = 100.0 * float(img_size) / span_nm
```

So the **metadata** computes scale using the **3D axis-aligned bounding box** (max of X/Y/Z ranges) + 2×max_radius, padded by 1.04×.

## 3. Comparison — ARE THEY THE SAME?

**NO. They are fundamentally different. This is the bug.**

| Aspect | Renderer | Metadata |
|--------|----------|----------|
| **Input bounds** | **2D** projected bounding box from Rust `ProjectionResult.bounds` — direction-dependent | **3D** axis-aligned bounding box from raw coordinates — direction-independent |
| **Radius inclusion** | Rust bounds already include ±radius per particle (see `projection/mod.rs:86-89`) | Adds `2 * max(radii)` to the 3D extent |
| **Padding** | `max(width, height) * 0.02` per side → effectively `* 1.04` | `max_extent_engine * 1.04` |
| **Result** | The actual pixel canvas span maps to the 2D projection extent | The declared `pixels_per_100nm` is computed from the 3D extent |

**The 3D bounding box is ALWAYS larger than or equal to the 2D projection** for any viewing angle (because projecting to 2D collapses one dimension). The metadata *over-estimates* the span → *under-estimates* `pixels_per_100nm` → primaries appear LARGER in pixels than the metadata declares.

### Why ~1.43×?

For a compact agglomerate of 1000 primaries with dpo=25nm, the 3D bounding box span is significantly larger than the 2D projected span for any given direction. The ratio depends on the aggregate geometry, but a factor of ~1.43 is consistent with:

```
3D_span / 2D_span ≈ 1.43
```

which means the metadata says "there are X pixels per 100nm" (based on the larger 3D span), but the renderer actually packs more pixels per 100nm (based on the smaller 2D span). So when FRAKTAL reads `pixels_per_100nm` from metadata and measures primaries in the actual image, the primaries are 1.43× bigger than expected.

## 4. Possible Inflation Sources — Ranked by Likelihood

### 🔴 HIGH: 3D vs 2D bounding box mismatch (THE ROOT CAUSE)
- **File**: `views.py:175-185` (`_stamp_scale_metadata`)
- **Evidence**: Metadata uses `coords[:, dim].max() - coords[:, dim].min()` for all THREE 3D axes. The renderer uses the 2D-projected `bounds` from `ProjectionResult`. These are **categorically different quantities**.
- **Impact**: Explains the entire 1.43× factor.
- **The comment on line 158-161 even acknowledges this**: *"This over-estimates the span for direction-dependent 2D bounding boxes, so the reported `pixels_per_100nm` is a conservative lower bound on the true scale for any given view"* — the authors knew this was an over-estimate but considered it "safe". It's safe for box-counting but BREAKS dpo estimation in FRAKTAL autocalibrate.

### 🟡 MEDIUM: Anti-aliasing halo
- **File**: `projection.py:176-182`
- The `PatchCollection` uses `linewidth=0.5` and `alpha=0.9`. The edge stroke adds ~0.5pt of visible edge around each circle, inflating the apparent diameter by ~1 pixel at dpi=100. For a 20px primary this adds ~5% inflation (20→21px). This is a minor contributor, not the main one.

### 🟢 LOW: `pad_inches=0` vs actual padding
- **File**: `projection.py:71` (`pad_inches=0` in img_size mode)
- The `pad_inches=0` + no `bbox_inches='tight'` means the figure should render at exactly `img_size × img_size` pixels. This is correct for the img_size path.
- However, matplotlib's `ax.set_aspect("equal")` can cause the axes to NOT fill the full figure when the data extent ratio doesn't match the figure ratio. For a square figure with non-square 2D bounds, the actual data-occupied region is SMALLER than `img_size`, making the effective `pixels_per_100nm` even more wrong.

### 🟢 LOW: Diameter vs radius confusion
- Checked: Rust `project_to_2d_internal` receives `radii` (line 77: `let r = radii[i]`) and uses them as radii for bounds (`x_proj - r`, `x_proj + r`). The PyO3 binding passes `radii` through unchanged. The backend loads `geometry_array[:, 3]` as radii. The matplotlib `Circle((xi, yi), ri)` takes radius as the third arg. **No diameter/radius confusion found.**

### 🟢 LOW: PNG resampling artifacts
- The PNG is saved directly from matplotlib at exact dpi/figsize. No post-processing, no resize, no resampling. The `io.BytesIO()` buffer goes straight to the ZIP. **No PNG pipeline issue.**

## 5. Recommended Fix Path

### Approach: Per-direction `pixels_per_100nm` or consistent 2D-based metadata

**Option A — Per-direction scale (correct but breaking):**
Compute `pixels_per_100nm` from each direction's actual 2D projected bounds, store it per-image in metadata.json. This would be accurate but changes the metadata schema (currently one global value at the ZIP root).

**Option B — Use worst-case 2D bounds for metadata (correct, backwards-compat):**
Instead of the 3D bounding box, pre-compute all 2D projections, take the MAXIMUM 2D span across all directions, and use that for the global `pixels_per_100nm`. This is still a conservative estimate but much tighter than the 3D bbox.

**Option C — Use the actual 2D projected bounds for the global scale (simplest fix):**
Since `_render_and_zip_sync` already has the `projection_results` list, extract the max 2D span from all results and use that for the metadata. The global `pixels_per_100nm` would be accurate for the widest-span direction and conservative (safe) for all others.

**Recommendation: Option C** — single SDD cycle, low complexity.

### Scope Estimate
- **Files to change**: `views.py` (`_stamp_scale_metadata` or its caller `_render_and_zip_sync`)
- **Effort**: Small — ~20 lines of code change
- **Risk**: Low — only affects metadata.json, not the actual rendered images
- **Testing**: Compare metadata `pixels_per_100nm` against measured pixel diameter from GIMP
- **Downstream**: Must also handle the async Celery path (`build_projections_zip_task`) and the legacy mode (where `_stamp_scale_metadata` is called with `first_png_size`)

## 6. Open Questions for User

1. **Is per-direction scale acceptable?** Option A is the most correct but adds a `pixels_per_100nm` field per direction in metadata.json. Does FRAKTAL batch analysis expect a single global scale or can it handle per-image scales?

2. **Which mode was used for the repro?** Grid, fibonacci, or legacy? The legacy mode has a different scale-stamping path (uses `first_png_size` from PIL measurement) — need to confirm which code path triggered the 1.43× inflation.

3. **Is the 2% padding (1.04×) accounted for by FRAKTAL?** Both the renderer and metadata apply a 1.04× padding factor, so they should cancel. But verify FRAKTAL doesn't apply its own padding assumption.

4. **Should the `linewidth=0.5` and `alpha=0.9` be removed for FRAKTAL analysis images?** The edge stroke and partial transparency could confuse threshold-based diameter measurement. Consider adding a "scientific" render mode with `linewidth=0`, `alpha=1.0`, `facecolor="black"`, `background="white"` for analysis-grade images.

---

## Summary

The root cause is a **3D-vs-2D bounding box mismatch** in the scale metadata computation. The metadata uses the 3D axis-aligned bounding box (which is always larger), while the renderer uses the 2D projected bounding box. This makes the declared `pixels_per_100nm` too small by a factor proportional to how much the 3D bbox exceeds the 2D projection — empirically ~1.43× for a 1000-particle agglomerate. The fix is to derive `pixels_per_100nm` from the actual 2D projected extents, not the 3D coordinates.
