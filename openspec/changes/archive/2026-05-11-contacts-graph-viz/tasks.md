# Tasks: contacts-graph-viz

**Change:** `contacts-graph-viz` — force-directed graph topology visualization replacing the particle-explorer list in `NeighborGraph.tsx`.

**Stack:** `[frontend]` (all tasks) · `[deps]` (T1.x) · `[docs]` (T9.x)

**Phase count:** 9 · **Total tasks:** 46 · **Constraint:** Strict TDD, frontend test runner `cd frontend && npx vitest run`, do not touch backend, do not run `npm run build`.

**Approach per task:** RED (write failing test) → GREEN (implement minimal code) → TRIANGULATE (edge cases) → REFACTOR (optional).

---

## Phase 1 — Dependencies + Skeleton

| # | Task | Size | Stack |
|---|------|------|-------|
| T1.1 | ~~Install `vis-network@^10.0.3` and `vis-data@^8.0.1`. Commit `package.json` + `package-lock.json`.~~ | M | [deps] | ✅ |
| T1.2 | ~~Verify with `npm ls vis-network` (in `frontend/`) that the package is resolved.~~ | S | [deps] | ✅ |
| T1.3 | ~~Create stub files so all imports compile (empty exports): `frontend/src/lib/graphUtils.ts`, `frontend/src/components/topology/NetworkCanvas.tsx` (empty), `frontend/src/components/topology/StatsBanner.tsx` (empty), `frontend/src/components/topology/NodeDetailPanel.tsx` (empty). No logic — just stubs so `NeighborGraph.tsx` can `import` them without errors.~~ | S | [frontend] | ✅ |

**Phase 1 commit:** `chore(deps): add vis-network and vis-data for topology graph viz`

---

## Phase 2 — graphUtils Pure Functions (TDD)

**Test file:** `frontend/src/lib/__tests__/graphUtils.test.ts`

| # | Task | Size | Stack |
|---|------|------|-------|
| T2.1 | ~~**RED→GREEN** `coordinationColor(coord)`~~ | S | [frontend] | ✅ |
| T2.2 | ~~**RED→GREEN** `coordinationSize(coord, maxCoord)`~~ | S | [frontend] | ✅ |
| T2.3 | ~~**RED→GREEN** `buildVisNetworkData(data)` — N=10~~ | M | [frontend] | ✅ |
| T2.4 | ~~**TRIANGULATE** edge cases: N=1, zero edges, N=1000~~ | S | [frontend] | ✅ |
| T2.5 | ~~**Performance** test: N=1000 <200ms~~ | M | [frontend] | ✅ |

**Phase 2 commit:** `test(graphUtils): add unit tests for coordinationColor, coordinationSize, buildVisNetworkData with perf`

---

## Phase 3 — StatsBanner (TDD)

**Test file:** `frontend/src/components/topology/__tests__/StatsBanner.test.tsx`

| # | Task | Size | Stack |
|---|------|------|-------|
| T3.1 | ~~**RED→GREEN** renders 4 stat cards~~ | S | [frontend] | ✅ |
| T3.2 | ~~**TRIANGULATE:** connected vs disconnected badge~~ | S | [frontend] | ✅ |

**Phase 3 commit:** `test(StatsBanner): add unit tests for stat card rendering and badge variants`

---

## Phase 4 — NodeDetailPanel (TDD)

**Test file:** `frontend/src/components/topology/__tests__/NodeDetailPanel.test.tsx`

| # | Task | Size | Stack |
|---|------|------|-------|
| T4.1 | ~~**RED→GREEN** `selectedNode=null` → returns null~~ | S | [frontend] | ✅ |
| T4.2 | ~~**RED→GREEN** render position, radius, coordination, distance~~ | S | [frontend] | ✅ |
| T4.3 | ~~**RED→GREEN** neighbor buttons with #<id> labels~~ | S | [frontend] | ✅ |
| T4.4 | ~~**RED→GREEN** clicking neighbor invokes onSelectNeighbor~~ | S | [frontend] | ✅ |
| T4.5 | ~~**TRIANGULATE** node with 0 neighbors~~ | S | [frontend] | ✅ |

