# Exploration: contacts-graph-viz

> Replace NeighborGraph list-based topology component with a real force-directed graph using vis-network.

## A. vis-network Compatibility with Next.js (SSR)

### The Problem
vis-network creates a `<canvas>` element inside a DOM `<div>` container. It accesses `window`, `document`, and `HTMLCanvasElement` at module-import time (via vis-data internals). In a Next.js SSR pass, none of these exist — importing `vis-network` at the top level crashes the server render.

### Recommended Pattern
**`'use client'` + `next/dynamic` with `ssr: false` is NOT needed.** The existing `NeighborGraph.tsx` already has `'use client'` (line 1). The key is to **lazy-import vis-network inside a `useEffect`** so the import only runs in the browser:

```tsx
// NeighborGraph.tsx — already 'use client'
import { useRef, useEffect } from 'react'

export function NeighborGraph({ data, ... }: NeighborGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<any>(null) // vis.Network instance

  useEffect(() => {
    if (!data || !containerRef.current) return

    // Dynamic import — only runs client-side
    import('vis-network/standalone').then(({ Network }) => {
      const nodes = data.nodes.map(n => ({ id: n.id, label: `${n.id}`, ... }))
      const edges = data.edges.map(e => ({ from: e.source, to: e.target }))
      networkRef.current = new Network(containerRef.current!, { nodes, edges }, options)
    })

    return () => { networkRef.current?.destroy() }
  }, [data])

  return <div ref={containerRef} style={{ height: 500 }} />
}
```

**Why this works**: `'use client'` makes React render this component only on the client, but Next.js still evaluates top-level imports during SSR module resolution. A dynamic `import()` inside `useEffect` guarantees the module is only loaded in the browser.

**Alternative**: `next/dynamic` with `ssr: false` wrapping the whole component. This works but adds an unnecessary wrapper layer since we only need to defer the `vis-network` import, not the entire React component (the stats banner, loading states, etc. can render SSR-safe).

### Package Details
- **Package**: `vis-network` v10.0.3 (published May 2026, actively maintained)
- **Import path**: `vis-network/standalone` (bundles vis-data + vis-network together, ~600KB minified / ~170KB gzipped based on historical measurements; bundlephobia was down during investigation)
- **Peer dependencies**: None when using `/standalone`
- **No React wrapper needed**: There is no well-maintained React wrapper. The `useRef` + `useEffect` pattern is standard for canvas-based libraries in React (same pattern used by Three.js before react-three-fiber, Plotly before react-plotly.js, etc.)

### Existing Dependencies Context
From `frontend/package.json`:
- Already includes `plotly.js` (~3MB minified), `three` (~1.2MB), `@react-three/fiber`, `@react-three/drei`
- Adding vis-network (~600KB) is proportionally small relative to what's already shipped
- The app already handles heavy canvas/WebGL deps — vis-network is lighter than Three.js

## B. Existing NeighborGraph Component Analysis

### File: `frontend/src/components/topology/NeighborGraph.tsx` (209 lines)

**Props interface** (lines 11-15):
```ts
interface NeighborGraphProps {
  data: NeighborGraphData | null
  isLoading: boolean
  onExportAdjacency?: () => void  // ← optional, never passed by caller
}
```

**What it renders** (4 sections):

1. **Stats Banner** (lines 93-112): 4-cell grid showing:
   - `n_particles` (particle count)
   - `n_edges` (connection count)
   - `avg_coordination` (average neighbors, 2 decimal places)
   - `is_connected` (badge: "Connected" / "Disconnected")

2. **Coordination Distribution** (lines 114-131): Pill badges showing `coordination: count` pairs, sorted ascending. Derived via `useMemo` (lines 21-30).

3. **Particle Explorer** (lines 133-151): Scrollable grid of small buttons, one per node. Clicking selects/deselects a node. Max-height 128px with overflow-y scroll.

4. **Particle Details Panel** (lines 155-205): Conditional panel shown when `selectedNode !== null`. Displays:
   - Position `(x, y, z)` — 2 decimals
   - Radius — 3 decimals
   - Coordination number
   - Distance from CDG — 2 decimals
   - Neighbor buttons (clickable, sets `selectedNode` to that neighbor)

**State**: Single `useState<number | null>` for `selectedNode` (line 18).

**Data shapes** (`frontend/src/lib/types.ts` lines 352-380):
```ts
NeighborGraphNode { id, x, y, z, radius, coordination, distance_from_cdg }
NeighborGraphEdge { source, target }  // both 1-based particle IDs
NeighborGraphStats { n_particles, n_edges, avg_coordination, max_coordination, min_coordination, is_connected }
NeighborGraphData { nodes, edges, stats }
```

