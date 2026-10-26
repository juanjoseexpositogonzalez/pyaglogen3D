# Base44 design delta — `fierce-fractal-logic-lab` vs. pyAgloGen3D

Audit of the Base44 export in `docs/design/fierce-fractal-logic-lab/` against
two references: the redesign brief (`base44-redesign-prompt.md`) and, more
importantly, **the functionality that actually exists in `frontend/src/`**.

Everything below is written to be pasted into Base44. Each gap has a ready-to-use
prompt in a fenced block.

---

## 0. Verdict

The export is faithful. The design system was adopted verbatim, the shell is
right, and 20 of the 22 screens match the real product. The gaps are narrow and
specific — but two of them matter.

| Area | State |
| --- | --- |
| Design tokens, type scale, component kit | Complete and correct |
| Shell: sidebar, top bar, theme toggle, dev state switcher | Complete |
| 10 simulation algorithms, incl. FracVAL / gCCA / Box-RFA / limiting cases | Complete |
| Simulation detail, 6 tabs | Complete except Rg evolution (§1.1) |
| Batch studies: grid builder, expansion preview, results, fractal, export | Complete |
| Compare: 4 slots, synced camera, overlay, legend, metrics table | Complete except Rg evolution (§1.1) |
| FRAKTAL single + batch + image detail, quality badges, re-analyze | Complete |
| AI assistant, AI settings, settings, admin | Complete |
| Auth | Two real screens missing, two invented (§1.3, §3.1) |
| Accessibility: chart/3D text alternative | Missing (§2.3) |
| Colour system | Three real collisions (§4) |

---

## 1. Missing functionality — exists in the product, absent from the design

### 1.1 Rg evolution chart — the real gap

**This is the one worth fixing first.** The product has
`frontend/src/components/charts/RgEvolutionChart.tsx`, used in two places:

- **Simulation detail**, single-series: the radius of gyration as the aggregate
  grows, particle by particle. It is how a researcher sees *whether the growth
  converged* or wandered — a flat Df number cannot show that.
- **Compare**, multi-series: one curve per simulation, each in its series colour,
  with simulations lacking evolution data listed underneath as
  *"no evolution data available"* rather than silently dropped.

Nothing in the Base44 export plots it. It is also absent from the original
brief — my omission, not Base44's.

```text
Add an "Rg evolution" chart component and place it in two screens.

The chart plots the radius of gyration Rg (nm, Y axis) against the number of
primary particles added (N, X axis), as a line with no markers, on the standard
light chart surface: grid #d7e8ec, 10px uppercase muted axis labels, no border.
Add a SegmentedControl above it for Linear / Log-log scaling, and the usual
35px selection strip underneath showing the hovered point as "N = 312 · Rg =
68.4 nm".

1. Simulation detail, Overview tab: a full-width Panel titled "Growth" placed
   directly under the 3D viewer row, single series in teal. Its hint reads
   "Radius of gyration as each primary particle is added. A smooth power-law
   rise means the growth converged."

2. Compare screen: a full-width Panel titled "Rg evolution" placed under the
   metric comparison table, one curve per selected simulation in that
   simulation's series colour, matching the selection strip chips at the top of
   the page. Any simulation without evolution data must NOT be dropped
   silently: list it under the chart as "<name> — no evolution data available"
   in 11px muted text.
```

### 1.2 Planned vs. generated projection directions

The real `HemisphereGrid` distinguishes two sets of directions: the ones the
**grid planned** and the ones that were **actually generated**, matched within a
0.5° tolerance. It also draws parallels at 15/30/45/60/75° and meridians every
30°. The Base44 `DirectionGrid` draws one undifferentiated set of dots.

This matters because a partially completed export is the normal case, and the
researcher needs to see *which* directions are missing.

```text
In the Projections tab, upgrade the hemisphere direction grid.

Draw it as a stereographic polar plot with explicit graticule: parallels at
elevation 15, 30, 45, 60 and 75 degrees as thin circles, meridians every 30
degrees of azimuth as thin radial lines, both in the muted grid colour, with
the elevation values labelled in 9px uppercase muted type.

Render TWO sets of directions, visually distinct:
- planned grid directions: small hollow rings;
- generated projections: filled teal dots.
A planned direction with no generated counterpart stays hollow, and the panel
caption reports "112 of 128 directions rendered". The selected direction gets a
larger filled dot with a teal halo. Clicking any generated direction loads its
2D projection in the panel beside it.
```

### 1.3 Dedicated e-mail verification screens

The product has `/auth/check-email` and `/auth/verify-email` as real routes.
Base44 folded "check your e-mail" into the forgot-password flow and put
verification inline in Register. The verify screen in particular has three
distinct states that need designing.

