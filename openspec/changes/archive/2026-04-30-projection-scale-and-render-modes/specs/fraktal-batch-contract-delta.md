# Delta for fraktal-batch-contract

Existing capability `fraktal-batch-contract` still applies in full. This delta records
three changes introduced by `projection-scale-and-render-modes`:

1. Engine batch signature now accepts `Vec<f64>` per-image scales (or single `f64` broadcast for legacy).
2. ZIP unpacking prefers `*.scientific.png` per direction when available; falls back to presentation PNG.
3. PNG endpoint gains `?variant=presentation|scientific` query param with graceful fallback.

Companion new-capability specs: `./projection-scale-per-image/spec.md`,
`./projection-render-dual/spec.md`.

---

## MODIFIED Requirements

### R1. Batch endpoint accepts ZIP with pyaglogen metadata

Modifies **R1 of [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md)**.

**GIVEN** a caller uploads a ZIP previously produced by pyaglogen3D's projection export,
**AND** the ZIP contains `metadata.json` with `parameters.pixels_per_100nm` present and positive,
**WHEN** the batch endpoint processes the upload,
**THEN** the scale for each image is taken from `directions[i].pixels_per_100nm` when that
field is present in the corresponding `directions[]` entry (new-mode ZIP),
**AND** when `directions[i].pixels_per_100nm` is absent for an entry (legacy-mode ZIP), the
top-level `parameters.pixels_per_100nm` is broadcast to that image (legacy fallback — no
parse error, no calibration failure),
**AND** `calibration_source: "metadata"` is reported in both cases,
**AND** the response body includes `calibration_source: "metadata"`.

(Previously: only `parameters.pixels_per_100nm` was read and applied uniformly to every
image; per-image `directions[i].pixels_per_100nm` did not exist.)

#### Scenario 1.1 — New-mode ZIP: per-image scales consumed

- GIVEN a ZIP from `mode=grid, n_az=10, n_el=5` (32 directions) where each
  `directions[i].pixels_per_100nm` has a distinct value (non-spherical aggregate)
- WHEN submitted to the batch endpoint
- THEN each of the 32 analyzer calls receives its own per-image scale
- AND `calibration_source = "metadata"`

#### Scenario 1.2 — Legacy ZIP: top-level broadcast

- GIVEN a ZIP with `metadata.parameters.pixels_per_100nm = 38.5` and NO per-direction
  `pixels_per_100nm` fields in `directions[]`
- WHEN submitted to the batch endpoint
- THEN batch runs with scale `38.5` broadcast to all images
- AND `calibration_source = "metadata"`

#### Scenario 1.3 — Mixed ZIP (partial per-direction)

- GIVEN a ZIP where some `directions[i]` have `pixels_per_100nm` and some do not
- WHEN submitted to the batch endpoint
- THEN entries WITH the field use their individual scale; entries WITHOUT it fall back
  to `parameters.pixels_per_100nm` (broadcast value)
- AND no HTTP 400 is returned for the absent fields

#### Scenario 1.4 — Metadata present but top-level scale non-positive

- GIVEN `metadata.parameters.pixels_per_100nm = 0` and no per-direction fields
- WHEN submitted without explicit calibration
- THEN the metadata calibration path is treated as missing; R2 fallback applies

---

## ADDED Requirements

### R-DELTA-C. Engine batch function accepts per-image `Vec<f64>` scales or single broadcast float

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

**GIVEN** the FRAKTAL batch engine function `analyze_fraktal_batch`,
**WHEN** called from the Python binding layer,
**THEN** it MUST accept a `Vec<f64>` of per-image scale values (one per image in the batch),
**AND** it MUST also accept a single `f64` value in the legacy-broadcast form, silently
expanding it to `[scale; N]` for all N images before the first analyzer call,
**AND** when `Vec<f64>` is provided with length ≠ N (batch image count), the call MUST fail
with a clear error (scale vector length mismatch),
**AND** the single-float legacy form MUST NOT require any caller-side migration — existing
call sites passing a single float continue to work without change.

#### Scenario C.1 — Per-image Vec accepted

- GIVEN a batch of 8 images with scales `[42.1, 41.8, 43.0, 40.5, 44.2, 41.0, 42.9, 43.5]`
- WHEN `analyze_fraktal_batch` is called with the Vec
- THEN each image is analyzed with its own scale value (no broadcast)
- AND the per-image `calibration_used.pixels_per_100nm` in results reflects each image's value

#### Scenario C.2 — Legacy single-float broadcast

- GIVEN a legacy batch call passing a single `f64 = 38.5`
- WHEN `analyze_fraktal_batch` is invoked
- THEN the engine internally broadcasts `[38.5; N]` for all N images
- AND results match a Vec call with the same repeated value

#### Scenario C.3 — Vec length mismatch is rejected

- GIVEN a batch of 10 images with a `Vec<f64>` of length 9
- WHEN `analyze_fraktal_batch` is called
- THEN the call returns an error (not a panic) describing the length mismatch
- AND no analyzer calls are made

#### Scenario C.4 — Single-image batch with scalar

- GIVEN `N=1`, single float `dpo = 25.5` passed
- WHEN `analyze_fraktal_batch` runs
- THEN it produces one result using scale `25.5`; no error about single-element broadcast

