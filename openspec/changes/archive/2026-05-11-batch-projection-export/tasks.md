# Tasks: batch-projection-export

## Overview
Batch export 2D-projection ZIPs across multiple simulations in a ParametricStudy — endpoint, Celery task with PNG reuse, frontend panel with polling.

**Total tasks**: 41
**Phases**: 7
**Stack**: [backend] primary, [frontend], [docs]
**TDD**: Strict (pytest before each GREEN for backend, vitest before each GREEN for frontend)

---

## Phase 1: Render-or-reuse helper (backend, TDD) ✅

- [x] T1.1 — Create render_or_reuse_projections() helper
- [x] T1.2 — RED→GREEN→TRIANGULATE: grid mode reuse
- [x] T1.3 — RED→GREEN: fibonacci mode
- [x] T1.4 — RED→GREEN: legacy mode
- [x] T1.5 — Test: reuse efficiency
- [x] T1.6 — Test: handles render failure of one direction
- [x] T1.7 — REFACTOR: extract duplicated filename logic (_compute_directions helper)

---

## Phase 2: Serializer + Celery task (backend, TDD) ✅

- [x] T2.1 — Create BatchProjectionExportRequestSerializer
- [x] T2.2 — RED→GREEN: empty simulation_ids → 400
- [x] T2.3 — RED→GREEN: >50 sims → 400
- [x] T2.4 — RED→GREEN: invalid mode → 400
- [x] T2.5 — RED→GREEN: mode-specific config validation
- [x] T2.6 — RED→GREEN: extra unknown config keys ignored
- [x] T2.7 — Create build_batch_projections_zip Celery task
- [x] T2.8 — RED→GREEN: ZIP structure (sim_{uuid}/... + manifest.json)
- [x] T2.9 — RED→GREEN: per-sim failure isolated
- [x] T2.10 — RED→GREEN: progress meta updated per sim
- [x] T2.11 — RED→GREEN: result includes download_filename

---

## Phase 3: ViewSet action + URL (backend, TDD) ✅

- [x] T3.1 — Add export_projections action to ParametricStudyViewSet
- [x] T3.2 — RED→GREEN: action validates and returns 202
- [x] T3.3 — RED→GREEN: cross-study sim rejection
- [x] T3.4 — RED→GREEN: permissions enforced (unauthenticated → 401)
- [x] T3.5 — Add URL route /export-projections/ in urls.py
- [x] T3.6 — Integration test: POST → 202 with correct shape (task mocked)

---

## Phase 4: Existing endpoints patch (backend, minimal) ✅

- [x] T4.1 — RED→GREEN: projections_status_view exposes current/total/current_sim_id
- [x] T4.2 — RED→GREEN: projections_download_view uses download_filename with fallback
- [x] T4.3 — Regression: existing single-sim export still works (8/8 existing polling tests pass)

---

## Phase 5: Frontend BatchProjectionExportPanel (vitest TDD)

### T5.1 — Create BatchProjectionExportPanel.tsx skeleton
- **Size**: S
- **Stack**: [frontend]
- **Description**: Create `frontend/src/components/batch/BatchProjectionExportPanel.tsx` skeleton
- **Acceptance**: File exists, TypeScript compiles

### T5.2 — RED→GREEN: panel renders sim list with checkboxes
- **Size**: M
- **Stack**: [frontend]
- **Description**: Assert panel renders list of completed simulations with checkboxes (one row per completed sim)
- **Acceptance**: Each sim shows as checkbox row

### T5.3 — RED→GREEN: select all / deselect all buttons
- **Size**: M
- **Stack**: [frontend]
- **Description**: "Select all" button checks all checkboxes; "Deselect all" unchecks all
- **Acceptance**: Both buttons work correctly

### T5.4 — RED→GREEN: counter shows selection count
- **Size**: S
- **Stack**: [frontend]
- **Description**: Counter displays "N of M selected"
- **Acceptance**: Counter updates dynamically

### T5.5 — RED→GREEN: mode/config controls
- **Size**: M
- **Stack**: [frontend]
- **Description**: Mode/config controls reuse `ProjectionControls` or equivalent component
- **Acceptance**: Existing controls reused

### T5.6 — RED→GREEN: button disabled when nothing selected
- **Size**: S
- **Stack**: [frontend]
- **Description**: "Generate & Export" button disabled when 0 selected
- **Acceptance**: Button state reflects selection

### T5.7 — RED→GREEN: clicking button POSTs to endpoint
- **Size**: M
- **Stack**: [frontend]
- **Description**: Click "Generate & Export" → POST to endpoint with correct body shape
- **Acceptance**: Correct payload sent

