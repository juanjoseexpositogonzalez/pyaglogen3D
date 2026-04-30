# Spec: projection-export-contract

## Overview

New capability defining the observable contract for the projection batch export endpoint. Covers direction-generation semantics (grid pole dedup, Fibonacci lattice), filename convention, `metadata.json` shape, mode switching, input validation, and the sync/async execution boundary.

Context: see `../proposal.md` for scope and affected areas; see `../explore.md` for diagnosis of the existing bugs this contract replaces.

This spec describes **observable behavior** — what a caller sees in responses, ZIP contents, and error payloads — not internal implementation.

## Requirements

### R1. Grid mode generates exactly `n_az·(n_el − 2) + 2` projections

**GIVEN** the caller requests `mode=grid` with integer `n_az ≥ 1` and `n_el ≥ 2`,
**WHEN** the backend generates projection directions,
**THEN** the number of unique projections emitted is exactly `n_az · (n_el − 2) + 2`,
**AND** each pole (elevation = −90° and elevation = +90°) appears exactly once in the output,
**AND** every intermediate elevation (elevation ∈ `(−90, +90)`) produces exactly `n_az` projections (one per azimuth in the azimuth sweep).

#### Scenario 1.1 — Canonical brief example
- **Input**: `mode=grid, n_az=10, n_el=5`
- **Expected**: 32 projections emitted (10 × 3 intermediate elevations + 2 poles)
- **Observable**: ZIP contains 32 PNGs; `metadata.directions` has length 32; exactly one entry has `elevation = -90.0` and exactly one has `elevation = +90.0`.

#### Scenario 1.2 — Minimal intermediate case
- **Input**: `mode=grid, n_az=6, n_el=3`
- **Expected**: 8 projections emitted (6 × 1 intermediate + 2 poles)
- **Observable**: ZIP contains 8 PNGs; 6 entries at `elevation = 0.0`; 1 at `-90.0`; 1 at `+90.0`.

#### Scenario 1.3 — Poles-only configuration
- **Input**: `mode=grid, n_az=1, n_el=2`
- **Expected**: 2 projections (just the two poles; no intermediate elevations exist)
- **Observable**: ZIP contains 2 PNGs; one at `elevation = -90.0`, one at `+90.0`.

#### Scenario 1.4 — High-elevation resolution
- **Input**: `mode=grid, n_az=4, n_el=7`
- **Expected**: 24 projections (4 × 5 intermediate + 2 poles)
- **Observable**: ZIP contains 24 PNGs; `metadata.n_generated = 24`.

#### Scenario 1.5 — Degenerate config rejected
- **Input**: `mode=grid, n_az=1, n_el=1`
- **Expected**: HTTP 400 with validation error (see R8 — `n_el` must be ≥ 2)
- **Observable**: no ZIP produced; response body contains an error describing the invalid `n_el`.

---

### R2. Fibonacci mode generates exactly N unique projections

**GIVEN** the caller requests `mode=fibonacci` with integer `N ≥ 1`,
**WHEN** directions are generated via a golden-angle spiral lattice,
**THEN** exactly `N` projections are emitted,
**AND** each projection has a unique identity in the output (guaranteed by the index prefix in the filename — see R4),
**AND** the (azimuth, elevation) distribution is approximately uniform over the unit sphere (no clustering at poles, no gaps at equator).

#### Scenario 2.1 — Typical N
- **Input**: `mode=fibonacci, n=50`
- **Expected**: 50 projections emitted
- **Observable**: ZIP contains 50 PNGs with unique filenames; `metadata.n_generated = 50`; `metadata.directions` has length 50.

#### Scenario 2.2 — Single-point edge
- **Input**: `mode=fibonacci, n=1`
- **Expected**: 1 projection
- **Observable**: ZIP contains 1 PNG; `metadata.directions` has length 1; the single point lies on the unit sphere.

#### Scenario 2.3 — Antipodal pair
- **Input**: `mode=fibonacci, n=2`
- **Expected**: 2 projections, approximately antipodal (near opposite poles)
- **Observable**: two entries in `metadata.directions`; their `z` components (sin(elevation)) are near +0.5 and −0.5 per the standard lattice formula `y = 1 − (2i+1)/N`.

