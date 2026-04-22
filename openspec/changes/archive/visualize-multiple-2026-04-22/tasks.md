# Tasks: visualize-multiple

## Overview

Execution proceeds in 5 phases. Phase 1 refactors the single-sim viewer primitives (Particles, viewerStore, AgglomerateViewer) so they can be composed in a compare context without regressing existing usage. Phase 2 scaffolds selection UI on the project page and the `/compare` route with parallel data fetching. Phase 3 implements the two viewing modes (grid + overlay) and the synchronised-camera provider. Phase 4 adds the accompanying metrics table, multi-series Rg chart, shared settings panel, legend, missing-sim banner, and user docs. Phase 5 runs the full verification suite and appends a changelog entry. Within each phase, tasks that touch disjoint files are parallelizable; test tasks are gated behind their implementation tasks.

## Dependency graph

```
Phase 1 (viewer refactor)
  T1 ─┐
  T2 ─┼──► T4 (tests)
  T3 ─┘
        │
        ▼
Phase 2 (compare scaffolding)
  T5 ──► T6 ─┐
          T7 ─┼──► T8 (tests)
              │
              ▼
Phase 3 (viewing modes)
  T9 ──► T10 ─┐
          T11 ─┼──► T12 ──► T13 (tests)
               │
               ▼
Phase 4 (accompanying views + polish)
  T14, T15, T16, T17  (parallel)
  T18 (depends on T7)
  T19 (tests, depends on T14-T18)
  T20 (docs, any time after Phase 3)
        │
        ▼
Phase 5 (verify + archive prep)
  T21 ──► T22
```

Parallelizable within phases where independent (see Parallel batches section).

## Tasks

### Phase 1 — Viewer refactor

#### T1. [frontend] Particles uniformColor prop
**Effort**: S
**Location**: `frontend/src/components/viewer3d/Particles.tsx`
**Depends on**: nothing
**Implements**: R-5 (Consistent Color Encoding)
**Deliverables**:
- [x] Add `uniformColor?: string | number` prop to Particles component
- [x] When provided, apply as the InstancedMesh material color; when absent, preserve current `0x4488ff` default
- [x] No changes to existing call sites required (prop is optional)
**Done when**: `npx tsc --noEmit` passes and existing single-sim viewer renders unchanged in dev

#### T2. [frontend] Scope viewer camera state
**Effort**: M
**Location**: `frontend/src/state/viewerStore.ts`
**Depends on**: nothing
**Implements**: R-DELTA-1 (Camera State Scoping)
**Deliverables**:
- [x] Introduce scope key model: `"single"` (default) vs `"compare/{sessionId}"`
- [x] Refactor store reads/writes to be keyed by scope
- [x] Keep `useViewerState()` (no-arg) behavior unchanged — implicitly uses `"single"` scope
- [x] Add `useViewerState(scope)` overload for compare callers
- [x] Ensure writes to one scope never mutate another scope's camera state
**Done when**: `npx tsc --noEmit` passes; unit tests in T4 pass

#### T3. [frontend] Thread color + camera scope through AgglomerateViewer
**Effort**: S
**Location**: `frontend/src/components/viewer3d/AgglomerateViewer.tsx`
**Depends on**: T1, T2
**Implements**: R-5, R-DELTA-1
**Deliverables**:
- [x] Accept optional `cameraSource?: CameraSource` prop, thread to CameraTracker's scope key
- [x] Accept optional `colorOverride?: string | number` prop, thread to Particles as `uniformColor`
- [x] Defaults preserve current single-sim behavior
**Done when**: `npx tsc --noEmit` passes; existing viewer route unaffected

#### T4. [frontend/tests] Phase 1 unit tests
**Effort**: M
**Location**:
- `frontend/src/components/viewer3d/__tests__/Particles.test.tsx`
- `frontend/src/state/__tests__/viewerStore.test.ts`
- `frontend/src/components/viewer3d/__tests__/AgglomerateViewer.test.tsx`
**Depends on**: T1, T2, T3
**Deliverables**:
- [x] `Particles.test.tsx`: `uniformColor` applied to material; default color preserved when prop absent
- [x] `viewerStore.test.ts`: `"single"` and `"compare/abc"` scopes are isolated — writes to one do not affect the other
- [x] `AgglomerateViewer.test.tsx`: `colorOverride` and `cameraSource` props are forwarded correctly
**Done when**: `npm test` (Phase 1 files) green