**Phase 4 commit:** `test(NodeDetailPanel): add unit tests for null guard, detail rendering, neighbor buttons, empty neighbors`

---

## Phase 5 — NetworkCanvas (TDD with mocked vis-network)

**Test file:** `frontend/src/components/topology/__tests__/NetworkCanvas.test.tsx`
**Mock:** `frontend/src/components/topology/__tests__/__mocks__/visNetworkMock.ts` (shared, used by all NetworkCanvas tests)

| # | Task | Size | Stack |
|---|------|------|-------|
| T5.1 | ~~Create `visNetworkMock.ts`~~ | M | [frontend] | ✅ |
| T5.2 | ~~**RED→GREEN** Network constructor called~~ | S | [frontend] | ✅ |
| T5.3 | ~~**RED→GREEN** click handler registered~~ | S | [frontend] | ✅ |
| T5.4 | ~~**RED→GREEN** click node → onNodeClick~~ | S | [frontend] | ✅ |
| T5.5 | ~~**RED→GREEN** click empty → onNodeClick(null)~~ | S | [frontend] | ✅ |
| T5.6 | ~~**RED→GREEN** unmount → destroy()~~ | S | [frontend] | ✅ |
| T5.7 | ~~(merged into T5.2 — data prop)~~ | S | [frontend] | ✅ |
| T5.8 | ~~**RED→GREEN** selectedNodeId → focus()~~ | S | [frontend] | ✅ |
| T5.9 | ~~**RED→GREEN** stabilization spinner~~ | S | [frontend] | ✅ |
| T5.10 | ~~**TRIANGULATE** empty nodes array~~ | S | [frontend] | ✅ |

**Phase 5 commit:** `test(NetworkCanvas): add integration tests with mocked vis-network class`

---

## Phase 6 — NeighborGraph Container Refactor (TDD)

**Test file:** `frontend/src/components/topology/__tests__/NeighborGraph.test.tsx` (exists — refactor)

| # | Task | Size | Stack |
|---|------|------|-------|
| T6.1 | ~~Read existing NeighborGraph.tsx~~ | S | [frontend] | ✅ |
| T6.2 | ~~**RED→GREEN** container renders StatsBanner + NetworkCanvas + NodeDetailPanel~~ | S | [frontend] | ✅ |
| T6.3 | ~~**RED→GREEN** props interface unchanged~~ | S | [frontend] | ✅ |
| T6.4 | ~~**RED→GREEN** isLoading → LoadingSpinner~~ | S | [frontend] | ✅ |
| T6.5 | ~~**RED→GREEN** data=null → "No topology data"~~ | S | [frontend] | ✅ |
| T6.6 | ~~**RED→GREEN** onExportAdjacency button~~ | S | [frontend] | ✅ |
| T6.7 | ~~**RED→GREEN** click node → NodeDetailPanel visible~~ | M | [frontend] | ✅ |
| T6.8 | ~~**RED→GREEN** click neighbor → selectedNode updates~~ | M | [frontend] | ✅ |
| T6.9 | ~~**RED→GREEN** large-graph warning (n_particles > 1000)~~ | S | [frontend] | ✅ |
| T6.10 | ~~**REFACTOR** NeighborGraph.test.tsx — new container tests~~ | M | [frontend] | ✅ |

**Phase 6 commit:** `refactor(topology): replace NeighborGraph body with container-presentational architecture`

---

## Phase 7 — Theme Awareness

| # | Task | Size | Stack |
|---|------|-------|
| T7.1 | ~~Investigate theme handling: no `next-themes`/`useTheme`/`ThemeProvider` found. Used `window.matchMedia('(prefers-color-scheme: dark)')` with jsdom-safe guard.~~ | M | [frontend] | ✅ |
| T7.2 | ~~Modify `buildVisNetworkData` signature to accept optional `theme: 'light' \| 'dark'` argument (default `'light'`).~~ | S | [frontend] | ✅ |
| T7.3 | ~~Edge color: light→`#cbd5e1`, dark→`#475569`. Dark font→`#e2e8f0`. Wired via `matchMedia` in `NetworkCanvas`, re-inits on theme change.~~ | S | [frontend] | ✅ |
| T7.4 | ~~**TDD** 4 tests: dark edges, light edges, dark font, no font in light mode. RED→GREEN confirmed.~~ | S | [frontend] | ✅ |

