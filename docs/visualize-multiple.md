# Comparing Multiple Aggregates

Compare up to 9 simulations side-by-side to see morphology and metrics
differences at a glance.

## How to compare

1. On your project page, tick the checkbox on each simulation row you
   want to compare (2 to 9).
2. A "Compare (N)" button becomes visible at the bottom of the table
   when at least 2 rows are selected. If you tick more than 9, the
   button disables with a "Max 9 sims" tooltip.
3. Click Compare → the app opens a new page with the comparison view at
   `/projects/{projectId}/compare?sims=ID1,ID2,...`.

## View modes

### Grid (default)

A responsive grid of 3D viewers, one per simulation:

- 2 sims → side by side (1 × 2)
- 3 sims → 1 × 3
- 4 sims → 2 × 2
- 5–6 sims → 3 × 2
- 7–9 sims → 3 × 3

Each cell shows the sim's name and color-chip in its top-left corner
and uses the same deterministic color everywhere else in the page.

### Overlay

All aggregates merged into a single 3D scene, each translated so its
own mass-weighted center-of-mass sits at the world origin. Every
aggregate is rendered in its own color so you can compare morphologies
directly without the grid layout.

Toggle between modes with the **Grid / Overlay** buttons in the
settings panel at the top of the page.

## Synced vs independent cameras

By default, rotating or zooming one viewer rotates/zooms all the others
— cameras are synchronised across the session so morphology comparison
stays aligned.

Toggle the **Synced / Independent** button in the settings panel to
make each viewer's camera independent. Flipping back to Synced re-links
all viewers to the next camera movement.

In Overlay mode the toggle has no visible effect (there is only one
camera), but it remains in sync with Grid mode so flipping back doesn't
surprise you.

## What you see on the Compare page

- **3D viewers** (grid or overlay) with per-sim color
- **Metrics table** with Fractal Dimension (Df), Prefactor (kf), Radius
  of Gyration in nm, N particles, and Algorithm — one column per sim,
  header dots color-coded to match the 3D view
- **Rg evolution chart** with one log-log series per simulation. Sims
  without `rg_evolution` data (e.g. imported aggregates) are omitted
  from the plot and listed underneath as "no evolution data available"

## Colors

Colors are assigned deterministically: sim IDs are sorted
lexicographically and mapped onto the Tableau 10 palette. The same
set of sims always gets the same colors across page reloads, regardless
of the order you ticked them in.

## Missing simulations

If a sim in the URL can't be loaded (deleted, permission denied, or an
API error), a non-dismissible "could not be loaded" banner lists the
affected IDs and the rest of the page continues to render the
surviving sims. If a sim exists but its geometry is still being
computed (queued or running), a separate informational note lists it.

## Limitations

- Maximum 9 simulations per compare session (GPU / layout performance).
  If the `?sims=` URL contains more, the page truncates to the first 9
  and shows a warning.
- Imported aggregates may not have Rg evolution data — those sims are
  omitted from the chart but still appear in the grid/overlay and the
  metrics table.
- The shared settings panel currently exposes only View mode and Camera
  sync. Sphere resolution, axes gizmo, and background color are still
  driven by the single-sim viewer's defaults; per-compare-session
  overrides are planned as a follow-up.
