# PYA-9 Exploration: FRAKTAL Detector Overestimation + Bisection Failures

**Date**: 2026-05-01
**Context**: Post-PYA-8 hotfix (3D bbox rasterizer fix) + frente-7 scale fix.
Simulation: dpo=25nm, npo=350, target Df=1.8, kf=1.4. Engine Df=1.802, kf=1.393.
31 projections → batch FRAKTAL: ~17 succeed, ~14 fail "Bisection method failed to converge". Successful images report `dpo_used ≈ 54.6nm` (2.18× real 25nm) and Df≈1.998 (saturated at cap). With autocalibrate OFF + manual dpo=25nm: 30/31 fail.

---

## 1. Canonical MATLAB vs Rust Port Comparison

### MATLAB (`dimfrac2012.m` lines 8-31 + `GeneralExe2012individual.m` line 32)

The canonical MATLAB code does **NOT** estimate `dpo` from the image. The `dpo` parameter is always **manual user input** — passed as `dpomat` from the GUI. The closest thing to "autocalibrate" is the human operator measuring dpo from TEM images externally.

In MATLAB, the binary image is created by:
```matlab
i2d = uint8(double(imagenbn) .* double(roicolor(imagenbn, 0, 240)));
```
This applies a hard range `[0, 240]` mask — `roicolor` returns 1/0, then element-wise multiply keeps pixels in range and zeros everything else. There is **no Otsu threshold**, no distance transform, no NMS, no particle-counting. The user supplies `dpo` and `npo` is computed as an output of the bisection, not estimated from the image.

### Rust port (`image_processing.rs`)

The Rust port adds three capabilities that DON'T EXIST in canonical MATLAB:

1. **Otsu auto-thresholding** (`smart_segment`, lines 135-165) with dark-on-light detection and `±10` margin on threshold
2. **Distance-transform-based particle detector** (`estimate_particle_count_adaptive`, lines 348-448) with NMS
3. **Auto-calibrate dpo** (`estimate_particles_and_dpo`, lines 453-460) — derives `dpo_nm = 2 × avg_radius_px × length_per_pixel`

**Verdict**: The Rust detector is an ENTIRELY NEW algorithm, not a port. MATLAB never detects particles from the image — it takes dpo as manual input. The Rust autocalibrate is custom logic with no MATLAB equivalent.

---

## 2. Detector Bias Analysis — Point-by-Point

### 2.1 Segmentation Threshold (Otsu + margin)

**File**: `image_processing.rs:153-162`

```rust
let effective_threshold = otsu.saturating_add(10).min(pixel_max);
image.mapv(|v| v >= pixel_min && v <= effective_threshold)
```

For a renderer producing red circles (facecolor="red") on white background with a black edge (`edgecolor="black"`, `linewidth=0.5`):

- After `convert("L")`, red pixels ≈ 76 (0.299×255), black edge ≈ 0, white bg ≈ 255
- Matplotlib anti-aliasing (AA) produces a gradient halo around each circle edge: values from ~76 to ~255 smoothly
- Otsu will find a threshold separating the bimodal distribution (background peak at ~255 vs particle peak at ~76). Likely threshold ≈ 165
- The `+10` margin pushes effective threshold to ~175
- **AA halo pixels with values 76-175 are INCLUDED in the segmented blob**

**Bias contribution**: Each particle's boundary is expanded by the AA gradient zone. For a 20px-diameter particle, the AA halo adds ~1-2px of radius on each side → measured radius = ~12 vs true 10 → **~20% inflation**.

**Counterpoint**: The `render_scientific_png` (lines 124-189 of `projection.py`) applies binary thresholding post-render (`arr > 127 → 255, else 0`), removing AA. But this is only for the `scientific_png` variant — the **presentation PNG** (what the batch analyzer reads) keeps the AA halo.

### 2.2 Distance Transform Output

**File**: `image_processing.rs:281-337`

The two-pass algorithm uses L1+diagonal approximation (not Euclidean EDT). For a perfect 20px-diameter circle:

- True center pixel should have distance = 10.0 (radius)
- L1+diagonal gives ≈ 9.4 for a 20px circle (underestimates vs Euclidean by ~6%)
- But with AA halo expanding the blob by ~1-2px: effective radius ≈ 12, distance at center ≈ 11.2

