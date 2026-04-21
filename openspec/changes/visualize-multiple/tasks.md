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
- [ ] Add `uniformColor?: string | number` prop to Particles component
- [ ] When provided, apply as the InstancedMesh material color; when absent, preserve current `0x4488ff` default
- [ ] No changes to existing call sites required (prop is optional)
**Done when**: `npx tsc --noEmit` passes and existing single-sim viewer renders unchanged in dev

#### T2. [frontend] Scope viewer camera state
**Effort**: M
**Location**: `frontend/src/state/viewerStore.ts`
**Depends on**: nothing
**Implements**: R-DELTA-1 (Camera State Scoping)
**Deliverables**:
- [ ] Introduce scope key model: `"single"` (default) vs `"compare/{sessionId}"`
- [ ] Refactor store reads/writes to be keyed by scope
- [ ] Keep `useViewerState()` (no-arg) behavior unchanged — implicitly uses `"single"` scope
- [ ] Add `useViewerState(scope)` overload for compare callers
- [ ] Ensure writes to one scope never mutate another scope's camera state
**Done when**: `npx tsc --noEmit` passes; unit tests in T4 pass

#### T3. [frontend] Thread color + camera scope through AgglomerateViewer
**Effort**: S
**Location**: `frontend/src/components/viewer3d/AgglomerateViewer.tsx`
**Depends on**: T1, T2
**Implements**: R-5, R-DELTA-1
**Deliverables**:
- [ ] Accept optional `cameraSource?: CameraSource` prop, thread to CameraTracker's scope key
- [ ] Accept optional `colorOverride?: string | number` prop, thread to Particles as `uniformColor`
- [ ] Defaults preserve current single-sim behavior
**Done when**: `npx tsc --noEmit` passes; existing viewer route unaffected

#### T4. [frontend/tests] Phase 1 unit tests
**Effort**: M
**Location**:
- `frontend/src/components/viewer3d/__tests__/Particles.test.tsx`
- `frontend/src/state/__tests__/viewerStore.test.ts`
- `frontend/src/components/viewer3d/__tests__/AgglomerateViewer.test.tsx`
**Depends on**: T1, T2, T3
**Deliverables**:
- [ ] `Particles.test.tsx`: `uniformColor` applied to material; default color preserved when prop absent
- [ ] `viewerStore.test.ts`: `"single"` and `"compare/abc"` scopes are isolated — writes to one do not affect the other
- [ ] `AgglomerateViewer.test.tsx`: `colorOverride` and `cameraSource` props are forwarded correctly
**Done when**: `npm test` (Phase 1 files) green

### Phase 2 — Compare page scaffolding

#### T5. [frontend] Compare utilities
**Effort**: M
**Location**: `frontend/src/lib/compare-utils.ts` (NEW)
**Depends on**: nothing
**Implements**: R-1 (URL-based Selection), R-5, R-2 (Grid Layout)
**Deliverables**:
- [ ] `parseCompareSimsParam(query: string): string[]` — parse `sims=id1,id2,...`, dedupe, preserve order
- [ ] `getCompareColorPalette(n: number): string[]` — deterministic by sorted sim ID using `schemeTableau10` from `d3-scale-chromatic`
- [ ] `getCompareGridLayout(n: number): { cols: number; rows: number }` — mapping N∈[2..9] to responsive grid
**Done when**: `npx tsc --noEmit` passes; unit tests in T8 pass

#### T6. [frontend] Project page selection + compare button
**Effort**: M
**Location**: `frontend/src/app/projects/[id]/page.tsx`
**Depends on**: T5
**Implements**: R-1, R-8 (Cap at 9)
**Deliverables**:
- [ ] Add per-row checkbox to simulations table
- [ ] Track selection in local `useState`
- [ ] Sticky bottom bar showing "Compare (N)" button when N≥2
- [ ] Disable button with tooltip when N>9
- [ ] On click, navigate to `/projects/{id}/compare?sims=<csv>`
**Done when**: Manual click-through works; T8 interaction tests pass

