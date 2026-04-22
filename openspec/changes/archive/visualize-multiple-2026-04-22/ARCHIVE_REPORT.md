# Archive Report — visualize-multiple

**Change**: `visualize-multiple`
**Archived on**: 2026-04-22
**Archive location**: `openspec/changes/archive/visualize-multiple-2026-04-22/`
**Previous archives retained**:
- `verify-rg-2026-04-20` (rg-unit-contract foundation)
- `import-aggregate-2026-04-21` (import-aggregate-contract + shim extension)

## Scope summary

Side-by-side comparison of 2–9 simulated or imported aggregates inside a new `/projects/{id}/compare` route: selection UI on the project page, grid mode (responsive 1×2 through 3×3) and overlay mode (single canvas with CoM alignment + deterministic per-sim colour palette), synchronised-camera provider (default on, togglable), shared settings panel, multi-column metrics table, multi-series Rg-evolution chart, missing-sim banner with deletion-safe URL handling, and a new scoping model for the viewer camera store so the compare session cannot overwrite the single-sim view's camera state.

## Task summary (22 total)

| # | Task | Status |
|---|------|--------|
| T1 | [frontend] Particles `uniformColor` prop | ✅ |
| T2 | [frontend] Scope viewer camera state (single vs compare/{sessionId}) | ✅ |
| T3 | [frontend] Thread color + camera scope through `AgglomerateViewer` | ✅ |
| T4 | [frontend/tests] Phase 1 unit tests (Particles, viewerStore, AgglomerateViewer) | ✅ |
| T5 | [frontend] Compare utilities (URL parse, palette, grid layout) | ✅ |
| T6 | [frontend] Project page selection + Compare button | ✅ |
| T7 | [frontend] Compare route + parallel data fetching | ✅ |
| T8 | [frontend/tests] Phase 2 unit tests | ✅ (project-page interaction tests deferred — documented on tasks.md:138) |
| T9 | [frontend] `CompareCameraProvider` | ✅ |
| T10 | [frontend] `CompareGrid` mode | ✅ |
| T11 | [frontend] `CompareOverlay` mode | ✅ |
| T12 | [frontend] Mode toggle in compare page | ✅ |
| T13 | [frontend/tests] Phase 3 component tests | ✅ |
| T14 | [frontend] `CompareMetricsTable` | ✅ |
| T15 | [frontend] `RgEvolutionChart` multi-series | ✅ |
| T16 | [frontend] `CompareSettingsPanel` | ✅ (shared sphere-resolution / axes / bg controls intentionally deferred — see follow-ups) |
| T17 | [frontend] Grid color legend | ✅ (decision: per-cell dot labels satisfy R-5; no shared legend added — see `tasks.md` T17) |
| T18 | [frontend] Missing-sim banner + deletion-safe URL handling | ✅ |
| T19 | [frontend/tests] Phase 4 unit tests | ✅ (19 new tests across the 3 files) |
| T20 | [docs] User guide `docs/visualize-multiple.md` | ✅ |
| T21 | [verify] Full test suite + typecheck + manual acceptance | ✅ automated (npm test 126/126, `tsc --noEmit` clean); manual 8-item checklist deferred post-deploy |
| T22 | [docs] Changelog entry | ✅ |

**All 22 tasks complete** on automated gates. T21's 8-item manual acceptance checklist is deferred to the post-deploy/staging smoke pass (same pattern as `import-aggregate` T28).

## Commits (5 total)

Range: `fa3cac6^..HEAD` on `main`

| Hash | Message |
|------|---------|
| `fa3cac6` | feat(visualize-multiple): apply Phase 1 — viewer refactor (T1-T4) |
| `e8a8efa` | feat(visualize-multiple): apply Phase 2 — compare scaffolding (T5-T8) |
| `f662742` | feat(visualize-multiple): apply Phase 3 — viewing modes (T9-T13) |
| `405a658` | feat(visualize-multiple): apply Phase 4 — polish (T14-T20) |
| `391d29b` | docs(visualize-multiple): add changelog entry (T22) |

## Test count delta

| Layer | Before | After | Δ |
|-------|--------|-------|---|
| Engine (Rust / cargo, `-p aglogen-engine`) | 165 | 165 | 0 |
| Backend (Python / pytest, `apps/simulations/tests/`) | 83 | 83 | 0 |
| Frontend (TypeScript / vitest) | 57 | 126 | +69 |
| **Total** | **305** | **374** | **+69** |

All new tests are frontend. No engine or backend code was touched by this change — it is a pure frontend composition layer on top of the existing Rust engine outputs and Django API.

## Canonical spec changes

- **New canonical spec**: `openspec/specs/multi-aggregate-comparison.md` (copied verbatim from `specs/multi-aggregate-comparison.md`, 228 lines, 10 requirements R1–R10).
- **New canonical spec**: `openspec/specs/viewer3d-state.md` (promoted from the delta `specs/viewer3d-state-delta.md`). Prior to this change, `viewer3d-state` was an implicit contract — the behaviour of the global `useViewerStore` and `CameraTracker` component. The delta documented the one required change (scoping per route/context) and has been promoted into a standalone canonical spec with a self-contained overview and R1 "Camera state is scoped per route/context" + 4 scenarios (S1.1–S1.4). The compare-side co-operation within a session is cross-referenced to `multi-aggregate-comparison` R3 rather than duplicated.

## Known follow-ups (deferred)

1. **Shared viewer settings panel — extended controls**: sphere resolution dropdown, axes toggle, and background color picker were intentionally scoped out of T16 to keep the MVP MEDIUM. Defaults from `useViewerStore` are used. A future change should add these to `CompareSettingsPanel` so compare sessions can adjust them in one place. **Deferred.**

2. **Mobile responsive layout**: the current layout is desktop-only (tested N=2..9 at desktop breakpoints). A mobile layout — including the N max 4 with horizontal scroll idea from design.md — is **deferred**.

3. **Export comparison as image / PDF**: users may want to export the grid or overlay view as a PNG / PDF for papers or reports. **Deferred.**

4. **Inertia-axes alignment option for Overlay mode**: overlay currently aligns by centre-of-mass only. A second alignment mode using principal inertia axes (so aggregates of similar shape but different orientation overlap more meaningfully) was considered and **deferred**.

5. **Save comparison view as named preset**: URL sharing of `/compare?sims=...` works today, but there is no persistence layer for "save this comparison with its toggle/settings as a named preset on the project". **Deferred.**

6. **Side-by-side particle highlight**: clicking a particle in one grid cell could highlight the same particle index in all other cells. Useful for manual inspection. **Deferred.**

7. **Multi-series FractalPlot with per-sim fitted lines**: the single-sim detail page has `FractalPlot` (Df fit visualisation). The Compare page does NOT yet render a multi-series FractalPlot with a fitted line per simulation. **Deferred.**

## Appendix — automated verification (T21)

### Frontend (TypeScript / vitest)

`npm test` — **Test Files passed; Tests 126 passed (126)** (delta +69 from prior baseline of 57).

### TypeScript

`npx tsc --noEmit` — exit code 0, no type errors.

### Engine + backend

No changes. Tests re-run and re-confirmed green at the same counts as the prior archive:
- Engine: 165 passed (1 ignored, pre-existing)
- Backend: 83 passed

### Manual acceptance (post-deploy on staging / prod)

_Deferred — to be ticked after the next staging deploy._ See T21 in the archived `tasks.md` for the 8-item checklist.

---

**SDD cycle complete.** Ready for the next change.
