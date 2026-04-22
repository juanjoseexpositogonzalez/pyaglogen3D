# Capability: multi-aggregate-comparison

> Side-by-side comparison of 2–9 simulated/imported aggregates with synchronised 3D
> viewers, an overlay mode, metrics table, and multi-series Rg-evolution chart.
>
> Context: see `../proposal.md` and `../explore.md` for motivation, scope, and
> architectural findings. This spec describes OBSERVABLE behaviour only.

---

## Requirements

### R1. Selection and entry point

**GIVEN** the user is on a project page listing N simulations
**WHEN** they interact with per-row selection controls
**THEN** they can open a multi-aggregate Compare view from there.

Observable rules:
- Each simulation row displays a selection checkbox that does NOT navigate to the sim detail page when toggled.
- A "Compare" action (button or link) is present on the project page.
- The Compare action is disabled (or hidden) when fewer than 2 rows are selected.
- The Compare action is enabled when between 2 and 9 rows are selected (inclusive).
- When the user attempts to select a 10th row, the selection is rejected and a user-visible warning is shown: "Maximum 9 simulations at once" (or equivalent wording).
- Clicking/activating the enabled Compare action navigates to `/projects/{projectId}/compare?sims=ID1,ID2,...` where the IDs are the selected simulations in selection order.

#### Scenarios

- **S1.1 (N=0)**: No rows selected → Compare action is hidden or disabled with a hint. Activating it does nothing.
- **S1.2 (N=1)**: One row selected → Compare action is disabled with a hint "Select ≥ 2 simulations".
- **S1.3 (N=2)**: Two rows selected → Compare action is enabled. Activating it navigates to `/projects/{id}/compare?sims=ID1,ID2`.
- **S1.4 (N=9)**: Nine rows selected → Compare action is enabled. Activating it navigates with all 9 IDs.
- **S1.5 (N=10 attempted)**: User attempts to tick a 10th checkbox → selection does not grow past 9; a warning "Maximum 9 simulations at once" is shown; the Compare action still operates on the 9 currently selected.
- **S1.6 (checkbox click does not navigate)**: Clicking the checkbox on a row does not trigger navigation to the simulation detail page.

---

### R2. Compare page renders grid by default

**GIVEN** the user lands on `/projects/{id}/compare?sims=...` with 2–9 valid IDs
**WHEN** the page finishes loading geometries
**THEN** every selected aggregate is rendered in its own 3D viewer inside a responsive grid, at its true nm scale.

Observable rules:
- The default layout is a CSS grid with the following shape, where N is the count of successfully loaded simulations:
  - N=2 → 1 row × 2 columns
  - N=3 → 1 row × 3 columns
  - N=4 → 2 rows × 2 columns
  - N=5 or N=6 → 2 rows × 3 columns
  - N=7, N=8, or N=9 → 3 rows × 3 columns
- Each grid cell contains exactly one `AgglomerateViewer` instance bound to the coordinates and radii of one simulation.
- Coordinates passed to each viewer have ALREADY been scaled to nanometres using that simulation's own `getScaleFactorNm(parameters)` (i.e. unit normalisation happens BEFORE the viewer receives data, so heterogeneous `dpo` values render at correct relative sizes).

#### Scenarios

- **S2.1 (grid N=2)**: Two simulations → one row of two cells, each a viewer.
- **S2.2 (grid N=9)**: Nine simulations → 3×3 grid, each cell a viewer.
- **S2.3 (mixed dpo)**: Two simulations with different `primary_particle_diameter_nm` (e.g. 25 nm and 30 nm) → the viewer of the larger-dpo sim shows visibly larger particles relative to a reference axis than the smaller-dpo sim. Rendered extents reflect the true nm scale, not dimensionless engine units.

---

### R3. Synchronised cameras (default-on)

**GIVEN** the Compare page is showing N viewers in grid mode
**WHEN** the user rotates, pans, or zooms one viewer
**THEN** all other viewers in the same compare session mirror that camera motion, unless the user has unlinked cameras.

Observable rules:
- On initial load of the Compare page, cameras are synchronised (linked) by default.
- A user-visible toggle "Independent cameras" (or "Unlink cameras") is present; its default state is OFF (i.e. cameras ARE linked).
- When cameras are linked: rotating/zooming any single viewer causes every other viewer to adopt the same camera orientation and zoom within the same visible interaction.
- When cameras are unlinked: rotating/zooming a viewer changes only that viewer; other viewers' cameras remain as they were.

#### Scenarios

- **S3.1 (default sync, 3 sims)**: Open Compare with 3 sims → rotate viewer 1 → viewers 2 and 3 visibly rotate to match.
- **S3.2 (toggle off, then rotate)**: With 3 viewers synced, toggle "Independent cameras" ON → rotate viewer 1 → viewers 2 and 3 remain at their previous orientation.
- **S3.3 (toggle on, then rotate)**: Starting unlinked with viewers at different angles, toggle "Independent cameras" OFF → subsequent rotation of any viewer re-syncs the others to its orientation.