#### T7. [frontend] Compare route + data fetching
**Effort**: M
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx` (NEW)
**Depends on**: T5
**Implements**: R-1, R-8, R-9 (Missing Sim Handling)
**Deliverables**:
- [ ] Route component parses `sims` query param via `parseCompareSimsParam`
- [ ] Enforce cap at 9: truncate extras + show warning
- [ ] Parallel React Query fetch — reuse `useSimulationGeometry` if present, else add `useSimulationsCompare(ids)` hook
- [ ] Render skeleton/placeholder layout while loading
- [ ] Missing-sim (404/403) surfaces via banner (styling in T18)
**Done when**: `npx tsc --noEmit` passes; loading + loaded states render in dev

#### T8. [frontend/tests] Phase 2 unit tests
**Effort**: M
**Location**:
- `frontend/src/lib/__tests__/compare-utils.test.ts`
- `frontend/src/app/projects/[id]/__tests__/page.test.tsx`
**Depends on**: T5, T6, T7
**Deliverables**:
- [ ] `compare-utils.test.ts`: URL parse (valid, dedupe, empty), palette determinism (same IDs → same colors regardless of input order), grid layout mapping for N=2..9
- [ ] `page.test.tsx`: checkbox interaction, N≥2 enables Compare button, N>9 disables with tooltip
**Done when**: `npm test` green

### Phase 3 — Viewing modes

#### T9. [frontend] CompareCameraProvider
**Effort**: M
**Location**: `frontend/src/components/compare/CompareCameraProvider.tsx` (NEW)
**Depends on**: T2
**Implements**: R-6 (Synced Camera), R-DELTA-1
**Deliverables**:
- [ ] React Context providing broadcast of camera state (position, target, zoom)
- [ ] Debounce writes to 16ms (~1 frame)
- [ ] `synchronised: boolean` toggle (default true)
- [ ] Generate session ID once per mount → scope key `compare/{sessionId}`
**Done when**: `npx tsc --noEmit` passes; T13 tests pass

#### T10. [frontend] CompareGrid mode
**Effort**: M
**Location**: `frontend/src/components/compare/CompareGrid.tsx` (NEW)
**Depends on**: T3, T5, T9
**Implements**: R-2, R-3 (Per-viewer Scaling), R-5, R-6
**Deliverables**:
- [ ] Responsive CSS grid using layouts from `getCompareGridLayout`
- [ ] Each cell = `AgglomerateViewer` with scaled coords via `getScaleFactorNm(sim)`
- [ ] Sim label + color dot overlay per cell
- [ ] All cells subscribe to `CompareCameraProvider`
**Done when**: Dev render shows N=2..9 grids correctly; T13 layout tests pass

#### T11. [frontend] CompareOverlay mode
**Effort**: M
**Location**: `frontend/src/components/compare/CompareOverlay.tsx` (NEW)
**Depends on**: T1, T5, T9
**Implements**: R-4 (Overlay CoM Alignment), R-5, R-6
**Deliverables**:
- [ ] Single R3F Canvas
- [ ] For each sim: normalize coords to nm + translate to own center-of-mass + render `Particles` with `uniformColor = palette[i]`
- [ ] Shared `OrbitControls`
- [ ] Legend overlay (per-sim color + label)
**Done when**: Dev render shows aligned CoM overlay with distinct colors; T13 tests pass

#### T12. [frontend] Mode toggle in compare page
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx`
**Depends on**: T10, T11
**Implements**: R-7 (Mode Toggle)
**Deliverables**:
- [ ] Toggle control switching between `CompareGrid` and `CompareOverlay`
- [ ] Preserve mode in local state (or URL — implementer choice; default local)
**Done when**: Toggle swaps the rendered component without unmounting provider

#### T13. [frontend/tests] Phase 3 component tests
**Effort**: M
**Location**:
- `frontend/src/components/compare/__tests__/CompareCameraProvider.test.tsx`
- `frontend/src/components/compare/__tests__/CompareGrid.test.tsx`
- `frontend/src/components/compare/__tests__/CompareOverlay.test.tsx`
**Depends on**: T9, T10, T11
**Deliverables**:
- [ ] `CompareCameraProvider`: broadcasts to subscribers; debounces writes at 16ms
- [ ] `CompareGrid`: layout adapts per N (2, 4, 9)
- [ ] `CompareOverlay`: CoM alignment correct; colors distinct per sim
**Done when**: `npm test` green

### Phase 4 — Accompanying views + polish

#### T14. [frontend] Compare metrics table
**Effort**: S
**Location**: `frontend/src/components/compare/CompareMetricsTable.tsx` (NEW)
**Depends on**: T5, T7
**Implements**: R-10 (Metrics Table)
**Deliverables**:
- [ ] Table with sims as columns, colored headers (palette from T5)
- [ ] Rows: Df, Kf, Rg (nm via `getScaleFactorNm`), N, Algorithm
**Done when**: Renders for N=2..9; T19 tests pass