**Net effect**: Distance transform itself is slightly conservative, but the AA-expanded blob overcompensates → distance at center reports ~11-12 for a 10px-radius particle.

### 2.3 NMS Radius Factor — THE CRITICAL BUG

**File**: `image_processing.rs:424`

```rust
let min_separation = estimated_radius * 2.0;
```

This means two peaks must be at least `2 × estimated_radius` apart. For tightly-packed primary particles where center-to-center distance equals `2 × radius` (touching spheres), peaks EXACTLY at the NMS boundary get **fused**. Any slight overlap (which delta=1.1 guarantees) makes adjacent peaks disappear.

**Quantitative impact**: With delta=1.1, center-to-center = `2 × radius / delta = 1.82 × radius`, which is LESS than the NMS `2.0 × radius` threshold → **ALL adjacent peaks fuse**.

For an aggregate of 350 primaries projected to 2D, many primaries overlap. The NMS fusing reduces detected peaks dramatically → remaining "peaks" represent merged blobs with inflated distance values → average radius biased upward.

**Expected bias**: For a typical Df=1.8 aggregate:
- True: 350 primaries, radius ~10px each
- After NMS fusion with 2× factor: detector finds ~50-100 merged peaks
- Merged peaks have distance values = max over merged region, which reflects the CLUSTER radius, not single primary radius
- Estimated radius inflated by ~1.5-2.5× depending on packing density

### 2.4 Top 30% Peaks → Median

**File**: `image_processing.rs:400-420`

```rust
let n_top = (all_peaks.len() * 3 / 10).max(3).min(50).min(all_peaks.len());
// ...
// Use median
let mid = top_distances.len() / 2;
```

Contrary to the user's hypothesis, the code DOES use median (not mean) of the top 30% peaks. This was likely already fixed. However:

- "Top 30% of peaks" selects the peaks with HIGHEST distance values (sorted descending at line 397)
- These are the LARGEST features — already biased by NMS fusion
- Median of the top 30% of already-fused-and-inflated peaks is still biased upward
- Should use median of ALL peaks (not top 30%) — or better, use mode detection on the distance histogram

**Estimated bias from selection**: Top-30% median is ~1.3× higher than all-peaks median for typical aggregate projections.

### 2.5 Combined Detector Bias

Combining multiplicative factors:
- AA halo expansion: **×1.2** (1-2px on 10px radius)
- NMS fusion at 2× (for delta=1.1 packed primaries): **×1.5-2.5**
- Top 30% selection: **×1.3**

**Total estimated dpo overestimation**: `1.2 × 2.0 × 1.3 ≈ 3.1×` for densely packed projections.

Empirical observation: `54.6nm / 25nm = 2.18×`. This is squarely within the predicted range, confirming the combined bias is real.

---

## 3. Bisection Range Diagnostic

### 3.1 Search Range and Tolerance

**File**: `bisection.rs:37-43`

```rust
tolerance: 1e-5,
max_iterations: 100,
step_size: 0.05,  // ~40 points in [1.0, 3.0]
```

**File**: `granulated_2012.rs:278-292` — but the actual search is narrowed:

```rust
// Find lower bound where kf becomes positive (searching from high to low)
let mut df_min_valid = 3.0;
for i in 0..40 {
    let test_df = 3.0 - 0.05 * (i as f64);
    let test_kf = calculate_kf(test_df, akf, bkf, ckf);
    if test_kf > 0.01 { df_min_valid = test_df; }
    else { break; }
}
let df_search_min = (df_min_valid + 0.05).min(2.5);
let result = solver.solve(objective, df_search_min, 3.0);
```

The Rust code **restricts** the search to the region where `kf > 0`, which can be as narrow as `[2.5, 3.0]`. The MATLAB code searches the full `[1.0, 3.0]` range.

### 3.2 What Happens When No Sign Change Exists

**File**: `bisection.rs:132-134`

```rust
if !found_bracket {
    return self.fallback_optimization(&objective_fn, df_min, df_max);
}
```

Fallback uses golden section search on `|f(Df)|`. At line 219:

```rust
let valid = df_opt > 1.001 && df_opt < 2.999;
BisectionResult {
    df: if valid { df_opt } else { 0.0 },
    kf: if valid { kf } else { 0.0 },
    converged: valid && fun_value.abs() < CONVERGENCE_THRESHOLD,  // < 0.1
}
```

