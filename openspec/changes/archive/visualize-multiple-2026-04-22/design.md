# Design: visualize-multiple

## Architecture overview

The Compare view is a new Next.js route `/projects/[id]/compare?sims=<csv>` that fetches N (2–9) simulations in parallel via React Query and renders them through one of two composition modes. The existing `AgglomerateViewer` is reused as-is for each cell in **Grid mode**; **Overlay mode** renders one shared `Canvas` with N aggregates merged at their respective CoMs and coloured from a deterministic palette. A `CompareCameraProvider` context owns a single shared camera state (debounced) that all viewers subscribe to when "sync cameras" is on. A single `CompareSettingsPanel` drives all viewers uniformly through `useViewerStore`; the store itself is lightly refactored so camera-angle writes don't race across mounted viewers.

```
  ProjectPage [row checkboxes] ──▶ navigate(?sims=A,B,C)
                                        │
                                        ▼
                              compare/page.tsx
                                        │
          ┌────────── useSimulationsCompare(ids) ──────────┐
          ▼                      ▼                         ▼
     React Query            React Query                React Query
     (sim A meta+geo)       (sim B meta+geo)           (sim C meta+geo)
          │                      │                         │
          └──────────────────────┴─────────────────────────┘
                                 │
                        CompareCameraProvider
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
   CompareSettingsPanel  {Grid or Overlay}      CompareMetricsTable
                                 │                      │
                                 └─ RgEvolutionChart (multi-series) ─┘
```

## Key components

### Component 1: Particles.tsx — MODIFIED
**Location**: `frontend/src/components/viewer3d/Particles.tsx:15-21`
**Change**: accept optional `uniformColor?: string | number` prop. When `colorMode === 'uniform'` and `uniformColor` is provided, use it via `color.set(uniformColor)` in place of the hardcoded `0x4488ff` at line 95. Default preserves current behaviour.
**Why**: explore §finding 5 / §6 — overlay mode needs per-sim distinct colours.

### Component 2: viewerStore.ts — MODIFIED
**Location**: `frontend/src/stores/viewerStore.ts:80-81, 104`
**Change**: replace single `cameraAzimuth`/`cameraElevation` scalars with a keyed map `cameraAngles: Record<string, {azimuth: number; elevation: number}>`. `setCameraAngles(scope: string, az: number, el: number)` writes to the scope slot; default scope `"single"` preserves prior single-sim semantics. `CameraTracker` in `AgglomerateViewer.tsx` accepts a `scope` prop (default `"single"`) and writes to its own slot. The persisted schema bumps; a migration drops the old scalar keys.
**Why**: explore §finding 2 — N viewers writing to one slot every frame is a race.

### Component 3: AgglomerateViewer.tsx — MODIFIED
**Location**: `frontend/src/components/viewer3d/AgglomerateViewer.tsx:126-142`
**Change**: add optional props
```ts
interface AgglomerateViewerProps {
  // ... existing
  cameraScope?: string            // default "single"; used by CameraTracker write slot
  cameraSource?: CameraSource     // when set, OrbitControls is driven from context
  colorOverride?: string | number // forwarded to Particles as uniformColor
}
```
When `cameraSource` is provided, `OrbitControls` listens to `onChange` and calls `cameraSource.setCamera(...)`; a `useEffect` reads `cameraSource.{azimuth,elevation,distance}` and applies to `controlsRef.current` (via spherical→cartesian). Auto-framing (cameraPosition computation) runs only on first mount.
**Why**: allow external sync (Grid mode) and uniform colouring (Overlay mode) without rewriting the viewer.

### Component 4: CompareCameraProvider.tsx — NEW
**Location**: `frontend/src/components/compare/CompareCameraProvider.tsx`
**Purpose**: React Context owning a single camera state shared across N viewers.
**Interface**:
```ts
interface CameraState {
  azimuth: number     // degrees
  elevation: number   // degrees
  distance: number    // world units (max across sims for safe initial)
}
interface CompareCameraContext {
  state: CameraState
  synchronised: boolean
  setCamera: (patch: Partial<CameraState>) => void
  toggleSync: () => void
}
export const useCompareCamera = (): CompareCameraContext
```
**Behavior**: 16 ms throttle (`requestAnimationFrame` coalesce) on `setCamera` writes to avoid per-frame cascades. When `synchronised === false`, the hook returns `{state, setCamera: () => {}}` making each viewer read-only from context; viewers fall back to their own internal OrbitControls state.

