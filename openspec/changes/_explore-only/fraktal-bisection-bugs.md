# Exploration Report: FRAKTAL Batch Bisection Bugs (2026-04-29)

> **Status**: READ-ONLY exploration — no code changes.
> **Scope**: 4 bugs in the FRAKTAL batch analysis pipeline.
> **Context**: User uploaded ZIP of 31 projection images (N=1000 simulation, Az/El grid sweep). 30/31 failed "Bisection method failed to converge". Image 13 succeeded with n_particles ≈ 50.

---

## Glossary: FRAKTAL Algorithm Concepts

Before the bug analysis, a conceptual clarification of FRAKTAL's key terms
(sourced from the Rust engine implementation, which is a direct port of the
MATLAB PhD code):

### `dpo` — Diameter of Primary Object (nm)

The mean diameter of an individual primary particle (monomer) in physical units
(nanometers). In the Granulated 2012 model, `dpo` is an INPUT parameter — it's
the known size of the primary spheres that make up the aggregate. The algorithm
uses it to compute the projected area of a single primary particle (`Apo`) via:

```
Apo = (π/4) × dpo² × overlap_correction(Jf, δ)
```

When `autocalibrate_dpo = true`, the batch engine estimates `dpo` from the image
by: (1) segmenting the image (Otsu threshold), (2) computing a distance
transform, (3) finding local maxima (particle centers), (4) averaging their
radii, and (5) converting from pixels to nm via `2 × avg_radius_px × (escala /
npix)`.

**Source**: `image_processing.rs:453-459` (`estimate_particles_and_dpo`)

### `n_particles` / `npo` / `npo_visual`

FRAKTAL tracks TWO different particle counts:

1. **`npo_visual`** — Visual estimate from image processing. The
   `estimate_particle_count_adaptive()` function uses distance transform +
   non-maximum suppression to count distinct particle centers in the segmented
   image. This is purely geometric (image-based).

2. **`npo`** (calculated) — Derived from the fractal equation:
   ```
   npo = kf × (dp/dpo)^Df
   ```
   where `dp = 2 × Rg` (diameter from radius of gyration), `kf` is the
   prefactor polynomial evaluated at the found `Df`, and `Df` is the fractal
   dimension found by bisection.

**CRITICAL**: In the batch path, `n_particles_counted` in the API response maps
to `npo_visual` (the visual estimate), NOT `npo` (the calculated count).

**Source**: `batch.rs:207` — `n_particles_counted: Some(r.npo_visual)`

### "Bisection" — What It Actually Means

NOT box-counting. The FRAKTAL bisection is a root-finding algorithm that
searches for the fractal dimension `Df` in [1.0, 3.0] where the following
equation is satisfied:

```
kf(Df) × (dp/dpo)^Df = (Ap/Apo)^zp(Df)
```

The algorithm:
1. Steps through Df values in increments of 0.05
2. Looks for a sign change in `LHS - RHS` (bracket)
3. Refines via bisection (midpoint iteration) until `|interval| < 1e-5`
4. Falls back to golden section optimization if no bracket is found
5. Declares convergence when `|f(Df)| < 0.1`

The OUTER loop iterates on `npo_estimate` (starting from visual or geometric
guesses), re-computing the kf polynomial each time, until `Df` stabilizes
within tolerance 0.0001.

**Source**: `bisection.rs:98-163`, `granulated_2012.rs:254-320`

### "Autocalibrate" in Batch Context

The batch autocalibrate is a ONE-SHOT operation per R3 of the spec:
1. Try `image[0]` — segment, find particles, estimate dpo
2. If that fails → try `image[N/2]`
3. If both fail → abort the entire batch

