# Delta for projection-export-contract

Existing capability `projection-export-contract` still applies in full. This delta records
three changes introduced by `projection-scale-and-render-modes`:

1. `metadata.json` `directions[]` gains per-direction `pixels_per_100nm` and `filename_scientific` (new mode only).
2. ZIP structure gains a `*.scientific.png` per direction in grid/fibonacci mode; legacy mode emits only presentation PNGs.
3. Render order is now explicit: render ALL directions first, measure per-image scale, write `metadata.json` once before ZIP close.

Companion new-capability specs: `./projection-scale-per-image/spec.md`,
`./projection-render-dual/spec.md`.

---

## MODIFIED Requirements

### R5. `metadata.json` is present in the ZIP with contract shape

Modifies **R5 of [`projection-export-contract.md`](../../../specs/projection-export-contract.md)**.

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

- GIVEN `mode=grid, n_az=6, n_el=3` producing 8 directions
- WHEN `metadata.json` is parsed
- THEN `len(directions) == 8`
- AND every `directions[i]` has keys `index`, `filename`, `filename_scientific`, `azimuth`, `elevation`, `pixels_per_100nm`
- AND `parameters.pixels_per_100nm == max(d.pixels_per_100nm for d in directions)`
- AND ZIP contains 16 PNGs + `metadata.json` = 17 entries total

#### Scenario 5.2 — Fibonacci metadata shape (new mode)

- GIVEN `mode=fibonacci, n=50`
- WHEN `metadata.json` is parsed
- THEN `len(directions) == 50`
- AND all 50 entries have `filename_scientific` ending in `.scientific.png`
- AND all 50 entries have `pixels_per_100nm` as positive float (non-degenerate aggregate)

#### Scenario 5.3 — Legacy mode: per-entry fields ABSENT

- GIVEN `mode=legacy` request (or no `mode` field)
- WHEN any `directions[i]` object in the resulting `metadata.json` is inspected
- THEN the key `pixels_per_100nm` is NOT present in that object (key absent, not null)
- AND the key `filename_scientific` is NOT present in that object (key absent, not null)
- AND the legacy sweep fields (`azimuth_start`, etc.) appear in `parameters` as before

#### Scenario 5.4 — Single direction: max equals the only value

- GIVEN `mode=grid, n_az=1, n_el=2` producing 2 directions (poles only)
- WHEN `parameters.pixels_per_100nm` is read
- THEN it equals the larger of the two `directions[i].pixels_per_100nm` values

#### Scenario 5.5 — No orphan images (dual-emit parity)

- GIVEN any grid or fibonacci export
- WHEN the set of PNG filenames in the ZIP is compared to the union of
  `{d.filename, d.filename_scientific}` for all `d` in `metadata.directions`
- THEN both sets are equal — no file in the ZIP is unreferenced, no reference points to
  a missing file

---

### R-DELTA-A. ZIP structure for grid and fibonacci modes includes dual PNGs per direction

Adds to / modifies the implicit ZIP structure contract described in **R4 and R5 of
[`projection-export-contract.md`](../../../specs/projection-export-contract.md)**.

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

New explicit rendering-order requirement. No prior R in
[`projection-export-contract.md`](../../../specs/projection-export-contract.md) specified
render order; this delta adds it as an observable pipeline constraint.

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