#### T15. [frontend] RgEvolutionChart multi-series
**Effort**: M
**Location**: `frontend/src/components/charts/RgEvolutionChart.tsx` (MODIFIED)
**Depends on**: T5
**Implements**: R-10
**Deliverables**:
- [ ] Accept `series: Array<{ label: string; data: {n: number; rg: number}[]; color: string }>` as new prop shape
- [ ] Feature-detect input: single-series callers keep existing API unchanged
- [ ] Missing-data points omitted with tooltip note
**Done when**: Single-series usage unregressed; multi-series renders on compare page; T19 tests pass

#### T16. [frontend] CompareSettingsPanel
**Effort**: S
**Location**: `frontend/src/components/compare/CompareSettingsPanel.tsx` (NEW)
**Depends on**: T9
**Implements**: R-7, R-6
**Deliverables**:
- [ ] Shared settings: sphere resolution, axes toggle, background color
- [ ] Mode toggle (grid/overlay) + sync-camera toggle
- [ ] Callbacks fire on change
**Done when**: Panel reflects and mutates shared settings; T19 tests pass

#### T17. [frontend] Grid color legend
**Effort**: S
**Location**: `frontend/src/components/compare/CompareGrid.tsx` (EXTEND)
**Depends on**: T10
**Implements**: R-5
**Deliverables**:
- [ ] Small corner panel listing per-sim color chip + name
- [ ] Visible only in grid mode
**Done when**: Legend visible in dev; matches palette ordering

#### T18. [frontend] Missing-sim banner + deletion-safe URL handling
**Effort**: S
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx`
**Depends on**: T7
**Implements**: R-9
**Deliverables**:
- [ ] Per-sim 404/403 → skip that sim, continue rendering survivors
- [ ] Non-dismissible banner listing missing IDs
- [ ] Finalized banner styling
**Done when**: Manual test: delete a sim, reload compare URL → banner shows, other sims render

#### T19. [frontend/tests] Phase 4 unit tests
**Effort**: M
**Location**:
- `frontend/src/components/compare/__tests__/CompareMetricsTable.test.tsx`
- `frontend/src/components/charts/__tests__/RgEvolutionChart.test.tsx`
- `frontend/src/components/compare/__tests__/CompareSettingsPanel.test.tsx`
**Depends on**: T14, T15, T16, T17, T18
**Deliverables**:
- [ ] `CompareMetricsTable.test.tsx`: rows render; header colors match palette
- [ ] `RgEvolutionChart.test.tsx`: add series-prop case; single-series case still passes
- [ ] `CompareSettingsPanel.test.tsx`: callbacks fire for each control
**Done when**: `npm test` green

#### T20. [docs] User guide
**Effort**: S
**Location**: `docs/visualize-multiple.md` (NEW)
**Depends on**: nothing (can start after Phase 3)
**Deliverables**:
- [ ] How to select sims on project page
- [ ] Compare modes (grid vs overlay) and when to use each
- [ ] Shared settings overview
- [ ] Cap (max 9 sims) rationale
**Done when**: Doc renders; reviewed for accuracy

### Phase 5 — Verification + archive prep

#### T21. [verify] Full test suite + typecheck + manual acceptance
**Effort**: M
**Location**: repo root
**Depends on**: T4, T8, T13, T19, T20
**Deliverables**:
- [ ] `npm test` green
- [ ] `npx tsc --noEmit` clean
- [ ] Manual acceptance checklist (8 items):
  1. Project page: select 2 sims → Compare button enables
  2. Project page: select 10 sims → button disabled with tooltip
  3. `/compare?sims=a,b` loads, grid mode default, cameras synced
  4. Toggle overlay → CoM-aligned, distinct colors, legend visible
  5. Metrics table shows Df/Kf/Rg/N/Algorithm with colored headers
  6. Rg chart shows N series matching palette
  7. Delete one sim, reload URL → banner lists it, others render
  8. Return to single-sim viewer → camera state unaffected by compare session
**Done when**: All items checked

#### T22. [docs] Changelog entry
**Effort**: S
**Location**: `CHANGELOG.md` (prepend)
**Depends on**: T21
**Deliverables**:
- [ ] Prepend "visualize-multiple (unreleased)" section summarizing user-visible changes
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
