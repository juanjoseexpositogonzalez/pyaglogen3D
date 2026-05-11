# Proposal: Projection Hemisphere Visualization

## Intent

Add a 2D stereographic hemisphere diagram to the simulation results view showing projection direction coverage at a glance — which grid directions exist, which have been generated, and which is currently selected.

## Scope

### In Scope
- New SVG React component `HemisphereGrid` (parallels + meridians + dots)
- Integration inside `ProjectionViewer` card, below preview image
- Three dot states: available (gray), generated (accent), selected (ring/halo)
- Click interaction on generated dots → triggers parent callback
- Hover tooltip showing `Az: X°, El: Y°`
- Works for grid, fibonacci, and legacy modes (all expose Az/El uniformly)
- Vitest unit tests (render, styling, click, tooltip)

### Out of Scope
- Backend API changes (Az/El already in response)
- 3D rendering (locked to 2D stereographic)
- Lower hemisphere (El < 0°) — future enhancement
- Click-to-generate on ungenerated dots — future feature
- Dot appearance animation — deferred
- Perf optimization for n > 500 — deferred (canvas fallback)

## Capabilities

### New Capabilities
- `hemisphere-grid-viz`: SVG-based 2D stereographic hemisphere component for projection direction visualization

### Modified Capabilities
- None (pure additive — no existing spec behavior changes)

## Approach

**Pure frontend, single new component, zero backend changes.**

- Stereographic projection from south pole: `r = cos(El) / (1 + sin(El))`, plotted at `(r·cos(Az), r·sin(Az))`
- North pole (El=90°) at center, equator (El=0°) at outer rim
- Direction generation math replicated in TypeScript (same formulas as Rust engine)
- Component API: `gridDirections`, `generatedDirections`, `selectedDirection`, `onDirectionClick`, `size`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/src/components/projection/HemisphereGrid.tsx` | New | Core SVG viz component |
| `frontend/src/lib/projectionMath.ts` | New | Stereographic transform + direction generators |
| `frontend/src/components/projection/ProjectionViewer.tsx` | Modified | Render HemisphereGrid below image |
| `frontend/src/components/projection/index.ts` | Modified | Export new component |
| `frontend/src/app/projects/[id]/simulations/[simId]/page.tsx` | Modified | Wire props (grid, generated, selected) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fibonacci n>500 SVG perf | Low | Cap MVP at n≤500; document canvas fallback |
| Small dot click targets | Med | Min 8px hit area via transparent overlay |
| Grid mismatch if backend changes step | Low | Compute gridDirections from authoritative config |
| Stereographic edge distortion (El~0°) | Low | Acceptable for diagnostic use |

## Rollback Plan

Pure frontend change. Revert merge commit. No data loss, no migration, no backend coupling.

## Dependencies

- None (all direction data computable client-side from existing params)

## Success Criteria

- [ ] Component renders correctly for grid/fibonacci/legacy with sample data
- [ ] All vitest tests pass (dots count, styling, click callback, tooltip)
- [ ] Visual: dots clearly distinguish available/generated/selected states
- [ ] Click on generated dot fires `onDirectionClick` with correct Az/El
- [ ] No regression in existing ProjectionViewer rendering
- [ ] SVG with ≤500 nodes causes no measurable perf hit
