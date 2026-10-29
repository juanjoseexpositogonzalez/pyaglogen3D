# Proposal: visualize-multiple

## Intent

Users today can only inspect one aggregate at a time, which makes the three core comparison workflows — seed variance studies (same target Df, multiple realisations), validation of imported vs simulated aggregates, and batch parameter sweeps — require opening N browser tabs and eyeballing them in isolation. That is the opposite of what a comparison tool should be. This capability is the natural pairing with `import-aggregate`: once a user can bring an external aggregate in, they immediately want to confirm it matches a simulated one visually and numerically.

This change introduces a Compare view that lets the user pick 2–9 simulations from the project page and open them side-by-side. The default layout is a responsive grid of 3D viewers with synchronised cameras, plus a metrics comparison table and a multi-series Rg-evolution chart underneath. An Overlay mode merges all aggregates into a single scene with distinct colours, aligned by centre-of-mass, for precise morphology comparison. All viewers share a single settings panel so toggling axes or sphere resolution applies uniformly.

## Scope

### In Scope
- Project page: row checkboxes + "Compare" button (enabled when ≥ 2 rows selected, hard cap at 9)
- New page `/projects/[id]/compare?sims=ID1,ID2,...` for the compare view
- Grid layout: responsive CSS grid (1×2, 2×2, 2×3, 3×3 depending on N)
- Overlay mode toggle: all aggregates in a single scene, distinct colours, aligned by CoM
- Synchronised cameras: single OrbitControls source-of-truth propagates to all N viewers (default on; toggle to independent)
- Shared viewer settings panel: sphere resolution, show/hide axes, background colour
- Per-simulation colour legend
- Metrics comparison table: columns = sim labels, rows = Df / Kf / Rg (nm) / N particles / algorithm
- Multi-series Rg-evolution chart (log-log, reuses `RgEvolutionChart` with array input)
- Unit normalisation to nm before rendering (honour each sim's own `dpo`)
- Fix: decouple `CameraTracker` store slot from multi-viewer context (explore §finding 2)
- Fix: add `uniformColor` prop to `Particles.tsx` (explore §finding 5)

### Out of Scope (deferred)
- More than 9 simulations (hard cap, user message if attempted)
- Export comparison as image/PDF
- Side-by-side particle-highlight (click on one sim's particle, highlight on all)
- Mobile layout (desktop-first; responsive up to N=4 on small screens with horizontal scroll beyond)
- Sharing compare URLs with auth (query param is already shareable within the same session)
- Aggregate alignment options (align by inertia axes, by CoM, by custom rotation)
- Save comparison view as a named preset
- Multi-series FractalPlot with N fitted lines (follow-up change)

## Approach

Split the work into four phases. **Phase 1** refactors the viewer layer so N instances can coexist: add a `uniformColor` prop to `Particles.tsx`, scope the global camera state in `viewerStore` so writes from a Compare-mode viewer don't race with other routes, and accept an optional `cameraSource` prop on `AgglomerateViewer` to support external sync. **Phase 2** scaffolds the Compare page: route, URL param parsing, parallel data fetching via React Query (staleTime Infinity; reuse `useSimulationGeometry`), cap-9 enforcement at button-enable time on the project page, and a skeleton grid layout.

**Phase 3** builds the two viewing modes: `CompareGrid` renders N `AgglomerateViewer` instances with a `CompareCameraProvider` context that owns one shared camera state (debounced prop-based sync — never frame-by-frame store writes, to avoid feedback loops); `CompareOverlay` renders a single `Canvas` with N aggregates merged into one scene, each scaled by its own per-sim `getScaleFactorNm` before placement, and coloured from a deterministic palette. **Phase 4** closes with the metrics table (`CompareMetricsTable`), the multi-series Rg chart (extend `RgEvolutionChart` to accept `series: Array<{label, data, color}>`), the shared settings panel, the colour legend, URL-missing-sim handling, and a user-facing docs page.

The existing `AgglomerateViewer` component is reused as-is — no rewrite. Data fetching is N parallel React Query calls; the existing `staleTime: Infinity` cache makes re-selection free. Single-sim detail page behaviour is preserved by scoping any store changes (default "single" key keeps old semantics). Testing covers grid rendering, camera sync, overlay scene composition, unit normalisation with heterogeneous `dpo`, and an end-to-end happy path.

### Key decisions (locked)
- N=9 maximum (grid 3×3, conservative GPU budget per explore §7)
- Synchronised cameras default-on (per Q1.i/ii use cases)
- Shared viewer settings in a single panel (not per-viewer)
- MEDIUM scope per explore §recommendation (grid + overlay; no multi-FractalPlot)
- Q1 covers all three use cases: seed variance, imported-vs-simulated, batch sweeps
- Q2 layout: grid default + overlay toggle
- Q3 entry: project-page checkboxes + Compare button when N≥2
- Q4 accompanying views: 3D + metrics table + synchronised Rg evolution

## Capabilities

### New capabilities
- `multi-aggregate-comparison`: contract for the Compare view — selection, grid + overlay rendering, camera synchronisation, metrics table, multi-series charts, shared settings.

### Modified capabilities
- `viewer3d-state` (implicit, from the existing single-sim view): global camera store gains scope identifier to avoid cross-route races.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/src/components/viewer3d/AgglomerateViewer.tsx` | Minor modify | Accept optional `colorOverride` + `cameraSource` props for sync |
| `frontend/src/components/viewer3d/Particles.tsx` | Modify | New `uniformColor` prop (replaces hardcoded `0x4488ff`) |
| `frontend/src/stores/viewerStore.ts` | Modify | Scope camera state to "single" vs "compare/{sessionId}" keys |
| `frontend/src/components/compare/CompareGrid.tsx` | NEW | Responsive grid of `AgglomerateViewer` instances |
| `frontend/src/components/compare/CompareOverlay.tsx` | NEW | Single scene with N aggregates, distinct colours |
| `frontend/src/components/compare/CompareCameraProvider.tsx` | NEW | Context provider with shared camera state (debounced) |
| `frontend/src/components/compare/CompareMetricsTable.tsx` | NEW | Df / Kf / Rg (nm) / N / algorithm table per-sim |
| `frontend/src/components/compare/CompareSettingsPanel.tsx` | NEW | Shared settings (sphere resolution, axes toggle, background) |
| `frontend/src/components/charts/RgEvolutionChart.tsx` | Modify | Accept `series: Array<{label, data, color}>` |
| `frontend/src/app/projects/[id]/compare/page.tsx` | NEW | Compare page, reads `?sims=` param, fetches geometries |
| `frontend/src/app/projects/[id]/page.tsx` | Modify | Row checkboxes + Compare button + selection state |
| `frontend/src/lib/compare-utils.ts` | NEW | URL param parse, colour palette, layout helper |
| `docs/visualize-multiple.md` | NEW | User guide |

## Success Criteria

- [ ] User can check ≥ 2 simulations on the project page and open the Compare view
- [ ] Compare view renders all selected aggregates in a responsive grid
- [ ] Rotating one viewer rotates all (synchronised mode)
- [ ] Toggle to Overlay mode merges all aggregates into a single scene with distinct colours
- [ ] Metrics table shows Df / Kf / Rg (nm) / N / algorithm for each selection
- [ ] `RgEvolutionChart` overlays all series when available (imported sims may lack `rg_evolution`)
- [ ] Shared settings panel changes all viewers simultaneously
- [ ] Attempting to select > 9 sims shows a warning at button-click (cap enforced)
- [ ] Single-sim detail page works identically to before (no regression)
- [ ] `npm test` green + `tsc --noEmit` green
- [ ] Docs page exists

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Memory pressure with 9 viewers × 10k particles each | Medium | Cap at 9; use `InstancedMesh` (already in place); document minimum GPU tier |
| Camera sync causes jitter / feedback loops | Medium | Debounced prop-based sync instead of frame-by-frame store writes |
| Per-sim `dpo` normalisation errors | Low | Tests with mixed v1/v2/imported sims having different `dpo` values |
| Performance on low-end devices | Medium | Neutral default background; allow user to disable axes/grid to save frames |
| Rg evolution chart crowds with 9 series | Low | Use opacity + hover-highlight pattern |
| One of the sims in `?sims=` URL has been deleted | Medium | Skip missing sim, show warning banner listing failed IDs |

## Rollback Plan
1. Revert the `/compare` page route (returns 404 until the route exists; no impact elsewhere)
2. Revert `Particles.tsx` `uniformColor` prop (default branch preserves previous hardcoded colour)
3. Revert `viewerStore` scoping (default "single" key preserves existing behaviour)
4. Revert `RgEvolutionChart` `series` prop (single-series default preserved)
5. Revert project-page checkboxes (rows render as before)

## Dependencies
- None external. Builds on `verify-rg`'s `getScaleFactorNm` shim (already in `lib/units.ts`)
- No backend changes required — existing geometry endpoint handles N parallel fetches

## Open questions (deferred to spec/design)
- Colour palette: `d3-scale-chromatic` `schemeTableau10` or hand-picked Tailwind set from explore §6? (design decides)
- Overlay CoM alignment: centre each aggregate on its own CoM (simplest) or place them in a ring pattern? (design decides)
- Missing-sim UX: warning banner + render remaining, or block entry entirely? (design decides)
