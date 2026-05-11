# Smoke Test: projection-hemisphere-viz

## Pre-conditions

- Deploy **frontend only** — no backend changes, no migration required.
- At least one simulation must exist with a completed projection export (any mode).

## Steps

### Step 1 — Hemisphere renders below preview

1. Open a completed simulation in the UI.
2. Navigate to the 2D Projections section.
3. Generate or select a projection preview.
4. **Verify**: An SVG hemisphere diagram appears below the projection preview image, showing concentric circles (parallels), radial lines (meridians), and direction dots.

### Step 2 — Hover tooltip

1. Hover over any dot on the hemisphere diagram.
2. **Verify**: A native tooltip appears showing `Az: X°, El: Y°` with the precise direction values.

### Step 3 — Click interaction

1. Click on a highlighted (blue) generated dot on the hemisphere.
2. **Verify**: The projection preview image switches to that direction AND the selected ring indicator moves to the clicked dot.

### Step 4 — Mode independence

1. In the Projection Controls panel, switch sampling mode from Grid → Fibonacci → Legacy.
2. **Verify**: The dot distribution on the hemisphere updates to match each mode:
   - **Grid**: Regular lattice pattern (uniform az × el spacing)
   - **Fibonacci**: Quasi-random golden-angle distribution
   - **Legacy**: Same pattern as grid (legacy uses identical parameterization)

### Step 5 — Empty state

1. Open a simulation that has **no completed projections** yet.
2. **Verify**: The hemisphere diagram renders the grid frame (circles + lines) but shows only gray (ungenerated) dots — no blue highlighted dots.
