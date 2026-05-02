# FRAKTAL Detector Fix (PYA-9)

Corrects a systematic overestimation of primary particle diameter
(`dpo`) in the FRAKTAL autocalibrate detector, which inflated fractal
dimension (Df) measurements by up to 2-3x for simulation-origin
batches.

## Why

The detector pipeline had three multiplicative bias sources:

1. **AA halo (~1.2x)**: presentation PNGs include matplotlib
   anti-aliasing.  Grey pixels around particle edges inflate the
   distance-transform peaks, making each primary look ~20% larger
   than its true radius.

2. **NMS fusion (~2x)**: Non-Maximum Suppression used a separation of
   `2.0 * estimated_radius`.  For touching/overlapping primaries
   (delta=1.1, center-to-center ≈ 1.82*radius), this fused adjacent
   peaks into one, doubling the apparent radius.

3. **Top-30% selection (~1.3x)**: the median was computed over only
   the largest 30% of peak distance values.  Fused peaks from (2)
   dominate the top tier, biasing the median upward by ~30%.

Combined effect: true dpo=25 nm was reported as ~54 nm (2.16x),
pushing Df to ~2.0 for every agglomerate regardless of real
morphology.

## What changed

### Engine (aglogen_core)

- **NMS radius factor 2.0 → 1.0**: the minimum separation for
  accepted peaks is now `1.0 * estimated_radius`.  Adjacent touching
  primaries (delta=1.1, separation ≈ 1.82*radius) are correctly
  resolved as distinct peaks.

- **Median over ALL peaks**: the primary radius is now the median of
  all accepted peaks after NMS, not just the top 30%.  This is robust
  to both noise (small spurious peaks) and fusion (large merged blobs).

- **Scientific PNG input**: when a binary-thresholded scientific PNG
  is available, it is used as the detector input.  The
  `smart_segment` function skips Otsu and treats pixels >= 128 as
  foreground, eliminating the AA halo entirely.

### Backend (Django)

- **`analysis_input_variant`** field on `FraktalBatchImage`: records
  whether `"scientific"` or `"presentation"` PNG was fed to the
  engine for each image.

- **`origin`** field on `FraktalBatch`: tracks whether the batch came
  from a simulation or an external upload.

- **`?origin=simulation&sim_dpo_nm=X`** on batch upload endpoint:
  when set, `autocalibrate_dpo` defaults to OFF and the known dpo
  from the simulation is used directly.  `calibration_source` is
  reported as `"manual"`.

- Sim-origin batches without `sim_dpo_nm` return HTTP 400.

### Frontend (React)

- Upload form toggle: sim-origin batches show "Using known dpo = X nm
  from simulation. Override?" with autocalibrate OFF by default.

- External uploads keep `autocalibrate=ON` default (unchanged).

- Drill-down badge: "Analysis input: Scientific (binary)" or
  "Presentation" per image.

## Migration notes

After deploy, run:

```
python manage.py migrate fractal_analysis 0008 0009
```

Migration 0008 adds `analysis_input_variant` (CharField, NOT NULL,
default `"presentation"`).  Migration 0009 adds `origin` to
`FraktalBatch`.  Both are additive — no data loss, no column drops.

## Backward compatibility

- **Legacy ZIPs** (no `*.scientific.png`): fall back to presentation
  PNG.  With NMS=1.0 and all-peaks median, results are still more
  accurate than before even without the scientific input.

- **External ZIP uploads**: keep `autocalibrate=ON` default.  The
  `origin` field defaults to `"external"`.

- **Legacy batch rows**: `analysis_input_variant` defaults to
  `"presentation"`, `origin` defaults to `"external"`.  No backfill
  required.

## Scientific result impact

Re-running prior batches with the updated engine WILL produce
different Df values.  This is expected and correct — the prior values
were systematically biased by the detector overestimation.

## Validation

An integration test (`test_fraktal_detector_pixel_accuracy.py`)
generates a synthetic binary image with 35 circles (radius=10 px,
dpo=25 nm, scale=80 px/100nm) and asserts the detector reports dpo
within ±10% of the true value.

## Known limitations

The Granulated 2012 model has a limited domain.  Some viewing angles
of planar aggregates (Df < 2) have no solution in the bisection
solver — the model returns "Bisection method failed to converge".
PYA-13 is a separate cycle to handle this gracefully with user-facing
messaging and per-image error recovery.
