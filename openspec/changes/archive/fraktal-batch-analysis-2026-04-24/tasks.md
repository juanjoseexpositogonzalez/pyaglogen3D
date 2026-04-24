# Tasks: Fraktal Batch Analysis

Dependency-ordered task checklist. Effort: S (≤1h), M (1-4h), L (>4h).
Reference R1..R11 maps to `specs/fraktal-batch-contract.md` requirements.

## Phase 1 — Rust batch orchestrator (design C1)

- [ ] **1.1 [M]** Implement `analyze_batch` + `BatchInput/BatchResult/ComparisonMetrics` types
  - File: `aglogen_core/engine/src/fractal/fraktal/batch.rs` (NEW)
  - Orchestrates per-image dpo with one-shot retry on image[N/2] (R3)
  - Builds comparison metrics (dimension_delta, lacunarity_ratio, sorensen_fixed=0.0)
  - Returns `Result<BatchResult, BatchError>` with structured error variants
  - Depends on: none
  - Done when: `cd aglogen_core && cargo build -p aglogen-engine` passes

- [ ] **1.2 [M]** Unit tests for batch orchestrator (R3 scenarios)
  - File: `aglogen_core/engine/src/fractal/fraktal/batch.rs` (same file, `#[cfg(test)] mod tests`)
  - 6 cases: happy path, image[0] fail→retry ok, both fail→error, empty batch, single image, non-square image
  - Depends on: 1.1
  - Done when: `cd aglogen_core && cargo test -p aglogen-engine fraktal::batch` passes

- [ ] **1.3 [S]** Register batch module
  - File: `aglogen_core/engine/src/fractal/fraktal/mod.rs` (MODIFY, add `pub mod batch;`)
  - Depends on: 1.1
  - Done when: `cargo build -p aglogen-engine` passes

## Phase 2 — PyO3 binding (design C2)

- [ ] **2.1 [S]** Expose `analyze_fraktal_batch` to Python
  - File: `aglogen_core/python/src/lib.rs` (MODIFY, add `#[pyfunction]`)
  - Accepts list of (bytes, filename) + pixels_per_100nm; returns dict matching BatchResult
  - Depends on: 1.1, 1.3
  - Done when: `cd aglogen_core && cargo build -p aglogen-python` passes

- [ ] **2.2 [S]** Smoke test the binding
  - File: `backend/apps/fractal_analysis/tests/test_pyo3_batch_binding.py` (NEW)
  - 2 cases: round-trip on 2 in-memory PNGs; type shape matches serializer expectations
  - Depends on: 2.1
  - Done when: `cd backend && pytest apps/fractal_analysis/tests/test_pyo3_batch_binding.py` passes

## Phase 3 — Backend services + endpoint + Celery + polling (design C3-C7)

- [ ] **3.1 [M]** Service helpers for batch flow
  - File: `backend/apps/fractal_analysis/services/batch.py` (NEW)
  - 6 functions: `unzip_batch`, `extract_metadata_scale`, `autocalibrate_scale`, `detect_sim_id_from_filename`, `build_histogram` (FD≥10 / Sturges 5-9 / omit<5), `run_batch_sync`
  - Depends on: 2.1
  - Done when: `ruff check backend/apps/fractal_analysis/services/batch.py` passes

- [ ] **3.2 [M]** Service unit tests (R1, R2, R7, R8, R9)
  - File: `backend/apps/fractal_analysis/tests/test_services_batch.py` (NEW)
  - Covers: scale precedence (manual > metadata > autocalibrate), UUID regex detection, histogram binning thresholds, ZIP structure validation
  - Depends on: 3.1
  - Done when: `cd backend && pytest apps/fractal_analysis/tests/test_services_batch.py` passes

- [ ] **3.3 [M]** `analyze_batch` action on FraktalViewSet
  - File: `backend/apps/fractal_analysis/views.py` (MODIFY, new `@action(detail=False, methods=['post'])`)
  - Sync if ≤30 images, Celery async if >30; scale precedence per R1; try/except → structured 400 per R3
  - Depends on: 3.1, 3.7
  - Done when: `pytest apps/fractal_analysis/tests/test_batch_endpoint.py::test_sync_happy_path` passes

- [ ] **3.4 [M]** Celery task with stage progress
  - File: `backend/apps/fractal_analysis/tasks.py` (MODIFY, add `analyze_fraktal_batch_task`)
  - Stages: `autocalibrate` → `analyzing` → `aggregating`; updates task meta with progress
  - Depends on: 3.1
  - Done when: `pytest apps/fractal_analysis/tests/test_batch_endpoint.py::test_async_queues_celery` passes

- [ ] **3.5 [S]** Polling endpoint `/fraktal-status/{job_id}/`
  - Files: `backend/apps/fractal_analysis/views.py` (MODIFY) + `backend/apps/fractal_analysis/urls.py` (MODIFY)
  - Returns `{state, stage, progress, result_url?}`
  - Depends on: 3.4
  - Done when: `pytest apps/fractal_analysis/tests/test_batch_endpoint.py::test_polling` passes

- [ ] **3.6 [S]** Results download endpoint `/fraktal-status/{job_id}/results/`
  - Files: `backend/apps/fractal_analysis/views.py` (MODIFY) + `urls.py` (MODIFY)
  - Streams BatchResult JSON; 404 if job not ready/expired
  - Depends on: 3.4
  - Done when: `pytest apps/fractal_analysis/tests/test_batch_endpoint.py::test_results_download` passes

