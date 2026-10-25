# design-system-foundation Specification

## Purpose

Govern the visual vocabulary the product is built from: colour tokens, light and dark themes,
the typographic scale, the chart theme, and the rules that keep data readable without relying
on colour alone.

It exists because the interface previously carried its values inline. Colours were written as
literals wherever they were needed, so the same intent was spelled differently in different
files, a theme could not be changed centrally, and nothing stopped a new screen from inventing
its own palette. This capability makes those values declarations instead of repetitions: a
token is defined once and derived everywhere, so a theme is a property of the application
rather than an agreement between files.

It also governs the part of readability that colour cannot carry on its own: numbers are
rendered so that columns of them can be compared, series in a chart differ by shape and dash
as well as hue, status is never signalled by colour alone, and contrast is held to an
accessible ratio in both themes. These are the rules that keep the interface legible for
someone reading a dense table, printing in greyscale, or distinguishing colours differently.

## Requirements

### Requirement: R1. Design tokens are the single source of truth

All colour, surface, line, shadow, radius and typography values introduced by this change MUST
be declared as CSS custom properties in `frontend/src/app/globals.css`. `tailwind.config.ts`
MUST derive its theme from those properties and MUST NOT restate any literal value.

No file **created by this change** — under `frontend/src/components/kit/`,
`frontend/src/components/shell/`, or `frontend/src/lib/chart-theme.ts` — may contain a colour
literal, with one documented exception: the SSR fallback ramp in `chart-theme.ts`. The same
rule covers the other files this change creates: `frontend/src/lib/theme.ts` and
`frontend/src/stores/useThemeStore.ts`.

This requirement does NOT demand the removal of pre-existing colour literals elsewhere in
`frontend/src`. Some of them are mandated by other capability contracts: the coordination
palette in `frontend/src/lib/graphUtils.ts` is fixed verbatim by `contacts-graph-viz`
(`0→#9ca3af, 1→#ef4444, …`) and MUST NOT be tokenised by this change. Migration of the
remaining literals belongs to the waves that rewrite their screens.

#### Scenario: Tailwind derives rather than repeats `[test]`

- GIVEN `tailwind.config.ts`
- WHEN its `theme.extend.colors` is inspected
- THEN every entry resolves through `var(--token)` or `hsl(var(--token))`
- AND no hexadecimal or `rgb()` literal appears in the file

#### Scenario: New files carry no colour literals `[test]`

- GIVEN the files created by this change, as listed above
- WHEN they are searched for `#[0-9a-fA-F]{3,8}` and `rgb(`
- THEN the only matches are inside the documented SSR fallback ramp

#### Scenario: The canonical coordination palette is untouched `[test]`

- GIVEN `frontend/src/lib/graphUtils.ts`
- WHEN `coordinationColor(0)` is called
- THEN it returns `'#9ca3af'`, as `contacts-graph-viz` requires

---

### Requirement: R2. Light and dark themes

The application MUST ship a light theme as the default and a dark theme under
`[data-theme="dark"]`. The active theme MUST be resolved before first paint, MUST follow
`prefers-color-scheme` when the user has expressed no preference, and MUST persist an explicit
choice across sessions.

Tailwind's `darkMode` strategy MUST be anchored to that attribute, so that every `dark:`
utility in the codebase follows the resolved theme. Leaving the strategy undeclared means
`media` in Tailwind 3.x, under which those utilities follow the operating system and contradict
an explicit user choice.

#### Scenario: Tailwind dark variants follow the attribute, not the OS `[test]`

- GIVEN `tailwind.config.ts`
- WHEN its `darkMode` entry is inspected
- THEN it is anchored to `[data-theme="dark"]` and not to `media`

#### Scenario: System preference is honoured on first visit `[test]`

- GIVEN no stored preference
- AND `prefers-color-scheme: dark` is reported
- WHEN the resolver runs against a simulated document
- THEN it writes `data-theme="dark"`

#### Scenario: Explicit choice wins over system preference `[test]`

- GIVEN `prefers-color-scheme: dark` is reported
- AND the stored preference is `light`
- WHEN the resolver runs
- THEN it writes `data-theme="light"`

#### Scenario: Every token has a value in both themes `[test]`

- GIVEN `globals.css` parsed as text
- WHEN the custom-property keys declared under `:root` and under `[data-theme="dark"]` are
  compared
- THEN every colour-bearing key declared in `:root` is also declared in the dark block
- AND no declaration has an empty value

#### Scenario: No flash of incorrect theme `[manual]`

- GIVEN a user whose stored preference is dark
- WHEN the document loads in a browser
- THEN no frame renders with light surfaces
- AND the evidence is a capture or Performance trace recorded in the Log

---

### Requirement: R3. Categorical data series ramp

Charts MUST draw categorical series from a dedicated ramp of six colours exposed as
`--series-1` through `--series-6`. No semantic colour (`--success`, `--warning`, `--danger`)
may equal any series colour, and no series colour may be used to convey state.

#### Scenario: Semantic and series colours are disjoint `[test]`

- GIVEN `globals.css` parsed as text
- WHEN the semantic values and the six series values are compared, in each theme block
- THEN the two sets share no value

#### Scenario: Accent-bright carries no state meaning `[manual]`

- GIVEN the files created by this change
- WHEN uses of `--accent-bright` are reviewed by hand
- THEN it appears only in focus, hover and active styling
- AND never as the colour of a status chip, badge or callout
- AND the reviewed list is recorded in the Log

(Not mechanically decidable: telling "focus styling" from "state styling" is a judgement about
intent, not a grep.)

---

