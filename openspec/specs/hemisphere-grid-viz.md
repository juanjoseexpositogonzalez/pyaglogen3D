<!-- Last sync: 2026-05-11 from change projection-hemisphere-viz -->

# Hemisphere Grid Visualization Specification

## Purpose

SVG stereographic hemisphere component (`HemisphereGrid`) that visualizes projection direction coverage inside `ProjectionViewer`. Shows all configured grid directions as dots, highlights generated and selected directions, and supports click interaction. Works identically for all 3 projection modes (grid, fibonacci, legacy).

**Azimuth convention**: Az=0° → right (3 o'clock), Az increases counter-clockwise. This matches standard mathematical convention (`atan2`) used in the Rust engine.

**Stereographic formula**: `r = R · cos(El) / (1 + sin(El))`, mapping El=90°→center, El=0°→outer circle.

---

## Requirements

### Requirement: SVG Grid Frame

The component MUST render an SVG element sized `size×size` px containing the stereographic reference grid.

#### Scenario: Renders grid frame at requested size

- GIVEN `HemisphereGrid` receives `gridDirections` (non-empty) and `size=300`
- WHEN the component mounts
- THEN an `<svg>` element is rendered with `width="300"` and `height="300"`
- AND contains one outer `<circle>` at r=R representing the equator (El=0°)
- AND contains 5 concentric `<circle>` elements for parallels at El = 15°, 30°, 45°, 60°, 75°
- AND contains 12 `<line>` elements for meridians at Az = 0°, 30°, 60°, ..., 330°
- AND contains a center marker dot at the pole (El=90°)

#### Scenario: Renders frame even with empty gridDirections

- GIVEN `gridDirections = []`
- WHEN the component mounts
- THEN the SVG frame (outer circle, parallels, meridians, pole marker) is still rendered
- AND no direction dots are rendered
- AND an accessible text "No projection directions configured" is present in the DOM

---

### Requirement: Stereographic Dot Placement

The component MUST project each direction in `gridDirections` to SVG coordinates using stereographic projection from the south pole.

#### Scenario: Equator dot at Az=0° lands at 3 o'clock

- GIVEN `gridDirections = [{az: 0, el: 0}]` and `size=300` (R = size/2 = 150)
- WHEN the component renders
- THEN the dot SVG center is at `(R, 0)` in the SVG coordinate system (right of center)

#### Scenario: Pole dot lands at center

- GIVEN `gridDirections = [{az: 0, el: 90}]`
- WHEN the component renders
- THEN the dot SVG center is at `(0, 0)` (center of disk)

#### Scenario: Mid-elevation dot at Az=90° lands at 12 o'clock

- GIVEN `gridDirections = [{az: 90, el: 45}]` and R=150
- WHEN the component renders
- THEN the dot x-coordinate ≈ 0 (tolerance ±0.5px) and y-coordinate ≈ `−R · cos(45°) / (1 + sin(45°))` (negative = up in SVG)

---

### Requirement: Dot State Visual Distinction

The component MUST render dots in three distinct visual states. Color MUST NOT be the only distinguishing signal.

| State | Fill | Radius | Additional |
|-------|------|--------|------------|
| Grid-only (not generated) | gray-400 | 3px | — |
| Generated (in `generatedDirections`) | blue-500 | 5px | — |
| Selected (matches `selectedDirection`) | blue-500 | 5px | 2px stroke ring, color blue-700 |

Matching tolerance: ±0.5° on both az and el.

#### Scenario: Grid-only dot renders gray and small

- GIVEN `gridDirections = [{az: 45, el: 30}]` and `generatedDirections = []`
- WHEN the component renders
- THEN the dot has `fill` equivalent to gray-400 and `r="3"`

#### Scenario: Generated dot renders accent and larger

- GIVEN `gridDirections = [{az: 45, el: 30}]` and `generatedDirections = [{az: 45, el: 30, projectionId: "x1"}]`
- WHEN the component renders
- THEN the dot has `fill` equivalent to blue-500 and `r="5"`

#### Scenario: Selected dot has halo ring

- GIVEN `selectedDirection = {az: 45, el: 30}` and that direction is in `generatedDirections`
- WHEN the component renders
- THEN a ring element with `stroke` equivalent to blue-700 and `fill="none"` is rendered around the dot

#### Scenario: Floating-point tolerance for matching

- GIVEN `generatedDirections = [{az: 45.0001, el: 30.0003}]` and `selectedDirection = {az: 45.0, el: 30.0}`
- WHEN the component renders
- THEN the selected halo IS applied (difference < 0.5° threshold)

---

### Requirement: Hover Tooltip

The component MUST show a tooltip with direction values on hover and focus.

#### Scenario: Tooltip appears on mouse hover

- GIVEN a dot at `{az: 45, el: 30}` is rendered
- WHEN the user hovers over the dot
- THEN a tooltip element becomes visible with text `"Az: 45°, El: 30°"` (values rounded to integer)

#### Scenario: Tooltip disappears on mouse leave

- GIVEN a tooltip is visible
- WHEN the user moves the mouse away from the dot
- THEN the tooltip element is no longer visible

#### Scenario: Tooltip appears on keyboard focus

- GIVEN a focusable dot (in `generatedDirections`)
- WHEN the dot receives keyboard focus
- THEN the tooltip element becomes visible with the same format

---

### Requirement: Click Interaction

The component MUST invoke `onDirectionClick` only when a GENERATED dot is clicked.

#### Scenario: Click on generated dot fires callback

- GIVEN `onDirectionClick` is provided and a dot is in `generatedDirections`
- WHEN the user clicks that dot
- THEN `onDirectionClick` is called with the full matching entry from `generatedDirections` (including `projectionId`)

#### Scenario: Click on grid-only dot does NOT fire callback

- GIVEN a dot that is in `gridDirections` but NOT in `generatedDirections`
- WHEN the user clicks that dot
- THEN `onDirectionClick` is NOT called

#### Scenario: Click on SVG background does NOT fire callback

- GIVEN `onDirectionClick` is provided
- WHEN the user clicks on the SVG outside any dot
- THEN `onDirectionClick` is NOT called

#### Scenario: No callback prop — clicks are silent

- GIVEN `onDirectionClick` is NOT provided
- WHEN the user clicks any dot
- THEN no error is thrown

---

### Requirement: Mode Independence

The component MUST render identically regardless of how `gridDirections` was populated.

#### Scenario: Grid mode directions render correctly

- GIVEN `gridDirections` computed from grid mode params (n_az=10, n_el=5)
- WHEN the component renders
- THEN all 32 expected dots appear at their correct stereographic positions

#### Scenario: Fibonacci mode directions render correctly

- GIVEN `gridDirections` computed from fibonacci mode (n=50)
- WHEN the component renders
- THEN all 50 dots appear; no error about invalid projections

#### Scenario: Legacy mode directions render correctly

- GIVEN `gridDirections` from a legacy sweep (az 0→180 step 45, el 0→90 step 45)
- WHEN the component renders
- THEN all expected dots appear at their correct stereographic positions

---

### Requirement: Performance Bound

The component SHOULD render within 50ms for inputs up to 500 directions.

#### Scenario: Renders ≤500 dots within performance budget

- GIVEN `gridDirections.length = 500`
- WHEN the component renders
- THEN render time is < 50ms (measured via React profiler in test environment)

#### Scenario: Warns in dev mode when over 500 directions

- GIVEN `gridDirections.length = 501` and `NODE_ENV = "development"`
- WHEN the component mounts
- THEN `console.warn` is called with a message indicating the performance guarantee does not apply

---

### Requirement: Accessibility

The SVG MUST be accessible with non-color signals and keyboard support.

#### Scenario: SVG has role and aria-label

- GIVEN the component renders with 32 grid and 10 generated directions
- WHEN the accessibility tree is inspected
- THEN the SVG has `role="img"` and `aria-label` containing both counts (e.g. "Projection hemisphere: 10 of 32 directions generated")

#### Scenario: Generated dots are keyboard-focusable

- GIVEN a dot is in `generatedDirections`
- WHEN the accessibility tree is inspected
- THEN that dot element has `tabindex="0"`

#### Scenario: Grid-only dots are NOT in tab order

- GIVEN a dot is in `gridDirections` but NOT in `generatedDirections`
- WHEN the accessibility tree is inspected
- THEN that dot element does NOT have `tabindex="0"`

---

### Requirement: Integration with ProjectionViewer

The `HemisphereGrid` component MUST integrate into the existing `ProjectionViewer` card layout.

#### Scenario: Hemisphere renders below preview image

- GIVEN `ProjectionViewer` renders with hemisphere integration enabled
- WHEN the DOM is inspected
- THEN the `HemisphereGrid` element appears after the projection preview `<img>` and before the controls section

#### Scenario: Selected dot updates when projection changes

- GIVEN `ProjectionViewer` has `selectedDirection = {az: 0, el: 45}`
- WHEN the parent updates `selectedDirection` to `{az: 90, el: 30}`
- THEN the halo ring moves to the dot at `{az: 90, el: 30}`
- AND the previous dot no longer has a halo ring

#### Scenario: Dot click reuses existing projection-picker callback

- GIVEN a dot click fires `onDirectionClick` with a direction entry
- WHEN the parent handler processes it
- THEN it follows the same code path as the existing projection selector control
