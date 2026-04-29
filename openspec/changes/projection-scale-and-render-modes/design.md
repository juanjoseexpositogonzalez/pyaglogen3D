# Design: Projection Per-Image Scale & Render Dual Modes

## Technical Approach

Fix PYA-8 by: (1) computing per-direction `pixels_per_100nm` from the 2D projected bbox instead of the 3D AABB, and (2) emitting a scientific PNG (binary black/white, no AA/border/alpha) alongside the presentation PNG so FRAKTAL measurements are free of visual artifacts. The approach is bottom-up: engine → binding → backend → frontend, fully additive.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Render in Python (matplotlib) vs Rust | Keep matplotlib for presentation; add `_render_scientific_png` as Python helper using PIL/numpy | Rust rasterizer | Presentation renderer is complex matplotlib; scientific is trivial (filled circles, threshold). Avoids pulling image rendering into Rust. Scientific render reuses same `_create_projection_figure` with `facecolor="black", edgecolor="black", alpha=1.0` then applies binary threshold. |
| Post-render threshold location | Python-side: numpy threshold on decoded grayscale array, re-encode PNG | Engine-side image_rs | Rendering stays in Python (matplotlib), so threshold is natural in Python. 2 lines: `arr[arr > 127] = 255; arr[arr <= 127] = 0`. |
| Per-image scale storage | Per-direction `pixels_per_100nm` in `directions[]` + global = `max()` | Global-only (status quo) | Root cause of PYA-8. Per-view 2D bbox varies; a single global scale under-reports. |
| FRAKTAL batch API change | New `analyze_fraktal_batch_per_image_scale` binding with `Vec<f64>`, old wrapper broadcasts single float | Breaking change to existing binding | Backward compat preserved. Existing callers unaffected. |
| Celery ordering | Render ALL → measure ALL → stamp metadata once → ZIP | Inline stamp per direction | Locked decision #3. Simpler, and ensures `max(per-image)` is known before metadata write. |
| `filename_scientific` in legacy | Key ABSENT from dict | Key present as `null` | Locked decision #2. Legacy consumers doing `for k in direction` won't encounter unexpected keys. |
| Scientific PNG binary | Post-render threshold `>127→255, ≤127→0` | Disable AA in matplotlib | Matplotlib AA is hard to fully disable for circles. Threshold is reliable and simple. Locked decision #1. |

## Data Flow