---

### R4. Overlay mode

**GIVEN** the Compare page is rendering N aggregates in grid mode
**WHEN** the user activates the "Overlay" toggle
**THEN** the grid collapses into a single 3D scene containing all N aggregates, each aligned by its own centre-of-mass and rendered in a distinct deterministic colour.

Observable rules:
- A user-visible toggle "Overlay" is present on the Compare page.
- When Overlay is OFF (default), the grid of N viewers from R2 is shown.
- When Overlay is ON:
  - A single canvas (one `Canvas`, one WebGL context) replaces the grid.
  - All N aggregates are present in that single scene.
  - Each aggregate is translated so its own centre-of-mass is at the scene origin before being added (CoM alignment).
  - Each aggregate is rendered with a colour picked from a deterministic palette indexed by the simulation's position in the `?sims=` URL parameter (i.e. the same simulation always gets the same colour for the same selection order across reloads).
  - Different simulations in the same overlay have visually distinguishable colours.

#### Scenarios

- **S4.1 (toggle grid→overlay)**: Grid view with 3 viewers → activate Overlay → the 3 separate canvases disappear and a single canvas shows all 3 aggregates in 3 different colours.
- **S4.2 (toggle overlay→grid)**: Overlay view → deactivate Overlay → the grid of N viewers returns.
- **S4.3 (colour stability on reload)**: Overlay view with sims `[A, B, C]` → note the colour assigned to B → reload the page (same `?sims=A,B,C`) → B has the same colour as before.
- **S4.4 (CoM alignment)**: Two aggregates with different native origins → in Overlay, both appear centred around the scene origin (not offset).

---

### R5. Metrics table

**GIVEN** the Compare page has loaded N simulations
**WHEN** the user scrolls to / views the metrics section
**THEN** a table shows each simulation as a column with its key aggregate metrics as rows, and each column header is visually tied to that simulation's 3D rendering colour.

Observable rules:
- The metrics table has one column per successfully loaded simulation.
- Each column is labelled with the simulation's name (or a short identifier if no name is set).
- The table includes at least these rows, in this order: Fractal Dimension (Df), Prefactor (kf), Radius of Gyration in nm, N particles, Algorithm.
- The Radius of Gyration row value is expressed in nanometres (i.e. `metrics.radius_of_gyration × getScaleFactorNm(parameters)` per simulation).
- Each column header displays a colour indicator (dot, swatch, or coloured text) that matches the colour used for that simulation in the 3D rendering (grid per-viewer colour OR overlay colour — same colour in both modes for a given sim).

#### Scenarios

- **S5.1 (3 sims with distinct values)**: Three simulations with differing Df (e.g. 1.78, 1.81, 1.85), kf, Rg, and N → table shows three columns, each with its own values, correctly filled.
- **S5.2 (imported sim)**: One imported simulation mixed with simulated ones → table renders the imported simulation's column with whatever algorithm label it carries (e.g. "imported"), distinct from the simulated sims' algorithm labels.
- **S5.3 (colour match)**: The colour swatch on the metrics column header for sim X is the same colour as the viewer border/tint of sim X in grid mode AND the particle colour for sim X in overlay mode.

---

### R6. Multi-series Rg-evolution chart

**GIVEN** the Compare page has loaded N simulations
**WHEN** the page renders the Rg-evolution section
**THEN** a single chart overlays one series per simulation that has Rg-evolution data, each drawn in that simulation's colour, on log-log axes.

Observable rules:
- `RgEvolutionChart` (or its multi-series equivalent) accepts an input of the form `series: Array<{label, data, color}>`.
- Axes are log-log; the y-axis label is `log10(Rg/nm)` (matching the `verify-rg` capability contract).
- Each series is drawn in the colour provided for that simulation (same colour as the grid viewer and overlay colour for that sim).
- Each series is labelled in the chart legend with the simulation's label.
- If a simulation in the selection lacks `rg_evolution` data (common for imports), it is OMITTED from the chart, and the other simulations' series still render.
- When an imported/missing-evolution simulation exists, the chart or legend surfaces a tooltip/note indicating which sim has no evolution data.
- When ZERO of the selected simulations have `rg_evolution` data, the chart area shows an empty state with a message such as "No evolution data" (or equivalent wording).

#### Scenarios

- **S6.1 (3 with data)**: 3 simulations, all with `rg_evolution` → chart shows 3 series in 3 distinct colours; legend lists all 3.
- **S6.2 (mixed 2 with, 1 without)**: 3 simulations, one of them imported with no `rg_evolution` → chart shows 2 series, legend lists 2, and a tooltip/note indicates the third sim has no evolution data.
- **S6.3 (all missing)**: 3 simulations, none with `rg_evolution` → chart shows an empty state "No evolution data".
- **S6.4 (log-log axes)**: The chart's Y axis label contains `log10(Rg/nm)` (or equivalent rendering) and the axes are log-scaled.