#### Scenario C.5 — Vec with one null-scale entry (degenerate view)

- GIVEN a Vec where `scales[3] = null` (degenerate direction, empty aggregate)
- WHEN `analyze_fraktal_batch` is called
- THEN image 3 is flagged as failed in the results with error "degenerate scale"
- AND remaining images proceed with their own scales

---

### R-DELTA-D. ZIP unpacking: prefer scientific PNG per direction when available; fall back to presentation

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

**GIVEN** a ZIP is ingested by the FRAKTAL batch task,
**WHEN** the task unpacks image files for analysis,
**THEN** for each direction entry `i`, the task MUST use `directions[i].filename_scientific`
(the scientific PNG) as the analysis input when that file is present in the ZIP,
**AND** when `directions[i].filename_scientific` is absent OR the referenced file is not
present in the ZIP (legacy mode or pre-change ZIP), the task MUST fall back silently to
`directions[i].filename` (the presentation PNG),
**AND** the fallback MUST NOT emit an HTTP 4xx or raise an exception — it is a silent
compatibility path,
**AND** `calibration_source` and per-image result fields are unaffected by the
presentation/scientific selection.

(Previously: the batch task consumed whichever PNG it found matching the direction filename;
there was no concept of a scientific variant.)

#### Scenario D.1 — New-mode ZIP: scientific PNG consumed

- GIVEN a new-mode ZIP where each direction has both `.png` and `.scientific.png`
- WHEN the batch task unpacks direction `i`
- THEN the bytes fed to the FRAKTAL analyzer are from `{base}.scientific.png` (no AA halo)
- AND `png_scientific_bytes` for that `FraktalBatchImage` row is the scientific PNG bytes

#### Scenario D.2 — Legacy ZIP: presentation PNG used as fallback

- GIVEN a legacy ZIP with no `*.scientific.png` files
- WHEN the batch task unpacks any direction
- THEN the bytes fed to the analyzer are from the presentation `.png`
- AND `png_scientific_bytes` is left NULL in the `FraktalBatchImage` row
- AND no error is raised

#### Scenario D.3 — Scientific PNG referenced but missing from ZIP

- GIVEN a ZIP whose `metadata.json` lists `filename_scientific` for a direction but the
  file is absent from the ZIP archive (corrupt export)
- WHEN the batch task encounters this direction
- THEN the task falls back to the presentation PNG for that direction
- AND the per-image error field is populated with a warning about the missing scientific file

#### Scenario D.4 — Cross-project batch access

- GIVEN a user attempts to run a batch using a ZIP belonging to another project
- WHEN the batch endpoint validates the request
- THEN HTTP 403 is returned regardless of whether the ZIP contains scientific PNGs

---

### R-DELTA-E. PNG endpoint gains `?variant=presentation|scientific` query parameter

Adds to [`fraktal-batch-contract.md`](../../../specs/fraktal-batch-contract.md).

**GIVEN** a `FraktalBatchImage` row with persisted PNG bytes,
**WHEN** `GET /api/v1/projects/{project_pk}/fraktal/batches/{batchId}/images/{index}/png/`,
**THEN** the endpoint MUST accept an optional `?variant=presentation|scientific` query param,
**AND** when `?variant=scientific` is requested AND `png_scientific_bytes IS NOT NULL`,
the response body MUST equal the persisted `png_scientific_bytes`,
**AND** when `?variant=scientific` is requested AND `png_scientific_bytes IS NULL`
(legacy row), the endpoint MUST fall back silently to the presentation PNG bytes (HTTP 200
with presentation bytes — no 404, no 422),
**AND** when `?variant=presentation` is requested OR the param is omitted, the response
MUST equal the persisted `png_bytes` (presentation bytes — unchanged from current behavior),
**AND** `Content-Type: image/png` and cache headers MUST be identical for both variants.

(Previously: the PNG endpoint served only presentation bytes with no variant selection.)

#### Scenario E.1 — Variant=scientific returns scientific bytes

- GIVEN a new-row batch image with `png_scientific_bytes` populated
- WHEN `GET .../png/?variant=scientific`
- THEN HTTP 200; response body bytes match `FraktalBatchImage.png_scientific_bytes`
- AND `Content-Type: image/png`

#### Scenario E.2 — Variant=scientific falls back for legacy row

- GIVEN a legacy `FraktalBatchImage` row with `png_scientific_bytes IS NULL`
- WHEN `GET .../png/?variant=scientific`
- THEN HTTP 200; response body bytes equal `png_bytes` (presentation fallback)
- AND no 404 is returned

#### Scenario E.3 — Variant=presentation (or omitted) returns presentation bytes

- GIVEN any `FraktalBatchImage` row
- WHEN `GET .../png/` or `GET .../png/?variant=presentation`
- THEN HTTP 200; response body bytes match `FraktalBatchImage.png_bytes` (unchanged behavior)

#### Scenario E.4 — Cross-project 403 on both variants

- GIVEN user B requesting an image that belongs to user A's project
- WHEN `GET .../png/?variant=scientific` or `GET .../png/?variant=presentation`
- THEN HTTP 403 regardless of variant

#### Scenario E.5 — Unknown variant value rejected

- GIVEN `GET .../png/?variant=raw`
- WHEN the endpoint validates the param
- THEN HTTP 400 with error identifying the invalid variant value
