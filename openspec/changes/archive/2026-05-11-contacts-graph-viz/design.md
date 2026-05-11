# Design: contacts-graph-viz

## Technical Approach

Replace `NeighborGraph.tsx` body with a container-presentational decomposition: container orchestrates state, three leaf components handle rendering. All vis-network coupling lives in `NetworkCanvas.tsx` behind a dynamic `import()` boundary (SSR-safe per explore #612). Pure data transformation extracted to `graphUtils.ts` for testability. Barnes-Hut params per spec R4 / explore #613.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Dynamic `import()` inside `useEffect` for vis-network | `next/dynamic` with `ssr:false`; top-level `import` with `'use client'` | `'use client'` alone doesn't prevent SSR module evaluation. `next/dynamic` wraps the whole component unnecessarily — we only need the library lazy-loaded, not the React tree (#612). |
| Extract `buildVisNetworkData` as pure function in `graphUtils.ts` | Inline transformation inside `useEffect` | Pure function is unit-testable without DOM/canvas mocking. Follows existing codebase pattern (`compare-utils.ts`, `projection-grid.ts`). |
| Container-presentational split (3 sub-components) | Single monolithic rewrite | Each sub-component is independently testable. `StatsBanner` and `NodeDetailPanel` are pure presentational (props-in, JSX-out). `NetworkCanvas` isolates the imperative vis-network lifecycle. |
| `vis-network/standalone/esm/vis-network` import path | Default `vis-network` import; `vis-network/peer` | Standalone bundles vis-data (no peer dep). ESM path enables tree-shaking, avoids pulling in Moment.js. ~170KB gzip — acceptable given Three.js (~1.2MB) and Plotly (~3MB) already in bundle. |
| Spec palette (8 discrete colors, 0→gray…7+→blue) | User-suggested 9-color Tailwind-400 palette | Spec R5 is formal requirement. Design follows spec. Palette is high-contrast on both light/dark backgrounds. |
| `window.matchMedia` for dark mode detection | Theme hook/provider | No `ThemeProvider` or `useTheme` exists in this codebase. `matchMedia` is zero-dependency and sufficient for edge color switching. |

## Data Flow

```
page.tsx (data prop)
    │
    ▼
NeighborGraph.tsx (container)
    │  state: selectedNodeId, stabilizing
    │
    ├──► StatsBanner         ← data.stats (pure presentational)
    │
    ├──► NetworkCanvas       ← data, onNodeClick, selectedNodeId
    │       │  useEffect: dynamic import vis-network
    │       │  builds Network, wires events
    │       │  stabilizationIterationsDone → physics off
    │       └──► onNodeClick callback → parent state
    │
    └──► NodeDetailPanel     ← selectedNode, edges, onSelectNeighbor
            └──► onSelectNeighbor → parent updates selectedNodeId
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/components/topology/NeighborGraph.tsx` | Modify | Full body rewrite to container; shell + props preserved |
| `frontend/src/components/topology/NetworkCanvas.tsx` | Create | SSR-safe vis-network canvas wrapper with stabilization overlay |
| `frontend/src/components/topology/StatsBanner.tsx` | Create | Extracted 4-card stats grid, pure presentational |
| `frontend/src/components/topology/NodeDetailPanel.tsx` | Create | Selected node details + neighbor navigation buttons |
| `frontend/src/lib/graphUtils.ts` | Create | Pure `buildVisNetworkData`, `coordinationColor`, `coordinationSize` |
| `frontend/package.json` | Modify | Add `vis-network@^10.0.3` |
| `frontend/src/components/topology/__tests__/graphUtils.test.ts` | Create | Unit tests for pure functions |
| `frontend/src/components/topology/__tests__/NetworkCanvas.test.tsx` | Create | Integration tests with mocked Network |
| `frontend/src/components/topology/__tests__/__mocks__/visNetworkMock.ts` | Create | Shared vis-network mock factory |

## Interfaces / Contracts

```tsx
// NetworkCanvas.tsx props
interface NetworkCanvasProps {
  data: NeighborGraphData;
  onNodeClick: (nodeId: number | null) => void;
  selectedNodeId: number | null;
}

// NodeDetailPanel.tsx props
interface NodeDetailPanelProps {
  selectedNode: NeighborGraphNode | null;
  allNodes: NeighborGraphNode[];
  edges: NeighborGraphEdge[];
  onSelectNeighbor: (nodeId: number) => void;
}

// graphUtils.ts — public API
export function buildVisNetworkData(data: NeighborGraphData): {
  nodes: VisNode[]; edges: VisEdge[]; options: VisOptions;
};
export function coordinationColor(coord: number): string;
export function coordinationSize(coord: number, maxCoord: number): number;
```

Palette (spec R5): `['#9ca3af','#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#3b82f6']`.
Size: linear `12 + (20 × coord / maxCoord)`, clamped `[12, 32]`.
Barnes-Hut: `{ gravitationalConstant: -3000, centralGravity: 0.1, springLength: 60, springConstant: 0.08, damping: 0.12, avoidOverlap: 0.5 }`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `buildVisNetworkData` output shape, color palette correctness, size clamping, empty edges, N=1000 perf (<200ms) | Direct function calls in vitest, no mocks. Pattern: `frontend/src/lib/__tests__/compare-utils.test.ts` |
| Integration | `Network` constructor called, click handler wired via `on('click',…)`, `destroy()` on unmount, stabilization overlay shown/hidden, large-N warning | Mock `vis-network/standalone/esm/vis-network` module; render with `@testing-library/react`. Pattern: `AgglomerateViewer.test.tsx` mock approach |
| Manual | Visual verification of layout quality for N=350 aggregate | Dev browser — not automated |

Mock strategy: `vi.mock('vis-network/standalone/esm/vis-network', …)` returns fake `Network` class that captures constructor args and exposes `on/once/destroy/focus/setOptions` as `vi.fn()`. Shared mock file avoids duplication.

## Migration / Rollout

No migration required. In-place component replacement — same export name, same props interface, zero `page.tsx` changes. Install: `cd frontend && npm install vis-network@^10.0.3` (apply phase only).

## Open Questions

- None blocking. `onExportAdjacency` is dead code — deferred to future cycle per proposal.
