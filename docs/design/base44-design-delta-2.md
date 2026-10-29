# Base44 design delta #2 — second re-export

Audit of the re-exported `docs/design/fierce-fractal-logic-lab/` against the
first delta (`base44-design-delta.md`).

**Four of the ten items landed, and they are the four that mattered most.** The
rest are listed below with paste-ready prompts, plus one new issue the re-export
introduced.

---

## 0. Scorecard

| § | Item | State |
| --- | --- | --- |
| 4.2 | Palette tokens, light + dark + shadcn bridge | **Done** |
| 1.1 | Rg evolution chart, both screens | **Done** |
| 2.1 | Coordination panel → neighbour graph preview | **Done** |
| — | `lib/chartTheme.js` SERIES ramp | **Done** |
| 4.3 | Triple encoding: colour + line style + marker | Not done (§A) |
| — | Retired hexes still hardcoded in 6 components | **New issue** (§B) |
| 2.3 | "Show values" text alternative | Not done (§C) |
| 1.2 | Planned vs generated projection directions | Not done (§D) |
| 2.2 | Topology graph controls | Not done (§E) |
| 1.3 | check-email / verify-email screens | Not done (§F) |
| 3.1 | Forgot/reset password — invented | Still undecided (§G) |
| 2.4 | "Precision shown" is a dead field | Not done (§H) |

### What landed well

- `index.css` carries `--series-1…6` in both themes, `--success` is now
  `#2f8f6d`, `--warning` is `#b8761f`, and `--chart-1…5` were correctly
  regenerated from the new ramp rather than left pointing at the old one.
- `--accent-bright` even carries the comment *"focus, hover and active states
  only — never carries state meaning"*. That is the rule, honoured.
- `RgEvolutionChart.jsx` is better than I specified: axis labels with units,
  linear/log-log toggle, a custom tooltip that names each series, the selection
  strip wired, and `connectNulls` so gaps do not break a line. On Compare it
  lists simulations without data underneath, exactly as asked.
- The coordination panel preview is right: 110px, 60% opacity, non-interactive,
  with the link underneath.

---

## A. The palette was adopted, the charts were not

This is the biggest remaining item, and it is subtle: **the tokens changed, the
call sites did not.** Six components still paint with hexes that no longer exist
in the design system.

| File | Line | Hex | What it was |
| --- | --- | --- | --- |
| `simulation/FractalPlot.jsx` | 91 | `#cf8a38` | retired gold — the old warning colour |
| `simulation/FractalPlot.jsx` | 92 | `#7664bb` | retired violet |
| `simulation/FractalPlot.jsx` | 13, 90, 102 | `#728391` | retired slate |
| `dashboard/DfDistributionPanel.jsx` | 47, 49 | `#7664bb` | retired violet |
| `batch/BatchScatter.jsx` | 53 | `#7664bb` | retired violet |
| `visual/AgglomerateViewer.jsx` | 7–8 | `#7664bb`, `#cf8a38` | retired violet and gold |
| `visual/TopologyGraph.jsx` | 6 | `rgb(118,100,187)` | retired violet |

The original collision is gone, so nothing *misreads* any more. But the app now
paints from two palettes at once, and the thin dashed reference lines in the
box-counting plot are the worst case: `#cf8a38` sits close enough to the new
`--series-2` burnt orange to read as the same series at 1.1px stroke.

```text
Migrate every chart and 3D colour to the SERIES ramp. No component may contain
a literal series hex any more.

Replace, in this order of preference: import SERIES from '@/lib/chartTheme' and
index into it, or read var(--series-N) in CSS. Specifically:

- FractalPlot: the three limiting-case reference lines become SERIES[3] olive
  (chain), SERIES[1] burnt orange (plane) and SERIES[2] violet (sphere); the
  excluded-point rings and their legend swatch use --ink-faint, not a series
  colour, because "excluded" is a state and not a series.
- DfDistributionPanel: the reference markers use SERIES[2].
- BatchScatter: the trend line uses SERIES[2].
- AgglomerateViewer: the three particle ramps become
  coord: SERIES[0] → SERIES[2] → SERIES[1];
  radius: --mint → SERIES[0] → SERIES[5];
  distance: --accent-bright → SERIES[0] → SERIES[2].
- TopologyGraph: the coordination ramp interpolates SERIES[0] to SERIES[2].

Then delete the now-unused --gold, --violet and --slate tokens from index.css,
or keep them ONLY as the names of the tonal panel gradients, never as a colour
a chart can reach for.
```

### A.2 One ramp, one source of truth

`index.css` defines `--series-1…6` and `lib/chartTheme.js` defines a `SERIES`
array with the same six values. Nothing reads the CSS variables — `grep` finds
zero uses of `var(--series`. Two definitions that must agree by hand will drift.

```text
Make the CSS custom properties the single source of truth. In
lib/chartTheme.js, read them at runtime instead of repeating the literals:

export const SERIES = Array.from({ length: 6 }, (_, i) =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(`--series-${i + 1}`).trim()
);

Recompute it when the theme changes so charts repaint with the dark-theme ramp.
Keep the literals only as a fallback for server-side rendering.
```

### A.3 Triple encoding is still missing

Every multi-series chart draws solid lines with `dot={false}`. With four
simulations on the Compare Rg evolution chart, hue is the only cue — which was
the whole reason for changing the palette.

