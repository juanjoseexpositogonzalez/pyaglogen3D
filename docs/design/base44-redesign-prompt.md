# Base44 prompt — pyAgloGen3D UI redesign (Synaptiq visual language)

> **How to use this file.** Paste section 0 through 9 into Base44 as a single
> prompt. If Base44 truncates, paste sections 0–3 first (shell + design system),
> then one screen section at a time, each prefixed with
> *"Same app, same design system, add this screen:"*.
>
> This is a **design-only** brief. Base44 should produce a clickable React
> prototype with realistic mock data. No real backend, no real computation.
> The resulting design will later be ported by hand into the production stack
> (Next.js 14 App Router + Tailwind + Django REST + Rust engine).

---

## 0. What the product is

**pyAgloGen3D** is a scientific web platform for aerosol/soot researchers that
does two things:

1. **Simulates 3D fractal agglomerates** (clusters of spherical primary
   particles) with tunable fractal dimension `Df` and prefactor `kf`, using ten
   different aggregation algorithms, one at a time or as a parameter-sweep batch.
2. **Analyses real TEM/SEM microscope images** ("FRAKTAL" module) to recover the
   fractal properties of imaged agglomerates, single images or whole batches.

Its users are researchers. They care about numbers, units, uncertainty,
reproducibility (seeds) and side-by-side comparison. They are not consumer
users: **density beats whitespace, clarity beats decoration**.

The current UI is a generic dark shadcn/ui dashboard. It works but it looks
like a template. The redesign must make it look like a serious scientific
instrument platform.

---

## 1. Visual direction: "Synaptiq"

Adopt this exact design language. It is light-first, calm, teal-anchored,
very data-dense, with translucent surfaces and dark canvases reserved for
visualisations.

### 1.1 Core principles

- **Light canvas, dark instruments.** The application chrome is a soft,
  slightly teal off-white. Anything that renders data *spatially* — the 3D
  viewer, the topology graph, the projection preview, the TEM image — sits on a
  near-black panel (`#07141d`). That contrast is the signature of the system.
- **Translucency, not neon.** Surfaces are white at 64–88% opacity over a
  gradient canvas, with `backdrop-filter: blur(14–20px)`. No glow, no neon,
  no cyberpunk.
- **Micro-typography.** Labels are tiny, uppercase, heavily tracked and bold
  (9–11px, weight 700–800, letter-spacing .05–.14em). Numbers are large and
  tightly tracked. This pairing is the second signature of the system.
- **Tonal panels.** Cards carry a subtle gradient tinted by a semantic tone
  (teal = simulation/compute, violet = analysis/AI, gold = attention/approximate,
  navy = reference/documentation, slate = neutral/archive).
- **Soft, deep shadows.** `0 22px 60px rgba(23,72,84,.12)` — large and faint,
  never a hard drop shadow.

### 1.2 Design tokens (use verbatim)

```css
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;

  /* canvas & surfaces */
  --canvas: #f4f7f7;
  --canvas-deep: #eaf2f3;
  --surface: rgba(255, 255, 255, .82);
  --surface-strong: #ffffff;
  --surface-soft: rgba(255, 255, 255, .58);
  --shell-background: radial-gradient(circle at 76% 4%, rgba(50,121,132,.12), transparent 29rem),
                      linear-gradient(180deg, #f6faf9 0%, #edf5f4 41%, #e7f0f0 100%);

  /* ink */
  --ink: #112c3d;
  --ink-strong: #0a2030;
  --ink-muted: #607b82;
  --ink-faint: #879b9f;
  --ink-on-dark: #eef8f4;

  /* accents */
  --accent: #1d858c;
  --accent-strong: #14646f;
  --accent-bright: #4faea8;
  --brand-cyan: #0096bb;
  --accent-soft: rgba(48,154,151,.12);
  --mint: #a9e1d6;
  --violet: #7664bb;
  --violet-soft: rgba(118,100,187,.14);
  --gold: #b38343;
  --navy: #3e6584;
  --slate: #728391;

  /* semantic */
  --success: #4ca993;  --success-soft: rgba(76,169,147,.13);
  --warning: #cf8a38;  --warning-soft: #fff4de;
  --danger:  #a34c58;  --danger-soft:  #fff0f1;

  /* lines, shadows, radius */
  --line: rgba(26,88,95,.17);
  --line-strong: rgba(26,88,95,.28);
  --shadow: 0 22px 60px rgba(23,72,84,.12);
  --shadow-deep: 0 28px 90px rgba(13,46,57,.18);
  --focus-ring: rgba(29,133,140,.28);
  --radius: 14px;

  /* visualisation canvas (dark, always) */
  --visual-background: #07141d;
  --visual-border: rgba(231,239,233,.1);
  --visual-caption-background: rgba(7,21,29,.77);
  --visual-overlay: linear-gradient(180deg, transparent 48%, rgba(5,17,25,.7) 100%);

  /* tonal card gradients */
  --card-gradient:        linear-gradient(145deg, rgba(255,255,255,.88), rgba(237,247,246,.72));
  --panel-gradient-teal:  linear-gradient(155deg, #ffffff 0%, #f8fbfd 100%);
  --panel-gradient-violet:linear-gradient(155deg, #ffffff 0%, #fbfaff 100%);
  --panel-gradient-gold:  linear-gradient(155deg, #ffffff 0%, #fffaf1 100%);
  --panel-gradient-navy:  linear-gradient(155deg, #ffffff 0%, #f6f9fc 100%);
  --panel-gradient-slate: linear-gradient(155deg, #ffffff 0%, #f7f9fa 100%);
}

[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #091923;
  --surface: rgba(255,255,255,.065);
  --surface-strong: #102733;
  --ink: #e9f4f4;
  --ink-strong: #f4fbfb;
  --ink-muted: #9bb6b7;
  --accent: #82c7bf;
  --line: rgba(255,255,255,.1);
  --shadow: 0 18px 48px rgba(0,0,0,.2);
}
```