```
Frontend form
    │
    ▼
Backend projection export view / Celery task
    │
    ├─ 1. project_directions(coords, radii, directions) → [ProjectionResult]
    │
    ├─ 2. FOR each direction i:
    │      render_presentation_png(proj) → pres_bytes
    │      render_scientific_png(proj)   → sci_bytes (threshold applied)
    │      bbox_w = proj.bounds[1] - proj.bounds[0]
    │      bbox_h = proj.bounds[3] - proj.bounds[2]
    │      COLLECT (pres_bytes, sci_bytes, bbox_w, bbox_h)
    │
    ├─ 3. AFTER loop: compute pixels_per_100nm[i] per direction
    │      top_level_scale = max(per_direction_scales)
    │
    ├─ 4. Write metadata.json (directions[i] includes pixels_per_100nm + filename_scientific)
    │      Add all PNGs to ZIP. Close ZIP.
    │
    ▼
FRAKTAL batch ingest
    │
    ├─ Unpack ZIP: detect *.scientific.png → store in FraktalBatchImage.png_scientific_bytes
    ├─ Read per-direction pixels_per_100nm from metadata → build list[float]
    ├─ Call analyze_fraktal_batch_per_image_scale(images, scales_list, ...)
    │
    ▼
Frontend drill-down
    │
    ├─ GET .../images/{i}/png/?variant=presentation|scientific
    └─ Toggle UI in FraktalBatchImageDetail
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/apps/simulations/services/projection.py` | Modify | Add `render_scientific_png()`: render with black/no-border/no-alpha, decode to grayscale, threshold, re-encode |
| `backend/apps/simulations/services/projections.py` | Modify | `build_projection_zip` gains optional `scientific_bytes_list` param; `build_metadata_json` gains optional `per_direction_scales` + `scientific_filenames` |
| `backend/apps/simulations/views.py` | Modify | Replace `_stamp_scale_metadata` with per-direction 2D-bbox scale computation; dual-render call |
| `backend/apps/simulations/tasks.py` | Modify | `build_projections_zip_task`: render-first ordering, dual PNG, per-direction scale stamp, then metadata+ZIP |
| `aglogen_core/engine/src/fractal/fraktal/batch.rs` | Modify | `BatchInput.pixels_per_100nm` → `Vec<f64>`; `run_one_image` uses per-image scale |
| `aglogen_core/python/src/lib.rs` | Modify | New `analyze_fraktal_batch_per_image_scale` fn (accepts `list[float]`); old `analyze_fraktal_batch` broadcasts single float internally |
| `backend/apps/fractal_analysis/models.py` | Modify | `FraktalBatchImage.png_scientific_bytes = BinaryField(null=True, blank=True)` |
| `backend/apps/fractal_analysis/migrations/0007_add_scientific_png_field.py` | Create | Additive migration: add nullable column |
| `backend/apps/fractal_analysis/views.py` | Modify | `batch_image_png_view`: read `?variant=` query param; `batch_image_detail_view`: add `has_scientific_png` flag |
| `backend/apps/fractal_analysis/tasks.py` | Modify | Batch task: detect `*.scientific.png` in ZIP, store separately; pass per-image scale list to engine |
| `backend/apps/fractal_analysis/services/batch.py` | Modify | `extract_zip_images` returns scientific images when present; `persist_batch_results` stores scientific bytes |
| `frontend/src/lib/api.ts` | Modify | `getBatchImagePngUrl` + `fetchBatchImagePng` gain optional `variant` param |
| `frontend/src/lib/types.ts` | Modify | `FraktalBatchImageDetail` gains `has_scientific_png: boolean` |
| `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` | Modify | Add Presentation/Scientific toggle, refetch on variant change, blob URL cleanup |

## Interfaces / Contracts

### Engine — BatchInput (Rust)

```rust
pub struct BatchInput {
    pub images: Vec<Array2<u8>>,
    pub pixels_per_100nm: Vec<f64>,  // was f64, now per-image
    pub autocalibrate_dpo: bool,
    pub dpo_hint: f64,
    pub algorithm: BatchAlgorithm,
}
```

### Python binding — new function

```python
def analyze_fraktal_batch_per_image_scale(
    images: list[np.ndarray],
    pixels_per_100nm: list[float],  # one per image
    autocalibrate_dpo: bool,
    dpo_hint: float,
    algorithm: str,
) -> dict: ...
```

### Scientific PNG render (Python)

```python
def render_scientific_png(x, y, radii, bounds, img_size) -> bytes:
    """Black circles on white, no AA, no border, no alpha.
    Post-render threshold: >127→255, ≤127→0. Returns RGB PNG bytes."""
```

### PNG endpoint variant

```
GET .../images/{i}/png/?variant=presentation    (default)
GET .../images/{i}/png/?variant=scientific
```

`variant=scientific` with `png_scientific_bytes IS NULL` → fallback to `image_png` (no 404).

### Drill-down detail response addition

```json
{ "has_scientific_png": true }
```

### Frontend API

