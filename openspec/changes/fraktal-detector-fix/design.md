# Design: FRAKTAL Detector Fix (PYA-9)

## Architecture Overview

Two input paths converge at the engine's `estimate_particle_count_adaptive`:

```
                      ZIP upload
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
    png_scientific_bytes         image_png (presentation)
     (binary, no AA)              (grayscale, AA halo)
              │                       │
              │   ┌───────────────────┘
              │   │  fallback when scientific=NULL
              ▼   ▼
     tasks.py: select variant per image
              │
              ▼
    PyO3 binding (input_variant param)
              │
              ▼
    batch.rs: analyze_batch(BatchInput)
              │
    ┌─────────┴──────────┐
    │ input_variant=      │ input_variant=
    │ Scientific          │ Presentation
    ▼                     ▼
  smart_segment:        smart_segment:
  passthrough           Otsu threshold
  (skip Otsu)           (existing logic)
    └────────┬────────────┘
             ▼
  estimate_particle_count_adaptive
    NMS radius = 1.0 × estimated_radius
    Median of ALL peaks (no top-30%)
             │
             ▼
  analyze_granulated_2012 / voxel_2018
```

## Component Breakdown

### 1. Engine: `image_processing.rs` — NMS + median fix

| Target | Change |
|--------|--------|
| `image_processing.rs:400-404` | Remove top-30% selection. `n_top = all_peaks.len()` — take ALL peaks for median |
| `image_processing.rs:424` | `estimated_radius * 2.0` → `estimated_radius * 1.0` |

Two constant changes, no structural refactoring.

### 2. Engine: `image_processing.rs` — scientific input passthrough

Add `smart_segment_or_passthrough(image, ..., pre_thresholded: bool)`:

```rust
pub fn smart_segment_or_passthrough(
    image: ArrayView2<u8>,
    pixel_min: u8, pixel_max: u8,
    auto_threshold: bool,
    pre_thresholded: bool,
) -> (Array2<bool>, u8, bool) {
    if pre_thresholded {
        // Binary image: pixel > 127 = foreground
        let binary = image.mapv(|v| v > 127);
        return (binary, 128, false);
    }
    smart_segment(image, pixel_min, pixel_max, auto_threshold)
}
```

**Decision**: Wrapper around existing `smart_segment` vs modifying it. **Choice**: New wrapper — keeps `smart_segment` unchanged, avoids breaking callers outside batch path. **Rationale**: Minimal diff, single-responsibility.

### 3. Engine: `batch.rs` — `BatchInput` gains `input_variant`

| Change | Detail |
|--------|--------|
| New enum `ImageInputVariant { Presentation, Scientific }` | In `batch.rs`, derives `Debug, Clone, Copy, PartialEq, Eq` |
| `BatchInput.input_variants: Vec<ImageInputVariant>` | Per-image, same length as `images`. Default: all `Presentation` |
| `analyze_batch_broadcast` | Gains `input_variant: &str` param ("presentation"/"scientific"), broadcasts to vec |
| `try_autocalibrate` | Passes `pre_thresholded` based on variant |
| `run_one_image` | Calls `smart_segment_or_passthrough` with `pre_thresholded` flag |

**Decision**: Per-image variant vs batch-level. **Choice**: Per-image — a mixed-mode ZIP has some scientific, some presentation. Matches spec scenario D.3.

### 4. Python binding: `lib.rs`

`analyze_fraktal_batch_per_image_scale` gains optional `input_variants: Option<Vec<String>>`:

```rust
#[pyo3(signature = (images, pixels_per_100nm, autocalibrate_dpo, dpo_hint, algorithm, input_variants=None))]
```

When `None`, defaults to all `"presentation"`. Parses each string to `ImageInputVariant`. Backward-compatible — existing callers omit the param.

### 5. Backend: `tasks.py::analyze_fraktal_batch_task`

Current: receives `scientific_png_b64` list but does NOT use it for analysis — only persists.

