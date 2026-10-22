# design-system-foundation Specification

## ADDED Requirements

### Requirement: Design tokens are the single source of truth

All colour, surface, line, shadow, radius and typography values MUST be declared as CSS custom
properties in `frontend/src/app/globals.css`. `tailwind.config.ts` MUST derive its theme from
those properties and MUST NOT restate any literal value. No file under `frontend/src/components/`
or `frontend/src/lib/` may contain a colour literal.

#### Scenario: Tailwind derives rather than repeats

- GIVEN `tailwind.config.ts`
- WHEN its `theme.extend.colors` is inspected
- THEN every entry resolves through `var(--token)` or `hsl(var(--token))`
- AND no hexadecimal or `rgb()` literal appears in the file

#### Scenario: No colour literals outside globals.css

- GIVEN the repository at `frontend/src`
- WHEN `components/` and `lib/` are searched for `#[0-9a-fA-F]{3,8}` and `rgb(`
- THEN no match is found outside `app/globals.css`

---

### Requirement: Light and dark themes

The application MUST ship a light theme as the default and a dark theme under
`[data-theme="dark"]`. The active theme MUST be resolved before first paint, MUST follow
`prefers-color-scheme` when the user has expressed no preference, and MUST persist an explicit
choice across sessions.

#### Scenario: No flash of incorrect theme

- GIVEN a user whose stored preference is dark
- WHEN the document loads
- THEN `data-theme="dark"` is present on `<html>` before the first paint
- AND no frame renders with light surfaces

#### Scenario: System preference is honoured on first visit

- GIVEN no stored preference
- AND the operating system reports `prefers-color-scheme: dark`
- WHEN the application loads
- THEN the dark theme is active

#### Scenario: Explicit choice wins over system preference

- GIVEN the operating system reports `prefers-color-scheme: dark`
- WHEN the user selects "Light" in the theme control
- AND reloads the page
- THEN the light theme is active

#### Scenario: Every token has a value in both themes

- GIVEN the token list declared under `:root`
- WHEN `[data-theme="dark"]` is inspected
- THEN every token that encodes a colour has a dark counterpart
- AND no token resolves to an empty string in either theme

---

### Requirement: Categorical data series ramp

Charts MUST draw categorical series from a dedicated ramp of six colours exposed as
`--series-1` through `--series-6`. No semantic colour (`--success`, `--warning`, `--danger`)
may equal any series colour, and no series colour may be used to convey state.

#### Scenario: Semantic and series colours are disjoint

- GIVEN the resolved values of `--success`, `--warning`, `--danger`
- AND the resolved values of `--series-1` through `--series-6`
- WHEN the two sets are compared in either theme
- THEN they share no value

#### Scenario: Accent-bright carries no state meaning

- GIVEN `--accent-bright`
- WHEN its uses are inspected
- THEN it appears only in focus, hover and active styling
- AND never as the colour of a status chip, badge or callout

---

### Requirement: Multi-series charts use triple encoding

A chart that renders more than one series MUST distinguish them by colour, line dash pattern
and marker shape at once, all three indexed by the same series position. Markers MUST be
thinned rather than drawn at every sample.

#### Scenario: Three cues per series

- GIVEN a chart with four series
- WHEN its Plotly traces are inspected
- THEN each trace carries a distinct `line.color`, a distinct `line.dash` and a distinct
  `marker.symbol`
- AND the cue index equals the series index for all three

#### Scenario: Legend shows all three cues

- GIVEN a chart with more than one series
- WHEN the legend is inspected
- THEN each entry shows the colour, the dash pattern and the marker glyph together

#### Scenario: Markers are thinned on dense series

- GIVEN a series of 500 points
- WHEN the trace is rendered
- THEN fewer than 60 markers are drawn

#### Scenario: Single-series charts stay plain

- GIVEN a chart with exactly one series
- WHEN the trace is inspected
- THEN the line is solid and no markers are drawn

---

### Requirement: Chart theme follows the active theme

`lib/chart-theme.ts` MUST read the series ramp and chart styling from the document's custom
properties, and MUST re-read them when the active theme changes, so that charts repaint with
the ramp of the theme in force.

#### Scenario: Ramp re-reads on theme flip

- GIVEN a rendered chart in the light theme
- WHEN the user switches to the dark theme
- THEN the chart's series colours equal the dark ramp
- AND no reload is required

#### Scenario: Literals are a fallback only

- GIVEN a server-side render with no document
- WHEN `series(0)` is called
- THEN it returns the documented fallback value without throwing

---

### Requirement: Numeric rendering is tabular and unit-separated

Every numeric quantity MUST render in the monospace family with `font-variant-numeric:
tabular-nums`, and its unit MUST be a separate adjacent element. A number and its unit MUST NOT
be concatenated into one string.

#### Scenario: Unit is a sibling element

- GIVEN a radius of gyration of 68.4 nm
- WHEN the `Num` primitive renders it
- THEN the value and the unit occupy separate elements
- AND only the value carries the monospace, tabular-nums styling

#### Scenario: Columns align

- GIVEN a table column of values 9.1, 68.4 and 142.75
- WHEN the column is rendered
- THEN the decimal separators align vertically

---

### Requirement: Charts and spatial views expose their values as text

Every chart panel and every spatial visualisation (3D viewer, topology graph, micrograph view)
MUST offer a control that replaces the visual with a keyboard-navigable table of the data
behind it, in place, keeping the surrounding panel chrome.

#### Scenario: Toggle replaces the visual in place

- GIVEN a rendered chart inside a panel
- WHEN the "Show values" control is activated
- THEN a data table occupies the chart's position
- AND the panel title, hint and borders are unchanged
- AND the control now reads "Show chart"

#### Scenario: The table is reachable by keyboard

- GIVEN the table is shown
- WHEN the user navigates with the keyboard alone
- THEN every row is reachable
- AND the control reports its state through `aria-pressed`

---

### Requirement: Contrast and non-colour status

Text MUST meet WCAG 2.1 AA contrast in both themes, including the small uppercase tracked
labels on translucent surfaces. Status MUST never be conveyed by colour alone.

#### Scenario: Micro-labels clear AA

- GIVEN a 10px uppercase label rendered in `--ink-muted` on `--surface`
- WHEN its contrast ratio against the composited background is measured in both themes
- THEN the ratio is at least 4.5:1

#### Scenario: Status chips carry a word

- GIVEN any status chip
- WHEN it is rendered
- THEN it contains a text label naming the state
- AND the state is not distinguished by colour alone

#### Scenario: Motion respects the user's preference

- GIVEN `prefers-reduced-motion: reduce`
- WHEN a running job's progress bar renders
- THEN the shimmer animation is not applied