```text
Add two standalone auth screens using the existing two-column auth layout.

"Check your e-mail": centred envelope mark, the address in bold mono, body copy
explaining the link expires in 24 hours, a "Resend" secondary action with a 60
second cooldown shown as a countdown on the button, and a "Wrong address?
Start over" link in the card footer.

"Verify e-mail": three states, all reachable from the dev state switcher.
- verifying: a 6px shimmer bar and "Checking your link…";
- success: a teal check mark, "Your e-mail is verified", and an auto-redirect
  countdown "Taking you to your dashboard in 3…";
- failed: a danger callout naming the cause (expired link / already used /
  unknown token) and a primary "Request a new link" action.
```

---

## 2. Present but shallower than the real feature

### 2.1 The connection graph — it IS there

You suspected the coordination-number connection graph was missing. It is not:
the export has a full **Topology tab** (`components/simulation/TopologyTab.jsx`)
with a force-directed neighbour graph coloured by coordination on the
teal→violet ramp, a stats banner, detached-particle warning, and a node drawer
with a clickable neighbour list. The Overview tab also carries a coordination
histogram.

The real problem is **discoverability**: the graph lives behind the sixth tab,
and the Overview coordination panel shows numbers and a bar chart but never
hints that a graph exists. Fix the path to it, not the graph.

```text
In the Simulation detail Overview tab, inside the "Coordination number" panel,
add a small non-interactive preview of the neighbour graph underneath the
histogram: the same force-directed layout, about 110px tall, nodes at 60%
opacity, no labels, no controls. Below it a single 11px accent link reading
"Open the full neighbour graph →" that switches to the Topology tab.

Keep the mean/min/max/contacts DetailList and the histogram as they are. The
preview is a signpost, not a second visualisation.
```

### 2.2 Topology graph controls

The real app renders the graph with a physics engine and exposes the controls.
The Base44 version is a fixed SVG layout capped at 220 nodes with only
zoom in / out / reset.

```text
In the Topology tab, add a collapsible glass control card in the top-right of
the graph panel, matching the 3D viewer's control card:
- Layout: a "Freeze / Run" toggle and a "Re-run layout" button;
- Link distance and Repulsion as two sliders;
- Colour by: SegmentedControl with Coordination / Component / Distance to centre;
- "Fit to view" button;
- Node cap: a select (220 / 500 / all) with the hint "above 500 nodes the layout
  is computed once and frozen".
Keep the existing "Layout shows 220 of 512 nodes" badge, and make it the
affordance that opens this card.
```

### 2.3 Text alternative for charts and 3D views — missing entirely

The brief required every chart and 3D view to expose its underlying numbers.
Nothing in the export implements it. This is an accessibility requirement, and
for a scientific tool it is also a usability one: researchers want the numbers.

```text
Add a "Show values" affordance to every chart panel and every VisualPanel.

It is a small 10px uppercase tracked button in the panel header action slot.
Activating it replaces the chart or 3D canvas with the DataTable of the data
behind it, in place, with the same panel chrome; the button then reads "Show
chart". The table is keyboard navigable and scrollable, numeric columns right
aligned and monospace.

Apply it to: the box-counting log-log plot, the Rg evolution chart, the
coordination histogram, the throughput and Df distribution panels, the batch
scatter plot, the FRAKTAL distribution charts, the optical spectrum, the 3D
agglomerate viewer (particle table) and the topology graph (node table).
```

### 2.4 Numeric precision is not wired

Settings has a "Precision shown" field, but the metric cards and tables use
hard-coded digit counts. It is a prototype, so this is minor — but the brief
made precision a user-facing promise.

```text
Make the "Precision shown" preference in Settings actually drive the number of
decimal places rendered in metric cards, detail lists and data tables across
the app. Show a live example beside the field: "Df would read 2.533 / 2.5334 /
2.5".
```

---

## 3. Invented — does not exist in the product

### 3.1 Forgot password / reset password

Base44 generated `/forgot-password` and `/reset-password`. The real backend has
no password-reset flow: `frontend/src/app/auth/` contains only login, register,
check-email, verify-email and oauth-callback.

This is a decision for you, not a bug:

- **Keep them** — then password reset becomes a backend feature request, and the
  design is ahead of the product. Reasonable: the product probably should have it.
- **Drop them** — then remove both routes and the "Forgot password?" link on the
  login card, so the prototype does not promise a flow that 404s.

Do not leave it ambiguous: a design that shows a reset screen will be read as a
commitment.

### 3.2 Minor invented fields

`Local free volume` in the topology node drawer and `Mass (est.)` in the shape
analysis panel are plausible but are not computed by the engine today. Either
drop them or mark them explicitly as derived estimates.