```text
In every multi-series chart, give each series three simultaneous cues:
- colour from SERIES in order;
- line style in this order: solid, "6 3", "2 3", "8 3 2 3", "12 4", "4 2";
- marker shape in this order: circle, square, triangle, diamond, cross, star,
  drawn at the data points with about 7px spacing, not on every sample.

The legend shows all three together. Apply to the Compare Rg evolution chart,
BatchScatter, the BatchFractalTab log-log overlay and the FRAKTAL distribution
charts. Single-series charts stay solid with no markers.
```

---

## C. "Show values" — still absent

Zero occurrences in the re-export. This is the accessibility requirement from
the original brief and it remains the only item that was in the brief, missed
once, and missed again.

```text
Add a "Show values" affordance to every chart panel and every VisualPanel.

It is a 10px uppercase tracked button in the panel header action slot.
Activating it replaces the chart or 3D canvas with a DataTable of the data
behind it, in place, keeping the panel chrome; the button then reads "Show
chart". The table is keyboard navigable and scrollable, with numeric columns
right aligned and monospace.

Apply to: the box-counting log-log plot, the Rg evolution chart, the
coordination histogram, the throughput and Df distribution panels, the batch
scatter, the FRAKTAL distribution charts, the optical spectrum, the 3D viewer
(particle table) and the topology graph (node table).
```

---

## D. Planned vs generated projection directions

Unchanged from delta #1 §1.2: `DirectionGrid` still draws one undifferentiated
set of dots, with no graticule.

```text
In the Projections tab, upgrade the hemisphere direction grid.

Draw it as a stereographic polar plot with an explicit graticule: parallels at
elevation 15, 30, 45, 60 and 75 degrees as thin circles, meridians every 30
degrees of azimuth as thin radial lines, both in the grid colour, with the
elevation values labelled in 9px uppercase muted type.

Render TWO sets of directions, visually distinct: planned grid directions as
small hollow rings, generated projections as filled teal dots. A planned
direction with no generated counterpart stays hollow, and the panel caption
reports "112 of 128 directions rendered". The selected direction gets a larger
filled dot with a teal halo. Clicking a generated direction loads its 2D
projection in the panel beside it.
```

---

## E. Topology graph controls

Unchanged from delta #1 §2.2: still zoom in / out / reset only.

```text
In the Topology tab, add a collapsible glass control card in the top-right of
the graph panel, matching the 3D viewer's control card:
- Layout: a "Freeze / Run" toggle and a "Re-run layout" button;
- Link distance and Repulsion as two sliders;
- Colour by: SegmentedControl with Coordination / Component / Distance to centre;
- "Fit to view" button;
- Node cap: a select (220 / 500 / all) with the hint "above 500 nodes the layout
  is computed once and frozen".
Keep the "Layout shows 220 of 512 nodes" badge and make it the affordance that
opens this card.
```

---

## F. check-email and verify-email screens

Unchanged from delta #1 §1.3. Neither page exists.

```text
Add two standalone auth screens using the existing two-column auth layout.

"Check your e-mail": centred envelope mark, the address in bold mono, copy
explaining the link expires in 24 hours, a "Resend" secondary action with a 60
second cooldown shown as a countdown on the button, and a "Wrong address? Start
over" link in the card footer.

"Verify e-mail": three states, all reachable from the dev state switcher.
- verifying: a 6px shimmer bar and "Checking your link…";
- success: a teal check mark, "Your e-mail is verified", and an auto-redirect
  countdown "Taking you to your dashboard in 3…";
- failed: a danger callout naming the cause (expired link / already used /
  unknown token) and a primary "Request a new link" action.
```

---

## G. Forgot/reset password — the decision is still open

`ForgotPassword.jsx` and `ResetPassword.jsx` are still in the export. The real
backend has no password-reset flow. This is not something Base44 can resolve:
it is a product decision, and leaving it unmade means the prototype keeps
promising a flow that does not exist.

Pick one and tell me, I will fold it into the port:

- **Keep** — password reset becomes a backend feature request. Defensible; the
  product arguably should have it.
- **Drop** — remove both routes and the "Forgot password?" link on the login
  card.

---

## H. "Precision shown" is still a dead field

Settings gained a clarifying hint — *"This setting only changes how many digits
the interface displays"* — which is the correct explanation, but the control
still drives nothing. A setting that explains itself and then does nothing is
worse than one that just sits there.

```text
Wire the "Precision shown" preference so it actually sets the number of decimal
places rendered in metric cards, detail lists and data tables across the app.
Show a live example beside the field: "Df would read 2.533 / 2.5334 / 2.5".

Quantities with a fixed convention — seeds, particle counts, percentages — are
unaffected and keep their own formatting.
```

---

## Suggested order

1. **§A.1 migrate the hardcoded hexes** — finishes the palette work already
   started; without it the app paints from two systems.
2. **§A.3 triple encoding** — the reason the palette changed in the first place.
3. **§C Show values** — twice missed, and it is an accessibility commitment.
4. **§G** — a decision, not work. Costs you one word.
5. §D, §E, §F, §A.2, §H — can be done during the port to the real frontend.

Items 1–3 are worth closing before the port. Everything else can travel.
