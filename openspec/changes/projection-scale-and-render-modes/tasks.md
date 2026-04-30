# Implementation Tasks: projection-scale-and-render-modes

> **Note**: Phase 1 was originally scoped as Rust render. After exploration confirmed aglogen3D canonical uses matplotlib (MATLAB equivalent), Rust render was reverted and dual render moved to P3 (Python/matplotlib). Only the 2D bbox helper stayed in Rust. See `_explore-only/aglogen3d-render-style.md`.

## Phase 1 — Engine Rust 2D bbox helper

- [x] T1.1 — Create shared 2D bounding box helper `compute_2d_bbox(positions, az, el) -> Bbox2dResult { width_nm, height_nm, projected_2d }` (engine/aglogen_core/engine/src/projection/mod.rs)
- [x] T1.2 — Add cargo tests: multi-particle, single-particle, empty (engine/aglogen_core/engine/src/projection/mod.rs)

## Phase 2 — Engine Rust FRAKTAL batch per-image scale

- [ ] T2.1 — Change BatchInput.pixels_per_100nm from f64 to Vec<f64> (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.2 — Create broadcast wrapper: single f64 expands to Vec with same value for all images (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.3 — Implement per-image bisection using correct scale per image (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.4 — Validate images.len() == pixels_per_100nm.len() at entry point, return error on mismatch (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.5 — Add cargo tests covering Vec<f64> path and single-float broadcast path (engine/aglogen_core/engine/tests/batch_per_image_scale_test.rs)

## Phase 3 — Python binding + backend simulations dual matplotlib render

> **Style locked**: presentation = `facecolor=red, edgecolor=black, linewidth=0.5, alpha=1.0, white background, axis off + equal` (matches MATLAB `create2DImages.m`). Scientific = `facecolor=#000000, edgecolor=none, linewidth=0, alpha=1.0, white background` + post-render binary threshold (`>127→255, ≤127→0`). Both renders share identical img_size, dpi=100, figsize=(img_size/100, img_size/100), pad_inches=0, same bbox + 2% padding.

- [ ] T3.1 — Expose `compute_2d_bbox` to Python via PyO3 binding: `compute_2d_bbox(positions, az, el) -> (width_nm, height_nm, projected_2d_positions)` (pyaglogen3D/aglogen_core/python/src/lib.rs)
- [ ] T3.2 — Expose `analyze_fraktal_batch_per_image_scale(images, pixels_per_100nm: list[float], ...)` accepting list (pyaglogen3D/aglogen_core/python/src/lib.rs)
- [ ] T3.3 — Maintain backward compat: legacy `analyze_fraktal_batch(images, pixels_per_100nm: float, ...)` broadcasts internally (pyaglogen3D/aglogen_core/python/src/lib.rs)
- [ ] T3.4 — Update `_create_projection_figure` for presentation parity: change `edgecolor` from "darkred" to "black" and `alpha` from 0.9 to 1.0 (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.5 — Add `_create_scientific_projection_figure` helper: identical geometry to presentation, but `facecolor="#000000"`, `edgecolor="none"`, `linewidth=0`, `alpha=1.0`. Apply post-render binary threshold via PIL+numpy (`>127→255, ≤127→0`), output as L-mode then convert to RGB (no alpha channel) (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.6 — Add `render_projection_dual_png(...) -> (presentation_bytes, scientific_bytes, bbox_2d_w_nm, bbox_2d_h_nm)`. Both renders share the same bbox computation (call `compute_2d_bbox` once, pass result into both render fns) (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.7 — Refactor Celery projection task to render-all-first → measure-per-image-scale → stamp-metadata.json-once-at-end. Per-direction inline stamping forbidden (pyaglogen3D/backend/apps/simulations/tasks.py)
- [ ] T3.8 — Update `build_projection_zip`: include both PNGs per direction. Filenames: `{base}.png` (presentation), `{base}.scientific.png` (scientific) (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.9 — Update `build_metadata_json`: directions[] gains per-direction `pixels_per_100nm` and `filename_scientific` (ABSENT key in legacy mode, NOT null). Top-level `parameters.pixels_per_100nm` = max(per-image) (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.10 — Add pytest tests: dual render returns identical pixel dimensions, scientific bytes are strictly binary (assert no value in 1..254 in pixel array), per-direction metadata, legacy mode parity (single PNG, no scientific filename) (pyaglogen3D/backend/apps/simulations/tests/test_projection_dual.py)
- [ ] T3.11 — Add pytest tests for the Celery task render→measure→stamp ordering (assert metadata.json written once, not per-direction) (pyaglogen3D/backend/apps/simulations/tests/test_projection_task_order.py)

## Phase 4 — Backend fractal_analysis migration + model

- [x] T4.1 — Create migration 0007_add_scientific_png_field.py: add nullable BinaryField png_scientific_bytes (pyaglogen3D/backend/apps/fractal_analysis/migrations/0007_add_scientific_png_field.py)
- [x] T4.2 — Add png_scientific_bytes field to FraktalBatchImage model with verbose_name (pyaglogen3D/backend/apps/fractal_analysis/models.py)
- [x] T4.3 — Add migration tests confirming additive + reversible (pyaglogen3D/backend/tests/test_migration_0007.py)

## Phase 5 — Backend fractal_analysis batch task + endpoints

- [ ] T5.1 — Modify batch task ZIP unpack: detect *.scientific.png, persist when available (pyaglogen3D/backend/apps/fractal_analysis/tasks.py)
- [ ] T5.2 — Store both png_bytes and png_scientific_bytes in FraktalBatchImage (pyaglogen3D/backend/apps/fractal_analysis/tasks.py)
- [ ] T5.3 — Pass per-image scale list from metadata.directions to engine (pyaglogen3D/backend/apps/fractal_analysis/tasks.py)
- [ ] T5.4 — Implement ?variant=presentation|scientific query param on PNG endpoint (pyaglogen3D/backend/apps/fractal_analysis/views.py)
- [ ] T5.5 — Add fallback: variant=scientific returns presentation when png_scientific_bytes is NULL (pyaglogen3D/backend/apps/fractal_analysis/views.py)
- [ ] T5.6 — Add has_scientific_png flag to drill-down detail response (pyaglogen3D/backend/apps/fractal_analysis/views.py)
- [ ] T5.7 — Add pytest integration tests: batch task, PNG variant, drill-down detail (pyaglogen3D/backend/tests/test_batch_variant.py)

## Phase 6 — Frontend variant toggle

- [ ] T6.1 — Update getBatchImagePngUrl to accept variant param (pyaglogen3D/frontend/src/lib/api.ts)
- [ ] T6.2 — Update fetchBatchImagePng to accept variant param (pyaglogen3D/frontend/src/lib/api.ts)
- [ ] T6.3 — Add FraktalBatchImageDetail toggle UI: presentation/scientific radio (pyaglogen3D/frontend/src/components/fraktal/FraktalBatchImageDetail.tsx)
- [ ] T6.4 — State management: refetch blob URL on variant toggle change (pyaglogen3D/frontend/src/components/fraktal/FraktalBatchImageDetail.tsx)
- [ ] T6.5 — Add vitest tests: API params, toggle state, refetch behavior (pyaglogen3D/frontend/src/components/fraktal/FraktalBatchImageDetail.test.tsx)

## Phase 7 — Tests + docs + Jira PYA-8

- [ ] T7.1 — Cross-cutting integration test: simulate→projection→upload→batch→drill-down with both variants (pyaglogen3D/tests/integration/test_projection_scale_render_modes.py)
- [ ] T7.2 — CSV byte-equivalence test still passes (pyaglogen3D/tests/integration/test_csv_byte_equivalence.py)
- [ ] T7.3 — Write documentation docs/projection-scale-and-render-modes.md (pyaglogen3D/docs/projection-scale-and-render-modes.md)
- [ ] T7.4 — Add CHANGELOG entry for projection-scale-and-render-modes (pyaglogen3D/CHANGELOG.md)
- [ ] T7.5 — Close Jira PYA-8 with link to commit range (pyaglogen3D/.jira-config.json)
