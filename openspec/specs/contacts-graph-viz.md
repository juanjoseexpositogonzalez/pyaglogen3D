<!-- Last sync: 2026-05-11 from change contacts-graph-viz -->

# contacts-graph-viz Specification

## Purpose

Force-directed 2D visualization of particle contact networks. Replaces the list-based `NeighborGraph.tsx` in-place with a vis-network canvas graph, preserving the existing component contract (name, props, export path) so `page.tsx` requires zero changes.

---

## Requirements

### Requirement: Component Contract

The system MUST export `NeighborGraph` from `frontend/src/components/topology/NeighborGraph.tsx` with the props interface `{ data: NeighborGraphData | null, isLoading: boolean, onExportAdjacency?: () => void }`.

#### Scenario: Props interface unchanged

- GIVEN `page.tsx` mounts `<NeighborGraph data={neighborGraph ?? null} isLoading={isGraphLoading} />`
- WHEN the component renders
- THEN it compiles without TypeScript errors and no changes to `page.tsx` are required

---

### Requirement: Stats Banner

The system MUST render a 4-card stats banner when `data` is non-null and `isLoading` is false, sourcing values from `data.stats`.

#### Scenario: Happy path — stats displayed

- GIVEN `data` is non-null and `isLoading` is false
- WHEN the component renders
- THEN it shows 4 stat cards: "Particles" (`data.stats.n_particles`), "Connections" (`data.stats.n_edges`), "Avg. Coordination" (`data.stats.avg_coordination.toFixed(2)`), and a "Connected"/"Disconnected" badge (`data.stats.is_connected`)

#### Scenario: Disconnected aggregate

- GIVEN `data.stats.is_connected === false`
- WHEN the banner renders
- THEN the badge shows "Disconnected" in destructive variant

---

### Requirement: Force-Directed Graph Rendering

The system MUST dynamically import `vis-network/standalone/esm/vis-network` inside `useEffect` and instantiate a `Network` in a `div` container with `height: 500px` and full width. On unmount, the `Network` instance MUST be destroyed.

#### Scenario: Graph mounts on data arrival

- GIVEN `data` is non-null and the container `div` is in the DOM
- WHEN the `useEffect` runs
- THEN `Network` is constructed with the container ref, vis-network node/edge datasets, and options; the canvas is visible

#### Scenario: Cleanup on unmount

- GIVEN a `Network` instance is active
- WHEN the component unmounts
- THEN `network.destroy()` is called exactly once; no post-unmount state updates occur

#### Scenario: Data change re-instantiates graph

- GIVEN the component has rendered with `data = A`
- WHEN `data` changes to `data = B`
- THEN the old Network is destroyed and a new Network is instantiated with the new data

---

### Requirement: Pure Data Transformation

The system MUST expose `buildVisNetworkData(data: NeighborGraphData): { nodes: VisNode[], edges: VisEdge[], options: VisOptions }` in `frontend/src/lib/graphUtils.ts`. This function MUST be pure (no DOM, no side effects).

#### Scenario: Node mapping — color and size

- GIVEN a node with `coordination = k` where `k ∈ {0…7+}`
- WHEN `buildVisNetworkData` is called
- THEN each output node has: `id = node.id`, `label = String(node.id)`, `color` from the discrete coordination palette, `size` clamped to `[12, 32]` px, `title` as a hover tooltip string

#### Scenario: Edge mapping

- GIVEN `data.edges` with `{ source, target }` pairs
- WHEN `buildVisNetworkData` is called
- THEN each output edge has `from = edge.source`, `to = edge.target` with default styling

#### Scenario: Empty edges array

- GIVEN `data.edges = []`
- WHEN `buildVisNetworkData` is called
- THEN the function returns successfully with an empty edges array; no error thrown

#### Scenario: Options include Barnes-Hut params

- WHEN `buildVisNetworkData` is called
- THEN `options.physics.solver === 'barnesHut'` with `gravitationalConstant: -3000`, `centralGravity: 0.1`, `springLength: 60`, `springConstant: 0.08`, `damping: 0.12`, `avoidOverlap: 0.5`

---

### Requirement: Color and Size Encoding

The system MUST encode coordination number via BOTH color AND size simultaneously. Color palette: `0→#9ca3af, 1→#ef4444, 2→#f97316, 3→#f59e0b, 4→#eab308, 5→#84cc16, 6→#22c55e, 7+→#3b82f6`. Size: linear from 12px (coord=0) to 32px (coord=8+), clamped.

#### Scenario: Minimum coordination

- GIVEN `coordination = 0`
- WHEN mapped
- THEN `color = '#9ca3af'` AND `size = 12`

#### Scenario: Maximum / overflow coordination

- GIVEN `coordination ≥ 8`
- WHEN mapped
- THEN `color = '#3b82f6'` AND `size = 32`

#### Scenario: Intermediate coordination

- GIVEN `coordination = 4`
- WHEN mapped
- THEN `color = '#eab308'` AND `size` is within `(12, 32)`

---

### Requirement: Node Click → Detail Panel

The system MUST maintain internal `selectedNode` state. Clicking a node sets `selectedNode` to that node's id and renders a detail panel below the graph.

#### Scenario: Click node — panel appears

- GIVEN the graph is rendered with non-null data
- WHEN the user clicks a node with id `N`
- THEN `selectedNode = N` AND the detail panel shows: position `(x, y, z)`, radius, coordination, distance from CDG, and clickable neighbor buttons

#### Scenario: Click neighbor button — focus and update

- GIVEN the detail panel is open for node `N` showing neighbor `M`
- WHEN user clicks the button for neighbor `M`
- THEN `network.focus(M)` is called AND the detail panel updates to show node `M`'s info

#### Scenario: Click same node again — deselect

