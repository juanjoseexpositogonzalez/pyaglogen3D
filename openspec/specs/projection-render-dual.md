# Projection Render Dual Modes Specification

## Purpose

Defines the contract for dual-mode PNG rendering: a **presentation** PNG (aglogen3D-style,
with red fill, dark edge, alpha, anti-aliasing, border) and a **scientific** PNG (solid
black on white, no AA, no border, no alpha). Both share identical 2D geometry and pixel
dimensions. Fixes PYA-8's secondary issue: AA halo and border stroke contaminating
box-counting measurements.

This spec describes **observable behavior** — what a caller sees in ZIP contents and
image pixels — not internal implementation.

## Requirements

### R1. Presentation render MUST emit a styled PNG with red color, alpha, AA, and border

**GIVEN** a direction is rendered in presentation mode,
**WHEN** the PNG is written to the ZIP as `{filename}.png`,
**THEN** the image MUST contain red-channel pixels (RGB values with R > 100, matching
the aglogen3D red-fill style),
**AND** the image MUST use anti-aliasing (smooth particle edges — circles are not
pure-pixel-staircase),
**AND** particle circles MUST have a visible dark edge stroke (border/outline present),
**AND** the canvas MUST have a white background with the aggregate rendered on top,
**AND** the image MUST be a valid PNG (parseable by standard image libraries).

#### Scenario 1.1 — Presentation PNG has red pixels

- GIVEN a grid export (`n_az=6, n_el=3`) with at least one non-pole direction
- WHEN the presentation PNG for any direction with visible particles is inspected pixel-by-pixel
- THEN at least one pixel MUST have R > 100, confirming red fill is present

#### Scenario 1.2 — Presentation PNG has smooth edges (AA present)

- GIVEN a presentation PNG with particles visible
- WHEN the edge region of any particle circle is sampled
- THEN there MUST be intermediate-intensity pixels (grayscale values between 20 and 235)
  along the circle perimeter, confirming anti-aliasing

#### Scenario 1.3 — Presentation PNG has dark edge stroke

- GIVEN a presentation PNG with particles visible
- WHEN the perimeter of any rendered circle is inspected
- THEN pixels at the outermost edge of the circle MUST be darker than the fill interior
  (edge R value < fill R value), confirming a border stroke is rendered

---

### R2. Scientific render MUST emit a solid-black-on-white PNG with no AA, no border, no alpha

**GIVEN** a direction is rendered in scientific mode,
**WHEN** the PNG is written to the ZIP as `{filename}.scientific.png`,
**THEN** every pixel MUST be either pure white (RGB 255,255,255) or pure black (RGB 0,0,0),
**AND** no intermediate gray values MUST appear (no anti-aliasing halo),
**AND** no colored pixels MUST appear (no red, no blue — only binary black/white),
**AND** particles MUST be rendered as solid black filled shapes with no edge stroke,
**AND** there MUST be no alpha channel (PNG mode MUST be RGB, not RGBA).

#### Scenario 2.1 — Scientific PNG is binary black/white only

- GIVEN a scientific PNG for any direction with visible particles
- WHEN every pixel is inspected
- THEN each pixel's RGB components are all 0 (black) or all 255 (white) — no other values
- AND the image has no alpha channel (3-channel PNG)

#### Scenario 2.2 — Scientific PNG has no anti-aliasing halo

- GIVEN a scientific PNG with particles visible
- WHEN the edge region of any particle circle is sampled
- THEN there are NO pixels with grayscale values between 1 and 254 (strict binary)

#### Scenario 2.3 — Scientific PNG has no red pixels

- GIVEN a scientific PNG for any direction
- WHEN the image is loaded and all R channel values are inspected
- THEN no pixel has R < 255 while G or B != R (confirming no colored pixels are present)

#### Scenario 2.4 — Scientific PNG has no border stroke

- GIVEN a scientific PNG with particles visible
- WHEN the perimeter of any particle circle is inspected
- THEN the outermost black pixels of the circle are interior fill pixels — there is no
  darker-than-black fringe (impossible) and no lighter edge indicating a partial stroke

---

### R3. Presentation and scientific PNGs MUST share identical 2D bbox and pixel dimensions

**GIVEN** a direction is rendered in both presentation and scientific mode,
**WHEN** the two PNGs are compared,
**THEN** both MUST have identical pixel width × height dimensions,
**AND** both MUST represent the same 2D projected bounding box (same `proj.bounds` input),
**AND** a particle circle visible at pixel position (px, py) in the presentation PNG
MUST occupy the same pixel region in the scientific PNG (geometry is identical; only
visual style differs),
**AND** `pixels_per_100nm` derived from either PNG MUST be the same value (shared canvas).

#### Scenario 3.1 — Identical pixel dimensions

- GIVEN a grid export with `img_size=512`
- WHEN the presentation PNG and scientific PNG for the same direction are opened
- THEN both report pixel size 512 × 512

#### Scenario 3.2 — Particle pixel footprint is identical

