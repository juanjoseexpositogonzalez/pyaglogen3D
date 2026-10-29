# Projection Scale & Render Modes

Per-image `pixels_per_100nm` and dual PNG render (presentation +
scientific) for FRAKTAL batch analysis.

## Why

Two related problems motivated this change:

1. **Scale mismatch (PYA-8 root cause)**: the projection metadata used
   the 3D axis-aligned bounding box (AABB) to compute `pixels_per_100nm`,
   but the renderer uses the 2D projected bounding box. The 3D AABB is
   always >= the 2D projection, so the reported scale was systematically
   inflated — roughly 1.43× for a typical agglomerate at an oblique
   viewing angle. This made every downstream FRAKTAL Df measurement
   wrong by a constant factor.

2. **Anti-aliasing halo**: the presentation render uses matplotlib with
   default anti-aliasing. This produces soft edges (grey pixels) around
   particle boundaries. When FRAKTAL counts pixels, those grey halos
   inflate the measured area and distort Df. A binary (black/white)
   render is needed for accurate scientific measurements.

## What changed

### Per-image scale

Each projection direction now computes its own `pixels_per_100nm` from
the 2D projected bounding box via a Rust helper (`compute_2d_bbox`).
The formula:

```
pixels_per_100nm = (100 * img_size) / (max(bbox_2d_w, bbox_2d_h) * 1.04)
```

The `1.04` factor accounts for the 2% padding added to each side of
the render viewport: `1 + 2 × 0.02 = 1.04`.

The scale is stamped per-direction in `metadata.json`:

```json
{
  "directions": [
    {
      "filename": "proj_000.png",
      "filename_scientific": "proj_000.scientific.png",
      "pixels_per_100nm": 42.1,
      "azimuth": 0.0,
      "elevation": 0.0
    }
  ],
  "parameters": {
    "pixels_per_100nm": 45.2
  }
}
```

The top-level `parameters.pixels_per_100nm` remains for backward
compatibility (set to `max(per-image scales)`). The FRAKTAL batch
endpoint reads per-direction scales when available and passes them as
a `Vec<f64>` to the Rust engine.

### Dual PNG render

Each direction now produces two PNGs:

- **Presentation** (`{base}.png`): red fill, black edge, linewidth 0.5,
  alpha 1.0, white background. Matches aglogen3D MATLAB parity
  (`create2DImages.m`).
- **Scientific** (`{base}.scientific.png`): solid black fill, no edge,
  white background. Post-render binary threshold (`>127→255, ≤127→0`)
  removes all anti-aliasing halos. Output is strictly 0/255 only.

Both renders share identical geometry (same `compute_2d_bbox` call,
same bounds, same figsize/dpi), so pixel coordinates match exactly.

### PNG endpoint variant

```
GET /api/v1/projects/{p}/fraktal/batches/{b}/images/{i}/png/?variant=presentation|scientific
```

- Default (no param or `variant=presentation`): returns presentation PNG.
- `variant=scientific`: returns scientific PNG when available.
- Fallback: when `png_scientific_bytes` is NULL (legacy row), scientific
  variant silently falls back to presentation — no 404.
- `Cache-Control: public, max-age=31536000, immutable` on both variants.

### Drill-down flag

The image drill-down detail response includes `has_scientific_png: true|false`.
The frontend uses this to enable/disable the Scientific toggle button.

## Migration notes

After deploy, run:

```bash
python manage.py migrate fractal_analysis 0007
```

This adds the `png_scientific_bytes` column to `fraktal_batch_images`
(nullable `BinaryField`). The migration is additive and reversible —
no data loss on rollback.

## Backward compatibility

- **Legacy ZIPs** (single PNG per direction, top-level scale only) still
  work. The batch endpoint broadcasts the single scale to all images and
  stores `png_scientific_bytes = NULL`.
- **Legacy `FraktalBatchImage` rows** (pre-migration, no scientific
  bytes) have `has_scientific_png = false`. The PNG endpoint falls back
  to presentation when scientific is requested but NULL.
- **Top-level `parameters.pixels_per_100nm`** is still present in
  metadata.json for backward-compatible consumers.

## Storage impact

Each batch image now stores two PNG variants instead of one, roughly
doubling PNG storage per batch image (~50-100 KB × 2). This is an
acceptable trade-off for accurate scientific measurements.

## Celery task ordering

The projection Celery task was refactored to:

1. Render ALL directions (both presentation + scientific PNGs)
2. Measure per-image scale from 2D bbox
3. Stamp `metadata.json` ONCE at the end

This eliminates per-direction inline metadata stamping, which was
fragile and produced incorrect incremental metadata files.

## Frontend

The drill-down page shows a **Presentation / Scientific** toggle
(radio buttons). Clicking Scientific refetches the PNG with
`?variant=scientific`. The toggle is disabled when
`has_scientific_png = false` (legacy batches).

Variant state resets to Presentation on image index change.
