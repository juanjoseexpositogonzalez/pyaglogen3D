# Projection Per-Image Scale Specification

## Purpose

Defines the contract for per-direction `pixels_per_100nm` values in projection ZIP exports.
Replaces the single 3D-aggregate-based scale with a per-view scale derived from the
actual 2D projected bounding box of each rendered direction. Fixes PYA-8 scale inflation.

This spec describes **observable behavior** — what a caller sees in `metadata.json` and
ZIP contents — not internal implementation.

## Requirements

### R1. Each direction entry in `metadata.json` MUST carry `pixels_per_100nm`

**GIVEN** a projection ZIP produced in `grid` or `fibonacci` mode,
**WHEN** `metadata.json` is assembled,
**THEN** every entry in `directions[]` MUST include a `pixels_per_100nm` field (float or null),
**AND** `pixels_per_100nm` is positive when the rendered view contains visible particles,
**AND** `pixels_per_100nm` is `null` only when the 2D bbox for that direction is degenerate
(zero-area projection, e.g. empty aggregate).

#### Scenario 1.1 — Grid mode, multiple directions

- GIVEN a grid export (`n_az=6, n_el=3`) producing 8 directions
- WHEN `metadata.json` is parsed
- THEN `len(metadata.directions) == 8`
- AND every entry has a `pixels_per_100nm` key present and positive

#### Scenario 1.2 — Fibonacci mode

- GIVEN a Fibonacci export (`n=50`)
- WHEN `metadata.json` is parsed
- THEN all 50 `directions[]` entries have `pixels_per_100nm` present and positive

#### Scenario 1.3 — Single direction

- GIVEN a grid export (`n_az=1, n_el=2`) producing 2 directions (poles only)
- WHEN `metadata.json` is parsed
- THEN both entries have `pixels_per_100nm` present and positive

#### Scenario 1.4 — Empty aggregate yields null scale

- GIVEN a simulation with no particles
- WHEN any direction is projected and rendered
- THEN `directions[i].pixels_per_100nm` is `null` for every entry

---

### R2. Top-level `parameters.pixels_per_100nm` MUST equal `max(directions[].pixels_per_100nm)`

**GIVEN** a projection ZIP in `grid` or `fibonacci` mode with per-direction scales populated,
**WHEN** the top-level `parameters.pixels_per_100nm` field is read,
**THEN** its value MUST equal the maximum of all non-null `directions[i].pixels_per_100nm` values,
**AND** if all per-direction values are `null`, the top-level field is also `null`.

The top-level field is kept for backward compatibility with consumers that read only
`parameters.pixels_per_100nm` and apply it uniformly to every image.

#### Scenario 2.1 — Single direction: max equals the only value

- GIVEN a single-direction export with `directions[0].pixels_per_100nm = 42.0`
- WHEN `parameters.pixels_per_100nm` is read
- THEN its value is `42.0`

#### Scenario 2.2 — All views identical

- GIVEN a grid export where every direction produces the same scale (e.g. a spherically
  symmetric aggregate)
- WHEN `parameters.pixels_per_100nm` is read
- THEN its value equals the common per-direction value (max == all)

#### Scenario 2.3 — Multiple distinct scales

- GIVEN a grid export (`n_az=6, n_el=3`) where scales vary by direction
- WHEN `parameters.pixels_per_100nm` is read
- THEN its value equals the largest value across all 8 `directions[]` entries

#### Scenario 2.4 — All null directions

- GIVEN an empty-aggregate export where all `directions[i].pixels_per_100nm` are `null`
- WHEN `parameters.pixels_per_100nm` is read
- THEN it is `null`

---

### R3. Per-direction scale MUST be derived from the 2D projected bbox of that specific view

**GIVEN** a projection direction `(azimuth, elevation)` with 2D rendered bbox
`(min_x, max_x, min_y, max_y)` in engine units,
**WHEN** `pixels_per_100nm` is computed for that direction,
**THEN** the formula applied SHALL be:

```
span_engine_2d = max(max_x - min_x, max_y - min_y)
span_padded    = span_engine_2d * 1.04          # renderer adds 2% padding per side
span_nm        = span_padded * scale_factor_nm  # engine-unit → nm conversion
pixels_per_100nm = (100 * img_size) / span_nm
```