- [ ] **3.7 [S]** Serializers for request/response
  - File: `backend/apps/fractal_analysis/serializers.py` (MODIFY)
  - Add `BatchRequestSerializer`, `BatchResultSerializer`, `ComparisonDataSerializer`
  - Depends on: none
  - Done when: `pytest apps/fractal_analysis/tests/test_services_batch.py` passes (reused in services tests)

- [ ] **3.8 [M]** Endpoint integration tests
  - File: `backend/apps/fractal_analysis/tests/test_batch_endpoint.py` (NEW)
  - Covers: sync happy path, async queue trigger, ZIP validation 400, scale precedence (R1), legacy single-image endpoint unchanged, polling lifecycle, results download
  - Depends on: 3.3, 3.4, 3.5, 3.6
  - Done when: `cd backend && pytest apps/fractal_analysis/tests/test_batch_endpoint.py` passes

## Phase 4 — Frontend (design C8-C12)

- [ ] **4.1 [M]** API client + polling helper
  - File: `frontend/src/lib/api.ts` (MODIFY)
  - Add `fraktalApi.analyzeBatch(formData)`, `fraktalApi.pollBatchStatus(jobId)`, `fraktalApi.downloadBatchResults(jobId)`
  - Mirror pattern from `simulationsApi.exportProjections`
  - Depends on: 3.5, 3.6
  - Done when: `cd frontend && npm run type-check` passes

- [ ] **4.2 [M]** `FraktalBatchUpload` component
  - File: `frontend/src/components/fraktal/FraktalBatchUpload.tsx` (NEW)
  - Drop-zone for ZIP, manual pixels_per_100nm override input, manual sim_id override
  - Depends on: 4.1
  - Done when: component renders + fires `onSubmit` with FormData in test

- [ ] **4.3 [M]** `FraktalBatchResultsView` component
  - File: `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` (NEW)
  - Results table + plotly histogram (respects binning rules R9) + ComparisonCard slot
  - Depends on: 4.2, 4.4
  - Done when: renders mock BatchResult without errors in test

- [ ] **4.4 [S]** `FraktalComparisonCard` component
  - File: `frontend/src/components/fraktal/FraktalComparisonCard.tsx` (NEW)
  - 3 metric badges (dimension_delta, lacunarity_ratio, sorensen) + fixed note "Sorensen pending dataset"
  - Depends on: none
  - Done when: renders all 3 badges in test

- [ ] **4.5 [S]** Batch route pages
  - Files: `frontend/src/app/projects/[id]/fraktal/batch/page.tsx` (NEW), `frontend/src/app/projects/[id]/fraktal/batch/[jobId]/page.tsx` (NEW)
  - Upload page + results/polling page; polling page starts polling on mount
  - Depends on: 4.2, 4.3
  - Done when: `cd frontend && npm run build` passes

- [ ] **4.6 [S]** CTA linking single-image → batch
  - File: `frontend/src/app/projects/[id]/fraktal/new/page.tsx` (MODIFY)
  - Add "Analizar lote (ZIP)" button → `/projects/[id]/fraktal/batch`
  - Legacy single-image flow UNCHANGED (R11)
  - Depends on: 4.5
  - Done when: `npm run build` passes + manual smoke renders CTA

- [ ] **4.7 [M]** Component tests
  - Files: `frontend/src/components/fraktal/__tests__/{FraktalBatchUpload,FraktalBatchResultsView,FraktalComparisonCard}.test.tsx` (NEW)
  - Covers: upload form submit shape, results view histogram omission <5, comparison card metric labels
  - Depends on: 4.2, 4.3, 4.4
  - Done when: `cd frontend && npm test -- fraktal` passes

- [ ] **4.8 [S]** API polling tests
  - File: `frontend/src/lib/__tests__/api.batch.test.ts` (NEW)
  - Mocks fetch; asserts polling stops on terminal state + calls download on success
  - Depends on: 4.1
  - Done when: `cd frontend && npm test -- api.batch` passes

## Phase 5 — Docs + verify

- [ ] **5.1 [S]** User guide for batch mode
  - File: `docs/fraktal-batch.md` (NEW, ~80 lines)
  - Covers: ZIP structure, metadata JSON shape, scale precedence, sync vs async thresholds, polling, sim_id override
  - Depends on: Phase 4 complete
  - Done when: file exists and renders in preview

- [ ] **5.2 [verify]** Run all test suites
  - Command: `cd aglogen_core && cargo test -p aglogen-engine && cd ../backend && pytest apps/fractal_analysis && cd ../frontend && npm test -- fraktal`
  - Depends on: all prior tasks
  - Done when: all three suites green

- [ ] **5.3 [changelog]** Prepend CHANGELOG entry
  - File: `CHANGELOG.md` (MODIFY)
  - Entry: `feat(fraktal): batch analysis via ZIP upload with async Celery + comparison metrics`
  - Depends on: 5.2
  - Done when: entry visible at top of unreleased section

- [ ] **5.4 [verify]** Final cross-stack verification
  - Command: `cd aglogen_core && cargo build && cd ../backend && ruff check && mypy . && cd ../frontend && npm run lint && npm run type-check && npm run build`
  - Depends on: 5.3
  - Done when: all commands exit 0

## Parallel execution plan (for sdd-apply)

- **Batch A (sequential)**: Phase 1 → Phase 2
- **Batch B (mixed)**: 3.1+3.2+3.7 parallel → 3.3+3.4+3.5+3.6 parallel → 3.8
- **Batch C (mixed)**: 4.1 | 4.2 | 4.4 parallel → 4.3 + 4.5 after 4.2+4.4 → 4.6 independent → 4.7 + 4.8 last
- **Batch D**: Phase 5 sequential