```typescript
getBatchImagePngUrl(projectId, batchId, index, variant?: 'presentation' | 'scientific'): string
fetchBatchImagePng(projectId, batchId, index, variant?: 'presentation' | 'scientific'): Promise<Blob>
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Engine (cargo test) | `BatchInput` with `Vec<f64>` scales; per-image bisection uses correct scale | Unit test: 2 images with different scales → different npix in internals |
| Backend (pytest) | `render_scientific_png` output is binary B/W | Unit: decode PNG, assert all pixels ∈ {0, 255}, no alpha channel |
| Backend (pytest) | Per-direction scale formula matches spec R3 | Unit: known bbox → known `pixels_per_100nm` ± 0.01% |
| Backend (pytest) | ZIP structure: dual PNGs, metadata, filenames | Integration: mock engine, verify ZIP contents |
| Backend (pytest) | Legacy mode: no scientific PNG, no `filename_scientific` key | Unit: legacy ZIP → assert key absent per locked decision #2 |
| Backend (pytest) | PNG endpoint `?variant=scientific` returns correct bytes; fallback when NULL | Unit: mock model, assert response content |
| Backend (pytest) | Migration 0007: forward + reverse | Django `migrate` / `migrate 0006` round-trip |
| Frontend (vitest) | `getBatchImagePngUrl` appends `?variant=` | Unit: assert URL string |
| Frontend (vitest) | Toggle state in `FraktalBatchImageDetail` | RTL: render, click Scientific, assert refetch |
| Integration | Full round-trip: simulate → export → batch-analyze → drill-down | E2E with test fixtures |

## Migration / Rollout

1. **DB migration 0007**: additive nullable `BinaryField`. Zero downtime — no data rewrite. Reverse migration drops the column.
2. **Engine API**: `Vec<f64>` replaces `f64` in `BatchInput`. Single internal call site (`lib.rs` binding). Legacy wrapper broadcasts. No external API break.
3. **Backend deploy**: new code handles old ZIPs (no scientific PNGs → `png_scientific_bytes=NULL`, broadcast scale). Old code ignores new ZIP files it can't parse — but there's no "old code" scenario since backend + engine deploy together.
4. **Frontend**: toggle disabled when `has_scientific_png=false`. Old frontend ignores new response field.

## Backward Compatibility Matrix

| Scenario | Behavior |
|----------|----------|
| Legacy ZIP (no `*.scientific.png`) ingested by new batch task | `png_scientific_bytes=NULL`, broadcast `parameters.pixels_per_100nm` to all images |
| Legacy DB row (`png_scientific_bytes=NULL`) + new endpoint `?variant=scientific` | Returns `image_png` (presentation fallback, no 404) |
| New ZIP ingested by old batch task (hypothetical rollback) | Old code skips `*.scientific.png` files (unrecognized), uses `parameters.pixels_per_100nm` (backward compat global field) |
| New client + old backend (no `has_scientific_png` field) | Toggle disabled (field undefined → falsy) |
| Old client + new backend | Ignores `has_scientific_png`, never sends `?variant=`, gets presentation PNG (default) |

## Storage Impact

Each `FraktalBatchImage` gains an optional `png_scientific_bytes` (~50-100 KB per image). For a typical 8-direction batch: +400-800 KB. For large 300-direction batches: +15-30 MB. Acceptable tradeoff — scientific PNG is essential for accurate FRAKTAL measurements.

ZIP size also doubles per direction (2 PNGs instead of 1). Ephemeral ZIPs are deleted after batch ingest.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Celery render-first reorder changes failure semantics | Low | Sequential pipeline is simpler than interleaved. If render fails on direction N, no partial metadata is written. Clean failure. |
| AA halo bias in presentation PNG | Known/Accepted | Documented. Users warned that presentation PNG measurements include halo. Scientific PNG eliminates this for FRAKTAL. |
| Migration 0007 on large tables | Low | `ALTER TABLE ADD COLUMN ... NULL` is instant on Postgres (no table rewrite for nullable columns). |
| matplotlib memory leak in dual render | Low | `plt.close(fig)` already called in `render_projection_png`. Scientific render follows same pattern. |
| `Vec<f64>` length mismatch with images | Low | Validate `images.len() == pixels_per_100nm.len()` at Rust entry point. Return `Err` on mismatch. |

## Open Questions

None — all decisions are locked.