---

### R7. Shared viewer settings panel

**GIVEN** the Compare page is showing N viewers (in grid or overlay)
**WHEN** the user changes a viewer setting in the shared settings panel
**THEN** the change applies simultaneously to every viewer in the current compare session.

Observable rules:
- A single settings panel is visible on the Compare page (there is NOT one panel per viewer).
- The panel includes at minimum: sphere resolution (e.g. low/medium/high), show/hide axes (gizmo + axes), background colour (or theme).
- Toggling any of these controls updates every rendered viewer in the same interaction.
- In overlay mode, changing a setting updates the single overlay canvas analogously.

#### Scenarios

- **S7.1 (axes toggle, N=5)**: Five viewers all showing axes → uncheck "Show axes" → all 5 viewers hide axes.
- **S7.2 (sphere resolution)**: Multiple viewers at default resolution → change "Sphere resolution" to low → all viewers re-render with the lower-resolution spheres.
- **S7.3 (background)**: Change background colour → every viewer's background updates.

---

### R8. Missing simulation handling

**GIVEN** the user navigates to `/projects/{id}/compare?sims=...` where at least one ID is invalid (does not exist → 404) or inaccessible (permission denied → 403)
**WHEN** the Compare page loads
**THEN** the page continues to render the remaining valid simulations, and surfaces a warning naming the unreachable IDs.

Observable rules:
- Simulations whose fetch returns 404 or 403 are considered "missing" for the compare session.
- Simulations that load successfully are rendered per R2 (grid) or R4 (overlay).
- When 1 or more simulations are missing but at least 1 loaded, a warning banner is shown at the top of the Compare page listing the number of missing simulations and their IDs (e.g. "2 of 5 simulations could not be loaded: [id-a], [id-b]").
- When ALL selected simulations are missing, the Compare page shows an empty state with the same warning listing the missing IDs.
- Missing simulations never appear in the metrics table or the Rg chart.

#### Scenarios

- **S8.1 (all valid)**: `?sims=A,B,C` with all three existing and accessible → no banner; grid shows 3 viewers.
- **S8.2 (1 missing of 5)**: `?sims=A,B,C,D,E` where C returns 404 → warning banner "1 of 5 simulations could not be loaded: [C]"; grid shows 4 viewers (A, B, D, E).
- **S8.3 (all missing)**: `?sims=X,Y` where both return 404 → warning banner listing both IDs; no grid / no metrics / no chart; empty state rendered.
- **S8.4 (403 access denied)**: `?sims=A,B` where A returns 403 → warning banner lists A; grid renders B only.

---

### R9. Single-sim view is unaffected (regression)

**GIVEN** the user opens `/projects/{id}/simulations/{simId}` (the pre-existing single-sim detail page)
**WHEN** they rotate, zoom, or otherwise interact with the 3D viewer on that page
**THEN** the behaviour is identical to before this change, and state does not leak between the single-sim and compare contexts.

Observable rules:
- The single-sim page continues to render one `AgglomerateViewer` with the same controls, metrics, and charts it had before this change.
- Camera state (azimuth/elevation/zoom) saved by the single-sim page is NOT overwritten by interactions on the Compare page, and vice versa (see also `viewer3d-state-delta.md`).
- Opening the Compare page with N sims never changes how the single-sim page renders for any of those sims.

#### Scenarios

- **S9.1 (no regression)**: Navigate to single-sim detail → viewer loads, rotates, controls respond as before this change.
- **S9.2 (isolated camera state)**: Open single-sim page → rotate the camera to some angle → open the Compare page in another tab/route with other sims and rotate → return to the single-sim page → the single-sim camera is still at the angle the user left it (not overwritten by the compare interaction).
- **S9.3 (fresh compare cameras)**: Open the Compare page → cameras start from the page's computed default framing, not from whatever angle the single-sim page last used.

---

### R10. Cap enforcement on the Compare page

**GIVEN** the user navigates directly to `/projects/{id}/compare?sims=...` with MORE than 9 valid simulation IDs in the URL
**WHEN** the page loads
**THEN** only the first 9 simulations are rendered, and a warning explains the truncation.

Observable rules:
- The Compare page processes at most 9 simulation IDs from the `?sims=` parameter.
- IDs in positions 10+ are ignored (not fetched, not rendered).
- A user-visible warning is shown indicating that N > 9 IDs were provided and only 9 are displayed.

#### Scenarios

- **S10.1 (exactly 9)**: `?sims=1,2,3,4,5,6,7,8,9` → all 9 render, no truncation warning.
- **S10.2 (15 IDs)**: `?sims=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15` → first 9 render (1..9); warning shown that 6 simulations were truncated; the metrics table and chart only include the 9.
- **S10.3 (truncation + missing combined)**: 12 IDs in URL, first 9 processed, of which 1 returns 404 → warning about truncation AND warning from R8 both surface; 8 viewers render.