Ship **both themes** with a toggle in the top bar. Light is the default.

### 1.3 Type scale

| Role | Spec |
| --- | --- |
| Page title `h1` | `clamp(28px, 4vw, 39px)`, letter-spacing `-.04em`, line-height 1.05 |
| Eyebrow (above `h1`) | 10px / 800 / `.12em` / uppercase / `--accent` |
| Panel title `h2` | 16px, letter-spacing `-.015em` |
| Sub-heading `h3` | 15px |
| Body | 13px, line-height 1.6, `--ink-muted` for descriptions |
| Field label | 10px / 800 / `.06em` / uppercase / `--ink-muted` |
| Table header | 10px / `.05em` / uppercase / `--ink-muted` |
| Table cell | 12px |
| Metric value | 29px, letter-spacing `-.045em` |
| Hint / caption | 11px, `--ink-muted` |

**All numeric values** (Df, kf, Rg, counts, R², standard errors) use a tabular
monospace font (`ui-monospace, "JetBrains Mono", "SF Mono", monospace`) with
`font-variant-numeric: tabular-nums`, so columns align. Units are rendered in a
separate, smaller, muted span — never baked into the number string.

### 1.4 Component kit

Build these as reusable primitives before building the screens:

- **`MetricCard`** — min-height 130px, 17px padding, 1px `--line` border,
  `--radius`, `--surface-strong`, `--shadow`. Layout: small bold label row (with
  optional delta chip on the right) → 29px value + unit → optional 6px progress
  bar → 11px detail line. Optional `tone` prop (teal/violet/gold/navy/slate)
  that swaps the background gradient.
- **`Panel`** — 21px padding, 1px `--line`, `--radius`, `--shadow`, header row
  with `h2` on the left and a small 11px/700 accent link or action on the right,
  optional `__hint` line.
- **`VisualPanel`** — same geometry but background `--visual-background`,
  border `--visual-border`, and an absolutely positioned glass caption bar at
  the bottom (`--visual-caption-background` + `blur(12px)`) holding the title on
  the left and live readouts on the right. This wraps every 3D/graph/image view.
- **`DataTable`** — 12px rows, uppercase 10px sticky headers, 1px `--line`
  row separators, no zebra striping, right-aligned numeric columns, horizontal
  scroll, `max-height: min(42rem, 62vh)` with sticky head for long tables,
  per-row hover tint `#f8fcfc`.
- **`StatusChip`** — pill, 10px/800/uppercase, with a background/border/ink
  triplet per state: `ready` (`#4ca993`), `processing` (teal gradient
  `linear-gradient(135deg,#0d586b,#176b87 64%,#2b8190)` with light ink and a
  slow shimmer), `queued` (`#9aaab2`), `attention` (`#cf8a38`),
  `error` (`#a34c58`), `cancelled` (`#9c91aa`).
- **`StatusDot`** — 7px dot with a 3px soft ring halo, for inline list states.
- **`QualityBadge`** — same pill, used for analysis quality:
  `GOOD` / `APPROXIMATE` / `EXCLUDED` / `FAILED`.
- **`SegmentedControl`** — for view switches (Grid / Fibonacci, 2D / 3D,
  Linear / Log).
- **`FilterBar`** — 10px padding, `--radius: 12px`, translucent, horizontal row
  of tiny labelled selects, with a right-aligned result-count hint.
- **`DisclosurePanel`** — collapsible section for advanced parameters.
- **`DetailsDrawer`** — right-side drawer, width `min(440px, 100%)`, used for
  "inspect this row/particle/image" instead of a modal.
- **`DetailList`** — definition list, label left muted / value right bold, 1px
  separators, 12px. Use it for every parameter recap.
- **`Callout`** — inline notice with a tone (info/warning/danger) used for unit
  conventions, parameter mismatches and estimator caveats.
- **`EmptyState`** — icon + 15px title + 12px explanation + one primary action.
- **`Eyebrow + PageHeader`** — eyebrow, `h1`, 13px description capped at 640px,
  and a right-aligned action cluster.

### 1.5 Charts

Use ECharts-style scientific plots, not decorative ones:

- Light grid `#d7e8ec`, axis labels 10px uppercase muted, no chart borders.
- Series palette in tone order: teal `#1d858c`, violet `#7664bb`,
  gold `#cf8a38`, navy `#3e6584`, slate `#728391`, mint `#a9e1d6`.
- Log-log plots must show the **fitted line, the confidence band and the
  excluded points** in visually distinct styles (solid / translucent fill /
  hollow markers).
- Every chart has a 35px selection strip underneath showing the currently
  hovered/selected point's exact values.

### 1.6 Motion

Transitions 150–200ms, ease-out, on colour/background/border only. Running jobs
get a slow shimmer on the progress bar, never a bouncing spinner. The 3D viewer
never animates on mount. Respect `prefers-reduced-motion`.

---

## 2. Application shell

Replace the current top-nav-only layout with a **fixed left sidebar + sticky top bar**.

### 2.1 Sidebar (246px, dark `#102b3d`, full height)

- Brand lockup at the top: 34px mark, product name `pyAgloGen3D` in white 15px,
  then a 10px uppercase tagline `FRACTAL AGGLOMERATE LAB`, then a 9px/800
  version chip in `#b8e7ea`.