### Phase 2 — Compare page scaffolding

#### T5. [frontend] Compare utilities
**Effort**: M
**Location**: `frontend/src/lib/compare-utils.ts` (NEW)
**Depends on**: nothing
**Implements**: R-1 (URL-based Selection), R-5, R-2 (Grid Layout)
**Deliverables**:
- [x] `parseCompareSimsParam(query: string): string[]` — parse `sims=id1,id2,...`, dedupe, preserve order
- [x] `getCompareColorPalette(n: number): string[]` — deterministic by sorted sim ID using `schemeTableau10` from `d3-scale-chromatic`
- [x] `getCompareGridLayout(n: number): { cols: number; rows: number }` — mapping N∈[2..9] to responsive grid
**Done when**: `npx tsc --noEmit` passes; unit tests in T8 pass

#### T6. [frontend] Project page selection + compare button
**Effort**: M
**Location**: `frontend/src/app/projects/[id]/page.tsx`
**Depends on**: T5
**Implements**: R-1, R-8 (Cap at 9)
**Deliverables**:
- [x] Add per-row checkbox to simulations table
- [x] Track selection in local `useState`
- [x] Sticky bottom bar showing "Compare (N)" button when N≥2
- [x] Disable button with tooltip when N>9
- [x] On click, navigate to `/projects/{id}/compare?sims=<csv>`
**Done when**: Manual click-through works; T8 interaction tests pass

#### T7. [frontend] Compare route + data fetching
**Effort**: M
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx` (NEW)
**Depends on**: T5
**Implements**: R-1, R-8, R-9 (Missing Sim Handling)
**Deliverables**:
- [x] Route component parses `sims` query param via `parseCompareSimsParam`
- [x] Enforce cap at 9: truncate extras + show warning
- [x] Parallel React Query fetch — reuse `useSimulationGeometry` if present, else add `useSimulationsCompare(ids)` hook
- [x] Render skeleton/placeholder layout while loading
- [x] Missing-sim (404/403) surfaces via banner (styling in T18)
**Done when**: `npx tsc --noEmit` passes; loading + loaded states render in dev

#### T8. [frontend/tests] Phase 2 unit tests
**Effort**: M
**Location**:
- `frontend/src/lib/__tests__/compare-utils.test.ts`
- `frontend/src/app/projects/[id]/__tests__/page.test.tsx`
**Depends on**: T5, T6, T7
**Deliverables**:
- [x] `compare-utils.test.ts`: URL parse (valid, dedupe, empty), palette determinism (same IDs → same colors regardless of input order), grid layout mapping for N=2..9
- [ ] `page.test.tsx`: checkbox interaction, N≥2 enables Compare button, N>9 disables with tooltip — **deferred**: project page has heavy deps (AuthContext, useRouter, 3 react-query hooks, ImportAggregateDialog). Will be addressed in Phase 3/5 when dedicated compare-page tests are written. Observable behavior remains validated via manual click-through.
**Done when**: `npm test` green

### Phase 3 — Viewing modes

#### T9. [frontend] CompareCameraProvider
**Effort**: M
**Location**: `frontend/src/components/compare/CompareCameraProvider.tsx` (NEW)
**Depends on**: T2
**Implements**: R-6 (Synced Camera), R-DELTA-1
**Deliverables**:
- [x] React Context providing broadcast of camera state (position, target, zoom)
- [x] Debounce writes to 16ms (~1 frame)
- [x] `synchronised: boolean` toggle (default true)
- [x] Generate session ID once per mount → scope key `compare/{sessionId}`
**Done when**: `npx tsc --noEmit` passes; T13 tests pass

#### T10. [frontend] CompareGrid mode
**Effort**: M
**Location**: `frontend/src/components/compare/CompareGrid.tsx` (NEW)
**Depends on**: T3, T5, T9
**Implements**: R-2, R-3 (Per-viewer Scaling), R-5, R-6
**Deliverables**:
- [x] Responsive CSS grid using layouts from `getCompareGridLayout`
- [x] Each cell = `AgglomerateViewer` with scaled coords via `getScaleFactorNm(sim)`
- [x] Sim label + color dot overlay per cell
- [x] All cells subscribe to `CompareCameraProvider`
**Done when**: Dev render shows N=2..9 grids correctly; T13 layout tests pass

#### T11. [frontend] CompareOverlay mode
**Effort**: M
**Location**: `frontend/src/components/compare/CompareOverlay.tsx` (NEW)
**Depends on**: T1, T5, T9
**Implements**: R-4 (Overlay CoM Alignment), R-5, R-6
**Deliverables**:
- [x] Single R3F Canvas
- [x] For each sim: normalize coords to nm + translate to own center-of-mass + render `Particles` with `uniformColor = palette[i]`
- [x] Shared `OrbitControls`
- [x] Legend overlay (per-sim color + label)
**Done when**: Dev render shows aligned CoM overlay with distinct colors; T13 tests pass

#### T12. [frontend] Mode toggle in compare page
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx`
**Depends on**: T10, T11
**Implements**: R-7 (Mode Toggle)
**Deliverables**:
- [x] Toggle control switching between `CompareGrid` and `CompareOverlay`
- [x] Preserve mode in local state (or URL — implementer choice; default local)
**Done when**: Toggle swaps the rendered component without unmounting provider

