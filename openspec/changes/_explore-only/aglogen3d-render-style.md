# Exploration: aglogen3D Render Style Extraction

## 1. Aglogen3D style (canonical — MATLAB)

The canonical PhD code is MATLAB, not Python. The projection renderer lives in `matlab_reference/create2DImages.m`, lines 46-51.

### Rendering method: `fill()` patches (data-unit circles), NOT `scatter`

```matlab
% create2DImages.m:46-51
circles( part2(:,1), part2(:,2), diam(:)/2, 'facecolor', 'red' );
fig = gcf();
set( fig, 'Color', [1 1 1] );
set( fig, 'Visible', 'off' );
axis off;
axis equal;
```

The `circles()` function (embedded in the same file, lines 111-320) uses MATLAB's `fill()` to draw each circle as a polygon with 1000 vertices at the correct radius in data units:

```matlab
% create2DImages.m:307
h(n) = fill(x(n)+r(n).*cos(t+rotation(n)), y(n)+r(n).*sin(t+rotation(n)), '', varargin{:});
```

### Visual element checklist

| Property | Canonical value | Source |
|----------|----------------|--------|
| **Primary particle fill** | `'red'` (MATLAB named color = `#FF0000`) | `create2DImages.m:46` — `'facecolor','red'` |
| **Primary particle border** | MATLAB `fill()` default = black edge, linewidth=0.5 | No explicit `'edgecolor'` or `'linewidth'` passed. MATLAB `fill()` default: black edge, linewidth 0.5pt |
| **Alpha** | 1.0 (fully opaque) | No `'facealpha'` arg passed → MATLAB default = 1.0 |
| **Anti-aliasing** | MATLAB default (on for print, depends on renderer) | No explicit setting. MATLAB painters renderer has minimal AA; OpenGL has full AA. `saveas` to .tif uses painters. |
| **Background** | White `[1 1 1]` | `create2DImages.m:48` — `set(fig,'Color',[1 1 1])` |
| **Figure DPI/size** | Screen default (~72 DPI). No explicit `PaperPosition` or resolution set. | No DPI control — `saveas(fig, ..., '.tif')` uses screen resolution |
| **Axes** | Hidden (`axis off`), equal aspect (`axis equal`) | `create2DImages.m:50-51` |
| **Markers vs patches** | Patches (filled polygons in data units with 1000 vertices per circle) | `circles()` uses `fill()`, NOT `scatter`. Radius is exact in data-space. |
| **Output format** | `.tif` (TIFF) | `create2DImages.m:67` — filename ends in `.tif` |

## 2. Current pyaglogen3D backend style

Renderer: `backend/apps/simulations/services/projection.py`, function `_create_projection_figure` (lines 123-194).

### Method: `matplotlib.patches.Circle` + `PatchCollection`

```python
# projection.py:173-182
circles = [Circle((xi, yi), ri) for xi, yi, ri in zip(x, y, radii)]
collection = PatchCollection(
    circles,
    facecolor=facecolor,   # default: "red"
    edgecolor=edgecolor,   # default: "darkred"
    linewidth=0.5,
    alpha=0.9,
)
```

### Visual element checklist

| Property | Current value | Source |
|----------|--------------|--------|
| **Primary particle fill** | `"red"` (default param) | `projection.py:24` — `facecolor: str = "red"` |
| **Primary particle border** | `"darkred"`, linewidth=0.5 | `projection.py:25,180-181` |
| **Alpha** | 0.9 | `projection.py:181` |
| **Anti-aliasing** | Matplotlib Agg default = ON | `projection.py:11` — `matplotlib.use("Agg")`. Agg always AA. |
| **Background** | White `"white"` (default param) | `projection.py:26,169-170` |
| **Figure DPI** | 150 (legacy), 100 (img_size mode) | `projection.py:36,58` |
| **Figure size** | 8.0" base auto-aspect (legacy), `img_size/100` (fixed mode) | `projection.py:156,59` |
| **Axes** | Hidden, equal aspect, 2% padding | `projection.py:186-192` |
| **Markers vs patches** | `Circle` patches in data units (correct) | `projection.py:173` |
| **Output format** | PNG (bytes) or SVG (string) | `projection.py:81,117` |
| **bbox_inches** | `"tight"` + `pad_inches=0.1` (legacy), disabled for img_size mode | `projection.py:71,81` |