- Grouped nav with 10px uppercase tracked section labels:
  - **WORKSPACE** — Dashboard, Projects
  - **CURRENT PROJECT** (only when inside a project, shows the project name as
    the section label) — Overview, Simulations, Batch studies, Compare,
    FRAKTAL analyses, FRAKTAL batches
  - **TOOLS** — AI Assistant *(only if the user has AI access)*
  - **ADMIN** — Users *(only for admins)*
- Nav link: 13px, 10px/13px padding, 9px radius, muted `#a9becb`; active state
  = `rgba(133,214,225,.15)` background, white ink, `inset 3px 0 0 #8be0e4` left
  bar. Sub-navigation is indented with a 1px left rule.
- Footer: connection StatusDot + "Engine online" + worker queue depth, 11px.
- Collapses to icon-only at `<1280px`, becomes an off-canvas drawer at `<900px`.

### 2.2 Top bar (sticky, 64px, translucent + blur)

Left: breadcrumb context (`Project · Simulation`) 12px with the current entity
in bold ink. Center: nothing. Right: theme toggle, an environment pill
(`PRODUCTION` / `LOCAL`), notifications bell with a count, 30px circular avatar
with initials and a user menu (Settings, AI Settings, Sign out).

### 2.3 Page frame

`max-width: 1440px`, margin auto, padding `36px 40px 56px`. Every page starts
with a `PageHeader`.

### 2.4 Global conventions

- A persistent, dismissible **unit-convention callout** on any page that shows
  physical quantities: "Lengths in nm · Schema v2 · Scale factor 1.0".
  It is informational, tone *navy*, and remembers its dismissal.
- Any estimated quantity shows its uncertainty inline: `2.533 ±0.041` with the
  tolerance in a muted smaller span, plus `R²` where a fit exists.
- Reproducibility is first-class: the **seed** is always visible next to the
  algorithm name and is one-click copyable.

---

## 3. Screen inventory

Fourteen screens. Build them in this order.

---

### SCREEN 1 — Authentication (login, register, verify e-mail, check e-mail)

**Layout.** Two-column `min(100%, 1120px)` grid centred on a radial-gradient
canvas. Left column: a 3:2 dark hero visual (`--visual-background`) showing a
rendered fractal agglomerate, with the brand lockup floating top-left in
`--ink-on-dark` and a glass caption bar at the bottom reading
`Tunable fractal aggregate · Df 2.70 · N 512`. Right column: the auth card —
`min(100%, 480px)`, 30px padding, 18px radius, `rgba(255,255,255,.9)`,
`0 20px 60px rgba(34,57,79,.12)`.

**Card contents.** `h1` `clamp(26px,4vw,34px)`, a 12px muted description,
then the form: labels are 10px uppercase tracked, inputs are 10/11px padded,
8px radius, focus = `--accent` border + `3px solid var(--focus-ring)` outline.
Full-width primary submit. A footer rule with the alternate action link
(11px, centred).

**Variants.**
- *Sign in*: e-mail, password, "Sign in with Google" OAuth button above a
  `— or —` divider, "Forgot password?" link.
- *Create account*: first name, last name, e-mail, password, confirm password,
  inline password-strength meter (6px bar, teal→mint).
- *Check your e-mail*: centred envelope illustration, the address in bold,
  "Resend" secondary action with a 60s cooldown.
- *Verify e-mail*: three states — verifying (shimmer), success (teal check +
  auto-redirect countdown), failed (danger callout + "Request a new link").

---

### SCREEN 2 — Dashboard

**Purpose.** Where the researcher lands. Answers: what is running right now,
what did I touch last, what is the state of my lab.

**Layout.**
1. `PageHeader`: eyebrow `WORKSPACE`, `h1` "Dashboard", description, right
   action cluster `New project` (primary) + `New simulation` (secondary).
2. `metric-grid` of four `MetricCard`s: **Projects**, **Simulations**
   (with a `12 running` delta chip), **FRAKTAL analyses**, **Engine queue**
   (value = jobs queued, progress bar = worker utilisation).
3. A two-column `content-grid` (`1.55fr / .9fr`):
   - **Left — "Active jobs"** `Panel`. A `DataTable` of running/queued work:
     Name · Kind (Simulation / Batch / FRAKTAL) · Algorithm · Progress (inline
     6px bar + `47 / 120`) · Elapsed · StatusChip · Cancel. Rows link to their
     detail page. Empty state: "Nothing running. The engine is idle."
   - **Right — "Recent projects"** `Panel`. Stacked cards: project name, 11px
     relative timestamp, counts as three tiny labelled stats
     (`8 SIM · 3 BATCH · 2 FRAKTAL`), owner/shared avatar group.
4. A lower two-column grid:
   - **"Throughput"** `Panel` with a 280px stacked-area chart of completed
     simulations per day for 30 days, split by algorithm.
   - **"Df distribution across the workspace"** `Panel` with a histogram of
     measured fractal dimension, 1.5 → 3.0, teal bars, with reference ticks at
     `Df=1` (chain), `Df=2` (plane), `Df=3` (sphere).

---

### SCREEN 3 — Projects

`PageHeader` eyebrow `WORKSPACE`, `h1` "Projects", right action `New project`.

A `FilterBar`: search, owner (Mine / Shared with me / All), sort
(Recent / Name / Most simulations), and a view toggle (`SegmentedControl`:
Grid / Table).