### Requirement: R4. Multi-series charts use triple encoding

A chart that renders more than one series **whose colours are not already bound by another
capability contract** MUST distinguish them by colour, line dash pattern and marker shape at
once, all three indexed by the same series position.

Where another contract binds a series colour to an entity — `multi-aggregate-comparison` R6
and S5.3 bind each Rg-evolution series to that simulation's own colour, shared with its viewer
border and its metrics-table swatch — **the dash pattern and marker shape still apply; the
colour does not.** That binding wins.

Markers MUST be thinned rather than drawn at every sample.

#### Scenario: Three cues per series `[test]`

- GIVEN a chart with four unbound series
- WHEN its Plotly traces are inspected
- THEN each trace carries a distinct `line.color`, a distinct `line.dash` and a distinct
  `marker.symbol`
- AND the cue index equals the series index for all three

#### Scenario: An entity-bound colour is preserved `[test]`

- GIVEN a chart whose series colours are supplied by the caller
- WHEN its traces are inspected
- THEN `line.color` equals the supplied colour for each series
- AND `line.dash` and `marker.symbol` still follow the series index

#### Scenario: Markers are thinned on dense series `[test]`

- GIVEN a series of 500 points
- WHEN the trace is built
- THEN fewer than 60 marker positions are emitted

#### Scenario: Single-series charts stay plain `[test]`

- GIVEN a chart with exactly one series
- WHEN the trace is inspected
- THEN the line is solid and no markers are drawn

#### Scenario: Legend declares all three cues `[test]`

- GIVEN a chart with more than one series
- WHEN its legend-bearing traces are inspected
- THEN each carries `showlegend`, its `line.dash` and its `marker.symbol`

---

### Requirement: R5. Chart theme follows the active theme

`lib/chart-theme.ts` MUST read the series ramp and chart styling from the document's custom
properties, and MUST re-read them when the active theme changes, so that charts repaint with
the ramp of the theme in force.

#### Scenario: Ramp re-reads on theme flip `[test]`

- GIVEN custom properties injected on `document.documentElement`
- AND a first call to `series(0)`
- WHEN `data-theme` is mutated and the properties are updated
- THEN the next call to `series(0)` returns the new value without a reload

#### Scenario: Literals are a fallback only `[test]`

- GIVEN no document is available
- WHEN `series(0)` is called
- THEN it returns the documented fallback value without throwing

---

### Requirement: R6. Numeric rendering is tabular and unit-separated

The `Num` primitive MUST render numeric quantities in the monospace family with
`font-variant-numeric: tabular-nums`, and MUST keep the unit in a separate adjacent element.
A number and its unit MUST NOT be concatenated into one string.

**Binding scope.** The guarantee binds `Num` and every component that renders a number through
it. A screen binds this requirement once it has been rewritten onto the kit; screens still on
their pre-redesign markup do not.

#### Scenario: Unit is a sibling element `[test]`

- GIVEN a radius of gyration of 68.4 nm
- WHEN the `Num` primitive renders it
- THEN the value and the unit occupy separate elements
- AND only the value carries the monospace, tabular-nums class

#### Scenario: Columns align `[manual]`

- GIVEN a table column of values 9.1, 68.4 and 142.75
- WHEN it is rendered in a browser
- THEN the decimal separators align vertically
- AND the evidence is a capture recorded in the Log

---

### Requirement: R7. Charts and spatial views expose their values as text

The `ShowValues` primitive MUST offer a control that replaces a visual with a
keyboard-navigable table of the data behind it, in place, keeping the surrounding panel chrome.

**Binding scope.** The guarantee binds `ShowValues` and every chart panel or spatial
visualisation that has been rewritten onto the kit. A panel binds this requirement from the
moment it adopts the kit, not before.

#### Scenario: Toggle replaces the visual in place `[test]`

- GIVEN a rendered chart inside a panel
- WHEN the "Show values" control is activated
- THEN a data table occupies the chart's position
- AND the panel title, hint and borders are unchanged
- AND the control now reads "Show chart"

#### Scenario: The table is reachable by keyboard `[test]`

- GIVEN the table is shown
- WHEN the user navigates with the keyboard alone
- THEN every row is reachable
- AND the control reports its state through `aria-pressed`

---

### Requirement: R8. Contrast and non-colour status

The token palette MUST meet WCAG 2.1 AA contrast in both themes, including the small uppercase
tracked labels on translucent surfaces, and the primitives this change delivers MUST NOT convey
status by colour alone.

**Binding scope.** The guarantee binds the token palette and every component built on the kit.
Screens still on their pre-redesign markup are audited by the wave that rewrites them.

#### Scenario: Micro-labels clear AA `[manual]`

- GIVEN a 10px uppercase label rendered in `--ink-muted` on `--surface`
- WHEN its contrast ratio against the composited background is measured in a browser, in both
  themes
- THEN the ratio is at least 4.5:1
- AND the measurement is recorded in the Log

#### Scenario: Status chips carry a word `[test]`

- GIVEN any status chip
- WHEN it is rendered
- THEN it contains a text label naming the state

#### Scenario: Motion respects the user's preference `[manual]`

- GIVEN a browser with `prefers-reduced-motion: reduce`
- WHEN a kit component with a shimmer renders
- THEN no shimmer animation plays
- AND the evidence is recorded in the Log

(The shimmer is suppressed with the CSS `motion-reduce:` variant, so the class is in the DOM
either way and jsdom evaluates no media query. `window.matchMedia` is undefined in jsdom 23.2.0
and `src/test/setup.ts` provides no stub, so a DOM assertion here would be vacuous.)
