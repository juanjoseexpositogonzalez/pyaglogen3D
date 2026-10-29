# Base44 — third pass verdict and port checklist

Audit of the third re-export of `docs/design/fierce-fractal-logic-lab/`.

**Verdict: stop iterating in Base44. The design is done enough to port.**

Everything that was a *design* problem is solved. What remains is six items that
are cheaper and safer to build against the real frontend, because each of them
needs real routes, real data or real state that a prototype can only fake.

---

## 1. What the third pass closed

| § | Item | Note |
| --- | --- | --- |
| A.1 | Retired hexes migrated | 36 call sites → 2 left (§3.1) |
| A.2 | Single source of truth for the ramp | Better than specified (§2) |
| A.3 | Triple encoding | Complete: `DASH` + `SeriesDot` + `SeriesSwatch` |
| C | "Show values" | 10 of 10 surfaces, including both 3D views |

### Two things done better than asked

**The ramp now reads itself from CSS.** `lib/chartTheme.js` keeps the literals
only as an SSR fallback, reads `--series-1…6` from the document at load, and
re-reads them through a `MutationObserver` on `class` and `data-theme`. That
last part I did not ask for and it is the piece that matters: charts now repaint
with the dark-theme ramp when the theme flips, instead of silently keeping the
light values.

**Markers are thinned, not drawn on every sample.** `SeriesDot` only renders on
rows flagged by `markEvery()`, so a 500-point series gets readable glyphs
instead of a solid smear. That is the difference between triple encoding that
helps and triple encoding that ruins the plot.

The six marker shapes, six dash patterns and six colours are all indexed by the
same series position, and `SeriesSwatch` shows the three together in the legend.
This is the part that makes the charts survive greyscale printing for a paper.

---

## 2. Residual items — do these during the port, not in Base44

### 2.1 Two retired hexes left

`pages/AiAssistant.jsx:123` and `:140` still carry
`linear-gradient(135deg,#7664bb,#5a4a92)` on the assistant avatar. It is
decorative, not a series, so nothing misreads — but `#7664bb` is a token that no
longer exists. Replace with `--series-3` (`#7046b0`) and a 25%-darker stop, or
introduce an explicit `--ai-avatar` token.

### 2.2 Projection direction grid — graticule, planned vs generated

Asked twice, still untouched (`DirectionGrid.jsx`, 74 lines, unchanged across
all three exports).

This one genuinely belongs in the port: the real `HemisphereGrid.tsx` already
implements the stereographic projection, the parallels at 15/30/45/60/75° and
the 0.5°-tolerance match between planned and generated directions. Porting the
existing component is less work than re-specifying it to a generator.

> Port note: keep `lib/stereographic.ts` as-is and restyle `HemisphereGrid`
> to the new tokens. Do not rebuild it from the Base44 `DirectionGrid`, which
> is a simpler flattened polar plot without the planned/generated distinction.

### 2.3 Topology graph physics controls

Asked twice, still zoom in / out / reset.

Also better in the port: the real app renders this with vis-network, which has
the physics engine already. The controls are an exposure problem on a real
engine, not a design problem on a mock layout.

> Port note: freeze/run, link distance, repulsion, colour-by, fit-to-view and
> the node cap map onto vis-network options directly.

### 2.4 check-email and verify-email screens

Asked twice, still absent. The three states of the verify screen (verifying /
success / failed) are real routes with real token outcomes, so they are better
designed against the actual backend responses than guessed in a prototype.

### 2.5 "Precision shown" is still a dead field

Settings has the input and a correct explanatory callout, but nothing reads it.
In the port it becomes a real preference, so wire it there:

> Port note: a `usePrecision()` hook feeding `MetricCard`, `DetailList` and
> `DataTable`. Seeds, counts and percentages keep their own formatting.

### 2.6 Forgot/reset password — still undecided

`ForgotPassword.jsx` and `ResetPassword.jsx` are still exported. The backend has
no password-reset flow. **This is the only item blocked on you, and it costs one
word:** keep them as a backend feature request, or drop both routes and the
"Forgot password?" link on the login card.

---

## 3. Why stop here

The first delta found four missing features and three colour collisions. The
second found a half-applied palette. This one found two stray hexes.

That curve is the signal: Base44 has given what it can give. The remaining six
items all share a property — they need something a prototype does not have
(real routes, a real physics engine, a real projection dataset, a real settings
store). Specifying them to a generator a third time costs more than building
them once against the real frontend.

**Recommended next step:** treat the port as an OpenSpec change. It alters the
behaviour of every screen in the product, so it needs a contract and approval
before code — the short lane does not cover it. The three delta documents plus
this checklist are the input to its `explore` phase, not a substitute for it.