**Grid view.** Responsive cards (3 columns at 1440px). Each card:
`--card-gradient` background, a 100px dark preview strip showing a thumbnail of
the project's most recent aggregate render, then name (15px), 12px muted
description clamped to two lines, a `DetailList`-style stat row
(`SIMULATIONS 8 · BATCHES 3 · ANALYSES 2`), and a footer with a shared-with
avatar group, a `Shared` chip when applicable, relative updated-at, and an
overflow menu (Open, Share, Rename, Delete).

**Table view.** `DataTable` with Name · Description · Simulations · Batches ·
FRAKTAL · Owner · Shared with · Updated · actions.

**Empty state.** Dark illustrated panel, "No projects yet", "A project groups
simulations, batch studies and image analyses that belong to the same
investigation.", primary `Create your first project`.

---

### SCREEN 4 — New project

Narrow single-column `min(100%, 720px)` centred form in one `Panel`:
project name, description (textarea, 4 rows), and an optional
`DisclosurePanel` "Defaults for this project" containing default primary
particle radius (nm), default refractive index material, and CSV decimal
separator. Sticky footer bar with `Cancel` / `Create project`.

---

### SCREEN 5 — Project detail

**Purpose.** The hub of one investigation. Three bodies of work live here.

**Header.** Eyebrow = `PROJECT`, `h1` = project name (inline-editable on click),
description underneath, right action cluster: `Share` (opens the share modal),
`Import aggregate` (opens the import dialog), and a split primary button
`New simulation ▾` whose menu offers *Single simulation*, *Batch study*,
*FRAKTAL analysis*, *FRAKTAL batch*.

**Body.** A top row of four `MetricCard`s (Simulations · Batch studies ·
FRAKTAL analyses · Mean Df across completed runs, with ± std).

Then three stacked `Panel` sections, each with its own header action:

1. **Simulations.** Toolbar: search, status filter, algorithm filter, and a
   `Compare selected` button that activates once 2+ rows are checked.
   `DataTable`: checkbox · Name · Algorithm chip · N particles · Df (measured,
   with ± and a tiny delta against the target when one exists) · kf · Rg (nm) ·
   Seed (monospace, copyable) · StatusChip · Created · row actions
   (Open, Export CSV, Analyze projections, Duplicate, Delete). Running rows
   show an inline progress bar in place of the metrics.
2. **FRAKTAL analyses.** Card grid, each card showing a 120px dark thumbnail of
   the analysed micrograph, the analysis name, `Df`, `kf`, `npo`, a
   `QualityBadge`, and the StatusChip.
3. **FRAKTAL batches.** `DataTable`: Batch name · Images (`96 analysed / 100`) ·
   Mean Df ± σ · Q1–Q3 · Failed count (danger chip when > 0) · StatusChip ·
   Created · actions (Open summary, Re-analyze failed).

**Share modal.** Title "Share project", an invite row (e-mail input + role
select `Viewer / Editor` + `Invite`), then a member list with avatar, name,
e-mail, role select, and a remove action. A footer section "Link sharing" with a
switch and a copyable read-only URL.

**Import aggregate dialog.** Tabbed `CSV` / `MATLAB (.mat)`. Drop zone on a
dashed `--line-strong` border, a parsed-preview `DataTable` of the first ten
rows (`x`, `y`, `z`, `r`), a column-mapping row of selects, a units select
(nm / µm / m), and a validation summary callout
("512 particles parsed · bounding box 184 nm · no NaN found").

---

### SCREEN 6 — New simulation

**Purpose.** Configure one aggregate generation run. This is the densest form in
the product and currently the worst-looking screen. Redesign it as a
**two-column workbench**, not a vertical stack of cards.

**Left column (flexible, ~62%) — configuration, in `Panel`s:**

1. **Identity.** Simulation name, optional notes.
2. **Algorithm.** A selectable card grid — not a dropdown — with one card per
   algorithm, each showing the short label, a one-line description, and a
   typical-`Df` range chip. The ten algorithms are:
   - `DLA` Diffusion-Limited Aggregation — *Df ≈ 2.4–2.6*
   - `CCA` Brownian Cluster-Cluster — *Df ≈ 1.8–2.0*
   - `Ballistic PC` Particle-Cluster — *Df ≈ 2.8–3.0*
   - `Ballistic CC` Cluster-Cluster — *Df ≈ 1.8–2.2*
   - `Tunable PC` Filippov method — *target Df and kf*
   - `Tunable CC` Cluster-Cluster — *target Df and kf*
   - `FracVAL` Polydisperse CC (Morán et al. 2019) — *lognormal sizes*
   - `Generalized CCA` Tomchuk & Avdeev 2020 — *configurable split strategy*
   - `Box-Counting RFA` Brown et al. 2010 — *exact target Df via grid refinement*
   - `Limiting case geometry` — *deterministic reference: chain Df=1,
     hexagonal plane Df=2, compact sphere Df=3*
   Selecting a card re-renders the parameter panel below. The card grid stays
   visible, with the selected card in the teal selected state.
3. **Parameters.** Grouped into `DisclosurePanel`s:
   - *Structure*: number of primary particles `N` (slider + number input),
     primary particle radius `dpo/2` in nm, target `Df`, target `kf`
     (the last two only for tunable/RFA/gCCA algorithms).
   - *Size distribution*: a single `DistributionSelector` — mode
     (`Fixed` / `Normal` / `Uniform` / `Lognormal`) and then the parameters for
     that mode. **There must be exactly one place in the UI that defines
     polydispersity.** When the selected algorithm overrides or ignores a
     distribution, the control is disabled with an explanatory callout, never
     silently ignored.
   - *Sintering*: enable switch, then sintering coefficient with the same
     distribution control.
   - *Reproducibility*: seed mode (`Random` / `Fixed`) and seed value,
     monospace, with a dice button to reroll.
   - *Import instead*: a secondary route that swaps the parameter panel for the
     CSV/MAT import dialog described in screen 5.
