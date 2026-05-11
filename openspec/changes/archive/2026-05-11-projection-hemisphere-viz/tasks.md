# Tasks: projection-hemisphere-viz

## Overview
Add 2D stereographic hemisphere diagram to simulation results showing projection direction coverage — available, generated, and selected directions. Pure frontend, zero backend changes.

**Total tasks**: 25
**Phases**: 5
**Stack**: [frontend] primary, [docs]
**TDD**: Strict (vitest run before each GREEN)

---

## Phase 1: Stereographic math + pure helper functions (TDD)

### T1.1 — Create stereographic.ts with pure functions ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Create `frontend/src/lib/stereographic.ts` with two exported pure functions:
  - `stereographicProject(az: number, el: number, size: number): {x: number, y: number}` — stereographic projection from south pole: r = size * cos(El) / (1 + sin(El)), x = r * cos(Az), y = r * sin(Az)
  - `directionsMatch(a: {az: number, el: number}, b: {az: number, el: number}, tolerance: number): boolean` — checks if two directions are within tolerance on both axes
- **Acceptance**: Import succeeds, functions export correctly, TypeScript compiles without errors

### T1.2 — RED→GREEN→TRIANGULATE: test stereographic for known points ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Create `frontend/src/lib/__tests__/stereographic.test.ts`. Test cases:
  - Pole (El=90°) → center (x=0, y=0)
  - Equator (El=0°) → outer edge (r=size)
  - 45° elevation → intermediate radius
  - Az convention: Az=0° → right (3 o'clock), increases counter-clockwise
- **Acceptance**: Tests pass for all 4 cases; assertion includes tolerance for floating point

### T1.3 — RED→GREEN: test direction matching with tolerance ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Add tests for directionsMatch:
  - Exact match (tolerance=0.5°) → returns true
  - Within tolerance (diff=0.3°) → returns true
  - Outside tolerance (diff=0.7°) → returns false
- **Acceptance**: All 3 cases pass

### T1.4 — REFACTOR: co-located test file ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Verify test file at `frontend/src/lib/__tests__/stereographic.test.ts` uses vitest, follows existing test patterns in project (check api-projections.test.ts for reference)
- **Acceptance**: `cd frontend && npx vitest run` passes stereographic tests

---

## Phase 2: HemisphereGrid component (TDD)

### T2.1 — Create HemisphereGrid.tsx skeleton with TypeScript props ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Create `frontend/src/components/projection/HemisphereGrid.tsx`. Props interface from spec R1-R10:
  - `gridDirections: Array<{az: number, el: number}>` — available directions to show as dots
  - `generatedDirections: Array<{az: number, el: number, projectionId: string}>` — completed projections
  - `selectedDirection: {az: number, el: number} | null` — current preview
  - `onDirectionClick: (entry: {az: number, el: number, projectionId?: string}) => void` — callback
  - `size?: number` — SVG size (default 200)
- **Acceptance**: Component renders, accepts all props, TypeScript compiles

### T2.2 — RED→GREEN: R1 — SVG grid frame (parallels, meridians, pole) ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Render SVG with:
  - Outer circle (hemisphere boundary)
  - Parallels at 15°, 30°, 45°, 60°, 75° (concentric circles)
  - Meridians every 30° (radial lines from pole)
  - Pole marker at center
- **Acceptance**: Test renders SVG, asserts presence of outer circle, 5 parallels, 12 meridians, center pole marker

### T2.3 — RED→GREEN: R2 — dot placement using stereographic helper ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Place dots for each gridDirection using stereographicProject(). Assert SVG positions match computed (x, y) values
- **Acceptance**: Test verifies dot positions for known (Az, El) pairs match stereographic formula

### T2.4 — RED→GREEN: R3 — three dot states (gray/accent/selected) ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Visual distinction:
  - Available (not generated): gray dot, smaller size (4px)
  - Generated (not selected): accent color, medium size (6px)
  - Selected: highlighted (border/glow), largest size (8px)
- **Acceptance**: Test asserts correct classes/colors applied based on state

### T2.5 — RED→GREEN: R4 — hover tooltip ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: On hover, show tooltip with Az/El values. Use React Testing Library + user-event
- **Acceptance**: Test hovers dot, asserts tooltip visible with formatted text "Az: X°, El: Y°"

### T2.6 — RED→GREEN: R5 — click interaction ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Click on generated dot triggers callback with full entry (az, el, projectionId). Click on ungenerated dot does nothing
- **Acceptance**: Test clicks generated dot, asserts callback called with correct data. Click ungenerated, assert no callback

### T2.7 — RED→GREEN: R6 — empty state ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: When gridDirections=[], render axes only (circles, lines), no dots. Include accessible text
- **Acceptance**: Test renders with empty arrays, asserts axes present, no dots, accessible text present

### T2.8 — RED→GREEN: R8 — dev-mode console.warn for >500 dots ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: When gridDirections.length > 500, console.warn with performance warning (mock console.warn in test)
- **Acceptance**: Test passes >500, asserts console.warn called with message containing "500"

### T2.9 — RED→GREEN: R9 — accessibility ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: SVG has role="img" and aria-label. Generated dots have tabindex="0", ungenerated dots omitted from tab order
- **Acceptance**: Test asserts role, aria-label present, tabindex on generated dots only

### T2.10 — REFACTOR: clean component ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: If helpful, extract sub-components (e.g., GridAxes, DirectionDot). Ensure clean public API
- **Acceptance**: Component still renders correctly, tests pass, no regression

---

## Phase 3: Integration into ProjectionViewer

### T3.1 — Read ProjectionViewer.tsx structure ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Read `frontend/src/components/projection/ProjectionViewer.tsx` to understand current props and rendering
- **Acceptance**: Document current props (imageUrl, azimuth, elevation, format, onDownload)

### T3.2 — RED→GREEN: add HemisphereGrid below preview ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Add HemisphereGrid component below the projection preview image, above controls (R10)
- **Acceptance**: Test renders ProjectionViewer with HemisphereGrid in correct DOM position

### T3.3 — Wire up props from ProjectionViewer state ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Derive and pass props:
  - `gridDirections`: from simulation's projection config (current Az/El step or fibonacci N)
  - `generatedDirections`: list of completed projections with (Az, El) and projectionId
  - `selectedDirection`: current preview's (Az, El)
  - `onDirectionClick`: reuse existing projection-picker handler in parent
- **Acceptance**: Test verifies correct prop values passed to HemisphereGrid

### T3.4 — Test: ProjectionViewer renders with correct props ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Create test for ProjectionViewer with mocked simulation data
- **Acceptance**: Test passes, HemisphereGrid receives correct gridDirections, generatedDirections, selectedDirection

### T3.5 — Test: clicking dot triggers projection switch ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: Click dot on HemisphereGrid, verify it triggers same projection switch as existing thumbnail/dropdown
- **Acceptance**: Test passes, onDirectionClick fired with correct entry data

### T3.6 — Regression: existing ProjectionViewer tests ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Run existing ProjectionViewer tests in `__tests__/` — ensure no regression
- **Acceptance**: All existing tests pass

---

## Phase 4: Compute helper for generating gridDirections (TDD)

### T4.1 — Create projection-grid.ts helper ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Create `frontend/src/lib/projection-grid.ts` with function:
  - `computeGridDirections(mode: "grid" | "fibonacci" | "legacy", config: GridConfig | FibonacciConfig | LegacyConfig): Array<{az: number, el: number}>`
- **Acceptance**: Function exports, TypeScript compiles

### T4.2 — RED→GREEN: grid mode (nested loops) ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: For "grid" mode: nested loops over az_step and el_step. Az: [0, 360), El: [0, 90] (upper hemisphere)
- **Acceptance**: Test asserts count = n_az * (n_el-1) + 1 (with pole), sample positions correct

### T4.3 — RED→GREEN: fibonacci mode (golden-angle spiral) ✅
- **Size**: M
- **Stack**: [frontend]
- **Description**: For "fibonacci" mode: spherical fibonacci spiral mapped to (Az, El). Use golden angle ~2.399 rad
- **Acceptance**: Test asserts exactly n points distributed on sphere, no duplicates

### T4.4 — RED→GREEN: legacy mode ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: For "legacy" mode: same as grid (per explore, they use same Az/El parameterization)
- **Acceptance**: Test asserts same output as grid mode for same parameters

### T4.5 — RED→GREEN: edge cases ✅
- **Size**: S
- **Stack**: [frontend]
- **Description**: Edge cases: zero step → empty array, n=1 fibonacci → single point at pole
- **Acceptance**: Tests pass for both edge cases

---

## Phase 5: Docs

### T5.1 — CHANGELOG entry ✅
- **Size**: S
- **Stack**: [docs]
- **Description**: Add entry under `## projection-hemisphere-viz (unreleased)` in CHANGELOG.md. Include: new HemisphereGrid component, stereographic math helper, integration into ProjectionViewer
- **Acceptance**: Entry present in CHANGELOG.md unreleased section

### T5.2 — SMOKE_TEST.md ✅
- **Size**: M
- **Stack**: [docs]
- **Description**: Create `openspec/changes/projection-hemisphere-viz/SMOKE_TEST.md`:
  - Pre-conditions: deploy frontend (no backend, no migration)
  - Step 1: open completed sim, select projection, verify hemisphere shows below image with parallels/meridians
  - Step 2: hover dot, verify tooltip shows Az/El
  - Step 3: click generated dot, verify preview switches
  - Step 4: try different modes (grid/fibonacci/legacy), verify hemisphere renders correctly
- **Acceptance**: Document created with all steps

### T5.3 — Mark spec sync deferred ✅ DEFERRED
- **Size**: S
- **Stack**: [docs]
- **Description**: Note in tasks.md that spec sync to canonical is deferred to archive phase
- **Acceptance**: Deferred status documented
- **Status**: Spec sync to canonical deferred to `sdd-archive` phase (no canonical spec existed prior to this change — all new capability)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-------------|
| Fibonacci n>500 SVG performance | Low | Medium | R8 console.warn cap at MVP; future canvas fallback deferred |
| Small click targets (8px) | Medium | Low | Use larger hit area via transparent border or SVG group |
| Grid mismatch with backend | Low | Low | Compute from same config; T3.3 validates prop derivation |

---

## Skill Resolution

- **go-testing**: Not applicable (React/vitest, not Go)
- **sdd-tasks**: This phase — tasks created

---

## Next Recommended

`apply` — Launch sdd-apply to execute tasks in phase order. Start with Phase 1 (stereographic math TDD).