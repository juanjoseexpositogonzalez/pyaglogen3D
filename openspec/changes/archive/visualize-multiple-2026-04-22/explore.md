# Exploration: visualize-multiple

> Multi-aggregate simultaneous visualization on the project page. User selects 2+
> simulations and compares their 3D morphology + metrics + Rg evolution side-by-side
> or overlaid.

---

## 1. Executive summary

1. **Reusable viewer already exists.** `AgglomerateViewer` (`frontend/src/components/viewer3d/AgglomerateViewer.tsx:135`) is self-contained — takes `coordinates`, `radii`, optional `principalAxes` + `className` — so N instances in a CSS grid is feasible without a rewrite. It uses `@react-three/fiber` + `@react-three/drei` with `InstancedMesh` (32-segment spheres) and already scales coords upstream (the sim detail page multiplies by `getScaleFactorNm(parameters)` before passing them in — `simulations/[simId]/page.tsx:205-215`).
2. **Global Zustand store is the biggest blocker for grid mode.** `useViewerStore` (`stores/viewerStore.ts:86`) is a singleton persisted to localStorage — every `AgglomerateViewer` subscribes to the SAME `colorMode`, `background`, `autoRotate`, `useOrthographic`, `showGrid`, etc. Mounting N viewers today means toggling "show axes" flips it on ALL of them simultaneously. For grid comparison that's actually the desired behavior (synchronized settings), but camera angle (`setCameraAngles`) is also written to the global store from inside the `CameraTracker` component (line 53-86) → N viewers fighting over one slot on every frame. This MUST be addressed.
3. **No bulk-geometry endpoint.** The backend exposes `GET /api/v1/simulations/{id}/geometry/` only (`backend/apps/simulations/views.py:477`). Response is binary `.npy` (float64 (N,4) = x,y,z,r). Parsed client-side in `simulationsApi.getGeometry` (`frontend/src/lib/api.ts:277-319`). For N=10 with 10k particles we're looking at ~3.2 MB × 10 = 32 MB over N parallel requests. Already cached in React Query with `staleTime: Infinity` so re-selection is free.
4. **Per-sim scale factors differ.** Every simulation carries its own `primary_particle_diameter_nm` in `parameters`. Engine coords are dimensionless; the sim detail page scales at read (`coords × scaleFactor`). When rendering N sims together, each must be scaled independently BEFORE entering the shared scene — so overlay mode works correctly with heterogeneous `dpo` (e.g. validation: imported aggregate with dpo=30 nm vs simulated with dpo=25 nm both render at true nm).
5. **Charts library is Plotly (not Recharts).** `FractalPlot` (`charts/FractalPlot.tsx:103`) and `RgEvolutionChart` (`charts/RgEvolutionChart.tsx:20`) both use `react-plotly.js`. Plotly's `data` prop is an array of traces — multi-series overlay is trivial (push one trace per simulation). No extension work beyond wiring.

---

## 2. Current 3D architecture

### Stack
- `three@^0.160` + `@react-three/fiber` + `@react-three/drei`
- Single `Canvas` per viewer instance
- `InstancedMesh` with 32×32 sphere geometry + `meshPhongMaterial` (`Particles.tsx:119-136`)
- `OrbitControls` from drei, `GizmoHelper` for axes, `Grid` for floor, `Line` for principal axes

### Performance characteristics
- Instanced rendering → one draw call regardless of particle count
- 32×32 sphere segments is heavier than it needs to be for a multi-panel view; probably fine up to ~5k particles per instance
- `frustumCulled={false}` on the InstancedMesh → everything rendered every frame
- Camera positioning auto-frames based on bounding sphere (`maxDist × 3`, `AgglomerateViewer.tsx:194`)

### Centering
Each viewer centers its own coords on mount (`useMemo` at line 161). Good — means overlay mode can place different aggregates at different origins without fighting.