4. **Estimated cost callout.** A live tone-navy callout: "≈ 12 s on the engine ·
   512 particles · ~1.4 MB geometry".

**Right column (sticky, ~38%) — live preview and recap:**

- A `VisualPanel` with a schematic preview of the structure the current
  parameters imply (a procedurally generated placeholder in the prototype),
  caption bar showing `N`, `Df target`, `kf target`.
- A `DetailList` recap of every parameter that will be submitted, in the exact
  order the engine receives them.
- A sticky action bar: `Run simulation` (primary) and `Save as draft`.

Validation errors appear as inline field messages plus a danger summary callout
above the action bar listing every blocking field as a clickable anchor.

---

### SCREEN 7 — Simulation detail

**Purpose.** The flagship screen. Everything known about one aggregate.

**Header.** Eyebrow `SIMULATION`, `h1` = name, then a 12px meta row:
algorithm chip · `N = 512` · `Seed 48213` (monospace, copy icon) ·
created timestamp · StatusChip. Right action cluster: `Export CSV`,
`Analyze projections`, overflow menu (Duplicate, Rename, Delete), and `Cancel`
when running.

**Running / queued state.** Replace the body with a single large tone-teal
`Panel`: a 6px shimmer progress bar, `Generating agglomerate structure…`,
elapsed time, a live particle counter, and `Cancel simulation`. Poll silently.

**Cancelled / failed state.** A warning or danger `Panel` with the engine
message in monospace inside a scrollable code block and a `Re-run` action.

**Completed state.** A tabbed workbench — the tab strip is a `SegmentedControl`
pinned under the header. Tabs: **Overview · Structure · Fractal analysis ·
Optical · Topology · Projections**.

**Tab 1 — Overview.**
- Four `MetricCard`s: `Fractal dimension Df` (value ± σ, with `R² 0.994` as the
  detail line and a delta chip versus the target when one exists),
  `Prefactor kf`, `Radius of gyration Rg` (nm), `Porosity` (%).
- Two-column grid below: left, a tall `VisualPanel` with the interactive 3D
  viewer; right, a `Panel` stack with `Coordination number` (mean, min, max,
  plus a small histogram) and `Shape analysis` (principal moments of inertia
  `I₁ I₂ I₃` as a three-bar mini chart, anisotropy and sphericity as a
  `DetailList`).
- A collapsed `Panel` at the bottom: `Simulation parameters` as a `DetailList`
  mirroring exactly what was submitted.

**3D viewer (`VisualPanel`) specification.** Dark `#07141d` canvas. Overlay
controls as a floating glass card in the top-right corner, collapsible,
containing: colour mode (`Uniform` / `By coordination` / `By radius` /
`By distance from centre`), particle opacity slider, background select
(`Deep` / `Black` / `Transparent`), a `Show bounding sphere` switch, a
`Show Rg shell` switch, and an `Export PNG` button. Bottom-left: a scale bar in
nm. Bottom caption bar: live camera readout (azimuth/elevation) plus the
hovered particle's index and coordination. Top-left: four preset camera buttons
(`+X`, `+Y`, `+Z`, `ISO`) and a reset.

**Tab 2 — Structure.** The full particle `DataTable` (index, x, y, z, r,
coordination, neighbours) with a `DetailsDrawer` on row click showing that
particle's neighbours and local density, plus a `Download geometry` action.

**Tab 3 — Fractal analysis.** The box-counting workbench.
- A `SegmentedControl` for the estimator (`Box counting` / `Rg power law`) and
  one for the scaling (`Linear` / `Log-log`).
- A large log-log `FractalPlot`: `log N(ε)` versus `log(1/ε)`, the fitted
  regression line, a translucent 95% confidence band, excluded points drawn as
  hollow markers with a muted `(excluded)` legend entry, and optional dashed
  reference lines for the limiting cases (chain Df=1, plane Df=2, sphere Df=3)
  toggled from a `LimitingCasesCard` beside the plot.
- Under the plot: three `MetricCard`s — `Fractal dimension`, `Std. error`,
  `95% CI` (rendered as `[2.49, 2.58]`).
- A gold `Callout` whenever the estimator is known to be biased for the
  current `N`, e.g. "Small-N bias: for N = 100 the box-counting estimator
  typically under-reports a target Df of 2.7 by ≈ 0.15."
- The `LimitingCasesCard` also offers a 3D preview of the reference shapes:
  `Chain` / `Cross` / `Star` / `Plane` / `Cuboctahedron` as a tab strip over a
  small dark canvas.

**Tab 4 — Optical.** RDG-FA properties.
- A `FilterBar`-style parameter row: `Material` select, `Wavelength (nm)`
  input, `Medium index`, `Dipoles per wavelength`.
- Four `MetricCard`s: `Refractive index (n)`, `Absorption (k)`,
  `Single scatter albedo (SSA)`, `Asymmetry parameter (g)`.
- A spectral chart of the cross-sections versus wavelength.
- A danger `Callout` for `Calculation failed`, with the reason.

**Tab 5 — Topology.** The neighbour graph.
- A `StatsBanner` strip of four inline stats: `Particles`, `Connections`,
  `Avg. coordination`, `Graph status`.
- A full-width `VisualPanel` holding the force-directed network, nodes coloured
  by coordination number using the teal→violet ramp, edges hairline at 35%
  opacity, zoom/pan controls bottom-right.