**Phase 7 commit:** `feat(NetworkCanvas): adapt edge color to light/dark theme via matchMedia`

---

## Phase 8 — Integration Verification

| # | Task | Size | Stack |
|---|------|------|-------|
| T8.1 | ~~Full suite: 525 passing, 6 pre-existing failures (FraktalBatchUpload/ImageDetail only). Zero regressions from contacts-graph-viz.~~ | M | [frontend] | ✅ |
| T8.2 | ~~`page.tsx` unchanged — `NeighborGraph` export name + props interface (`data`, `isLoading`, `onExportAdjacency`) preserved.~~ | S | [frontend] | ✅ |
| T8.3 | ~~Visual sanity deferred to SMOKE_TEST.md (post-deploy checklist).~~ | M | [frontend] | ✅ |

**Phase 8 commit:** `test: verify full frontend suite passes with no regressions`

---

## Phase 9 — Documentation

| # | Task | Size | Stack |
|---|------|------|-------|
| T9.1 | ~~CHANGELOG.md entry added at top of file with Added/Changed/Notes sections.~~ | S | [docs] | ✅ |
| T9.2 | ~~SMOKE_TEST.md created at `openspec/changes/contacts-graph-viz/SMOKE_TEST.md` with 9 steps + pre/post conditions.~~ | M | [docs] | ✅ |
| T9.3 | ~~**Defer** spec sync to archive phase (per design doc §Migration/Rollout).~~ | S | [docs] | ✅ — noted here: spec sync deferred to `sdd-archive` phase. |

**Phase 9 commit:** `docs: add CHANGELOG entry and smoke test guide for contacts-graph-viz`

---

## Summary

| Phase | Focus | Tasks |
|-------|-------|-------|
| 1 | Dependencies + Skeleton | T1.1–T1.3 |
| 2 | graphUtils pure functions | T2.1–T2.5 |
| 3 | StatsBanner | T3.1–T3.2 |
| 4 | NodeDetailPanel | T4.1–T4.5 |
| 5 | NetworkCanvas (mocked vis-network) | T5.1–T5.10 |
| 6 | NeighborGraph container refactor | T6.1–T6.10 |
| 7 | Theme awareness | T7.1–T7.4 |
| 8 | Integration verification | T8.1–T8.3 |
| 9 | Documentation | T9.1–T9.3 |
| **Total** | | **46 tasks** |

## Risks

- **`vis-network` SSR/import path**: Ensure the `import('vis-network/standalone/esm/vis-network')` inside `useEffect` resolves correctly in Next.js 14 App Router. Risk is mitigated by dynamic import in `useEffect` (no top-level module evaluation).
- **`mockNetwork.once` behavior**: The mock must fire the handler immediately on registration (not deferred) so tests can synchronously verify behavior. Implement this in `visNetworkMock.ts` factory.
- **Edge color test with dark mode**: If `window.matchMedia` is not available in jsdom (it isn't by default), T7.4 test must pass a theme prop explicitly rather than relying on auto-detection. The `buildVisNetworkData` signature change accommodates this.
- **`NeighborGraph.test.tsx` refactor**: Existing tests cover the old particle-explorer list and coordination-distribution pills. These must be removed and replaced with container-level assertions. Do not skip — stale tests will confuse future maintainers.
- **Bundle size**: `+170KB gzip` — within acceptable range given existing Three.js (~1.2MB) and Plotly (~3MB). No action needed, but document in CHANGELOG per T9.1.

## Skill Resolution

All tasks are `[frontend]` scope — no backend involvement. Testing follows existing vitest patterns (`compare-utils.test.ts` for pure functions, `AgglomerateViewer.test.tsx` for mocked library integration). No new skill needed.