The resulting `dpo` is then SHARED across ALL images in the batch. This is by
design (spec comment: "the dpo is a property of the aggregate, not of individual
projections").

**Source**: `batch.rs:143-167` (`resolve_dpo`)

---

## Bug C1: Drill-down hides diagnostic metadata for failed images

### Root Cause Hypothesis

**MOST LIKELY**: The frontend component `FraktalBatchImageDetail.tsx` renders an
either/or between the error banner and the metrics cards. When `data.error` is
truthy, ONLY the error card is shown (lines 318-326). The metrics cards
(including `dpo_used`) are inside the `else` branch (lines 327-375).

The backend DOES return `dpo_used` even for failed images — see
`batch_image_detail_view` at `views.py:960` which always includes `dpo_used:
img.dpo_used`. But the frontend discards it by rendering either the error OR the
metrics, never both.

### Evidence

| File | Line | What |
|------|------|------|
| `FraktalBatchImageDetail.tsx` | 318-376 | `{data.error ? (<ErrorCard/>) : (<MetricsCards/>)}` — exclusive rendering |
| `views.py` | 948-969 | `batch_image_detail_view` returns `dpo_used`, `fractal_dimension`, `prefactor`, etc. alongside `error` — all fields present regardless of status |
| `models.py` | 344 | `dpo_used = models.FloatField()` — NOT nullable, always populated |

### Missing Fields on Error

The following fields are persisted per image but invisible when `error` is
truthy:

- `dpo_used` (always set — it's the batch-level dpo)
- `pixels_per_100nm` (on the batch, not on the image — would need to be fetched
  from parent)
- `autocalibrate_source` (batch-level, not currently in the image detail
  endpoint)
- `azimuth` / `elevation` (available but hidden by the error branch)
- `filename` (shown in the title, so this one IS visible)

### Severity: WARNING

User can't diagnose WHY the analysis failed without seeing the dpo and scale
used.

---

## Bug C2: Back navigation from drill-down loses batch summary

### Root Cause Hypothesis

**MOST LIKELY**: There is NO route page at
`/projects/[id]/fraktal/batch/[batchId]/`. The Next.js file tree has:

```
frontend/src/app/projects/[id]/fraktal/batch/
  page.tsx                    → upload page (holds result in useState)
  [batchId]/
    image/
      [index]/
        page.tsx              → drill-down detail
```

There is NO `[batchId]/page.tsx`. When the drill-down's "Back to batch results"
link navigates to `/projects/${projectId}/fraktal/batch/${batchId}`, Next.js
falls back to the nearest layout/page — the batch upload page at
`.../batch/page.tsx` — which renders a fresh upload form with `result = null`.

**Additionally**: The upload page (`batch/page.tsx`) stores the batch result in
`useState` (line 28). When the user clicks through to a drill-down image, React
unmounts the upload page, destroying that state. There's no way to recover it
without re-fetching.

**Moreover**: `FraktalBatchesSection.tsx` (the project dashboard's batch list)
links each batch directly to `image/0` (line 53:
`/projects/${projectId}/fraktal/batch/${batch.id}/image/0`), completely skipping
any batch summary view. There IS an API endpoint
(`batch_detail_view` at `views.py:838`) that returns full batch data, but no
frontend page consumes it as a standalone route.

### Evidence

| File | Line | What |
|------|------|------|
| `FraktalBatchImageDetail.tsx` | 142 | `batchUrl = /projects/${projectId}/fraktal/batch/${batchId}` — links to nonexistent route |
| `batch/page.tsx` | 28 | `useState<FraktalBatchResult \| null>(null)` — ephemeral state, lost on navigate-away |
| `FraktalBatchesSection.tsx` | 53 | Links to `image/0`, not to a batch summary |
| `frontend/src/app/...` | — | No `[batchId]/page.tsx` exists in the file tree |
| `views.py` | 838-904 | `batch_detail_view` API endpoint exists and works |

### Severity: CRITICAL

User is stranded: can't go back to summary from drill-down, can't reach summary
from project dashboard. The only way to see the batch summary is immediately
after upload, before navigating away.

---

## Bug C3: n_particles ≈ 50 when simulation had N=1000

### Root Cause Hypothesis

**MOST LIKELY**: This is a semantic mismatch, NOT a bug in the algorithm. What
the user sees as "n_particles" in the UI is `npo_visual` — the VISUAL estimate
from the distance transform particle detector in the 2D projected image. With
N=1000 primaries in 3D, a 2D projection at specific angles (Az=060, El=000)
shows heavy overlap. The particle detector uses non-maximum suppression with
`min_separation = 2 × estimated_radius` (image_processing.rs:424), so
overlapping particles merge into fewer detected peaks.

This means `npo_visual ≈ 50` is telling us "I can visually resolve ~50 distinct
particle centers in this 2D projection", which is EXPECTED for a dense 1000-
particle aggregate viewed in projection.

**PLAUSIBLE alternative**: The autocalibrated dpo from image[0] (or image[N/2])
may be too large, causing the algorithm to "see" fewer, larger particles. If the
estimated dpo is, say, 4× the true monomer diameter, the non-maximum suppression
window expands proportionally, merging more neighbors.

**UNLIKELY**: The calculated `npo` (from the fractal equation) might also be
low, but we can't see it — the batch path reports `npo_visual`, not `npo`. The
single-image path reports both.

### Evidence

| File | Line | What |
|------|------|------|
| `batch.rs` | 207 | `n_particles_counted: Some(r.npo_visual)` — batch reports visual, not calculated |
| `image_processing.rs` | 424 | `min_separation = estimated_radius * 2.0` — NMS merges overlapping peaks |
| `image_processing.rs` | 401-404 | Top 30% of peaks used for radius estimate → sensitive to outliers |
| `granulated_2012.rs` | 300 | Calculated `npo = kf × (dp/dpo)^Df` — this value is NOT exposed in batch path |
| `result.rs` | 54-56 | `npo: u64` (calculated) vs `npo_visual: u64` (image-detected) — two distinct counts |

### Conceptual Clarification

The user's expectation of "n_particles = 1000" conflates:
- **N_primaries** (input to the simulation) = 1000 3D spheres
- **npo_visual** (detected in 2D projection) ≈ 50 visible peaks
- **npo** (fractal equation result) = unknown (not exposed in batch UI)

For a fractal aggregate with Df ≈ 1.8 and N=1000, a 2D projection will show
massive overlap. Detecting 50 distinct particle peaks is physically reasonable.

### Severity: WARNING

Not a code bug per se, but a UX/documentation issue. The field label "Particles"
in the UI doesn't clarify that it's a 2D visual estimate, not the simulation's
input N.

---

## Bug C4: 30/31 bisection failures with shared dpo

### Root Cause Hypothesis

**MOST LIKELY (high confidence)**: The one-shot autocalibrate picks dpo from ONE
image (image[0] or image[N/2]), then applies that SAME dpo to ALL 31 images.
Different azimuth/elevation angles produce dramatically different 2D silhouettes
of the same 3D aggregate:

- **El=-90** (top-down): circular, compact silhouette → small Rg, large
  coverage
- **El=0** (side view): elongated, sparse silhouette → large Rg, moderate
  coverage
- **El=60** (high angle): somewhere in between

The autocalibrated dpo is optimal for the calibration image's geometry but
WRONG for images with very different projected density. When the algorithm
tries to solve `kf × (dp/dpo)^Df = (Ap/Apo)^zp`, a mismatched dpo means
the objective function may NEVER cross zero in [1.0, 3.0], causing:

1. No sign change found in the bracket search (bisection.rs:112-125)
2. Golden section fallback also fails because the minimum of `|f(Df)|` exceeds
   the convergence threshold of 0.1 (bisection.rs:226)
3. Result: `converged = false` → `FraktalStatus::NoConvergence` →
   "Bisection method failed to converge"

The reason image 13 (Az=060, El=000) succeeds while others fail is likely that
image 13 has a projected geometry SIMILAR to the calibration image, so the
shared dpo produces a solvable equation.

**CORROBORATING EVIDENCE**: The batch spec R3 comment in `batch.rs:5-8`:
> "the dpo is a property of the aggregate, not of individual projections"

This is physically correct for the TRUE dpo (the actual primary particle
diameter doesn't change with viewing angle). But the ESTIMATED dpo (from image
processing) DOES change with viewing angle because:
1. Different angles show different amounts of particle overlap
2. The distance transform finds different peak heights/sizes
3. The NMS radius changes → particle count changes → estimated dpo changes

So while the spec's reasoning is sound ("dpo is intrinsic"), the ESTIMATION
method is angle-dependent, making the one-shot approach fragile.

### Evidence

| File | Line | What |
|------|------|------|
| `batch.rs` | 143-167 | `resolve_dpo` — one-shot on image[0], retry image[N/2], share result |
| `batch.rs` | 129-131 | `run_one_image` receives the SAME `dpo` for every image |
| `bisection.rs` | 132-134 | No bracket found → golden section fallback |
| `bisection.rs` | 219-227 | Golden section: `valid && fun_value.abs() < 0.1` — threshold too tight for angle-varied dpo |
| `granulated_2012.rs` | 278-292 | Search restricted to region where kf > 0 → narrower bracket window |
| `granulated_2012.rs` | 295-296 | `if result.df == 0.0 \|\| !result.converged \|\| result.kf <= 0.0` — breaks to next estimate |
| `granulated_2012.rs` | 322-338 | Final check: `!converged` → `FraktalStatus::NoConvergence` |
| `image_processing.rs` | 424 | NMS radius = `estimated_radius * 2.0` — angle-dependent |

### Why Image 13 Succeeds

Image 13 is Az=060, El=000. If the autocalibrate happened on image[0] (Az=000,
El=-90) or image[15] (the N/2 = 31/2 = 15th image, likely Az=090, El=-90),
then Az=060 El=000 might have a similar projected particle density to the
calibration source, making the dpo close enough to produce a convergent
bisection.

### Severity: CRITICAL

30 out of 31 images fail. This is NOT an edge case — it's the expected behavior
given the architecture. Multi-angle batches are the primary use case for batch
FRAKTAL and they systematically fail.

---

## Coupling Analysis: Are Bugs Independent?

### C3 and C4 are COUPLED

Both stem from the same one-shot autocalibrate + shared dpo architecture:
- **C4**: The shared dpo doesn't fit most angles → bisection fails
- **C3**: Even when bisection succeeds, the dpo may be wrong enough that
  `npo_visual` (estimated with the same dpo-influenced parameters) is
  unreliable

Fixing C4 (per-image dpo estimation or per-image autocalibrate) would likely
also improve C3's particle count accuracy.

### C1 and C2 are INDEPENDENT

Pure frontend issues, unrelated to the algorithm. C1 is a rendering conditional,
C2 is a missing route page.

### C1 and C4 are SYNERGISTIC

C1 (hiding diagnostic metadata on failure) makes C4 (30/31 failures) much worse
because the user can't see the `dpo_used` value that caused the failure.

---

## Recommended Fix Order

| Priority | Bug | Effort | Risk | Rationale |
|----------|-----|--------|------|-----------|
| 1 | **C2** | S (1-2h) | Low | Missing route page — create `[batchId]/page.tsx` that fetches from `batch_detail_view` API. Unblocks user navigation immediately. |
| 2 | **C1** | S (1h) | Low | Change `{error ? ... : ...}` to always show diagnostic metadata alongside error. Quick TSX change, no backend work. |
| 3 | **C4** | L (4-8h) | Medium | Core algorithm change. Options: (a) per-image autocalibrate (recompute dpo per image), (b) use user-supplied dpo instead of autocalibrate for multi-angle batches, (c) widen bisection convergence threshold. Needs SDD cycle — design decision required. |
| 4 | **C3** | M (2-4h) | Low | After C4 is fixed, expose BOTH `npo_visual` AND `npo` (calculated) in the batch results. Add tooltip/label clarification. May resolve naturally if per-image autocalibrate is implemented. |

---

## Open Questions for User

1. **Which algorithm was used?** Granulated 2012 or Voxel 2018? (The failure
   pattern is consistent with Granulated 2012, which is more dpo-sensitive.)

2. **Was autocalibrate_dpo enabled or was a manual dpo provided?** If manual,
   what value? If autocalibrate, the one-shot problem is confirmed.

3. **What was the actual `dpo_used` value reported?** (Currently hidden by Bug
   C1, but the batch-level `dpo_used` should appear in the calibration summary
   section of the batch results page — was the user on the batch summary before
   it was lost to Bug C2?)

4. **Is `n_particles=50` actually `npo_visual` or `npo`?** We believe it's
   `npo_visual` based on the code, but confirming which field the user read
   would clarify.

5. **Expected behavior for multi-angle batches**: Should each projection get its
   own autocalibrated dpo? Or should the user supply the known `dpo` from the
   simulation parameters (since it's a synthetic aggregate with known primary
   particle size)?

6. **What is the simulation's `dpo` (primary particle diameter)?** If the user
   ran a simulation with known monomer size (e.g., 25nm primaries), that value
   should be passed as `dpo_hint` with `autocalibrate_dpo=false`, bypassing the
   estimation entirely.

---

## Summary of Affected Areas

| File | Bugs |
|------|------|
| `aglogen_core/engine/src/fractal/fraktal/batch.rs` | C3, C4 |
| `aglogen_core/engine/src/fractal/fraktal/bisection.rs` | C4 |
| `aglogen_core/engine/src/fractal/fraktal/granulated_2012.rs` | C3, C4 |
| `aglogen_core/engine/src/fractal/fraktal/image_processing.rs` | C3, C4 |
| `frontend/src/components/fraktal/FraktalBatchImageDetail.tsx` | C1 |
| `frontend/src/components/fraktal/FraktalBatchResultsView.tsx` | C2 |
| `frontend/src/components/fraktal/FraktalBatchesSection.tsx` | C2 |
| `frontend/src/app/projects/[id]/fraktal/batch/page.tsx` | C2 |
| `frontend/src/app/projects/[id]/fraktal/batch/[batchId]/` | C2 (missing) |
| `backend/apps/fractal_analysis/views.py` | C1 (data available, just not surfaced) |