- Clicking a node opens the `DetailsDrawer`: node index, coordination,
  neighbour list (each clickable), distance to centre of mass, and a
  `Focus in 3D viewer` action.

**Tab 6 — Projections.** 2D projections of the 3D aggregate, the bridge into
FRAKTAL.
- Left: a `Panel` with the projection controls — grid mode `SegmentedControl`
  (`Grid` / `Fibonacci`), number of directions, image size in px, background,
  and a `Preview single projection` action.
- Centre: a `VisualPanel` showing the hemisphere direction grid in 3D with the
  currently selected direction highlighted, plus the rendered 2D projection
  beside it.
- Right: a `Panel` "Export projections" — format, resolution, naming pattern,
  a `Batch download` primary button, and a progress strip while the export runs.
- Footer action: `Send these projections to FRAKTAL batch` (primary) which
  carries the known `dpo` across so auto-calibration can default to off.

---

### SCREEN 8 — Batch simulations (parameter sweep studies)

**Purpose.** Run a grid of simulations across parameter ranges and read the
aggregate statistics.

**Header.** Eyebrow `BATCH STUDY`, `h1` "Batch simulations", description, right
action `New batch study`.

**Left rail (320px) — "Previous studies".** A scrollable list of study cards:
name, 11px timestamp, `48 runs` count, a mini sparkline of the resulting Df, and
a StatusChip. Selecting one loads it into the main area.

**Main area, tabbed: `Configure` · `Results` · `Fractal analysis` · `Export`.**

**Configure tab.** The batch form as a grid builder:
- Study name and base algorithm (the same card grid as screen 6, compact).
- A **parameter grid builder**: each row is one swept parameter — a parameter
  select, a mode `SegmentedControl` (`Single` / `List` / `Range` / `Distribution`),
  then the mode's inputs (range = from / to / step; list = chips; distribution =
  the same `DistributionSelector` as screen 6). Add/remove rows.
  Sweepable parameters include `N particles`, `target Df`, `target kf`,
  `primary radius`, `size distribution`, `sintering`, `seed type`.
- A live **"Grid expansion" preview** `Panel` to the right: a `DataTable` of the
  first fifteen generated combinations plus a bold total
  (`4 × 3 × 2 = 24 runs · ≈ 6 min`). This preview is the whole point of the
  screen — make it prominent.
- `Repeats per combination` and `Seed strategy` (`Shared` / `Per run`).
- Sticky action bar: `Launch batch`.

**Results tab.** A progress header (`86 / 120 complete · 2 failed`, 6px bar,
`Cancel remaining`), a `FilterBar`, then the results `DataTable`: Run # ·
swept parameter columns (dynamically generated, highlighted with a faint teal
column tint) · measured `Df ± σ` · `kf` · `Rg` · `R²` · StatusChip · open.
Above the table, a scatter plot of the primary swept parameter versus measured
`Df`, with error bars and a trend line, and a `SegmentedControl` to change the
Y-axis metric.

**Fractal analysis tab.** Batch-level box counting: a windowed/global
`SegmentedControl`, the aggregated log-log plot with one faint line per run and
a bold mean line, and four `MetricCard`s (`Mean Df`, `σ`, `Q1–Q3`, `Runs
excluded`). A `Re-run analysis` action with an explicit estimator select.

**Export tab.** The projection export panel described in screen 7, applied to
every run in the study, plus `Export results CSV` with a decimal-separator
select that respects the user's locale preference.

---

### SCREEN 9 — Compare simulations

**Purpose.** Put two to four aggregates side by side, structurally and
numerically.

**Header.** Eyebrow `PROJECT`, `h1` "Compare simulations", right actions
`Add simulation` and `Export comparison`.

**Body.**
1. A **selection strip**: up to four slots; each filled slot is a compact chip
   card with the simulation name, algorithm chip, its assigned series colour
   (teal / violet / gold / navy) and a remove `×`. Empty slots are dashed
   `+ Add`.
2. A **`CompareGrid`** of `VisualPanel`s, one per simulation, in a responsive
   2×2. Each panel's caption bar shows that aggregate's `Df`, `kf`, `N`.
   A prominent toggle above the grid: **`Synchronised camera`** — when on, all
   viewports share one camera; a small badge on each panel confirms the link.
3. A second toggle: **`Overlay mode`** — collapses the grid into one shared
   viewport where the aggregates are superimposed with per-series colour and
   50% opacity, with a floating `Legend` card listing each series, its colour,
   an eye toggle and an isolate action.
4. A **`CompareMetricsTable`**: metrics as rows, simulations as columns, the
   best value per row subtly highlighted, and a final `Δ vs. first` column.
   Rows: `Fractal dimension (Df)`, `Prefactor (kf)`, `Radius of gyration (nm)`,
   `N particles`, `Primary radius (nm)`, `Porosity`, `Mean coordination`,
   `Anisotropy`, `Algorithm`, `Seed`.
5. A **`CompareSettingsPanel`** drawer: colour mode, particle opacity,
   normalise scale by `Rg` switch, show bounding spheres switch, background.

---

### SCREEN 10 — New FRAKTAL analysis

**Purpose.** Analyse one real microscope image.

**Two-column workbench.**

**Left — configuration `Panel`s:**
1. **Analysis name.**
2. **Image source.** Drop zone, or `Pick from a simulation's projections`, or
   a URL. After upload, show the filename, dimensions in px and file size.