### Global store coupling (THE problem for grid)
`AgglomerateViewer` destructures 8 fields from `useViewerStore`:
- `colorMode`, `showAxes`, `showGrid`, `showBoundingSphere`, `showPrincipalAxes`, `useOrthographic`, `autoRotate`, `rotateSpeed`, `particleOpacity`, `background`
- Plus **writes** `cameraAzimuth/Elevation` every frame via `CameraTracker`

For grid mode this is mixed:
- **Good**: one "Show grid" toggle applies to all → users expect this
- **Bad**: camera tracker write-race — N viewers writing their angle to one store slot every frame → undefined which sim "owns" the Az/El display

### Orthographic re-mount gotcha
Canvas uses `key={useOrthographic ? 'ortho' : 'perspective'}` (line 220) to force re-mount on camera type change. With N canvases this is N full scene teardowns per toggle — manageable but worth knowing.

---

## 3. Data fetching

### Endpoint
`GET /api/v1/simulations/{simId}/geometry/` → binary `.npy` v1/v2 header + `Float64Array` of shape `(N, 4)`.

### Client parser
`simulationsApi.getGeometry` parses the `.npy` header on the client, returns `{ coordinates: number[][], radii: number[] }`. The reshape allocates new JS arrays (not typed) — for N=10 × 10k particles that's 10 × 10k = 100k `number[3]` allocations. Not cheap but one-shot.

### Caching
`useSimulationGeometry` hook (`useSimulations.ts:56-63`) uses React Query with `staleTime: Infinity`. **Re-selection in a grid is free** — already-loaded sims are served from cache.

### Bulk fetch
No bulk endpoint. N parallel `useQuery` calls work fine (React Query dedupes and runs in parallel). With HTTP/2 (Django + nginx behind fly.io) parallel downloads are cheap.

### Size budget
~32 bytes per particle (3 coords + 1 radius × 8 bytes) + `.npy` header ≈ 320 KB per 10k-particle sim. 10 sims × 10k = 3.2 MB total — under 5s on 10 Mbps connection. **Feasible up to ~20 sims of 10k particles each before it feels slow.**

---

## 4. UI entry point — project page

### Current rendering
`app/projects/[id]/page.tsx:282-386` renders each sim as a `<Link><Card>…</Card></Link>` in a `grid gap-4` (one column). Each card wraps the whole row in a link → clicking anywhere navigates to detail.

### How to fit checkboxes
The link-wrap is the problem: a checkbox click must NOT navigate. Two non-intrusive options:
- **A**: Keep the Link, add `<Checkbox onClick={e => { e.preventDefault(); e.stopPropagation(); ... }}>` inside, mirroring the existing pattern used by the Delete button at lines 355-378.
- **B**: Replace the outer Link with a `<Card>` + onClick, and render a separate "Open" icon-button. More invasive.

Recommend **A** — matches the existing e.preventDefault()/stopPropagation() pattern.

### "Compare" button placement
Options:
- **Top of list, next to "Delete All" at line 251** — appears only when `selectedIds.size >= 2`. This is where users already look for batch actions.
- **Sticky footer bar** — overkill for a secondary action.

Recommend **next to Delete All**, visible only when `selectedIds.size >= 2`. Text: `Compare (${selectedIds.size})`.

### Selection persistence
Not needed across navigation. A local `useState<Set<string>>` in the project page is enough.

### Navigation
Clicking Compare navigates to a new route — suggest `/projects/{id}/compare?sims={id1},{id2},...`. URL-driven so users can bookmark/share comparisons.

---

## 5. Layout strategies

Given Q1 use cases (same-Df-different-seed, imported-vs-simulated, batch-sweep):

### Option A: Grid mode
N `AgglomerateViewer` instances in a CSS grid (1×2, 2×2, 2×3, 3×3 depending on N).
- **Pros**: each sim has own camera, own zoom, minimal scene complexity per canvas, bounding sphere per sim works correctly, no scale-normalization headaches, mobile-degradable to 1 column
- **Cons**: N WebGL contexts is expensive — most browsers cap at ~16. No visual superposition (hard to see subtle morphology differences)
- **Best for**: **seed-study** (Q1.i) — multiple realizations of same target Df, user wants to see the variance
- **Best for**: **batch parameter sweep** (Q1.iii) — grid lets user eyeball trends across a 2D parameter space