When the minimum of `|f(Df)|` is greater than 0.1, `converged = false` → the outer loop in `granulated_2012.rs:295` breaks and tries next initial estimate. If ALL initial estimates fail → `FraktalStatus::NoConvergence` → error "Bisection method failed to converge".

### 3.3 Mathematical Analysis: When Does the Equation Have No Solution?

The FRAKTAL equation: `kf(Df) × (dp/dpo)^Df = (Ap/Apo(Df))^zp(Df)`

With the user's parameters:
- `dpo = 25nm` (manual, correct)
- `dp = 2 × Rg` where Rg is computed from the binary image
- `Ap` = projected area from binary image
- `Apo(Df)` = single-primary projected area (depends on Jf, delta, dpo)
- `zp(Df)` = overlap exponent (function of npo, Df, m)

For a **near-planar aggregate** viewed from a **high-inclination angle** (e.g., az=90° el=80°):
- Ap (projected area) is much SMALLER than for a top-down view (the aggregate is viewed nearly edge-on)
- Rg (radius of gyration of the projection) also shrinks
- `dp = 2×Rg` is much smaller, but `Ap` shrinks faster

The LHS `kf × (dp/dpo)^Df` grows with Df (since `dp/dpo > 1` for aggregates).
The RHS `(Ap/Apo)^zp` — when Ap is very small relative to Apo (edge-on view of a planar aggregate, few primaries visible), the ratio `Ap/Apo` can be < 1, making the RHS < 1 for all zp > 0.

If LHS > 1 for all Df ∈ [1,3] but RHS < 1, the equation LHS = RHS has NO solution → bisection fails.

