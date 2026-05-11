# Proposal: contacts-graph-viz

## Intent

Replace the list-based `NeighborGraph.tsx` (coordination pills + button explorer) with a real force-directed graph visualization using **vis-network**. The current component *describes* topology through numbers and lists but doesn't *show* it — users can't see clusters, chains, or branching patterns. A visual graph makes aggregate morphology immediately legible.

## Scope

### In Scope
- Add `vis-network@^10.0.3` (standalone bundle, includes vis-data)
- In-place rewrite of `NeighborGraph.tsx` — same name, same props, zero changes to `page.tsx`
- Stats banner (4 cards) preserved as-is
- Force-directed graph: Barnes-Hut solver, nodes colored+sized by coordination, stabilization spinner
- Click → inline detail panel below graph (position, radius, coordination, neighbors as focus buttons)
- Hover → highlight node + connected edges
- Edge/empty states: N=1 single node, disconnected clusters render naturally
- Performance: smooth for N≤1000; warning toast for N>1000
- Tests: unit (pure `buildVisNetworkData`), integration (mocked Network class, cleanup verification)

### Out of Scope
- `onExportAdjacency` wiring (dead code, future cycle)
- 3D graph rendering, physics tuning UI, multi-aggregate comparison
- Mobile-specific touch gestures, session zoom/pan persistence
- Server-side rendering of canvas, batch image stats (F4)

## Capabilities

### New Capabilities
- `contacts-graph-viz`: Force-directed 2D visualization of particle contact networks with coordination-based visual encoding, node detail interaction, and stabilization handling.

### Modified Capabilities
- None — existing specs don't cover NeighborGraph behavior.

## Approach

Dynamic `import('vis-network/standalone')` inside `useEffect` (SSR-safe pattern per explore #612). Pure `buildVisNetworkData()` function in `graphUtils.ts` handles all data transformation (color palette, sizing, Barnes-Hut params per #613). Component structure: `<StatsBanner>` → `<NetworkCanvas>` → `<NodeDetailPanel>` inside existing Card shell.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/src/components/topology/NeighborGraph.tsx` | Modified | Full body rewrite; shell + props preserved |
| `frontend/src/components/topology/graphUtils.ts` | New | Pure functions: data transform, color palette, physics config |
| `frontend/src/components/topology/__tests__/` | New | Unit + integration tests |
| `frontend/package.json` | Modified | Add vis-network dependency |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bundle size +170KB gzip | Certain | Acceptable — Three.js + Plotly already heavier; dynamic import lazy-loads |
| Stabilization flash (nodes explode from center) | High | Spinner overlay during `stabilizationProgress` → hide until `stabilizationIterationsDone` |
| Canvas blank in dark mode | Med | `background: 'transparent'` + coordination palette already high-contrast on dark |
| jsdom lacks canvas (vitest) | Certain | Pure-function extraction + Network class mock; no canvas tests |
| N>1000 slow render | Low | Warning toast, no hard block; physics disabled post-stabilization |
| Behavior regression (list clicks → graph clicks) | Med | Same info surfaced via visual graph; detail panel preserves neighbor navigation |

## Rollback Plan

Revert merge commit. No backend changes, no migration. Old list-based component recoverable from git history.

## Dependencies

- `vis-network@^10.0.3` (standalone — bundles vis-data, no peer deps)

## Success Criteria

- [ ] Force-directed graph renders N=350 sim in <2s
- [ ] Stats banner identical to current
- [ ] Click node → detail panel below graph with position, radius, coordination, neighbors
- [ ] Click neighbor button → graph focuses on that node
- [ ] Hover highlights node + edges
- [ ] N=1 renders without errors
- [ ] All vitest tests pass (pure functions + mocked Network)
- [ ] No regression in simulation page (page.tsx unchanged)