### `onExportAdjacency` Status
- Declared optional in props (line 14)
- Renders a Download button when truthy (lines 83-88)
- **Never passed** at the call site in `page.tsx` line 696-699:
  ```tsx
  <NeighborGraph data={neighborGraph ?? null} isLoading={isGraphLoading} />
  ```
- **No references elsewhere** in the codebase (grep found it only in NeighborGraph.tsx itself)
- Verdict: Dead code. Keep the prop in the interface for future use, but don't wire it up in this cycle.

### Use Site: `page.tsx` lines 57-61, 694-700
- Hook call: `useNeighborGraph(id, simId, simulation?.status === 'completed')` — only fetches when sim is completed
- Mounting: Simple `<NeighborGraph data={neighborGraph ?? null} isLoading={isGraphLoading} />` inside a `<div className="mb-8">`
- No event callbacks wired (no onSelect, no onExport)

### API Endpoint
`GET /projects/{projectId}/simulations/{simId}/neighbor-graph/` → returns `NeighborGraphData` (file: `frontend/src/lib/api.ts` line 551-554).

## C. Performance Expectations

### Typical Simulation Sizes
- **Particles (N)**: 100 to 1000 (most runs: 200-500)
- **Edges**: up to ~5000 for densely-connected aggregates (high coordination avg ~6)
- **Sparse aggregates** (Df < 2, ramified): ~2-3 edges per node → ~300-1500 edges for N=100-500

### vis-network Performance Characteristics
- **Barnes-Hut O(N log N)**: Handles 1000 nodes + 5000 edges smoothly. Stabilization in ~1-3 seconds.
- **Soft limit**: ~5000 nodes before noticeable lag. We're well under this.
- **Canvas renderer**: vis-network uses HTML Canvas (not SVG), which is faster for large node counts.

### Recommendation
- **N ≤ 1000**: Render directly, no special handling needed.
- **N > 1000** (future-proofing): Show a warning banner: "Large aggregate — graph rendering may be slow" and optionally disable physics after initial stabilization (`network.setOptions({ physics: false })`).
- After stabilization completes (`stabilized` event), **always** disable physics to prevent CPU drain from idle simulation ticks. This is a standard vis-network pattern.

## D. Color/Sizing Strategy

### Recommended: Color by Coordination Number (Discrete Palette)

Map coordination number → color using a discrete palette. This directly replaces the information currently shown by the "Coordination Distribution" pills.

| Coordination | Color | Hex | Meaning |
|:---:|:---:|:---:|:---|
| 0 | Gray | `#9ca3af` | Isolated (no contacts) |
| 1 | Red | `#ef4444` | Terminal (end of chain) |
| 2 | Orange | `#f97316` | Chain link |
| 3 | Amber | `#f59e0b` | Branching point |
| 4 | Yellow | `#eab308` | Moderate connectivity |
| 5 | Lime | `#84cc16` | Well-connected |
| 6 | Green | `#22c55e` | Highly connected |
| 7+ | Blue | `#3b82f6` | Very dense |

**Implementation with vis-network**:
```ts
const COORD_COLORS: Record<number, string> = {
  0: '#9ca3af', 1: '#ef4444', 2: '#f97316', 3: '#f59e0b',
  4: '#eab308', 5: '#84cc16', 6: '#22c55e', 7: '#3b82f6',
}

const getNodeColor = (coord: number) =>
  COORD_COLORS[Math.min(coord, 7)] ?? COORD_COLORS[7]

// In node mapping:
nodes.map(n => ({
  id: n.id,
  label: `${n.id}`,
  color: { background: getNodeColor(n.coordination), border: getNodeColor(n.coordination) },
  size: 8 + n.coordination * 2,  // 8px base + 2px per neighbor
}))
```

### Node Sizing
- **Base size**: 8px (for coord=0 isolated particles)
- **Scaling**: +2px per coordination number → coord=6 gets 20px
- This gives subtle but visible size difference without dominating the layout
- vis-network's `scaling.min` / `scaling.max` can also be used with the `value` property for automatic scaling

### Why Not Size-Only or Color-Only
- Color-only: Hard to see small color differences in a dense graph
- Size-only: Large nodes occlude neighbors
- **Both together** reinforce the same information through two visual channels (preattentive processing principle)

## E. Layout Algorithm Recommendation

### Default: `barnesHut` Solver

vis-network's default solver. Best for our use case because:

1. **O(N log N)** — efficient for N ≤ 1000
2. **Handles both ramified and compact aggregates** naturally:
   - Ramified (Df < 2): Long chains spread out, tree-like structures emerge
   - Compact (Df > 2): Dense blobs compress into clusters
3. **Well-tested**: Most vis-network users use Barnes-Hut. It's the default for a reason.

### Recommended Parameters (Tuned for Aggregates)