- GIVEN a direction with a known particle at 2D coordinates (cx, cy) with radius r
- WHEN the presentation PNG and scientific PNG are compared
- THEN the bounding box of the black region in the scientific PNG for that particle
  matches the bounding box of the red-filled region in the presentation PNG within
  ±1 pixel (sub-pixel AA rendering may shift edge by at most 1 pixel)

#### Scenario 3.3 — `pixels_per_100nm` is the same for both renders

- GIVEN the scale stamped in `directions[i].pixels_per_100nm`
- WHEN this scale is used to convert a box size from pixels to nm using the presentation PNG
- THEN applying the same scale to the scientific PNG yields the same box-size-in-nm result
  (shared geometry guarantees shared scale)

---

### R4. ZIP MUST include BOTH PNGs per direction with locked filename pattern

**GIVEN** a projection ZIP produced in `grid` or `fibonacci` mode,
**WHEN** the ZIP contents are listed,
**THEN** for every direction entry at index `i`, the ZIP MUST contain:
- `proj_{idx:03d}_Az{AAA}_El{±EEE}.png` — presentation PNG
- `proj_{idx:03d}_Az{AAA}_El{±EEE}.scientific.png` — scientific PNG

**AND** both files MUST be present for every direction (no partial pairs),
**AND** the `directions[i].filename` field in `metadata.json` MUST reference the
presentation PNG name (`{base}.png`), and `directions[i].filename_scientific` MUST
reference the scientific PNG name (`{base}.scientific.png`),
**AND** the total number of image files in the ZIP MUST equal `2 × n_generated`.

#### Scenario 4.1 — Dual emit happy path

- GIVEN a grid export (`n_az=6, n_el=3`) → 8 directions
- WHEN the ZIP is opened
- THEN the ZIP contains 16 PNG files (8 presentation + 8 scientific) + `metadata.json`
- AND each presentation file has an exact scientific counterpart with the `.scientific.png` suffix

#### Scenario 4.2 — Filename pattern is locked

- GIVEN direction at index 7, azimuth=45°, elevation=+30°
- WHEN filenames are generated
- THEN presentation filename is `proj_007_Az045_El+030.png`
- AND scientific filename is `proj_007_Az045_El+030.scientific.png`

#### Scenario 4.3 — ZIP structure with metadata references

- GIVEN any grid or fibonacci export
- WHEN `metadata.json` is parsed
- THEN every `directions[i]` object MUST have both `filename` and `filename_scientific` keys
- AND `directions[i].filename` ends with `.png` (not `.scientific.png`)
- AND `directions[i].filename_scientific` ends with `.scientific.png`

#### Scenario 4.4 — No orphan images

- GIVEN any grid or fibonacci export
- WHEN the set of all PNG files in the ZIP is compared to the set of filenames referenced
  in `metadata.json` (both `filename` and `filename_scientific` across all directions)
- THEN both sets are equal — no file in the ZIP is unreferenced, no reference points to
  a missing file

---

### R5. Legacy mode (single-PNG) MUST emit presentation only for backward compat

**GIVEN** a request using `mode=legacy` OR a caller that does not request scientific render,
**WHEN** the ZIP is produced,
**THEN** the ZIP MUST NOT contain any `*.scientific.png` files,
**AND** the `metadata.json` `directions[]` entries MUST NOT contain `filename_scientific` keys,
**AND** `parameters.pixels_per_100nm` in legacy mode continues to use the pre-existing
broadcast formula (3D-bbox based, single value — unchanged from pre-change behavior),
**AND** existing callers of the legacy path receive byte-identical ZIPs at the PNG layer
to what they received before this change.

#### Scenario 5.1 — Legacy ZIP has no scientific PNGs

- GIVEN a request with `mode=legacy`
- WHEN the ZIP contents are listed
- THEN no filename ending in `.scientific.png` appears
- AND the total image count equals the number of directions (not 2×)

#### Scenario 5.2 — Legacy `directions[]` has no `filename_scientific` key

- GIVEN a legacy mode ZIP with `metadata.json`
- WHEN any `directions[i]` object is inspected
- THEN `"filename_scientific"` is NOT a key in that object

#### Scenario 5.3 — Presentation-only callers are unaffected

- GIVEN a caller that reads only `{base}.png` filenames from a grid/fibonacci ZIP
- WHEN the ZIP produced by this change is consumed
- THEN `{base}.png` files are present and identical to what a presentation-only render
  would produce — the presence of `{base}.scientific.png` is additive and non-breaking

---

## Relationship to Other Specs

This spec augments `projection-export-contract` (R4 and R5 modifications regarding dual PNG emit
and metadata shape). The `projection-scale-per-image` spec defines per-direction scale computation;
both presentation and scientific PNGs use the same bounds for scale derivation.
Both `fraktal-batch-contract` and `fraktal-batch-persistence` consume scientific PNGs via
ZIP unpacking and prefer the scientific variant for analysis (with graceful fallback to
presentation for legacy ZIPs).

<!-- Last sync: 2026-04-30 from change projection-scale-and-render-modes -->