#### Scenario 2.4 — Async threshold
- **Input**: `mode=fibonacci, n=500`
- **Expected**: 500 projections, response follows the async path defined in R6 (202 + `job_id`)
- **Observable**: immediate 202 response; polling eventually yields a ZIP with 500 PNGs and `metadata.n_generated = 500`.

#### Scenario 2.5 — Zero rejected
- **Input**: `mode=fibonacci, n=0`
- **Expected**: HTTP 400 with validation error (see R8 — `n` must be ≥ 1)
- **Observable**: no ZIP produced; error response explains the constraint.

---

### R3. Legacy mode preserves current production output

**GIVEN** a client calls the endpoint **without** a `mode` field, **or** with `mode=legacy`,
**WHEN** the backend processes the request,
**THEN** the output ZIP is byte-equivalent to the current production endpoint's output for the same inputs (same filename shape, same projection count, same rendered pixels),
**AND** no new fields in `metadata.json` break pre-existing parsers (see R5 — legacy `metadata.json` shape is permitted to differ from grid/fibonacci).

#### Scenario 3.1 — Mode omitted defaults to legacy
- **Input**: POST body with legacy fields only (`az_start`, `az_end`, `az_step`, `el_start`, `el_end`, `el_step`) and no `mode` key
- **Expected**: Backend routes to the legacy path
- **Observable**: ZIP contents match byte-for-byte the pre-change endpoint output for identical inputs.

#### Scenario 3.2 — Explicit mode=legacy
- **Input**: `mode=legacy` plus the 6 legacy sweep fields
- **Expected**: Same behavior as Scenario 3.1
- **Observable**: identical ZIP to omission of `mode`.

#### Scenario 3.3 — All legacy fields honored
- **Input**: `mode=legacy, az_start=0, az_end=150, az_step=30, el_start=0, el_end=90, el_step=30`
- **Expected**: All six fields drive the existing sweep semantics; no grid/fibonacci logic is applied
- **Observable**: ZIP contents match the legacy endpoint for these exact inputs.

---

### R4. Filename convention for grid and fibonacci modes

**GIVEN** projections are generated in `grid` or `fibonacci` mode,
**WHEN** filenames are assigned in the ZIP,
**THEN** each filename matches the pattern `proj_{idx:03d}_Az{AAA}_El{±EEE}.{ext}` where:

- `idx` is a zero-padded 3-digit sequential index starting at `000`,
- `AAA` is a zero-padded 3-digit azimuth in the range `[000, 360)` (360° wraps to 000),
- `±EEE` is a signed 3-digit elevation in `[-090, +090]` with an explicit `+` or `-` character (0° renders as `+000`),
- `{ext}` is the requested image format (`png` or `svg`),

**AND** filenames sort lexicographically in order of their index (so `proj_000_*` precedes `proj_001_*`, etc.),
**AND** no two filenames in the same ZIP collide (the index prefix guarantees uniqueness even when Fibonacci points round to the same `(Az, El)` integers).

#### Scenario 4.1 — Typical positive elevation
- **Input**: direction `(azimuth=45°, elevation=+30°)` at index `7`
- **Expected filename**: `proj_007_Az045_El+030.png`

#### Scenario 4.2 — South pole
- **Input**: direction `(azimuth=180°, elevation=-90°)` at index `0`
- **Expected filename**: `proj_000_Az180_El-090.png`

#### Scenario 4.3 — Equator at zero azimuth
- **Input**: direction `(azimuth=0°, elevation=0°)` at index `15`
- **Expected filename**: `proj_015_Az000_El+000.png`

#### Scenario 4.4 — Sort order
- **Input**: grid mode producing indices `0..31`
- **Expected**: listing filenames in lexicographic order yields indices `000, 001, 002, ..., 031` in sequence.

---

### R5. `metadata.json` is present in the ZIP with contract shape

