# Implementation Tasks: projection-scale-and-render-modes

## Phase 1 — Engine Rust dual render

- [ ] T1.1 — Split render function into presentation and scientific modes (engine/aglogen_core/engine/src/projection/render.rs)
- [ ] T1.2 — Implement post-render binary threshold (>127→255, ≤127→0) for scientific mode (engine/aglogen_core/engine/src/projection/render.rs)
- [ ] T1.3 — Create shared 2D bounding box helper returning (width, height) from projection bounds (engine/aglogen_core/engine/src/projection/mod.rs)
- [ ] T1.4 — Return (png_bytes, bbox_w, bbox_h) tuple from dual render function (engine/aglogen_core/engine/src/projection/render.rs)
- [ ] T1.5 — Add presentation render: red fill, dark edge, alpha, AA, border (engine/aglogen_core/engine/src/projection/render.rs)
- [ ] T1.6 — Add cargo tests for dual render output: binary check, dimension parity, bbox correctness (engine/aglogen_core/engine/tests/dual_render_test.rs)

## Phase 2 — Engine Rust FRAKTAL batch per-image scale

- [ ] T2.1 — Change BatchInput.pixels_per_100nm from f64 to Vec<f64> (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.2 — Create broadcast wrapper: single f64 expands to Vec with same value for all images (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.3 — Implement per-image bisection using correct scale per image (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.4 — Validate images.len() == pixels_per_100nm.len() at entry point, return error on mismatch (engine/aglogen_core/engine/src/fractal/batch.rs)
- [ ] T2.5 — Add cargo tests covering Vec<f64> path and single-float broadcast path (engine/aglogen_core/engine/tests/batch_per_image_scale_test.rs)

## Phase 3 — Python binding + backend simulations service

- [ ] T3.1 — Expose render_projection_dual binding: returns (pres_bytes, sci_bytes, bbox_w, bbox_h) (pyaglogen3D/src/lib.rs)
- [ ] T3.2 — Expose analyze_fraktal_batch_per_image_scale accepting list[float] pixels_per_100nm (pyaglogen3D/src/lib.rs)
- [ ] T3.3 — Maintain backward compat: analyze_fraktal_batch broadcasts single float to all images (pyaglogen3D/src/lib.rs)
- [ ] T3.4 — Refactor Celery task to render-all-first→measure→stamp-once-at-end order (pyaglogen3D/backend/apps/simulations/tasks.py)
- [ ] T3.5 — Modify build_projection_zip to include both PNG variants per direction (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.6 — Update build_metadata_json: directions[] gains per-direction pixels_per_100nm + filename_scientific (pyaglogen3D/backend/apps/simulations/services/projection.py)
- [ ] T3.7 — Add pytest tests: dual render, per-direction metadata, legacy mode (pyaglen3D/backend/tests/test_projection_dual.py)

## Phase 4 — Backend fractal_analysis migration + model

- [ ] T4.1 — Create migration 0007_add_scientific_png_field.py: add nullable BinaryField png_scientific_bytes (pyaglogen3D/backend/apps/fractal_analysis/migrations/0007_add_scientific_png_field.py)
- [ ] T4.2 — Add png_scientific_bytes field to FraktalBatchImage model with verbose_name (pyaglogen3D/backend/apps/fractal_analysis/models.py)
- [ ] T4.3 — Add migration tests confirming additive + reversible (pyaglogen3D/backend/tests/test_migration_0007.py)

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