### Option B: Overlay mode
Single `Canvas`, N aggregates rendered in one scene at different origins (or same origin with transparency) + distinct colors per sim.
- **Pros**: one WebGL context, direct visual comparison of shape/extent, great for showing "same Df ≠ same morphology"
- **Cons**: needs scale-normalization (all coords in nm before adding to scene), needs a color-legend overlay, camera framing must include ALL sims' bounding spheres, overlap makes N>4 visually noisy
- **Best for**: **validation** (Q1.ii, imported vs simulated) — two aggregates in contrasting colors, user sees the shape match/mismatch
- **Best for**: **small N** (2-4 sims) where visual overlay is actually readable

### Option C: Grid with synchronized cameras
N canvases, but a shared OrbitControls state — rotating one rotates all. Implementation: lift the camera state into React, pass `camera.position` + `controls.target` as props, write to it on `onChange` from the "master" panel.
- **Pros**: precise side-by-side comparison of the same viewing angle, no overlay noise
- **Cons**: one more control component, N listeners to keep in sync, camera-zoom interpretation differs per sim (different sizes)
- **Best for**: **seed-study** (Q1.i) where user wants to confirm same-angle morphology

### Option D (recommendation): Hybrid — grid by default, overlay toggle
Start in grid mode with synchronized cameras (C). Add a "Overlay" switch at the top that merges all aggregates into one canvas (B).
- Covers all three Q1 use cases
- Users discover overlay when they want it, don't get it forced on them
- Synchronized cameras in grid solve the "rotate them all together" problem that every user will ask for

**Detailed recommendation per use case:**
| Use case | Default layout | User toggles to |
|---|---|---|
| Q1.i seed variance | Grid + sync cameras | Overlay (rarely) |
| Q1.ii validation | Grid + sync cameras | **Overlay** (common) |
| Q1.iii batch sweep | Grid + sync cameras | Grid only (never overlay with N>6) |

---

## 6. Metrics table + synchronized charts

### Metrics table
Columns = metrics (Df, Kf, Rg nm, N, Porosity, Anisotropy, Algorithm). Rows = simulations. Each row prefixed with a colored dot matching the sim's 3D color — so user visually pairs row ↔ aggregate.

Source: `simulation.metrics.*` + `simulation.parameters.n_particles` + `simulation.algorithm`. All available via the existing `useSimulation(projectId, simId)` hook.

Scale factor per-row: `simulation.metrics.radius_of_gyration * getScaleFactorNm(simulation.parameters)` — same pattern as `BatchResultsTable.tsx:248-255`.

### Synchronized Rg-evolution chart
`RgEvolutionChart` (`charts/RgEvolutionChart.tsx:20`) currently takes a single `rgEvolution: number[]` and plots one trace. Plotly accepts an array of traces trivially — extension path:

```
interface MultiRgEvolutionChartProps {
  series: Array<{
    label: string
    color: string
    rgEvolution: number[]
    parameters: Record<string, unknown>  // for scaleFactor
  }>
}
```

Each series → one `{ x, y, name, line.color }` trace, log-log axes stay the same, legend shows sim IDs/labels with their colors.

**FractalPlot overlay** is harder: the built-in regression-range sliders assume single-series data, and the fitted-line annotation shows one Df/Kf. Options:
- v1: only show multi-series on Rg-evolution; leave FractalPlot single-sim (launched from a row action).
- v2: new `MultiFractalPlot` that draws N data series + N fitted lines in different colors, shares ONE exclude-range slider.

Recommend **v1 for the initial change**. Multi-FractalPlot is a follow-up.

### Color assignment
Deterministic per selection order — `['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6','#ec4899','#eab308']` (Tailwind blue/green/amber/red/purple/teal/pink/yellow). Passed to both the 3D viewer (as `colorMode='uniform'` override + custom color) and the chart/table.