**GIVEN** the export ZIP is assembled in `grid` or `fibonacci` mode,
**WHEN** the ZIP is finalized,
**THEN** the ZIP contains a file at its root named `metadata.json`,
**AND** the JSON document conforms to this shape:

```json
{
  "mode": "grid" | "fibonacci" | "legacy",
  "n_requested": <integer>,
  "n_generated": <integer>,
  "parameters": {
    "pixels_per_100nm": <float | null>
  },
  "directions": [
    {
      "index": <integer>,
      "filename": "proj_000_Az000_El-090.png",
      "filename_scientific": "proj_000_Az000_El-090.scientific.png",
      "azimuth": <float in [0, 360)>,
      "elevation": <float in [-90, +90]>,
      "pixels_per_100nm": <float | null>
    }
  ]
}
```

**AND** in `grid` or `fibonacci` mode, `directions[i].pixels_per_100nm` MUST be present in
every entry (positive float or `null` for degenerate views — see `projection-scale-per-image`
R1),
**AND** in `grid` or `fibonacci` mode, `directions[i].filename_scientific` MUST be present
in every entry and equal `{base_filename}.scientific.png` where `{base_filename}` is the stem
of `directions[i].filename`,
**AND** in `legacy` mode, `directions[i].pixels_per_100nm` MUST be absent (key not in dict)
and `directions[i].filename_scientific` MUST be absent (key not in dict) — legacy entries
keep only the pre-change fields,
**AND** `parameters.pixels_per_100nm` equals `max(directions[i].pixels_per_100nm)` for all
non-null entries (backward compat for consumers reading only the top-level field),
**AND** `directions` is an array whose length equals `n_generated`,
**AND** every image file in the ZIP is referenced by exactly one `directions[i].filename`
(presentation) or `directions[i].filename_scientific` (scientific).

(Previously: `directions[]` entries contained only `index`, `filename`, `azimuth`,
`elevation`; no `pixels_per_100nm` or `filename_scientific` per-entry fields existed.)

#### Scenario 5.1 — Grid metadata shape (new mode)
- **Input**: `mode=grid, n_az=6, n_el=3` producing 8 directions
- **Expected metadata**: `mode="grid"`, `n_requested=8`, `n_generated=8`, `parameters={pixels_per_100nm: <max>}`, `directions` has 8 entries.
- **Observable**: `len(directions) == 8`; every `directions[i]` has keys `index`, `filename`, `filename_scientific`, `azimuth`, `elevation`, `pixels_per_100nm`; ZIP has 16 PNGs + 1 `metadata.json` = 17 entries total.

#### Scenario 5.2 — Fibonacci metadata shape (new mode)
- **Input**: `mode=fibonacci, n=50`
- **Expected metadata**: `mode="fibonacci"`, `n_requested=50`, `n_generated=50`, `parameters={pixels_per_100nm: <max>}`, `directions` has 50 entries.
- **Observable**: `len(directions) == 50`; all 50 entries have `filename_scientific` ending in `.scientific.png`; all 50 entries have `pixels_per_100nm` as positive float (non-degenerate aggregate); ZIP has 100 PNGs + 1 `metadata.json`.