---

## 4. Colour

You said the blue looks good. Strictly it is **teal-cyan**, `#1d858c`, and I
agree it works: it reads scientific without being cold, it has enough chroma to
survive on the translucent surfaces, and it is distinct from the near-black
visualisation canvas. **Keep it as the brand accent.** I am not proposing a
different identity colour.

But the palette has three collisions that will cause real misreadings, and they
all come from one mistake: **brand, semantic and data colours were drawn from
the same pool.** They have different jobs and must not overlap.

### 4.1 The three collisions

| Collision | Current | Consequence |
| --- | --- | --- |
| `--gold` = `--warning` | both `#cf8a38` | Data series 3 in any chart is pixel-identical to a warning state. A gold line in the batch scatter reads as "something is wrong". |
| `--success` vs `--accent-bright` | `#4ca993` vs `#4faea8` | ΔE ≈ 3 — indistinguishable. The "ready" chip looks like decorative accent, so completion stops registering as information. |
| Categorical ramp | teal, violet, gold, navy, slate | Three of the five (teal `#1d858c`, navy `#3e6584`, slate `#728391`) are low-chroma blues. In a 4-series line chart they merge; under deuteranopia teal/navy/slate collapse almost completely, and so do violet/slate. |

The third is the serious one. Compare and batch screens routinely show four
series at once, and this is a tool for reading data.

### 4.2 Proposed correction

Keep every brand and surface token exactly as it is. Add a **separate data
series ramp**, and pull the two semantic colours off the series hues.

```css
:root {
  /* ── Data series — categorical, hue-ordered for maximum separation.
        Derived from Okabe–Ito, retuned for the light canvas. Use in this
        order; never reuse a semantic colour for a series. ── */
  --series-1: #1d858c;  /* teal — brand, always the first/reference series */
  --series-2: #c25d1e;  /* burnt orange */
  --series-3: #7046b0;  /* violet */
  --series-4: #6f8540;  /* olive */
  --series-5: #a8386b;  /* magenta */
  --series-6: #3e6584;  /* navy — last, least separable */

  /* ── Semantic — moved clear of every series hue ── */
  --success: #2f8f6d;   /* was #4ca993, too close to --accent-bright */
  --success-soft: rgba(47, 143, 109, .13);
  --warning: #b8761f;   /* was #cf8a38, identical to the gold series */
  --warning-soft: #fdf2dd;
  --danger: #a34c58;    /* unchanged */
  --danger-soft: #fff0f1;

  /* --accent-bright #4faea8 is now reserved for focus, hover and active
     states only. It must never carry state meaning. */
}

[data-theme="dark"] {
  --series-1: #58c5c0;
  --series-2: #e8975a;
  --series-3: #a98ae0;
  --series-4: #a8c272;
  --series-5: #e08aa9;
  --series-6: #7fa8cc;

  --success: #5cc49b;
  --warning: #dfa857;
  --danger:  #e09aa1;
}
```

Also update the shadcn bridge tokens so the `ui/` primitives follow:
`--chart-1` through `--chart-5` currently mirror the old ramp and must be
regenerated from `--series-1…5`.

### 4.3 Hue is not enough

For a scientific tool, colour alone is never a sufficient encoding — colour-blind
users aside, these charts get printed in greyscale for papers.

```text
In every multi-series chart, encode each series THREE ways at once:
- colour, from --series-1 … --series-6 in order;
- line style: solid, dashed, dotted, dash-dot, long-dash, solid-thin;
- marker shape: circle, square, triangle, diamond, cross, star.

The legend must show all three together, so a series stays identifiable in
greyscale and under colour-vision deficiency. Apply to the Compare Rg evolution
chart, the batch scatter, the batch fractal log-log overlay and the FRAKTAL
distribution charts.
```

### 4.4 One contrast note

`--ink-muted` was already corrected to `#536a73` in the export — good, that was
the right call. Keep it. Do not revert it to `#607b82`: the 10px uppercase
tracked labels sit on translucent surfaces and need the extra contrast to clear
AA.

---

## 5. Suggested order

1. **§4.2 palette** — it is a token edit, it touches everything, do it first.
2. **§1.1 Rg evolution** — the real functional gap.
3. **§2.1 coordination preview** — the thing you noticed, cheap to fix.
4. **§2.3 Show values** — accessibility, and it unblocks printing numbers.
5. **§1.2 projection directions**, **§2.2 topology controls**, **§1.3 auth screens**.
6. **§3.1** — decide, do not postpone.

Items 1–3 are worth doing before any of this is ported into the real
`frontend/`. Items 5–6 can be adjusted during the port.