3. **Analysis model.** Select with a 12px explanatory line per option.
4. **Scale calibration.** The critical input: `pixels per 100 nm`, with an
   `Auto-calibrate` switch. When auto-calibration is on, explain in a callout
   what it infers and from what. When the image came from a simulation,
   auto-calibration defaults to **off** and a navy callout states
   "`dpo = 14.0 nm` carried over from simulation *name*".
   Offer an interactive `Measure on image` tool: drag a line on the preview and
   type its known length.
5. **Model parameters.** `dpo (nm)`, `overlap exponent zf`,
   `coordination index Jf`, each with a reference-value hint.
6. **Segmentation.** Threshold mode (`Otsu` / `Manual`), threshold slider with a
   live binarised preview, minimum object size, `Fill holes` switch,
   `Exclude border objects` switch.

**Right — sticky `VisualPanel`:** the image preview with the segmentation mask
overlaid in translucent teal, a `SegmentedControl` over it
(`Original` / `Mask` / `Overlay`), zoom/pan, and the caption bar showing cursor
position in px and nm.

Sticky action bar: `Run analysis`.

---

### SCREEN 11 — FRAKTAL analysis results

**Header.** Eyebrow `FRAKTAL ANALYSIS`, `h1` = analysis name, meta row with the
model, timestamp, StatusChip and `QualityBadge`. Actions: `Re-run`,
`Export CSV`, `Delete`.

**Body.**
- Four `MetricCard`s: `Fractal dimension (Df)`, `Prefactor (kf)`,
  `Primary particles (npo)`, `Radius of gyration (Rg)`.
- Two-column grid:
  - Left: `VisualPanel` "Analysed image" with the mask overlay and the detected
    primary-particle circles drawn in mint; `SegmentedControl` for
    Original / Mask / Detected particles.
  - Right: a `Panel` stack —
    **Geometry** (`Projected area (Ap)`, `Perimeter`, `Max length`,
    `Aspect ratio`), **Physical properties** (`Mass`, `Volume`,
    `Surface area`, `Calculated npo`), **Analysis parameters**
    (`dpo`, `zf`, `Jf`, `overlap`, model name) and **Projection parameters**,
    all as `DetailList`s.
- **Parameter-mismatch state.** A gold `Callout` "Parameter mismatch detected"
  when the visual estimate of `dpo` disagrees with the supplied one, expanding
  into a comparison `DataTable` with columns `Metric · Visual estimate ·
  Supplied · Ratio · Change`, and a primary action
  `Re-run with suggested dpo = 12.4 nm`.
- **Failed state.** Danger `Panel` with the error, the diagnostic block in
  monospace, and `Re-run with different segmentation`.

---

### SCREEN 12 — FRAKTAL batch (upload, summary, image detail)

**12a — Batch upload.** `h1` "Batch FRAKTAL analysis". A large drop zone
accepting many images or a ZIP, then a thumbnail grid of the queued images with
per-image remove. Below it, the same model / calibration / segmentation panels
as screen 10, applied to all images, plus a `Per-image calibration` switch that
reveals a per-row calibration column. When arriving from a simulation, a navy
callout names the origin simulation and pre-fills `dpo`. Primary: `Analyze N images`.

**12b — Batch summary.** The main screen.
- **Header** with the batch name, `96 / 100 analysed`, StatusChip, and actions
  `Re-analyze failed` (shows the failed count on the button),
  `Export CSV`, `Delete`.
- A running batch shows a stage-aware progress strip:
  `Analyzing · 64 / 100 · stage: segmentation`.
- Four `MetricCard`s: `Mean Df ± σ`, `Median Df`, `Q1–Q3`, `Images excluded`.
- **Distributions `Panel`.** Histograms with overlaid kernel density for `Df`,
  `kf`, `npo` and `Rg`, as a 2×2 grid, each with its mean marked by a dashed
  teal line and the inter-quartile band shaded. A `SegmentedControl` switches
  between `All images` / `Accepted only`.