**Change**: Before calling the engine, for each image `i`:
1. If `scientific_png_b64[i]` is not None, decode it, convert to grayscale numpy, use as analysis input. Set `input_variants[i] = "scientific"`.
2. Else, use `images[i]` (presentation). Set `input_variants[i] = "presentation"`.
3. Pass `input_variants` list to `analyze_fraktal_batch_per_image_scale`.
4. After engine returns, persist `analysis_input_variant` per `FraktalBatchImage` row.

Same logic applies to `_run_batch_sync` in `views.py`.

### 6. Backend: `views.py::analyze_batch` — autocalibrate default

Add origin-awareness before the current autocalibrate parsing block (line ~206):

```python
origin = request.data.get("origin")
sim_dpo_nm_raw = request.data.get("sim_dpo_nm")

if origin == "simulation":
    if not sim_dpo_nm_raw or float(sim_dpo_nm_raw) <= 0:
        return Response({"detail": "sim_dpo_nm required for simulation origin"}, 400)
    # Default autocalibrate=OFF for sim batches unless explicitly overridden
    if "autocalibrate_dpo" not in request.data:
        autocalibrate_dpo = False
        dpo_hint = float(sim_dpo_nm_raw)
        calibration_source = "manual"
```

**Decision**: New request fields (`origin`, `sim_dpo_nm`) vs inferring from `sim_id`. **Choice**: Explicit `origin` field — cleaner contract, frontend controls the default. `sim_id` already serves a different purpose (linking batch to sim for comparison).

### 7. Migration `0008_add_analysis_input_variant_field.py`

```python
migrations.AddField(
    model_name="fraktalbatchimage",
    name="analysis_input_variant",
    field=models.CharField(max_length=16, default="presentation"),
)
```

Additive. No data loss. Existing rows get `"presentation"` (correct — legacy used presentation PNG).

### 8. Serializer / drill-down response

`batch_image_detail_view` (views.py:987-1011): Add `"analysis_input_variant": img.analysis_input_variant` to the response dict.

### 9. Frontend: `FraktalBatchUpload.tsx`

**Decision**: Single component with conditional rendering vs two separate components. **Choice**: Single component — the form structure is 90% shared; only defaults and a few labels differ. Pass `fromSimulation?: boolean` and `simDpoNm?: number` as props.

| Prop state | `autocalibrateDpo` default | `dpoHint` default | Label hint |
|------------|---------------------------|-------------------|------------|
| `fromSimulation=true` | `false` | `simDpoNm` | "Using known dpo = {X}nm from simulation" |
| `fromSimulation=false` (or absent) | `true` | `25` (existing) | (existing UI) |

New fields in form data sent to backend: `origin: "simulation" | "external_zip"`, `sim_dpo_nm: number | undefined`.

### 10. Frontend: `FraktalBatchImageDetail.tsx`

Add badge above metrics section:

```tsx
{data.analysis_input_variant && (
  <Badge variant={data.analysis_input_variant === 'scientific' ? 'default' : 'secondary'}>
    Input: {data.analysis_input_variant === 'scientific' ? 'Scientific (binary)' : 'Presentation'}
  </Badge>
)}
```

## Algorithm Change Summary

| Parameter | Before | After | Impact |
|-----------|--------|-------|--------|
| NMS radius | `2.0 × est_radius` | `1.0 × est_radius` | Resolves adjacent peaks that were fused. Biggest fix (~2× correction) |
| Peak selection | Top-30% for median | ALL peaks for median | Removes ~1.3× upward bias |
| Segmentation input | Presentation PNG (AA halo) | Scientific PNG when available | Removes ~1.2× blob inflation |
| Combined | ~3.1× overestimation | ~1.0× (target) | dpo_used ≈ true dpo |

## Migration Strategy

All changes are additive:
- **Engine API**: New `input_variants` param with default. Old callers unaffected.
- **DB**: New nullable-with-default field. No data migration needed.
- **Frontend**: `fromSimulation` prop defaults to `false`. Existing pages work unchanged.
- **Behavioral**: Re-running prior batches produces different (more accurate) Df. Documented as known behavior change per spec E1.3.

## Backward Compatibility Matrix