**Gotcha**: `Particles.tsx` currently hardcodes `0x4488ff` for the `uniform` color mode (line 95). For overlay, we need a per-instance uniform color — either add a `uniformColor` prop to `AgglomerateViewer`/`Particles` or add a new `colorMode='custom'` that takes a color prop.

---

## 7. Performance budget

| N sims | Geometry fetch | Render mode | GPU cost | Verdict |
|---|---|---|---|---|
| 2 | ~600 KB | Grid 1×2 or Overlay | Low | Effortless |
| 4 | ~1.2 MB | Grid 2×2 or Overlay | Med | Good |
| 6 | ~2 MB | Grid 2×3 | Med | Good |
| 9 | ~3 MB | Grid 3×3 | High | OK on desktop |
| 12 | ~4 MB | Grid 3×4 | Very high | WebGL context cap approaching |
| 16+ | >5 MB | Grid 4×4 | Breaks | **Cap at 12 sims** |

### Mobile
N canvases on mobile is brutal. Recommend:
- **N ≤ 4**: show grid on mobile (1 column)
- **N > 4**: show warning + force overlay mode, OR offer "Open on desktop" screen

### Initial suggestion: hard cap
- Free-for-all up to 9 sims
- Warning banner at 10-12 ("Performance may be slow")
- Reject 13+ (disable Compare button with tooltip)

### Memory
Each `AgglomerateViewer` Canvas has own WebGL context + scene + buffers. Rough estimate: ~30 MB GPU per viewer with 10k particles. 9 viewers ≈ 270 MB GPU. On mid-range laptops (Intel Iris ~1 GB VRAM) this is fine; on old integrated GPUs it'll slow but not crash.

---

## 8. Open questions for the user

Given Q1-Q4 are locked, only these remain:

1. **Cap on N**: hard-cap at 9 (grid 3×3, conservative) or 12 (grid 3×4, more generous)? Recommend 9 — keeps perf predictable and grid layouts clean.

2. **Synchronized cameras in grid — default on or opt-in toggle?** Default-on matches Q1.i/ii needs directly. Opt-in (via toggle at top of Compare page) is more conservative. Recommend **default-on with a "Unlink cameras" toggle**.

3. **Per-viewer OR global viewer settings?** Currently `useViewerStore` is shared. In Compare mode should `showGrid`, `background`, `colorMode` etc. apply to all viewers (shared) — OR should each viewer get its own settings panel? Recommend **shared** — it's what users want for comparison and avoids N settings panels. BUT camera Az/El writes must be disabled in Compare mode (pick one "primary" sim to track) to avoid the race described in §2.

---

## 9. Recommendations for PROPOSE

### Minimal scope (1-2 days)
- New route `/projects/[id]/compare?sims=<csv>`
- Grid-only layout with **synchronized cameras** (no overlay toggle)
- Metrics table below grid
- Single shared `RgEvolutionChart` with N series
- Checkboxes on project page + Compare button
- Hard cap N=9
- No FractalPlot overlay (single-sim only via existing links)
- Uses existing `AgglomerateViewer` with `className` sizing; adds `uniformColor` prop

**Ships the 3 Q1 use cases with a minimum-viable UX.**

### Medium scope (3-4 days, recommended)
Minimal + add:
- **Overlay mode toggle** (all aggregates in one canvas, color-coded)
- Color-legend overlay on the 3D scene
- "Unlink cameras" toggle for grid mode
- Export comparison as single image (grid screenshot)

### Full scope (1 week+)
Medium + add:
- `MultiFractalPlot` with N fitted lines + shared exclude-range
- Side-by-side comparison of detailed metrics (inertia tensor, coordination dist)
- URL state includes camera angle (shareable precise view)
- "Add sim" mid-flow (from Compare page, add another sim without re-navigating)

**Recommend MEDIUM scope.** Grid-only misses Q1.ii (validation) which is explicitly one of the three use cases — overlay is essential there. Full scope is polish.