```ts
const physicsOptions = {
  physics: {
    solver: 'barnesHut',
    barnesHut: {
      gravitationalConstant: -3000,  // stronger repulsion → spread ramified chains
      centralGravity: 0.1,           // mild pull to center → prevents drift
      springLength: 60,              // short springs → connected particles stay close
      springConstant: 0.08,          // moderate stiffness
      damping: 0.12,                 // slightly higher damping → faster stabilization
      avoidOverlap: 0.5,             // prevent node overlap
    },
    stabilization: {
      enabled: true,
      iterations: 500,               // enough for N≤1000
      updateInterval: 50,
    },
    maxVelocity: 30,
  },
}
```

### Why Not ForceAtlas2Based?
- ForceAtlas2Based is better for very large graphs (N > 5000) and community detection
- For N ≤ 1000 with physical-contact-based edges, Barnes-Hut gives more natural "physical" layouts
- ForceAtlas2Based produces tighter clusters which might look strange for chain-like aggregates

### Why Not Hierarchical?
- Aggregates don't have a meaningful hierarchy (they're contact networks, not trees)
- Would force an artificial layout direction

### Post-Stabilization Freeze
After the `stabilized` event fires, disable physics:
```ts
network.on('stabilized', () => {
  network.setOptions({ physics: false })
})
```
This prevents CPU drain and makes manual node dragging feel snappy (dragged node stays put).

## F. Click and Hover Interactions

### vis-network Events to Use

| Event | When | Action |
|:---|:---|:---|
| `click` | Left-click on node | Emit node ID → parent opens detail panel |
| `click` (empty) | Left-click on canvas | Deselect → close detail panel |
| `hoverNode` | Mouse enters node | Highlight node + connected edges (built-in with `interaction.hover: true`) |
| `blurNode` | Mouse leaves node | Remove highlight (automatic) |
| `doubleClick` | Double-click on node | `network.focus(nodeId, { scale: 1.5, animation: true })` |
| `stabilized` | Physics converges | Disable physics, enable user dragging |

### Required `interaction` Options
```ts
interaction: {
  hover: true,           // enables hoverNode/blurNode events
  tooltipDelay: 200,     // tooltip after 200ms hover
  navigationButtons: false, // we'll add our own or skip
  keyboard: false,        // no keyboard navigation needed
}
```

### Component API (Props to Add)
```ts
interface NeighborGraphProps {
  data: NeighborGraphData | null
  isLoading: boolean
  onExportAdjacency?: () => void
  onNodeSelect?: (nodeId: number | null) => void  // NEW: for future use
}
```

For this cycle: keep selection **internal** (same as current `useState<number | null>`). The detail panel renders below the graph inside the same component. If we later want to emit selection to the parent (e.g., for cross-component highlighting in the 3D viewer), the `onNodeSelect` prop is ready.

## G. Node Detail Panel Layout

### Current Behavior (lines 155-205)
Shows below the explorer grid: position, radius, coordination, distance from CDG, clickable neighbor buttons.

### Recommended Layout for New Component

**Option 1 (Recommended): Inline panel below the graph**
```
┌─────────────────────────────────────────┐
│  Stats: [N particles] [N edges] [avg]   │  ← Keep existing stats banner
├─────────────────────────────────────────┤
│                                         │
│          ┌─ vis-network canvas ──┐      │
│          │                       │      │
│          │   (force-directed     │      │  ← 400-500px height
│          │    graph here)        │      │
│          │                       │      │
│          └───────────────────────┘      │
│                                         │
├─────────────────────────────────────────┤
│  Particle #42 Details                   │  ← Shown on click, same info as today
│  Position: (1.23, 4.56, 7.89)          │
│  Radius: 0.500  Coord: 4               │
│  Neighbors: [#12] [#15] [#23] [#38]    │  ← Clicking focuses graph on that node
└─────────────────────────────────────────┘
```

**Why inline and not a side panel**:
- The page already has a single-column layout for this section (`<div className="mb-8">`)
- Adding a side panel requires responsive layout changes (two-column on wide, stacked on narrow)
- The current detail panel is small (5-6 lines of info) — doesn't justify a persistent sidebar
- Inline below is the simplest migration with zero layout changes to `page.tsx`

**Enhancement for later**: On screens ≥ 1280px, position the detail panel as an overlay card at the bottom-right of the graph canvas (absolute positioning inside a relative container). This gives a "picture-in-picture" feel without requiring layout restructuring.

## H. Test Strategy

### The Challenge
vis-network requires a real `<canvas>` element. `jsdom` (used by vitest) has no canvas implementation. The `Network` constructor will fail in a jsdom environment.

### Recommended Strategy

**1. Unit-test the data transformation (PURE functions)**
- Transform `NeighborGraphData` → vis-network `{ nodes: DataSet, edges: DataSet }`
- Test coordination→color mapping
- Test coordination→size mapping
- Test edge `{source, target}` → `{from, to}` mapping
- **These are pure functions, no DOM needed**