| Scenario | Legacy ZIP | New ZIP (has scientific) |
|----------|-----------|------------------------|
| Old client (no `origin` field) | Works unchanged: autocalibrate=ON, presentation PNG | Works: autocalibrate=ON, scientific PNG used (engine gets variant from backend) |
| New client (sim origin) | N/A (sim always produces new ZIPs) | autocalibrate=OFF, sim dpo, scientific PNG |
| New client (external) | autocalibrate=ON, presentation PNG | autocalibrate=ON, scientific PNG used |
| Old DB rows (no `analysis_input_variant`) | Migration fills `"presentation"` | N/A |

## Scientific Result Impact

Re-running prior batches with the new engine WILL produce different Df values. The old engine overestimated dpo by ~2.18× (measured 54.6nm vs true 25nm), causing Df to saturate at ~2.0. Post-fix, dpo converges to true value, and Df reflects actual fractal dimension. This is a correctness improvement, not a regression. Prior results were systematically biased.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Engine unit | NMS=1.0 resolves adjacent peaks; ALL-peaks median | `cargo test` — synthetic distance-transform with known peak positions |
| Engine unit | Binary input passthrough | `cargo test` — feed pre-thresholded array, verify smart_segment skips Otsu |
| Engine integration | ±10% dpo accuracy | `cargo test` — generate 10px-radius circles at known positions, scale=80px/100nm, assert dpo ∈ [22.5, 27.5] |
| Backend unit | `input_variant` propagation | `pytest` — mock engine, assert `input_variants` list matches scientific availability |
| Backend unit | Autocalibrate default by origin | `pytest` — POST with `origin=simulation`, verify `autocalibrate_dpo=False` |
| Backend integration | Full pipeline accuracy | `pytest` — synthetic projection → ZIP → endpoint → verify Df within expected range |
| Frontend unit | Form pre-fill differs by origin | `vitest` — render with `fromSimulation=true`, assert autocalibrate toggle OFF and dpo pre-filled |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| NMS=1.0 accepts spurious noise peaks for very sparse aggregates | Low | Sparse aggregates have well-separated peaks; NMS=1.0 still suppresses sub-radius noise. Validate empirically with real TEM images post-deploy |
| Scientific PNG passthrough changes analysis for all new batches (not just sim-originated) | Medium (intentional) | This is by design — scientific PNG removes AA bias. If regression detected, rollback is one constant change |
| `origin` field not sent by old frontend | Low | Backend treats absent `origin` as non-simulation → existing default (autocalibrate=ON) preserved |

## Open Questions

None — all decisions resolved in proposal and spec.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `aglogen_core/engine/src/fractal/fraktal/image_processing.rs` | Modify | NMS 2.0→1.0 (line 424), ALL-peaks median (lines 400-404), add `smart_segment_or_passthrough` |
| `aglogen_core/engine/src/fractal/fraktal/batch.rs` | Modify | Add `ImageInputVariant` enum, extend `BatchInput`, thread through `run_one_image` and `try_autocalibrate` |
| `aglogen_core/python/src/lib.rs` | Modify | Add `input_variants` optional param to `analyze_fraktal_batch_per_image_scale` |
| `backend/apps/fractal_analysis/tasks.py` | Modify | Select scientific vs presentation input per image, pass `input_variants`, persist `analysis_input_variant` |
| `backend/apps/fractal_analysis/views.py` | Modify | Origin-aware autocalibrate default; `analysis_input_variant` in drill-down response |
| `backend/apps/fractal_analysis/models.py` | Modify | Add `analysis_input_variant` field to `FraktalBatchImage` |
| `backend/apps/fractal_analysis/migrations/0008_add_analysis_input_variant_field.py` | Create | Additive CharField migration |
| `frontend/src/components/fraktal/FraktalBatchUpload.tsx` | Modify | `fromSimulation` prop, origin-aware defaults, `sim_dpo_nm` field |
| `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` | Modify | `analysis_input_variant` badge |
| `aglogen_core/engine/tests/` | Create | Synthetic geometry integration test |