### T5.8 — RED→GREEN: polling starts on POST
- **Size**: M
- **Stack**: [frontend]
- **Description**: Polling starts, shows progress "Processing sim X of Y"
- **Acceptance**: Progress displayed during polling

### T5.9 — RED→GREEN: auto-download on completion
- **Size**: M
- **Stack**: [frontend]
- **Description**: On completion, triggers download (use jsdom-friendly approach, e.g., mock `window.location.assign`)
- **Acceptance**: Download triggered correctly

### T5.10 — RED→GREEN: partial failure warning toast
- **Size**: M
- **Stack**: [frontend]
- **Description**: On partial failure, shows warning toast with "X failed, Y succeeded"
- **Acceptance**: Warning toast displays correct message

### T5.11 — RED→GREEN: full failure error toast
- **Size**: S
- **Stack**: [frontend]
- **Description**: On full failure, shows error toast
- **Acceptance**: Error toast appears

### T5.12 — REFACTOR: clean component
- **Size**: M
- **Stack**: [frontend]
- **Description**: Clean component, extract sub-components if useful
- **Acceptance**: Clean code, tests still pass

---

## Phase 6: Frontend API client + integration

### T6.1 — Add triggerBatchProjectionExport to api.ts
- **Size**: S
- **Stack**: [frontend]
- **Description**: Add `triggerBatchProjectionExport(projectId, studyId, body)` to `frontend/src/lib/api.ts`
- **Acceptance**: Function exists and exports correctly

### T6.2 — Add/use polling helper
- **Size**: S
- **Stack**: [frontend]
- **Description**: Grep for existing polling helper, reuse or add new one for batch exports
- **Acceptance**: Polling mechanism available

### T6.3 — Integrate panel into parametric study page
- **Size**: M
- **Stack**: [frontend]
- **Description**: Mount `BatchProjectionExportPanel` in parametric study page (find: `frontend/src/app/projects/[id]/studies/[studyId]/page.tsx` or similar)
- **Acceptance**: Panel integrated into page

### T6.4 — Test: page renders panel with correct sim list
- **Size**: M
- **Stack**: [frontend]
- **Description**: Test page renders the panel, panel receives correct sim list from page state
- **Acceptance**: Integration works correctly

### T6.5 — Regression: existing parametric study tests pass
- **Size**: M
- **Stack**: [frontend]
- **Description**: Run existing ParametricStudy tests — ensure no regression
- **Acceptance**: All existing tests pass

---

## Phase 7: Docs

### T7.1 — CHANGELOG entry
- **Size**: S
- **Stack**: [docs]
- **Description**: Add entry under `## batch-projection-export (unreleased)` in CHANGELOG.md. Include: new endpoint, batch Celery task, PNG reuse, frontend panel
- **Acceptance**: Entry present in CHANGELOG.md unreleased section

### T7.2 — SMOKE_TEST.md
- **Size**: M
- **Stack**: [docs]
- **Description**: Create `openspec/changes/batch-projection-export/SMOKE_TEST.md`:
  - Pre-conditions: deployed backend + frontend
  - Step 1: Open parametric study with ≥3 completed sims
  - Step 2: Select 2 sims via checkboxes, select "grid" mode, click "Generate & Export"
  - Step 3: Poll until complete, verify ZIP auto-downloads
  - Step 4: Verify ZIP contains `sim_*/` folders + manifest.json
  - Step 5: Run again to verify PNG reuse (second run faster)
- **Acceptance**: Document created with all steps

### T7.3 — Spec sync deferred to archive
- **Size**: S
- **Stack**: [docs]
- **Description**: Note in tasks.md that spec sync to canonical is deferred to archive phase
- **Acceptance**: Deferred status documented

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-------------|
| 20 sims × 30 dirs = 600 renders (~60s) | Medium | Medium | Sequential sims, parallel dirs per sim. Show estimated time in UI |
| Disk: 600 PNGs × 100KB = 60MB transient | Low | Low | Existing cleanup-after-download pattern |
| Soft timeout partial results | Low | Medium | Return partial ZIP with processed sims + manifest |
| Orphan Celery tasks on user nav-away | Low | Low | Out of scope; document as future enhancement |
| Mode-config mismatch validation | Low | Low | Validate at endpoint, reject with 400 |
| Sim ID not in study validation | Low | Low | Validate ownership at endpoint level |

---

## Skill Resolution

- **go-testing**: Not applicable (Python pytest + React vitest, not Go)
- **sdd-tasks**: This phase — tasks created
- **sdd-apply**: Next recommended phase — execute tasks in phase order

---

## Next Recommended

`apply` — Launch sdd-apply to execute tasks in phase order. Start with Phase 1 (render-or-reuse helper TDD).