- GIVEN `selectedNode = N`
- WHEN the user clicks node `N` again
- THEN `selectedNode = null` AND the detail panel disappears

#### Scenario: Click empty canvas — deselect

- GIVEN `selectedNode = N`
- WHEN user clicks the canvas with no node under cursor
- THEN `selectedNode = null` AND the detail panel disappears

---

### Requirement: Hover Interaction

The system MUST enable `interaction.hover: true` in vis-network options. Hover highlighting (node border, edge emphasis) is provided natively; no custom rendering needed.

#### Scenario: Hover highlights node

- GIVEN `interaction.hover: true` is set in options
- WHEN the user hovers a node
- THEN vis-network fires `hoverNode` and applies native highlight; connected edges are emphasized

#### Scenario: Cursor leaves — highlight clears

- WHEN cursor leaves the node
- THEN `blurNode` fires and native highlight is removed automatically

---

### Requirement: Loading State

The system MUST render a Card with a spinner (no graph) when `isLoading === true`, and MUST NOT instantiate vis-network.

#### Scenario: Loading shown

- GIVEN `isLoading === true`
- WHEN the component renders
- THEN only the loading Card with `<LoadingSpinner />` is shown; no `useEffect` mounts the Network

---

### Requirement: Empty / Null State

The system MUST render a "No topology data available" message (no graph) when `data === null` and `isLoading === false`.

#### Scenario: Null data

- GIVEN `data === null` AND `isLoading === false`
- WHEN the component renders
- THEN the Card shows "No topology data available"; no Network is instantiated

#### Scenario: Single-node aggregate (N=1, no edges)

- GIVEN `data.nodes.length === 1` AND `data.edges = []`
- WHEN the component renders
- THEN the graph renders the single node centered; stats banner shows 0 connections; no error is thrown

---

### Requirement: Stabilization Feedback

The system MUST show a spinner overlay on top of the canvas while the Barnes-Hut simulation is running, and remove it when vis-network emits `stabilizationIterationsDone`. If stabilization exceeds 5 seconds, the overlay MUST append "Settling… this may take a moment".

#### Scenario: Spinner visible during stabilization

- GIVEN data has just been loaded and the Network instantiated
- WHEN `stabilizationProgress` is firing
- THEN a spinner overlay covers the canvas and is visible to the user

#### Scenario: Overlay removed on completion

- WHEN vis-network emits `stabilizationIterationsDone`
- THEN the spinner overlay is removed and the graph is fully interactive

#### Scenario: Long stabilization message

- GIVEN stabilization starts
- WHEN 5 seconds elapse without `stabilizationIterationsDone`
- THEN the overlay appends "Settling… this may take a moment" to the spinner text

---

### Requirement: Large Graph Warning

The system MUST show a dismissible toast/banner when `data.nodes.length > 1000`. The graph MUST still attempt to render.

#### Scenario: Warning shown for large N

- GIVEN `data.nodes.length = 1200`
- WHEN the component renders
- THEN a toast/banner reads "Large network (N=1200). Rendering may be slow." and is dismissible

#### Scenario: Render not blocked

- GIVEN `data.nodes.length > 1000`
- WHEN the component renders
- THEN Network is instantiated and the graph renders (no hard cap)

---

### Requirement: Physics Freeze Post-Stabilization

The system SHOULD disable physics after `stabilizationIterationsDone` to prevent CPU drain and make manual node dragging snappy.

#### Scenario: Physics disabled after stabilization

- GIVEN vis-network emits `stabilizationIterationsDone`
- WHEN the handler fires
- THEN `network.setOptions({ physics: { enabled: false } })` is called

---

### Requirement: Theme Awareness

The graph canvas background MUST be transparent or match the app's current theme. Coordination color palette MUST be readable in both light and dark modes.

#### Scenario: Transparent background

- GIVEN any theme (light or dark)
- WHEN the Network is instantiated
- THEN `options.nodes.color.background` is NOT hardcoded white; canvas container background is `transparent` or inherits the Card background

---

### Requirement: Test Coverage

The system MUST include tests covering the following cases.

**Unit (graphUtils):**

#### Scenario: 1-node transform

- GIVEN `data` with 1 node and 0 edges
- WHEN `buildVisNetworkData` is called
- THEN returns 1 vis-node, 0 vis-edges, no error

#### Scenario: Typical transform (N=10, edges=15)

- GIVEN `data` with 10 nodes and 15 edges
- WHEN `buildVisNetworkData` is called
- THEN all 10 nodes are present with correct color and size; all 15 edges map `source→from`, `target→to`

#### Scenario: Large transform performance (N=1000)

- GIVEN `data` with 1000 nodes
- WHEN `buildVisNetworkData` is called
- THEN it completes within 200ms

#### Scenario: Coordination color/size correctness

- GIVEN nodes with coordination values `0, 1, 2, 3, 4, 5, 6, 7, 8`
- WHEN `buildVisNetworkData` is called
- THEN each node's color matches the discrete palette and size is within `[12, 32]`

**Integration (mocked Network):**

#### Scenario: Network instantiated on data prop

- GIVEN the mock Network class is injected
- WHEN `data` prop is set to non-null
- THEN `new Network(container, data, options)` is called once

#### Scenario: Click handler wired

- GIVEN the Network mock exposes `on(event, cb)`
- WHEN the component mounts
- THEN `network.on('click', ...)` is registered

#### Scenario: Destroy called on unmount

- GIVEN the component has mounted with non-null data
- WHEN the component unmounts
- THEN `network.destroy()` is called exactly once

#### Scenario: Large graph warning at N>1000

- GIVEN `data.nodes.length = 1001`
- WHEN the component renders
- THEN the warning toast/banner is present in the DOM