## 3. Diff (delta to apply for aglogen3D parity)

To match the MATLAB canonical style in the presentation render:

- **edgecolor**: Change `"darkred"` → `"black"` in `_create_projection_figure`. MATLAB `fill()` default edge is black, not darkred. (`projection.py:179`)
- **alpha**: Change `0.9` → `1.0`. MATLAB `fill()` default is fully opaque. (`projection.py:181`)
- **linewidth**: Keep `0.5` — matches MATLAB default for `fill()`.
- **facecolor**: Keep `"red"` — matches MATLAB `'facecolor','red'`.
- **background**: Keep `"white"` — matches `set(fig,'Color',[1 1 1])`.
- **axes**: Already correct (off + equal).

Summary: only 2 changes needed for aglogen3D parity — edgecolor and alpha.

**Decision point**: The design.md already specifies the presentation render as "red fill, dark edge, alpha, AA, border" — i.e. it INTENTIONALLY deviates from MATLAB's black edge/no-alpha. The current `darkred`/`0.9` may be an aesthetic choice, not a bug. See Open Questions.

## 4. Scientific mode definition (NEW)

This render mode does NOT exist in MATLAB — it's a new requirement for accurate FRAKTAL box-counting (eliminates AA halo and border contamination per PYA-8).

### Recommended matplotlib code

```python
def render_scientific_png(x, y, radii, bounds, img_size=512):
    """Black circles on white, binary B/W, no border, no alpha."""
    effective_dpi = 100
    effective_figsize = (img_size / 100.0, img_size / 100.0)

    fig, ax = plt.subplots(figsize=effective_figsize)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    circles = [Circle((xi, yi), ri) for xi, yi, ri in zip(x, y, radii)]
    collection = PatchCollection(
        circles,
        facecolor="#000000",
        edgecolor="none",     # NO border
        linewidth=0,
        alpha=1.0,            # fully opaque
    )
    ax.add_collection(collection)

    min_x, max_x, min_y, max_y = bounds
    padding = max(max_x - min_x, max_y - min_y) * 0.02
    ax.set_xlim(min_x - padding, max_x + padding)
    ax.set_ylim(min_y - padding, max_y + padding)
    ax.set_aspect("equal")
    ax.axis("off")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=effective_dpi, pad_inches=0)
    plt.close(fig)

    # Post-render binary threshold (AA cleanup)
    from PIL import Image
    import numpy as np
    img = Image.open(io.BytesIO(buf.getvalue())).convert("L")
    arr = np.array(img, dtype=np.uint8)
    arr = np.where(arr > 127, 255, 0).astype(np.uint8)
    out = Image.fromarray(arr, mode="L").convert("RGB")  # 3-channel, no alpha
    out_buf = io.BytesIO()
    out.save(out_buf, format="PNG")
    return out_buf.getvalue()
```

### Anti-aliasing note

Matplotlib's Agg backend always rasterizes with anti-aliasing — there is no `antialiased=False` that fully works for `PatchCollection` circles. The post-render binary threshold (`>127 → 255, ≤127 → 0`) is the locked design decision (design.md row 7). This produces clean binary edges suitable for box-counting.

### Figure geometry parity

Both presentation and scientific renders MUST use identical `img_size`, `dpi=100`, `figsize=(img_size/100, img_size/100)`, `pad_inches=0`, and same `bounds`/`padding`. This guarantees `pixels_per_100nm` is identical across variants (spec R3).

## 5. Open questions for user

1. **Presentation edgecolor: intentional `darkred` or match MATLAB `black`?**
   The design.md says "red fill, dark edge" which could mean either. MATLAB canonical is `black` edge (default `fill()`). Current code uses `darkred`. Should Phase 3 change it to `black` for parity, or keep `darkred` as a conscious aesthetic upgrade?

2. **Presentation alpha: intentional `0.9` or match MATLAB `1.0`?**
   Design says "alpha" suggesting non-1.0 is intentional. MATLAB canonical is `1.0`. The 0.9 alpha creates subtle overlap transparency. Keep current or match MATLAB exactly?

3. **No Python-side canonical code exists.** The user's prompt references `aglogen3D/` as "the canonical PhD code" — but the repo has `matlab_reference/` (MATLAB) and `aglogen_core/` (Rust engine, no rendering). There is no Python `aglogen3D/` package. Confirmed the MATLAB `create2DImages.m` is the correct reference.
