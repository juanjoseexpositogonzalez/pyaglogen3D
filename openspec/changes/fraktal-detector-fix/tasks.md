# Implementation Tasks — fraktal-detector-fix (PYA-9)

## Phase 1 — Engine: NMS radius 2.0→1.0 + ALL-peaks median

- [x] T1.1 — Change NMS radius factor in `image_processing.rs:424` from `estimated_radius * 2.0` to `estimated_radius * 1.0` (aglogen_core/engine/src/fractal/fraktal/image_processing.rs)
- [x] T1.2 — Modify peak selection in `image_processing.rs:401-404`: remove top-30% filter, set `n_top = all_peaks.len()` for median over ALL peaks (aglogen_core/engine/src/fractal/fraktal/image_processing.rs)
- [x] T1.3 — Add cargo test: synthetic distance-transform with two adjacent peaks at 1.1× radius separation, verify NMS=1.0 resolves both peaks (aglogen_core/engine/src/fractal/fraktal/image_processing.rs::tests::test_nms_resolves_delta_1_1_packed_primaries)
- [x] T1.4 — Add cargo test: verify median computed over all peaks (not top-30%) using known peak set (aglogen_core/engine/src/fractal/fraktal/image_processing.rs::tests::test_radius_median_uses_all_peaks_not_top_30)
- [x] T1.5 — No existing cargo tests asserted top-30% behavior; verified all 186 prior tests still pass with new logic

## Phase 2 — Engine: accept binary scientific PNG input

- [x] T2.1 — Add `ImageInputVariant { Presentation, Scientific }` enum in `batch.rs` with derives `Debug, Clone, Copy, PartialEq, Eq` (aglogen_core/engine/src/fractal/fraktal/batch.rs)
- [x] T2.2 — Modify `BatchInput` to add `input_variants: Vec<ImageInputVariant>` field, default all to `Presentation` (aglogen_core/engine/src/fractal/fraktal/batch.rs)
- [x] T2.3 — Add `smart_segment_or_passthrough()` wrapper in `image_processing.rs`: when `pre_thresholded=true`, skip Otsu and treat input as binary (pixel > 127 = foreground) (aglogen_core/engine/src/fractal/fraktal/image_processing.rs)
- [x] T2.4 — Update `run_one_image` and `try_autocalibrate` to pass `pre_thresholded` flag based on `input_variant` (aglogen_core/engine/src/fractal/fraktal/batch.rs)
- [x] T2.5 — Python binding: expose `input_variants` optional param in `analyze_fraktal_batch_per_image_scale`, default "presentation", backward-compatible (aglogen_core/python/src/lib.rs)
- [x] T2.6 — Add cargo test: feed pre-thresholded binary array, verify Otsu skipped, output binary matches input threshold (aglogen_core/engine/tests/)
- [x] T2.7 — Final suite: 198 engine tests passing (188 baseline P1 + 10 new P2), 0 regressions. Binding test for `input_variants=["scientific"]` covered by Rust-side conversion test (commit d35057d)

## Phase 3 — Backend: DB + batch task

- [x] T3.1 — Create migration `0008_add_analysis_input_variant_field.py`: CharField max_length=16, default="presentation", NOT NULL (backend/apps/fractal_analysis/migrations/)
- [x] T3.2 — Add `analysis_input_variant` field to `FraktalBatchImage` model (backend/apps/fractal_analysis/models.py)
- [x] T3.3 — Modify `analyze_fraktal_batch_task`: when `png_scientific_bytes[i]` is non-NULL, decode and use as engine input, set `input_variants[i]="scientific"`; else use presentation PNG with variant "presentation" (backend/apps/fractal_analysis/tasks.py)
- [x] T3.4 — Modify `persist_batch_results` in `services/batch.py` to persist `analysis_input_variant` per `FraktalBatchImage` row (backend/apps/fractal_analysis/services/batch.py)
- [x] T3.5 — pytest: test scientific path — ZIP with `*.scientific.png`, verify variant="scientific" persisted (backend/apps/fractal_analysis/tests/)
- [x] T3.6 — pytest: test presentation fallback — legacy ZIP without scientific, verify variant="presentation" (backend/apps/fractal_analysis/tests/)
- [x] T3.7 — pytest: test mixed batch — some images have scientific, some don't, verify per-image variant (backend/apps/fractal_analysis/tests/)