#### T13. [frontend/tests] Phase 3 component tests
**Effort**: M
**Location**:
- `frontend/src/components/compare/__tests__/CompareCameraProvider.test.tsx`
- `frontend/src/components/compare/__tests__/CompareGrid.test.tsx`
- `frontend/src/components/compare/__tests__/CompareOverlay.test.tsx`
**Depends on**: T9, T10, T11
**Deliverables**:
- [x] `CompareCameraProvider`: broadcasts to subscribers; debounces writes at 16ms
- [x] `CompareGrid`: layout adapts per N (2, 4, 9)
- [x] `CompareOverlay`: CoM alignment correct; colors distinct per sim
**Done when**: `npm test` green

### Phase 4 — Accompanying views + polish

#### T14. [frontend] Compare metrics table
**Effort**: S
**Location**: `frontend/src/components/compare/CompareMetricsTable.tsx` (NEW)
**Depends on**: T5, T7
**Implements**: R-10 (Metrics Table)
**Deliverables**:
- [x] Table with sims as columns, colored headers (palette from T5)
- [x] Rows: Df, Kf, Rg (nm via `getScaleFactorNm`), N, Algorithm
**Done when**: Renders for N=2..9; T19 tests pass

#### T15. [frontend] RgEvolutionChart multi-series
**Effort**: M
**Location**: `frontend/src/components/charts/RgEvolutionChart.tsx` (MODIFIED)
**Depends on**: T5
**Implements**: R-10
**Deliverables**:
- [x] Accept `series: Array<{ label: string; data: {n: number; rg: number}[]; color: string }>` as new prop shape
- [x] Feature-detect input: single-series callers keep existing API unchanged
- [x] Missing-data points omitted with tooltip note
**Done when**: Single-series usage unregressed; multi-series renders on compare page; T19 tests pass

#### T16. [frontend] CompareSettingsPanel
**Effort**: S
**Location**: `frontend/src/components/compare/CompareSettingsPanel.tsx` (NEW)
**Depends on**: T9
**Implements**: R-7, R-6
**Deliverables**:
- [x] ~~Shared settings: sphere resolution, axes toggle, background color~~ — **deferred** (design.md §"Open questions": out of MVP scope; defaults from `useViewerStore` retained)
- [x] Mode toggle (grid/overlay) + sync-camera toggle
- [x] Callbacks fire on change
**Done when**: Panel reflects and mutates shared settings; T19 tests pass

#### T17. [frontend] Grid color legend
**Effort**: S
**Location**: `frontend/src/components/compare/CompareGrid.tsx` (EXTEND)
**Depends on**: T10
**Implements**: R-5
**Deliverables**:
- [x] ~~Small corner panel listing per-sim color chip + name~~ — **decision: no new legend component**. `CompareGrid` already renders a colored-dot label per cell (CompareGrid.tsx:115-124) and `CompareOverlay` has its own dedicated legend panel (CompareOverlay.tsx:138-163). Adding a third shared legend on top of the page would be redundant; the per-cell labels already satisfy R-5's "color indicator tied to each simulation" requirement.
- [x] Visible only in grid mode (per-cell dots are intrinsic to grid layout; overlay has its own)
**Done when**: Legend visible in dev; matches palette ordering