#### Scenario 5.3 — Legacy metadata present with scale stamp
- **Input**: legacy mode request
- **Expected**: `metadata.json` is present with `mode="legacy"`, a `parameters` block capturing the legacy sweep inputs (`azimuth_start`, `azimuth_end`, `azimuth_step`, `elevation_start`, `elevation_end`, `elevation_step`, `format`), and — when the render format is PNG — an additional `pixels_per_100nm` field so FRAKTAL batch analysis can auto-calibrate against legacy ZIPs. The `directions` array is populated with the same legacy filenames written to the ZIP (PNG filenames follow the legacy `{sim_id_short}_Az###_El###.png` shape — NOT the `proj_###_…` shape used by grid/fibonacci, preserving R3's PNG-layer byte compatibility). Per-direction `pixels_per_100nm` and `filename_scientific` MUST NOT be present in legacy mode entries.
- **Observable**: presence of `metadata.json` does not break any legacy-only parser that iterates PNGs and ignores unknown files in the ZIP. Parsers that DO consume `metadata.json` can correlate `directions[i].filename` to the legacy PNG entries.

#### Scenario 5.4 — No orphan images (dual-emit parity)
- **Input**: any grid or fibonacci export
- **Expected**: the set of PNG filenames in the ZIP equals exactly the union of `{d.filename, d.filename_scientific}` for all `d` in `metadata.directions`.
- **Observable**: set difference in either direction is empty.

---

### R-DELTA-A. ZIP structure for grid and fibonacci modes includes dual PNGs per direction

**GIVEN** a projection ZIP produced in `grid` or `fibonacci` mode,
**WHEN** the ZIP contents are enumerated,
**THEN** for every direction at index `i`, the ZIP MUST contain BOTH:
- `proj_{idx:03d}_Az{AAA}_El{±EEE}.png` — presentation PNG (styled, AA, red fill, border),
- `proj_{idx:03d}_Az{AAA}_El{±EEE}.scientific.png` — scientific PNG (strict binary, no AA, no border),

**AND** both files MUST be present for every direction (no partial pairs),
**AND** the total number of image files in the ZIP MUST equal `2 × n_generated`,
**AND** in legacy mode, the ZIP MUST contain only the presentation PNGs (no `*.scientific.png`
files) — backward compatibility is preserved at the ZIP layer.

(Previously: ZIP contained exactly `n_generated` PNG files — one per direction in grid/fibonacci,
one per sweep step in legacy. Scientific PNGs did not exist.)

#### Scenario A.1 — Dual emit happy path

- GIVEN `mode=grid, n_az=6, n_el=3` → 8 directions
- WHEN the ZIP is opened
- THEN the ZIP contains exactly 16 PNG files (8 presentation + 8 scientific) + `metadata.json`
- AND each presentation file `proj_{i}_...png` has an exact scientific counterpart `proj_{i}_....scientific.png`

#### Scenario A.2 — Legacy ZIP has no scientific PNGs

- GIVEN `mode=legacy` or omitted mode
- WHEN the ZIP contents are listed
- THEN no filename ending in `.scientific.png` appears
- AND the total image count equals the number of legacy sweep steps (unchanged)

#### Scenario A.3 — Fibonacci dual emit

- GIVEN `mode=fibonacci, n=50`
- WHEN the ZIP is listed
- THEN exactly 100 PNG files are present (50 presentation + 50 scientific) + `metadata.json`

#### Scenario A.4 — Poles-only grid has full dual pair

- GIVEN `mode=grid, n_az=1, n_el=2` (2 poles only)
- WHEN the ZIP is listed
- THEN ZIP contains 4 PNGs (2 presentation + 2 scientific) + `metadata.json`
- AND no orphan files exist (R5 no-orphan condition holds)

#### Scenario A.5 — Presentation-only consumer unaffected

- GIVEN a caller that reads only `{base}.png` files from a grid/fibonacci ZIP
- WHEN the ZIP produced by this change is consumed
- THEN `{base}.png` files are present and byte-identical to a presentation-only render
- AND the presence of `{base}.scientific.png` is additive and non-breaking

---

### R-DELTA-B. Render → measure → write order: render all directions first, then metadata once

**GIVEN** a projection export task (sync or Celery async) in any mode,
**WHEN** the export pipeline executes,
**THEN** ALL PNG files (both presentation and scientific, for all directions) MUST be
rendered and written to the ZIP before `pixels_per_100nm` is measured for any direction,
**AND** per-direction `pixels_per_100nm` MUST be measured after rendering using the 2D bbox
returned by the engine for each direction,
**AND** `metadata.json` MUST be written exactly once, as the final entry before the ZIP is
closed,
**AND** per-direction inline stamping of `metadata.json` (writing or updating the metadata
file once per direction during iteration) is FORBIDDEN,
**AND** this order applies to both the sync path (`n_generated ≤ 200`) and the Celery async
path (`n_generated > 200`).

(Previously: no explicit render-order contract existed. The earlier implementation updated
metadata inline per direction, which created partial-write windows and race conditions in
the Celery path.)

#### Scenario B.1 — Metadata is the last entry in the ZIP

- GIVEN any grid or fibonacci export
- WHEN the ZIP central directory is inspected
- THEN `metadata.json` has the highest local file offset (i.e. it was added last)
- AND all PNG entries precede it in the central directory order

#### Scenario B.2 — Single direction: render-then-measure still applies

- GIVEN `mode=grid, n_az=1, n_el=2` (2 directions)
- WHEN the export runs
- THEN both PNGs are written before `pixels_per_100nm` is measured for either direction
- AND `metadata.json` is written after both measurements

#### Scenario B.3 — Celery async path obeys the same order

- GIVEN an async export (`mode=fibonacci, n=300`)
- WHEN the Celery task runs
- THEN the task renders all 300 × 2 = 600 PNGs first, then measures 300 per-direction scales,
  then writes `metadata.json` once, then closes the ZIP

#### Scenario B.4 — Identical bbox results between sync and async

- GIVEN the same aggregate and direction list exported once sync and once async
- WHEN `directions[i].pixels_per_100nm` values are compared
- THEN values match within ±0.01% floating-point tolerance (render-order difference
  does not alter the measured bbox)

#### Scenario B.5 — Partial-write window does not exist

- GIVEN the Celery worker is killed mid-export after all PNGs are rendered but before
  `metadata.json` is written
- WHEN the incomplete ZIP is detected by the polling endpoint
- THEN the polling status is `"failed"` (no partial `metadata.json` was ever written)
- AND no `metadata.json` with incomplete `directions[]` is present in the ZIP

---

### R6. Sync/async execution threshold

**GIVEN** `mode=grid` or `mode=fibonacci`,
**WHEN** the total projection count `n_generated ≤ 200`,
**THEN** the endpoint responds **synchronously** with HTTP 200 and a ZIP body (`Content-Type: application/zip`).

**WHEN** `n_generated > 200`,
**THEN** the endpoint responds immediately with HTTP 202 and a JSON body `{"job_id": "<string>"}`,
**AND** a polling endpoint `GET /api/v1/projections-status/{job_id}/` returns JSON with one of these shapes:
- `{"status": "processing", "progress": <float in [0, 1]>}` while the job is running,
- `{"status": "done", "download_url": "<string>"}` when the ZIP is ready,
- `{"status": "failed", "error": "<string>"}` on irrecoverable failure.

#### Scenario 6.1 — Small grid is sync
- **Input**: `mode=grid, n_az=10, n_el=5` → 32 projections
- **Expected**: 200 OK with ZIP body in the response; no `job_id` issued.

#### Scenario 6.2 — At the boundary (200) sync
- **Input**: `mode=fibonacci, n=200`
- **Expected**: 200 OK, sync ZIP body (the boundary is inclusive on the sync side).

#### Scenario 6.3 — Just over boundary is async
- **Input**: `mode=fibonacci, n=201`
- **Expected**: 202 Accepted with body `{"job_id": "..."}`
- **Observable**: polling `/api/v1/projections-status/{job_id}/` yields `processing` → eventually `done` with a `download_url`.

#### Scenario 6.4 — Large async with progress
- **Input**: `mode=fibonacci, n=500`
- **Expected**: 202 + `job_id`; polling yields `processing` with monotonically non-decreasing `progress` values, eventually reaching `done`.
- **Observable**: at least one `processing` response has `0 < progress < 1`; a later response has `status="done"` with a valid `download_url`.

---

### R7. Azimuth and elevation computation for Fibonacci

**GIVEN** a Fibonacci lattice point `(x, y, z)` on the unit sphere (where `y` is the up-axis per the golden-angle construction `y = 1 − (2i+1)/N`),
**WHEN** it is converted to `(azimuth, elevation)` for the output contract,
**THEN** `azimuth = atan2(z, x)` in degrees, normalized to the range `[0, 360)` (negative atan2 results are shifted by +360),
**AND** `elevation = asin(y)` in degrees, in the range `[-90, +90]`.

Note: the axis convention is `y`-up; the spec canonicalizes poles to `azimuth = 0` when elevation is exactly ±90 (atan2 at the pole is mathematically underdetermined).

#### Scenario 7.1 — North pole
- **Input**: lattice point at `y = +1` (north pole)
- **Expected**: `elevation = +90.0`, `azimuth = 0.0` (canonical).

#### Scenario 7.2 — South pole
- **Input**: lattice point at `y = -1`
- **Expected**: `elevation = -90.0`, `azimuth = 0.0` (canonical).

#### Scenario 7.3 — Equator on +x axis
- **Input**: `(x, y, z) = (1, 0, 0)`
- **Expected**: `elevation = 0.0`, `azimuth = 0.0` (since `atan2(0, 1) = 0`).

#### Scenario 7.4 — Equator on +z axis (90° azimuth)
- **Input**: `(x, y, z) = (0, 0, 1)`
- **Expected**: `elevation = 0.0`, `azimuth = 90.0` (`atan2(1, 0) = 90°`).

#### Scenario 7.5 — Equator on −x axis (180° azimuth)
- **Input**: `(x, y, z) = (-1, 0, 0)`
- **Expected**: `elevation = 0.0`, `azimuth = 180.0`.

---

### R8. Mode rejection and validation

**GIVEN** a request with invalid or missing mode-specific parameters,
**WHEN** the backend validates the payload,
**THEN** it responds with HTTP 400 and a JSON error body containing an explicit, field-level message identifying the violation (no silent coercion, no partial run).

#### Scenario 8.1 — Grid missing `n_el`
- **Input**: `mode=grid, n_az=5` (no `n_el`)
- **Expected**: 400; error message mentions `n_el` is required for grid mode.

#### Scenario 8.2 — Fibonacci missing `n`
- **Input**: `mode=fibonacci` (no `n`)
- **Expected**: 400; error message mentions `n` is required for fibonacci mode.

#### Scenario 8.3 — Unknown mode
- **Input**: `mode=nonsense`
- **Expected**: 400; error message mentions `mode` is not one of the accepted values (`grid`, `fibonacci`, `legacy`).

#### Scenario 8.4 — `n_az` below minimum
- **Input**: `mode=grid, n_az=0, n_el=5`
- **Expected**: 400; error message says `n_az` must be ≥ 1.

#### Scenario 8.5 — `n_el` below minimum
- **Input**: `mode=grid, n_az=5, n_el=1`
- **Expected**: 400; error message says `n_el` must be ≥ 2 (both poles required; a single elevation is degenerate).

#### Scenario 8.6 — `n` above hard cap
- **Input**: `mode=fibonacci, n=10001`
- **Expected**: 400; error message says `n` exceeds the maximum of `10000` (cap chosen to bound server-side resource usage; see proposal §5.3 / Open Q2 for the concrete cap).

#### Scenario 8.7 — `n` below minimum
- **Input**: `mode=fibonacci, n=0`
- **Expected**: 400; error message says `n` must be ≥ 1.

---

## Out-of-scope for this contract

- DPI / color / background customization of rendered PNGs (separate change).
- Multi-simulation aggregation or comparison (tracked in `visualize-multiple`).
- Caching, shareable projection URLs, or alternative archive formats (tar.gz, individual downloads).

## Notes for implementers (informative, not normative)

- R3 implies that any new `metadata.json` emitted in legacy mode must remain additive: pre-existing consumers typically iterate PNG entries and ignore unknown files, so adding `metadata.json` does not break them, but changing legacy filename shapes **would** and is forbidden. As of 2026-04-24 the legacy mode ZIP DOES carry `metadata.json` (with `parameters.pixels_per_100nm` when rendered as PNG) for FRAKTAL batch-analysis parity.
- R6's boundary is inclusive on the sync side (`n ≤ 200` is sync, `n > 200` is async). The threshold value `200` is a contract constant; implementations MAY expose it as config but callers MUST NOT rely on a different threshold.
- R4's `idx` is scoped per-ZIP, starts at `000`, and increments by 1 per projection in generation order.

<!-- Last sync: 2026-04-30 from change projection-scale-and-render-modes -->