## Phase 4 — Backend: autocalibrate default by origin

- [x] T4.1 — Modify `views.py::analyze_batch`: accept `origin` ("simulation" | "external") and `sim_dpo_nm` params (backend/apps/fractal_analysis/views.py)
- [x] T4.2 — When `origin="simulation"`: require `sim_dpo_nm` param, default `autocalibrate_dpo=False`, use `sim_dpo_nm` as `dpo_hint`, set `calibration_source="manual"` (backend/apps/fractal_analysis/views.py)
- [x] T4.3 — When `origin="simulation"` and `sim_dpo_nm` absent/invalid: return HTTP 400 with descriptive error (backend/apps/fractal_analysis/views.py)
- [x] T4.4 — When origin not "simulation": keep current behavior (autocalibrate default depends on scale) (backend/apps/fractal_analysis/views.py)
- [x] T4.5 — Update serializers to include `analysis_input_variant` in drill-down detail response (backend/apps/fractal_analysis/serializers.py)
- [x] T4.6 — pytest: test simulation origin with valid `sim_dpo_nm`, verify autocalibrate OFF, dpo_hint set (backend/apps/fractal_analysis/tests/)
- [x] T4.7 — pytest: test simulation origin missing `sim_dpo_nm`, verify HTTP 400 (backend/apps/fractal_analysis/tests/)
- [x] T4.8 — pytest: test external origin, verify autocalibrate default unchanged (backend/apps/fractal_analysis/tests/)

## Phase 5 — Frontend: upload UX differentiation

- [ ] T5.1 — Add `origin` and `sim_dpo_nm` props to `FraktalBatchUpload` component (frontend/src/components/fraktal/FraktalBatchUpload.tsx)
- [ ] T5.2 — Path A (sim-origin): pre-fill `autocalibrateDpo=false`, `dpoHint=simDpoNm`, display "Using known dpo = {X} nm from simulation. Override?" (frontend/src/components/fraktal/FraktalBatchUpload.tsx)
- [ ] T5.3 — Path B (external ZIP): keep current behavior, default `autocalibrateDpo=true`, `dpoHint=25` (frontend/src/components/fraktal/FraktalBatchUpload.tsx)
- [ ] T5.4 — Update `fraktalApi.uploadBatch` (or equivalent) to send `origin` and `sim_dpo_nm` when sim-origin (frontend/src/api/)
- [ ] T5.5 — Add `analysis_input_variant` badge in `FraktalBatchImageDetail.tsx`: "Analysis input: Scientific (binary)" or "Presentation" (frontend/src/components/fraktal/FraktalBatchImageDetail.tsx)
- [ ] T5.6 — vitest: render FraktalBatchUpload with `fromSimulation=true`, assert autocalibrate toggle OFF and dpo pre-filled (frontend/src/components/fraktal/)
- [ ] T5.7 — vitest: render FraktalBatchUpload with `fromSimulation=false`, assert autocalibrate ON default (frontend/src/components/fraktal/)
- [ ] T5.8 — vitest: render FraktalBatchImageDetail with `analysis_input_variant="scientific"`, assert badge displays "Scientific (binary)" (frontend/src/components/fraktal/)

## Phase 6 — Tests + docs + Jira close

- [ ] T6.1 — Integration test: synthetic projection (35 primaries, dpo=25nm, scale=80px/100nm → radius 10px), full pipeline, assert detector reports radius within ±10% (aglogen_core/engine/tests/)
- [ ] T6.2 — Documentation: `docs/fraktal-detector-fix.md` (~80 lines): why, what changed, NMS rationale, scientific PNG path, autocalibrate default, scientific result impact warning (docs/fraktal-detector-fix.md)
- [ ] T6.3 — CHANGELOG entry under `fraktal-detector-fix` (CHANGELOG.md or docs/CHANGELOG.md)
- [ ] T6.4 — Close Jira PYA-9 with comment summarizing fix + commit range. Note PYA-13 remains open for bisection UX (cycle B) (Jira)