- **Study comparison `Panel`.** When the batch is linked to a simulation study,
  a grouped bar chart comparing simulated versus measured `Df` and `kf`, with a
  `DetailList` of the deltas and a plain-language verdict line
  ("Measured Df is 0.09 below the simulated value, within the estimator's
  expected bias for N = 100.").
- **Images `DataTable`.** Thumbnail · filename · `Df` · `kf` · `npo` · `Rg` ·
  `QualityBadge` · StatusChip · open. Filterable by quality, sortable by every
  numeric column. Rows that are `APPROXIMATE` get a faint gold tint,
  `EXCLUDED` a faint slate tint, `FAILED` a faint danger tint.

**12c — Batch image detail.** A single image inside a batch, with previous/next
arrows and `3 of 100` in the header.
- Left: `VisualPanel` with the image, mask and detected particles.
- Right: `Fractal metrics` `DetailList`, `Calibration` `DetailList`
  (pixels per 100 nm, source: auto / manual / inherited), and, depending on the
  state, one of: a gold `Approximate result` `Panel` explaining why, a slate
  `Excluded` `Panel` with the exclusion rule, or a danger `Analysis failed`
  `Panel` with `Diagnostic info` in a collapsible monospace block.
- Footer action: `Re-analyze this image` with an inline parameter override.

---

### SCREEN 13 — AI Assistant (+ AI settings)

**13a — Assistant.** A three-pane chat workspace.
- Left (280px): **Conversations** list with search and `New conversation`;
  each item shows the title, a 11px snippet and a relative timestamp.
- Centre: the conversation. User messages right-aligned on a tinted teal
  surface, assistant messages full-width on `--surface-strong` with a small
  violet avatar. Assistant messages render markdown, code blocks with copy
  buttons, and **inline result cards** — when the assistant references a
  simulation or analysis, render a compact `MetricCard` row instead of raw
  numbers. A `Thinking…` state shows three softly pulsing violet orbs, not a
  spinner. Composer at the bottom: auto-growing textarea, attach button, model
  chip showing the active provider and model, and send.
- Right (collapsible, 300px): **Context** — which project, simulations and
  analyses the assistant can see, each as a removable chip, plus a
  `Notifications` section.
- **No access state.** A centred violet-toned card: "Access required", an
  explanation, and `Request access`.

**13b — AI settings.** `h1` "AI settings". A `Panel` listing configured
providers as rows (provider logo, name, masked key, default model, status dot,
test/edit/remove). A second `Panel` "Add AI provider": provider select, API key
input with a reveal toggle, a model picker grouped by family with capability
chips (context window, vision, cost tier), a default-model radio, and
`Test connection` which reports latency and the model list it saw.

---

### SCREEN 14 — Settings and Admin

**14a — Settings.** `h1` "Settings", a left sub-navigation of sections
(Profile, Preferences, CSV export, Danger zone) and a right content column.
- *Profile*: avatar, first/last name, e-mail (read-only with a verified chip),
  change password.
- *Preferences*: theme (`System` / `Light` / `Dark`), default units,
  default algorithm, result polling interval.
- *CSV export*: decimal separator (`.` / `,`), field delimiter,
  include-metadata-header switch, and a live 4-row preview of the resulting file
  in monospace. This preview must update as the options change.
- *Danger zone*: bordered danger `Panel` with `Delete account`.

**14b — Admin.** `h1` "All users", a `FilterBar` (search, role, AI access,
status), and a `DataTable`: avatar+name · e-mail · role select · `AI access`
switch · projects count · last seen · actions. The current user's own role and
access controls are disabled with a `(cannot change own)` hint, and admins show
an `(admins always have access)` hint on the AI switch. Row click opens a
`DetailsDrawer` "Edit user" with first name, last name, role, AI access, and a
`Reset password` action.

---

## 4. Cross-cutting states

Every data surface must have all five states designed, not just the happy one:

1. **Loading** — skeletons that match the real layout's geometry (shimmering
   `--surface-soft` blocks), never a centred spinner on a blank page.
2. **Empty** — illustrated dark panel, 15px title, 12px explanation of what the
   thing is for, one primary action.
3. **Partial / degraded** — gold callout naming exactly what is missing
   ("4 of 100 images failed segmentation").
4. **Error** — danger callout with the human cause first, the raw engine
   message collapsed behind `Show diagnostic`.
5. **Running** — shimmer progress with real counts and a cancel action.

---

## 5. Scientific-UI rules (non-negotiable)

- **Never show a bare number.** Every quantity carries its unit and, when it is
  an estimate, its uncertainty and fit quality.
- **Never hide an exclusion.** If points, images or runs were dropped from an
  aggregate, the count is visible next to the aggregate and one click reveals
  which ones and why.
- **One concept, one control.** Polydispersity, calibration and seed strategy
  each have exactly one input location per form.
- **Show the provenance.** Any value inherited from elsewhere (a `dpo` carried
  from a simulation, an auto-calibrated scale) says where it came from.
- **Reproducibility is visible.** Algorithm + seed + parameter recap are always
  one click away from any result.

---

## 6. Accessibility

WCAG 2.1 AA contrast on all text including the tiny uppercase labels (bump
`--ink-muted` to `#536a73` where a label sits on a translucent surface). Full
keyboard navigation with a visible `3px var(--focus-ring)` focus ring. All
charts and 3D views have a text alternative: a `DataTable` behind a
`Show values` toggle. Status is never conveyed by colour alone — every chip
carries a word, every dot a tooltip. `prefers-reduced-motion` disables shimmer
and auto-rotation.

---

## 7. Responsive behaviour

- `≥1440px` — full layout as described.
- `1280–1439px` — sidebar collapses to icons; four-up metric grids stay four-up.
- `900–1279px` — two-column workbenches stack, configuration first, preview
  second but sticky to the viewport bottom as a collapsible sheet; metric grids
  become 2×2.
- `<900px` — single column; sidebar becomes an off-canvas drawer; `DataTable`s
  become stacked definition cards; the 3D viewer gets a fixed 16:9 height and
  its overlay controls move into a bottom sheet.

---

## 8. What to deliver

A React prototype with:

- The shell (sidebar, top bar, page frame, theme toggle) implemented once.
- The component kit from section 1.4 as reusable components.
- All fourteen screens, navigable from the sidebar and from each other
  (project → simulation → fractal tab → FRAKTAL batch, etc.).
- Realistic mock data: eight simulations across different algorithms with
  plausible `Df` values matching each algorithm's typical range, two batch
  studies, one FRAKTAL batch of 100 images with 4 failures and 7 approximate
  results, three projects, two users.
- Both light and dark themes.
- All five states per screen reachable via a hidden `?state=` query parameter or
  a small dev state-switcher, so each state can be reviewed.

---

## 9. What NOT to do

- Do not invent features that are not in this brief. The screen inventory is the
  complete, already-implemented functionality.
- Do not use neon, glow, heavy gradients on text, or a purple/blue SaaS palette.
  The accent is teal.
- Do not centre-align body text or use large hero whitespace inside the app.
  This is an instrument, not a landing page.
- Do not replace data tables with cards on desktop.
- Do not use emoji as icons; use a consistent 16px line-icon set
  (Lucide-compatible).
- Do not animate the 3D viewer on mount or auto-rotate by default.
- Do not round numbers for looks; show the precision the engine reports and let
  the user change it in Settings.