### Component 5: CompareGrid.tsx — NEW
**Location**: `frontend/src/components/compare/CompareGrid.tsx`
**Props**: `{ simulations: CompareSim[]; settings: ViewerSettings; showLegend: boolean }`
**Behavior**:
- Responsive CSS grid via `getCompareGridLayout(n)`:
  - N=2 → 1×2, N=3 → 1×3, N=4 → 2×2, N=5-6 → 2×3, N=7-9 → 3×3
- Each cell: `AgglomerateViewer` with pre-scaled coords (each sim's own `getScaleFactorNm`), label chip (sim name truncated + coloured dot), `cameraScope={`compare/${simId}`}`, `cameraSource` bound to `useCompareCamera()`.
- All viewers subscribe to the same `CompareCameraProvider`.

### Component 6: CompareOverlay.tsx — NEW
**Location**: `frontend/src/components/compare/CompareOverlay.tsx`
**Props**: `{ simulations: CompareSim[]; settings: ViewerSettings }`
**Behavior**:
- Single Three.js `Canvas`.
- For each sim: already-nm-scaled coords (from `CompareSim.coords`), mass-weighted CoM computed client-side, translated to origin, rendered via `<Particles uniformColor={sim.color} />`.
- Shared `OrbitControls` (one instance). Camera auto-framed from the union of all sims' bounding spheres.
- `<CompareLegend />` overlay (top-right): coloured swatch + sim name per entry.

### Component 7: CompareMetricsTable.tsx — NEW
**Location**: `frontend/src/components/compare/CompareMetricsTable.tsx`
**Props**: `{ simulations: CompareSim[] }`
**Behavior**:
- Sticky-header table, sims as columns, metrics as rows.
- Header cells: `<span className="color-dot" style={{backgroundColor: sim.color}}/>` + truncated sim name + algorithm badge.
- Rows: Fractal Dimension, Prefactor (kf), Radius of Gyration (nm) via `sim.metrics.radius_of_gyration * sim.scaleFactorNm`, N particles, Algorithm, Porosity (if present).
- Missing metric → em-dash.

### Component 8: CompareSettingsPanel.tsx — NEW
**Location**: `frontend/src/components/compare/CompareSettingsPanel.tsx`
**Props**:
```ts
{
  mode: "grid" | "overlay"
  onToggleMode: () => void
  sync: boolean
  onToggleSync: () => void
  // viewer settings forwarded to useViewerStore setters
}
```
**Behavior**: single panel (mirrors single-sim `ViewerControls` but without per-axis toggles that make no sense in Compare). Mode segmented control + sync checkbox at the top; below it the shared `showAxes`, `background`, `particleOpacity`, `showGrid`, `useOrthographic` read from `useViewerStore` and dispatch to it.

### Component 9: RgEvolutionChart.tsx — MODIFIED
**Location**: `frontend/src/components/charts/RgEvolutionChart.tsx:10-20`
**Change**: accept either the existing `{rgEvolution, parameters}` single-series signature **or** a new `series` prop:
```ts
type RgSeries = {
  label: string
  color: string
  rgEvolution: number[]
  parameters?: Record<string, unknown>
}
type RgEvolutionChartProps =
  | { rgEvolution: number[]; parameters?: Record<string, unknown>; className?: string }
  | { series: RgSeries[]; className?: string }
```
When `series` is provided, emit one Plotly trace per series (`line.color = series.color`, `name = series.label`), show legend. Sims without `rgEvolution` are omitted from the traces; a tooltip note lists them under the legend. Single-series call sites remain unchanged.

### Component 10: compare/page.tsx — NEW
**Location**: `frontend/src/app/projects/[id]/compare/page.tsx`
**Behavior**:
- Read `searchParams.sims` via `parseCompareSimsParam`; truncate beyond 9 (with non-dismissible warning banner).
- Parallel fetches: one `useSimulation(id, simId)` + one `useSimulationGeometry(simId, true)` per id, composed into `CompareSim[]` with `getScaleFactorNm(parameters)` applied to coords and radii.
- Per-sim failure (404/403/geometry missing) → skip sim, append to `missingSims`, render warning banner listing failed IDs.
- Wrap render tree in `<CompareCameraProvider>`.
- Layout: breadcrumb → `<CompareSettingsPanel>` → (`<CompareGrid>` | `<CompareOverlay>`) → `<CompareMetricsTable>` → `<RgEvolutionChart series={...}>` .

### Component 11: projects/[id]/page.tsx — MODIFIED
**Location**: `frontend/src/app/projects/[id]/page.tsx:229-261, 282-386`
**Change**:
- Add `useState<Set<string>>(new Set())` for selected ids. Clear on `refetch()` after deletions.
- Inject a `<Checkbox>` at the left of each simulation row, inside the `<Link>` wrapper but with `onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(sim.id) }}` — same pattern as the existing Delete button at lines 355-378.
- Add a "Compare (N)" button next to "Delete All" (line 251), visible only when `selectedIds.size >= 2`. Disabled with tooltip `Max 9 sims` when `size > 9`. On click: `router.push(`/projects/${id}/compare?sims=${[...selectedIds].join(',')}`)`.

### Component 12: compare-utils.ts — NEW
**Location**: `frontend/src/lib/compare-utils.ts`
**Functions**:
```ts
parseCompareSimsParam(raw: string | string[] | null): {
  ids: string[]
  truncated: boolean   // true when > 9 ids were supplied
}
// Splits on comma, trims, drops empties, dedupes (preserve order), caps at 9.

getCompareColorPalette(n: number): string[]
// Returns first n colors from the Tableau10 palette (see below).

getCompareGridLayout(n: number): { cols: number; rows: number }
// 2→(2,1), 3→(3,1), 4→(2,2), 5→(3,2), 6→(3,2), 7..9→(3,3)

assignColorsByIdOrder(ids: string[]): Record<string, string>
// Sort ids lexicographically and assign palette[i] → stable across refreshes.
```

## Data flow

```
ProjectPage[checkboxes] ──▶ router.push('/projects/X/compare?sims=A,B,C')
                                        │
                                        ▼
                          compare/page.tsx (reads searchParams)
                                        │
                         parseCompareSimsParam → ids=[A,B,C]
                                        │
                 React Query parallel:  ├── useSimulation(X,A)  + useSimulationGeometry(A)
                                        ├── useSimulation(X,B)  + useSimulationGeometry(B)
                                        └── useSimulation(X,C)  + useSimulationGeometry(C)
                                        │
                         combine → CompareSim[]  (nm-scaled coords/radii, color, metrics)
                                        │
                         <CompareCameraProvider>  (shared camera state)
                                        │
      ┌─────────────────────────────────┼────────────────────────────────┐
      ▼                                 ▼                                ▼
 CompareSettingsPanel          CompareGrid | CompareOverlay    CompareMetricsTable
 (writes useViewerStore)                    │                  RgEvolutionChart(series=...)
                                   (reads useCompareCamera)
```

## Data shapes

```ts
interface CompareSim {
  id: string
  name: string                        // sim.algorithm + short id, or parameters.label if present
  algorithm: string
  coords: number[][]                  // (N, 3), nm-scaled
  radii: number[]                     // (N,), nm-scaled
  metrics: {
    fractal_dimension: number | null
    prefactor: number | null
    radius_of_gyration: number | null // engine units; display = × scaleFactorNm
    n_particles: number
    porosity?: number | null
    rg_evolution?: number[]           // engine units (RgEvolutionChart multiplies by scale)
  }
  parameters: Record<string, unknown>
  scaleFactorNm: number               // from getScaleFactorNm(parameters)
  color: string                       // assigned by assignColorsByIdOrder
}

interface ViewerSettings {
  sphereResolution: "low" | "medium" | "high"   // maps to sphereGeometry segments 16/24/32
  showAxes: boolean
  background: BackgroundPreset                   // reused from viewerStore
  particleOpacity: number
  useOrthographic: boolean
}
```

## Color palette

Use `d3-scale-chromatic` `schemeTableau10`:
```
["#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F",
 "#EDC948","#B07AA1","#FF9DA7","#9C755F"]
```
Assignment: sort sim ids lexicographically → `palette[i]`. Stable across refreshes, independent of URL order. If `d3-scale-chromatic` is not yet in `package.json`, inline the 9-colour literal in `compare-utils.ts` to avoid adding a dep for one array.

## Overlay CoM alignment

Each sim's coords (already nm-scaled) are mean-centred so that mass-weighted CoM = (0,0,0) before entering the shared scene. This reuses the same centering logic already present in `AgglomerateViewer.tsx:170-182`. More sophisticated alignment (inertia-axis rotation, ring placement) is deferred — per proposal §"Out of Scope".

## Missing sim UX

Non-dismissible warning banner at the top of the Compare page listing failed ids and their failure reason (`not_found | forbidden | no_geometry | still_processing`). Rendering proceeds with the surviving sims. Empty state ("No simulations to compare") only when **all** requested sims fail or `ids.length === 0` after parsing.

## Edge cases

- `ids.length === 0` after parsing (URL had only invalid ids) → empty state.
- Sim geometry with zero particles → render empty cell with "No geometry data" note (matches existing `AgglomerateViewer` empty branch at `:203-212`).
- Sim where `useSimulation` returns but `useSimulationGeometry` fails → treat as missing.
- Mobile viewport (`width < 768px`) → force `N <= 4` layout (1 column stacked) with a banner note; `>4` sims keep data but overflow with `overflow-x-auto`.
- Sim status `"queued" | "running"` → skip with banner note "Still processing".
- One sim uses legacy v1 schema, another v2 → each `getScaleFactorNm` is computed independently → overlay alignment is correct because both are in nm before entering the scene.

## Testing strategy

### Unit tests (Vitest + RTL)
- `compare-utils.parseCompareSimsParam`: valid csv, empty, >9 (truncated flag), whitespace, duplicates.
- `compare-utils.getCompareGridLayout`: N ∈ {2,3,4,5,6,7,8,9}.
- `compare-utils.assignColorsByIdOrder`: stable under input permutation.
- `Particles` with `uniformColor` prop applied and `colorMode='uniform'`.
- `viewerStore` scoped `cameraAngles`: two scopes don't overwrite each other.

### Component tests
- `CompareCameraProvider` broadcasts state to consumers, debounced at ~16 ms.
- `CompareGrid` renders correct layout for N ∈ {2, 4, 9}.
- `CompareOverlay` centres each aggregate at (0,0,0) before placement (snapshot on transform matrices).
- `CompareMetricsTable` renders coloured header dots and correct row values (incl. nm scaling).
- `CompareSettingsPanel` toggles `useViewerStore` fields and propagates `onToggleMode` / `onToggleSync`.

### Integration tests (mocked API)
- Compare page with 3 valid sim ids → grid of 3.
- Compare page with 1 missing → banner + grid of 2.
- Compare page with all missing → empty state.
- Cap enforcement: URL with 15 ids → 9 rendered + warning banner.
- Overlay mode: legend lists all sims; toggling back to grid restores per-cell viewers.

### Manual acceptance
- Open Compare with 9 sims, rotate one viewer, all follow (sync on).
- Toggle sync off, rotate one, others stay.
- Toggle Overlay, confirm aggregates merge with distinct colours.
- Change sphere resolution in settings panel, confirm all viewers update.
- Navigate to single-sim detail page, confirm camera Az/El display works as before (no regression from the store-scoping change).

## Open questions for TASKS

- Sphere resolution control: reuse existing `useViewerStore` values or introduce a new `sphereResolution` setting? (lean: keep using the implicit `32` and add the enum as a follow-up).
- Colour-blind palette option? — deferred, not in initial scope.
- Persist compare session state in localStorage? — no, URL is the source of truth.