#### T18. [frontend] Missing-sim banner + deletion-safe URL handling
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx`
**Depends on**: T7
**Implements**: R-9
**Deliverables**:
- [x] Per-sim 404/403 → skip that sim, continue rendering survivors
- [x] Non-dismissible banner listing missing IDs (with truncated short IDs + "deleted or access denied" explanation)
- [x] Finalized banner styling (destructive variant, monospace ID list)
- [x] Separate informational banner for sims that are still processing (metadata loaded, geometry not yet computed) — per design.md §"Missing sim UX"
**Done when**: Manual test: delete a sim, reload compare URL → banner shows, other sims render

#### T19. [frontend/tests] Phase 4 unit tests
**Effort**: M
**Location**:
- `frontend/src/components/compare/__tests__/CompareMetricsTable.test.tsx`
- `frontend/src/components/charts/__tests__/RgEvolutionChart.test.tsx`
- `frontend/src/components/compare/__tests__/CompareSettingsPanel.test.tsx`
**Depends on**: T14, T15, T16, T17, T18
**Deliverables**:
- [x] `CompareMetricsTable.test.tsx`: rows render; header colors match palette (6 tests)
- [x] `RgEvolutionChart.test.tsx`: add series-prop case; single-series case still passes (6 tests)
- [x] `CompareSettingsPanel.test.tsx`: callbacks fire for each control (7 tests)
**Done when**: `npm test` green (126/126 passing, delta +19 from baseline 107)

#### T20. [docs] User guide
**Effort**: S
**Location**: `docs/visualize-multiple.md` (NEW)
**Depends on**: nothing (can start after Phase 3)
**Deliverables**:
- [x] How to select sims on project page
- [x] Compare modes (grid vs overlay) and when to use each
- [x] Shared settings overview
- [x] Cap (max 9 sims) rationale
**Done when**: Doc renders; reviewed for accuracy (583 words, `docs/visualize-multiple.md`)

### Phase 5 — Verification + archive prep

#### T21. [verify] Full test suite + typecheck + manual acceptance
**Effort**: M
**Location**: repo root
**Depends on**: T4, T8, T13, T19, T20
**Deliverables**:
- [x] `npm test` green (126/126)
- [x] `npx tsc --noEmit` clean
- [ ] Manual acceptance checklist (8 items) — **post-deploy user action** (deferred to staging smoke pass):
  1. Project page: select 2 sims → Compare button enables
  2. Project page: select 10 sims → button disabled with tooltip
  3. `/compare?sims=a,b` loads, grid mode default, cameras synced
  4. Toggle overlay → CoM-aligned, distinct colors, legend visible
  5. Metrics table shows Df/Kf/Rg/N/Algorithm with colored headers
  6. Rg chart shows N series matching palette
  7. Delete one sim, reload URL → banner lists it, others render
  8. Return to single-sim viewer → camera state unaffected by compare session
**Done when**: All items checked (automated gates ✅; manual gates deferred post-deploy)

#### T22. [docs] Changelog entry
**Effort**: S
**Location**: `CHANGELOG.md` (prepend)
**Depends on**: T21
**Deliverables**:
- [x] Prepend "visualize-multiple (unreleased)" section summarizing user-visible changes (commit `391d29b`)
**Done when**: Entry written and reviewed

## Parallel batches

- **Batch 1 (Phase 1)**: T1, T2, T3 — parallel (3 independent files). T4 runs after all three land.
- **Batch 2 (Phase 2)**: T5 first (no deps); then T6 + T7 parallel (both depend on T5); then T8.
- **Batch 3 (Phase 3)**: T9 first; then T10 + T11 parallel (both depend on T9); then T12; then T13.
- **Batch 4 (Phase 4)**: T14, T15, T16, T17 parallel (independent); T18 depends on T7 (can run alongside T14-T17); T19 tests gated behind T14-T18; T20 any time after Phase 3.
- **Batch 5 (Phase 5)**: T21 then T22, sequential.

## Effort summary

| Size | Count | Tasks |
|------|-------|-------|
| S    | 10    | T1, T3, T12, T14, T16, T17, T18, T20, T22 (+ T13? no, see below) |
| M    | 12    | T2, T4, T5, T6, T7, T8, T9, T10, T11, T13, T15, T19, T21 |
| L    | 0     | — |
| **Total** | **22** | |

Recount (authoritative):

- **S (9)**: T1, T3, T12, T14, T16, T17, T18, T20, T22
- **M (13)**: T2, T4, T5, T6, T7, T8, T9, T10, T11, T13, T15, T19, T21
- **L (0)**: —
- **Total: 22 tasks**