**2. Mock vis-network for component integration tests**
```ts
// __mocks__/vis-network.ts
export class Network {
  constructor(container: HTMLElement, data: any, options: any) {}
  on(event: string, callback: Function) {}
  off(event: string, callback?: Function) {}
  destroy() {}
  fit() {}
  focus(nodeId: string | number) {}
  setOptions(options: any) {}
}
```
Then test that:
- Component renders the stats banner with correct numbers
- Component renders the detail panel when `selectedNode` is set
- Component calls `Network` constructor with correct data
- Component calls `destroy()` on unmount

**3. Skip visual rendering tests entirely**
- Don't try to test canvas output
- Don't try to test node positions after physics stabilization
- These are vis-network's responsibility, not ours

### Test File Recommendation
```
frontend/src/components/topology/__tests__/
  NeighborGraph.test.tsx         — component rendering + mock Network
  transformGraphData.test.ts     — pure data transformation functions
```

## I. Migration Path

### Approach: In-Place Replacement (Same Component Name, Same Props)

**Keep**:
- Component name: `NeighborGraph`
- Export from: `frontend/src/components/topology/index.ts` (unchanged)
- Props interface: `NeighborGraphProps` (add optional `onNodeSelect`, keep everything else)
- `page.tsx` call site: **Zero changes needed**

**Replace**:
- The entire component body — list/pills/explorer → canvas graph + detail panel
- Remove `coordinationDistribution` useMemo (the graph itself IS the distribution)
- Remove `selectedNodeNeighbors` useMemo (neighbors are visible as connected edges in the graph; detail panel can still compute this)

**Add**:
- `useRef<HTMLDivElement>` for canvas container
- `useRef<Network>` for vis-network instance
- `useEffect` with dynamic `import('vis-network/standalone')`
- Cleanup: `network.destroy()` on unmount or data change
- Optional: extract `transformGraphData()` utility for testability

### New File Structure
```
frontend/src/components/topology/
  NeighborGraph.tsx       ← rewrite (same name, same export)
  index.ts                ← unchanged
  graphUtils.ts           ← NEW: transformGraphData(), color palette, physics config
  __tests__/
    NeighborGraph.test.tsx
    graphUtils.test.ts
```

### Migration Steps (for tasks phase)
1. Create `graphUtils.ts` with pure functions (color, sizing, data transform)
2. Write tests for `graphUtils.ts`
3. Rewrite `NeighborGraph.tsx` body (keep shell: Card, CardHeader, loading/empty states)
4. Test component with mocked Network
5. Manual smoke test in browser

## Open Questions (for Proposal Phase)

| # | Question | Default Recommendation |
|:---|:---|:---|
| 1 | Wire up `onExportAdjacency` in this cycle? | **No** — defer. Dead code today, keep prop for future. |
| 2 | Add explicit zoom buttons (+/-/reset)? | **No** — vis-network has scroll-to-zoom + double-click-to-focus. Buttons add UI clutter for power users who already have mouse/trackpad. |
| 3 | Empty state: N=1 (single particle, no edges)? | Show the single node centered. Stats banner shows "0 Connections". No special handling needed — vis-network handles it. |
| 4 | Disconnected aggregate (multiple components)? | `is_connected: false` badge already exists in stats. Force-directed layout naturally separates disconnected components into distinct visual clusters. |
| 5 | Mobile UX (graph on small screens)? | Graph gets full width, detail panel stacks below. Touch pinch-to-zoom works out of the box with vis-network. Acceptable for now. |
| 6 | Coordination legend? | **Yes, add a small legend** showing the color palette (coord→color) so users can read the graph without hovering. Small row of colored dots with labels. |

## Risks

1. **vis-network bundle size**: ~170KB gzipped is not trivial, but acceptable given existing Three.js + Plotly deps. Can be mitigated with lazy loading (dynamic import already planned).
2. **Canvas rendering in dark mode**: vis-network canvas background defaults to white. Must set `background: 'transparent'` in network options and let the Card's background show through — or explicitly set canvas bg to match Tailwind dark theme.
3. **vis-network is `standalone` import**: The `/standalone` path bundles vis-data. If we ever add vis-timeline or vis-graph3d, we'd want `vis-network/peer` + `vis-data` as shared dep. For now, standalone is simpler.
4. **Physics stabilization flash**: Users may see nodes "explode" from center and settle. Mitigate: stabilize off-screen (`hidden: true` on container) then reveal, OR show a brief "Laying out graph..." spinner during stabilization.

## Ready for Proposal

**Yes.** All investigation items (A–I) have concrete answers. The approach is clear:
- vis-network v10.0.3 via dynamic import inside useEffect
- Barnes-Hut solver with tuned parameters
- Color + size by coordination number
- In-place component replacement (same name, same props)
- Pure function extraction for testability
- Canvas mock strategy for vitest