where `scale_factor_nm = primary_particle_diameter_nm / 2` (the engine's length unit),
`img_size` is the square canvas pixel dimension, and the 1.04 factor matches the
renderer's 2% padding applied symmetrically on each side of the longer axis.

**AND** the 3D axis-aligned bounding box SHALL NOT be used for per-direction scale computation.

#### Scenario 3.1 — Scale varies with direction (non-spherical aggregate)

- GIVEN a non-spherical aggregate exported in grid mode
- WHEN `directions[i].pixels_per_100nm` values are compared across directions
- THEN at least two entries MUST differ by more than 1% (confirming per-view computation)

#### Scenario 3.2 — Scale formula matches rendered canvas at boundary

- GIVEN a direction with 2D bbox width=W and height=H (W > H), canvas size=512px,
  `scale_factor_nm=25.0` nm/unit
- WHEN `pixels_per_100nm` is computed
- THEN it equals `(100 * 512) / (W * 1.04 * 25.0)` within floating-point tolerance (±0.01%)

#### Scenario 3.3 — Pole direction (elevation ±90°) uses its own 2D bbox

- GIVEN a grid export including the south pole direction
- WHEN `directions[0].pixels_per_100nm` (pole) is compared to an equatorial entry
- THEN they MUST be computed independently; the pole's scale reflects the pole's 2D projection

---

### R4. Legacy metadata (no per-direction field) MUST be treated as broadcast for backward compat

**GIVEN** a ZIP whose `metadata.json` was produced before this change (contains only the
top-level `parameters.pixels_per_100nm`, with no `pixels_per_100nm` inside `directions[]`),
**WHEN** a consumer (e.g. FRAKTAL batch) reads this ZIP,
**THEN** the consumer MUST apply `parameters.pixels_per_100nm` uniformly to all images
(broadcast semantics),
**AND** the absence of per-direction fields MUST NOT cause a parse error or calibration
failure,
**AND** `calibration_source` reported by the batch endpoint MUST be `"metadata"` (the
top-level field still satisfies the metadata-calibration path).

#### Scenario 4.1 — Legacy ZIP ingested by FRAKTAL batch

- GIVEN a ZIP with `metadata.parameters.pixels_per_100nm = 38.5` and no per-direction fields
- WHEN submitted to the FRAKTAL batch endpoint
- THEN batch runs with scale `38.5` for all images; `calibration_source = "metadata"`

#### Scenario 4.2 — Legacy ZIP with null top-level scale falls through to manual/autocalibrate

- GIVEN a legacy ZIP where `parameters.pixels_per_100nm = null`
- WHEN submitted to the FRAKTAL batch endpoint without explicit calibration
- THEN the batch endpoint responds HTTP 400 requesting a scale or autocalibrate flag
  (consistent with existing R2 of `fraktal-batch-contract`)

#### Scenario 4.3 — Legacy mode export does not add per-direction fields

- GIVEN a request using `mode=legacy`
- WHEN the ZIP is produced
- THEN `metadata.json` MUST NOT gain per-direction `pixels_per_100nm` fields
  (legacy path is unchanged — backward compat preserved at the ZIP layer)

---

### R5. Scale formula uses the 2D bbox from the Rust engine's `bounds` output, not re-derived

**GIVEN** the Rust engine returns `proj.bounds = (min_x, max_x, min_y, max_y)` for a direction,
**WHEN** `pixels_per_100nm` is stamped for that direction,
**THEN** `bbox_2d_width = proj.bounds[1] - proj.bounds[0]` and
`bbox_2d_height = proj.bounds[3] - proj.bounds[2]` SHALL be the sole inputs to the formula,
**AND** no secondary geometry pass (re-reading coords/radii) SHALL occur per direction,
**AND** the stamping MUST happen after rendering so the bounds reflect the actual projected
geometry used to produce the PNG.

#### Scenario 5.1 — Stamp uses engine bounds, not recomputed from 3D coords

- GIVEN two directions producing identical 3D coords but different 2D projections
- WHEN scales are stamped
- THEN the two scale values differ (proving bounds come from the 2D projection, not 3D coords)

#### Scenario 5.2 — Scale stamp happens after render per direction

- GIVEN an async (Celery) export of 300 directions
- WHEN each direction is rendered and its scale is stamped
- THEN the `directions[]` entry in `metadata.json` has the scale from THAT direction's render,
  not a pre-render estimate

#### Scenario 5.3 — Celery and sync paths produce identical scale values for same direction

- GIVEN the same aggregate and direction exported once sync (N≤200) and once async (N>200)
- WHEN `directions[i].pixels_per_100nm` is compared between the two ZIPs
- THEN values match within floating-point tolerance (±0.01%)

---

### R6. Legacy 3D-bbox scale semantics NOT applicable in grid/fibonacci mode

**GIVEN** a grid or fibonacci mode export,
**WHEN** scale is computed,
**THEN** the algorithm described in R3 and R5 (2D-per-direction) MUST be used,
**AND** the pre-change algorithm (3D-axis-aligned-bbox broadcast) MUST NOT be used,
**AND** this requirement applies to all directions, even poles.

#### Scenario 6.1 — 3D bbox method forbidden in grid mode

- GIVEN a non-spherical aggregate in grid mode
- WHEN exported and inspected
- THEN observed scale values across directions will NOT match what the 3D-bbox method would produce
- AND the discrepancy confirms per-direction 2D computation

#### Scenario 6.2 — Scale independence from 3D geometry

- GIVEN two aggregates with different 3D bboxes but identical 2D projections in one direction
- WHEN both are exported and the scale for that direction is compared
- THEN scales are identical (2D projection determines scale, not 3D shape)

---

## Relationship to Other Specs

This spec augments `projection-export-contract` (R5 modification and new scenario 4.1–4.3 regarding
legacy backward compat). The `projection-render-dual` spec defines the dual-PNG mechanism;
scales are computed identically for both presentation and scientific modes from shared geometry.
Both `fraktal-batch-contract` and `fraktal-batch-persistence` consume per-direction scales via
metadata and per-image analysis, respectively.

<!-- Last sync: 2026-04-30 from change projection-scale-and-render-modes -->