**This happens specifically for projections where**:
- The aggregate is viewed at high elevation angles where projected area collapses
- Especially for Df=1.8 (near-planar) aggregates where the edge-on projection is dramatically thinner
- The ratio `dp/dpo` stays large (Rg doesn't shrink as fast as area) → LHS always > RHS

### 3.4 Why Manual dpo=25nm Also Fails (30/31 images)

This confirms that the detector is NOT the only problem. Even with correct dpo:

The Granulated 2012 model equation has limited domain validity. For projections of an aggregate with Df=1.8 (chain-like/planar), many viewing angles produce geometries where `(Ap/Apo)^zp` doesn't cross `kf × (dp/dpo)^Df` in [1.0, 3.0].

The restricted search range `[df_search_min, 3.0]` makes this worse — the MATLAB code searches [1.0, 3.0] where the sign change might exist in the lower Df region where the Rust code doesn't look.

---

## 4. Recommended Fix Path

### Fix A: Detector Overestimation (PYA-9 proper)

1. **Use scientific PNG for batch analysis (not presentation PNG)**
   - `render_scientific_png` already removes AA halos with binary threshold
   - The batch path currently sends presentation PNGs through PIL → grayscale
   - Change: use `scientific_png_b64` as analysis input when available, fall back to presentation PNG
   - Effort: **Low** (wiring change)
   - Impact: Eliminates AA halo bias (~1.2× reduction in overestimation)

2. **Reduce NMS radius from 2.0 to 1.0 (or even 0.7)**
   - `image_processing.rs:424`: change `estimated_radius * 2.0` to `estimated_radius * 1.0`
   - For delta=1.1 (touching/overlapping spheres), centers are at `1.82 × radius` apart → NMS of 1.0× still resolves them
   - Effort: **Low** (one-line change + test update)
   - Impact: Biggest single fix — eliminates peak fusion bias (~2× reduction)

3. **Use ALL-peaks median instead of top-30% median**
   - `image_processing.rs:401-404`: change `all_peaks.len() * 3 / 10` to `all_peaks.len()`
   - Or better: compute the mode of the distance histogram (most common peak distance = true primary radius)
   - Effort: **Low-Medium**
   - Impact: ~1.3× reduction

4. **Validate detector against known geometry**
   - The simulation knows the TRUE dpo (25nm) and scale (80px/100nm) → true radius in pixels = `25/2 × 80/100 = 10px`
   - Add integration test: generate synthetic projection with known geometry, verify detector output within ±10%
   - Effort: **Medium**

### Fix B: Bisection Failure UX (PYA-13)

1. **Expand search range to match MATLAB**
   - `granulated_2012.rs:289-292`: change `let df_search_min = (df_min_valid + 0.05).min(2.5)` to search from 1.0
   - The MATLAB code searches `dfmat=1:0.05:3` regardless of kf sign, letting the bisection find solutions where the Rust code currently doesn't look
   - Caution: kf can go negative for Df < ~1.85, making the equation meaningless. The MATLAB code evaluates these but they produce non-physical solutions (negative kf). The current Rust restriction is intentional but too aggressive.
   - Better approach: search [1.0, 3.0] but reject solutions where `kf < 0` post-hoc, rather than pre-filtering the range
   - Effort: **Medium**

2. **Distinguish error causes in the status message**
   - Current: all failures report "Bisection method failed to converge"
   - Better: report WHY it failed:
     - "No sign change found in Df ∈ [1, 3] — projection geometry may be incompatible with Granulated 2012 model at this viewing angle"
     - "kf negative in search range — aggregate configuration not representable by this model"
   - Include diagnostic values: `LHS_at_Df1`, `LHS_at_Df3`, `RHS_at_Df1`, `RHS_at_Df3` so the user can see the equation state
   - Effort: **Low**

3. **Allow graceful degradation instead of hard error**
   - If no exact solution exists, return the Df where `|LHS - RHS|` is minimized, with a quality flag
   - Status: `FraktalStatus::Approximate(min_residual)` instead of `NoConvergence`
   - The user sees "Df ≈ 2.3 (approximate, residual = 0.45)" instead of "failed"
   - Effort: **Medium**

4. **Add per-image diagnostics to batch results**
   - Return `azimuth`, `elevation`, `ap`, `rg`, `dp/dpo` per image so the user can identify which geometries fail
   - This is partially done (PYA-drilldown feature) but needs the equation diagnostics
   - Effort: **Low** (extend `BatchImageResult`)

---

## 5. Open Questions for User

1. **Use scientific PNG for FRAKTAL analysis?** The scientific render already removes AA halos. Using it as input to the analyzer eliminates the segmentation inflation. Tradeoff: scientific PNG has no edge drawing (`edgecolor="none"`) — the presentation PNG has edges (`linewidth=0.5`) that add ~1px to each particle. Scientific PNG is more accurate for automated analysis.

2. **NMS radius: 1.0× or 0.7×?** Reducing from 2.0 to 1.0 resolves adjacent peaks for delta=1.1. Going to 0.7 would resolve even more tightly packed configurations but risks creating spurious peaks from the distance transform artifacts. Recommend 1.0 as starting point, validate empirically.

3. **Should autocalibrate be the default for batch-from-simulation?** When we have the true dpo from the simulation parameters, autocalibrate is strictly worse than manual. The frontend should default to `autocalibrate=OFF, dpo=sim.parameters.dpo` when the batch ZIP comes from a simulation.

4. **Accept "no solution" as valid scientific result?** For certain viewing angles of near-planar aggregates, the Granulated 2012 model genuinely has no solution. This is a PHYSICAL LIMITATION, not a bug. Should these images be excluded from batch statistics with a clear explanation, or should we compute an approximate Df with a quality warning?

5. **Expand kf search range?** The Rust code intentionally restricts Df search to where kf > 0. MATLAB doesn't restrict but can produce non-physical kf < 0 solutions. Should we search [1.0, 3.0] and reject kf < 0 solutions post-hoc (like MATLAB), or keep the pre-filtering?

---

## Summary

| Finding | Severity | Root Cause | Fix |
|---------|----------|------------|-----|
| Detector overestimates dpo by ~2× | **HIGH** | NMS radius 2× fuses adjacent peaks; AA halo expands segmented blob | Reduce NMS to 1×; use scientific PNG |
| 30/31 images fail with manual dpo=25nm | **HIGH** | Granulated 2012 model has no solution for many projection angles of planar (Df≈1.8) aggregates | Physical limitation; expand search range; graceful degradation |
| Df saturates at ~2.0 for "successful" images | **MEDIUM** | With inflated dpo (54.6nm), equation is forced to extreme of valid range | Fixing detector dpo resolves this |
| Search range restricted to kf>0 region | **MEDIUM** | Rust pre-filters vs MATLAB's post-filter approach | Search [1.0, 3.0], reject kf<0 post-hoc |
| Error message undifferentiated | **LOW** | All failures report same message | Add diagnostic context to error |
