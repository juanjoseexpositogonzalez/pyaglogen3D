//! Fast 3D Box-counting fractal dimension analysis using Morton codes.
//!
//! This implementation uses the bit-interleaving technique from Hou et al. (1990)
//! "An efficient algorithm for fast O(N ln N) box-counting" adapted for 3D.
//!
//! Key optimizations:
//! - Morton codes (Z-order curve) for spatial hashing
//! - Single sort operation - O(N log N)
//! - Bit masking for multi-scale counting - O(N) per scale
//! - Parallel processing with rayon
//! - SIMD-friendly bit operations

use std::fmt;
use std::time::Instant;

use rayon::prelude::*;

/// Maximum precision in bits (21 bits per dimension = 63 bits total for 3D Morton code).
const MAX_PRECISION: u32 = 21;

/// Validation error from the windowed box-counting path (`box_counting_3d_windowed`).
///
/// Window indices refer to the EFFECTIVE level sequence: the count-valid
/// levels (`0 < count < N`) ordered finest-first (index 0 = finest count-valid
/// level) — the semantics validated by the Phase 0 diagnostic
/// (`bc_window_alignment_audit`, design Log L2). NOT raw Morton level indices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoxCountingError {
    /// Window start is greater than window end (empty range).
    EmptyWindow { start: usize, end: usize },
    /// Window extends beyond the effective level sequence.
    WindowOutOfRange {
        start: usize,
        end: usize,
        num_levels: usize,
    },
    /// Fewer than 3 count-valid levels fall inside the window (occurs at
    /// small N / high Df, e.g. effLevels = 2-3 at Df >= 2.5, N <= 100 —
    /// see design Log L2).
    InsufficientLevels { have: usize, need: usize },
}

impl fmt::Display for BoxCountingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BoxCountingError::EmptyWindow { start, end } => {
                write!(f, "empty fit window: start {start} > end {end}")
            }
            BoxCountingError::WindowOutOfRange {
                start,
                end,
                num_levels,
            } => write!(
                f,
                "fit window ({start}, {end}) out of range: only {num_levels} count-valid levels"
            ),
            BoxCountingError::InsufficientLevels { have, need } => write!(
                f,
                "only {have} count-valid levels inside the fit window, need at least {need}"
            ),
        }
    }
}

impl std::error::Error for BoxCountingError {}

/// Choice of box-counting fit window returned by [`select_fit_window`]
/// (task #332 S2, criterion R5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FitWindowChoice {
    /// Inclusive `(start, end)` indices into the effective (count-valid)
    /// level sequence, finest-first — directly consumable by
    /// [`box_counting_3d_windowed`]. `None` means **no measured window**: the
    /// caller must use the legacy path ([`box_counting_3d_morton`]), NOT
    /// `(0, effective_levels - 1)` on the windowed path. Those are not the same
    /// thing: with fewer than 3 count-valid levels the windowed path rejects the
    /// range outright, so mapping `None` that way turns a fallback into an error.
    pub window: Option<(usize, usize)>,
    /// Whether the window is a measured choice. `false` means no measured window
    /// (see [`FitWindowChoice::window`]): the declared fallback where R5 refuses.
    pub reliable: bool,
    /// Number of count-valid levels (`0 < count < n_points`).
    pub effective_levels: usize,
}

/// Select the box-counting fit window from the raw per-level counts
/// (task #332 S2, criterion R5 — locked in task Log L9).
///
/// # Criterion (R5, "coarse window")
/// Among the count-valid levels — those with `0 < count < n_points`, kept in
/// their natural order (finest-first, the order `box_counting_3d_windowed`
/// indexes them) — the window is `(1, len-1)` when there are at least 3
/// count-valid levels from index 1 onward (i.e. `len >= 4`). Index 0 is dropped
/// as the finest **non-saturated** level, the noisiest end of the usable curve.
/// (Saturated levels are not "index 0" of anything here: the filter above drops
/// them, so the saturation transition sits *above* the effective sequence.)
/// Otherwise the window is `None` with `reliable = false`, and the caller falls
/// back to the legacy estimator rather than to a windowed fit of everything.
///
/// # Measured evidence
/// R5 was chosen by measuring five candidate rules on engine clouds (task
/// #332 Log L9): max |Δ| 0.359, mean 0.185 — better than the oracle's mean
/// 0.306. It refuses on short curves (< 4 count-valid levels, e.g. all
/// N = 100 runs), which is why the fallback is the current behaviour: where
/// R5 refuses it cannot make anything worse.
///
/// This is a pure function: it does not touch the estimator. `n_points` is
/// the number of points of the run the counts come from, used only to filter
/// saturated levels (`count == n_points`).
pub fn select_fit_window(counts: &[usize], n_points: usize) -> FitWindowChoice {
    let effective_levels = counts.iter().filter(|&&c| 0 < c && c < n_points).count();

    if effective_levels >= 4 {
        // At least 3 count-valid levels from index 1 onward: fit 1..=last,
        // dropping only the noisiest (finest) non-saturated level.
        FitWindowChoice {
            window: Some((1, effective_levels - 1)),
            reliable: true,
            effective_levels,
        }
    } else {
        // No measured window. The caller keeps `box_counting_3d_morton`: the
        // windowed path would reject fewer than 3 levels, so `None` is not a
        // range to be rebuilt as (0, len-1).
        FitWindowChoice {
            window: None,
            reliable: false,
            effective_levels,
        }
    }
}

/// Interleave bits of x into a 64-bit integer, spreading them apart for Morton code.
/// Places bits of x at positions 0, 3, 6, 9, ... (every 3rd bit for 3D).
#[inline]
fn expand_bits_3d(mut x: u64) -> u64 {
    // Use magic numbers to spread bits
    // Reference: https://www.forceflow.be/2013/10/07/morton-encoding-for-3d/
    x &= 0x1fffff; // Keep only 21 bits
    x = (x | (x << 32)) & 0x1f00000000ffff;
    x = (x | (x << 16)) & 0x1f0000ff0000ff;
    x = (x | (x << 8)) & 0x100f00f00f00f00f;
    x = (x | (x << 4)) & 0x10c30c30c30c30c3;
    x = (x | (x << 2)) & 0x1249249249249249;
    x
}

/// Compute 3D Morton code from coordinates.
/// Morton code interleaves bits: z2y2x2z1y1x1z0y0x0
#[inline]
pub fn morton_encode_3d(x: u64, y: u64, z: u64) -> u64 {
    expand_bits_3d(x) | (expand_bits_3d(y) << 1) | (expand_bits_3d(z) << 2)
}

/// Result from 3D box-counting analysis.
#[derive(Debug, Clone)]
pub struct BoxCountingResult3D {
    /// Estimated fractal dimension.
    pub dimension: f64,
    /// R-squared value of the linear fit.
    pub r_squared: f64,
    /// Standard error of the dimension estimate.
    pub std_error: f64,
    /// 95% confidence interval.
    pub confidence_interval: (f64, f64),
    /// Log(1/box_size) values used in fitting.
    pub log_scales: Vec<f64>,
    /// Log(box_count) values at each scale.
    pub log_counts: Vec<f64>,
    /// Residuals from linear fit.
    pub residuals: Vec<f64>,
    /// Execution time in milliseconds.
    pub execution_time_ms: u64,
    /// Number of points analyzed.
    pub num_points: usize,
    /// Start index of linear region (0 = all points used).
    pub linear_region_start: usize,
    /// Number of count-valid levels (`0 < count < N`) BEFORE the Step 4b
    /// saturation truncation (design D1, R9). Read-only additive field: the
    /// legacy path truncates `log_scales`/`log_counts`, so the effective level
    /// count is NOT derivable from the returned vectors. The windowed fit
    /// `(s, e)` is derived from this count by the backend (design D2).
    pub effective_levels: usize,
    /// Inclusive `(start, end)` indices into the EFFECTIVE level sequence —
    /// the count-valid levels, finest-first, BEFORE the Step 4b saturation
    /// truncation; the same sequence `box_counting_3d_windowed` indexes —
    /// over which the reported fit was actually computed (task #332 S3,
    /// S1/S2). `None` when fewer than 3 effective levels were fitted (S6):
    /// no window to promise.
    ///
    /// Legacy path arithmetic (S2): the robust fit runs on the POST-
    /// truncation sequence, so both ends are translated back by the number
    /// of fine levels Step 4b dropped (`truncation_offset`). The start is
    /// `linear_region_start` (a truncated-sequence index) shifted by that
    /// offset. `linear_regression_robust` always fits through the coarsest
    /// level (a suffix of its input) and Step 4b only drops FINE levels, so
    /// the end is the last effective level. Additive: no existing consumer
    /// changes behaviour.
    pub fit_window: Option<(usize, usize)>,
    /// Origin of the published window (S3): `"legacy"` when the default
    /// robust path (or an explicit window nobody measured) chose it, `"r5"`
    /// when a measured window from `select_fit_window` chose it. Always
    /// `"legacy"` in this step — R5 is not wired (S3b connects it).
    pub window_source: &'static str,
}

/// Fast 3D box-counting using Morton codes (default legacy fit path).
///
/// # Arguments
/// * `points` - Nx3 array of (x, y, z) coordinates
/// * `precision` - Number of bits per dimension (higher = finer resolution)
///
/// # Returns
/// BoxCountingResult3D with fractal dimension and statistics.
pub fn box_counting_3d_morton(points: &[[f64; 3]], precision: u32) -> BoxCountingResult3D {
    morton_core(points, precision, None).expect("default fit path never fails window validation")
}

/// Fast 3D box-counting using Morton codes with an explicit fit window
/// (design D1/D3, R29.2).
///
/// `fit_window = (s, e)` is an inclusive range of indices into the EFFECTIVE
/// level sequence — the count-valid levels (`0 < count < N`) ordered
/// finest-first (0 = finest count-valid level) — exactly the semantics
/// validated by the Phase 0 diagnostic (design Log L2). The windowed path
/// computes a plain OLS of ln(1/box_size) vs ln(count) restricted to levels
/// `[s, e]` (no saturation truncation, no coarse-anchor greedy extension) and
/// reports `linear_region_start = s`.
///
/// # Errors
/// Returns [`BoxCountingError`] (never panics) when the window is empty
/// (`s > e`), out of range of the effective level sequence, or when fewer
/// than 3 count-valid levels fall inside the window.
pub fn box_counting_3d_windowed(
    points: &[[f64; 3]],
    precision: u32,
    fit_window: (usize, usize),
) -> Result<BoxCountingResult3D, BoxCountingError> {
    morton_core(points, precision, Some(fit_window))
}

/// Shared counting + fit core (design D3).
///
/// `fit_window = None` → legacy robust-fit path (saturation truncation +
/// `linear_regression_robust`), byte-identical to the pre-refactor
/// implementation (R29.1). `fit_window = Some((s, e))` → plain OLS over the
/// effective level range `[s, e]` with validation errors (R29.2).
fn morton_core(
    points: &[[f64; 3]],
    precision: u32,
    fit_window: Option<(usize, usize)>,
) -> Result<BoxCountingResult3D, BoxCountingError> {
    let start_time = Instant::now();
    let n_points = points.len();

    if n_points < 2 {
        if let Some((start, end)) = fit_window {
            // No count-valid levels exist at all.
            return Err(BoxCountingError::WindowOutOfRange {
                start,
                end,
                num_levels: 0,
            });
        }
        return Ok(BoxCountingResult3D {
            dimension: 0.0,
            r_squared: 0.0,
            std_error: f64::INFINITY,
            confidence_interval: (0.0, 0.0),
            log_scales: vec![],
            log_counts: vec![],
            residuals: vec![],
            execution_time_ms: 0,
            num_points: n_points,
            linear_region_start: 0,
            effective_levels: 0,
            // S6: degenerate input, no window to promise.
            fit_window: None,
            window_source: "legacy",
        });
    }

    let precision = precision.min(MAX_PRECISION);

    // Step 1: Find bounding box and normalize coordinates
    let (min_coords, max_coords) = find_bounding_box(points);
    let scale = compute_scale(&min_coords, &max_coords);

    // Step 2: Convert to Morton codes (parallel)
    let max_val = (1u64 << precision) - 1;
    let morton_codes: Vec<u64> = points
        .par_iter()
        .map(|p| {
            let nx = normalize_coord(p[0], min_coords[0], scale, max_val);
            let ny = normalize_coord(p[1], min_coords[1], scale, max_val);
            let nz = normalize_coord(p[2], min_coords[2], scale, max_val);
            morton_encode_3d(nx, ny, nz)
        })
        .collect();

    // Step 3: Sort Morton codes (this is the main O(N log N) operation)
    let mut sorted_codes = morton_codes;
    sorted_codes.par_sort_unstable();

    // Step 4: Count boxes at each scale using bit masking
    // Each scale corresponds to masking off the low bits
    let mut log_scales: Vec<f64> = Vec::with_capacity(precision as usize);
    let mut log_counts: Vec<f64> = Vec::with_capacity(precision as usize);

    // Box size at level k is 2^k (in normalized units)
    // We count unique Morton codes when masking off 3*k low bits
    for level in 0..precision {
        let shift = 3 * level; // 3 bits per level for 3D
        let box_count = count_unique_masked(&sorted_codes, shift);

        if box_count > 0 && box_count < sorted_codes.len() {
            // Log(1/box_size) where box_size = scale * 2^level / max_val
            let box_size = scale * (1u64 << level) as f64 / max_val as f64;
            log_scales.push((1.0 / box_size).ln());
            log_counts.push((box_count as f64).ln());
        }
    }

    // Effective level count BEFORE any truncation (design D1, R9): captured
    // before the legacy Step 4b saturation truncation reassigns `log_scales`.
    // The windowed path indexes THIS sequence, so it must not observe the
    // truncated vectors.
    let effective_levels = log_scales.len();

    // ── Windowed path: plain OLS over the effective level range (R29.2) ──
    // Applied BEFORE the legacy saturation truncation: the window indexes the
    // effective (count-valid) sequence, exactly as the Phase 0 diagnostic
    // validated (design Log L2).
    if let Some((start, end)) = fit_window {
        let num_levels = log_scales.len();
        if start > end {
            return Err(BoxCountingError::EmptyWindow { start, end });
        }
        if end >= num_levels {
            return Err(BoxCountingError::WindowOutOfRange {
                start,
                end,
                num_levels,
            });
        }
        let have = end - start + 1;
        if have < 3 {
            return Err(BoxCountingError::InsufficientLevels { have, need: 3 });
        }
        // Plain OLS restricted to [start, end] — no greedy extension, no
        // coarse anchor. `linear_region_start` reports the window start `s`.
        let (slope, intercept, r_squared, std_error, _) =
            linear_regression(&log_scales[start..=end], &log_counts[start..=end]);

        // Residuals for ALL effective levels vs the windowed fit
        // (same "for visualization" convention as the legacy path).
        let residuals: Vec<f64> = log_scales
            .iter()
            .zip(log_counts.iter())
            .map(|(xi, yi)| yi - (intercept + slope * xi))
            .collect();

        let dimension = slope;
        let ci_half = 1.96 * std_error;
        let confidence_interval = (dimension - ci_half, dimension + ci_half);

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        return Ok(BoxCountingResult3D {
            dimension,
            r_squared,
            std_error,
            confidence_interval,
            log_scales,
            log_counts,
            residuals,
            execution_time_ms,
            num_points: n_points,
            linear_region_start: start,
            effective_levels,
            // S1: the window is exactly what the caller passed.
            fit_window: Some((start, end)),
            // S3: "legacy" until R5 is wired (S3b) — no caller passes a
            // measured window yet, so even an explicit window is not a
            // measured choice.
            window_source: "legacy",
        });
    }

    // Step 4b: Saturation truncation (ported from fit_frac3D.m:4-12)
    // Data is ordered finest (index 0) → coarsest (last index).
    // log_counts should monotonically DECREASE (fewer boxes at coarser scales).
    // Saturation = consecutive fine-scale levels with SAME count (no new boxes
    // appear when refining further). Scan from coarse→fine (high→low index)
    // and truncate at the first plateau.
    //
    // `truncation_offset` (task #332 S3): number of FINE levels this step
    // dropped, needed to translate the fitted window back to effective
    // indices below. Zero when no truncation happened (short curve, no
    // plateau, or a plateau that would leave < 3 levels).
    let truncation_offset;
    if log_counts.len() > 6 {
        let mut truncate_before = 0;
        // Scan from second-finest towards coarsest
        for i in (1..log_counts.len()).rev() {
            if (log_counts[i] - log_counts[i - 1]).abs() < 1e-12 {
                // log_counts[i-1] == log_counts[i]: the finer level (i-1) added
                // no new boxes. Truncate everything at i-1 and finer.
                truncate_before = i;
                break;
            }
        }
        if truncate_before > 0 && log_counts.len() - truncate_before >= 3 {
            log_scales = log_scales[truncate_before..].to_vec();
            log_counts = log_counts[truncate_before..].to_vec();
            truncation_offset = truncate_before;
        } else {
            truncation_offset = 0;
        }
    } else {
        truncation_offset = 0;
    }

    // Step 5: Robust linear regression to find fractal dimension
    // Automatically detects linear region by excluding outliers from small scales
    let (linear_start, slope, _intercept, r_squared, std_error, residuals) =
        linear_regression_robust(&log_scales, &log_counts);

    let dimension = slope;
    let ci_half = 1.96 * std_error;
    let confidence_interval = (dimension - ci_half, dimension + ci_half);

    // S1/S2 (task #332 S3): publish the window this fit actually used, in
    // EFFECTIVE level indices (the sequence the windowed path indexes).
    let fit_window = legacy_fit_window(log_scales.len(), truncation_offset, linear_start);

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    Ok(BoxCountingResult3D {
        dimension,
        r_squared,
        std_error,
        confidence_interval,
        log_scales,
        log_counts,
        residuals,
        execution_time_ms,
        num_points: n_points,
        linear_region_start: linear_start,
        effective_levels,
        fit_window,
        // S3: the default robust path is the legacy choice by definition;
        // `"r5"` appears only when S3b wires the measured selector in.
        window_source: "legacy",
    })
}

/// Legacy-path fit window in EFFECTIVE level indices (task #332 S3, S1/S2).
///
/// `linear_start` is the robust fit's first index IN TRUNCATED coordinates;
/// `truncation_offset` is the number of FINE levels Step 4b dropped (0 when
/// no truncation happened); `fitted_levels` is the length of the truncated
/// sequence the fit actually ran on. Both ends are translated back to
/// effective indices: the start by the full offset (this is the part a naive
/// `(linear_region_start, effective_levels - 1)` report would get wrong),
/// the end lands on `truncation_offset + fitted_levels - 1` because
/// `linear_regression_robust` always fits through the coarsest level (a
/// suffix of its input). S6: fewer than 3 fitted levels → `None`.
fn legacy_fit_window(
    fitted_levels: usize,
    truncation_offset: usize,
    linear_start: usize,
) -> Option<(usize, usize)> {
    if fitted_levels >= 3 {
        Some((
            truncation_offset + linear_start,
            truncation_offset + fitted_levels - 1,
        ))
    } else {
        None
    }
}

/// Count unique values after masking off `shift` low bits.
/// Takes advantage of sorted array for O(N) counting.
#[inline]
pub fn count_unique_masked(sorted: &[u64], shift: u32) -> usize {
    if sorted.is_empty() {
        return 0;
    }
    if shift >= 64 {
        return 1; // All values mask to 0
    }

    let mask = !((1u64 << shift) - 1);
    let mut count = 1;
    let mut prev = sorted[0] & mask;

    for &code in sorted.iter().skip(1) {
        let masked = code & mask;
        if masked != prev {
            count += 1;
            prev = masked;
        }
    }

    count
}

/// Find bounding box of points.
pub fn find_bounding_box(points: &[[f64; 3]]) -> ([f64; 3], [f64; 3]) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];

    for p in points {
        for i in 0..3 {
            if p[i] < min[i] {
                min[i] = p[i];
            }
            if p[i] > max[i] {
                max[i] = p[i];
            }
        }
    }

    (min, max)
}

/// Compute uniform scale to fit all dimensions.
pub fn compute_scale(min: &[f64; 3], max: &[f64; 3]) -> f64 {
    let mut max_range = 0.0f64;
    for i in 0..3 {
        max_range = max_range.max(max[i] - min[i]);
    }
    if max_range < 1e-15 {
        1.0
    } else {
        max_range
    }
}

/// Normalize a coordinate to [0, max_val].
#[inline]
pub fn normalize_coord(val: f64, min: f64, scale: f64, max_val: u64) -> u64 {
    let normalized = (val - min) / scale;
    let clamped = normalized.clamp(0.0, 1.0);
    (clamped * max_val as f64).round() as u64
}

/// Linear regression returning (slope, intercept, r_squared, std_error, residuals).
fn linear_regression(x: &[f64], y: &[f64]) -> (f64, f64, f64, f64, Vec<f64>) {
    let n = x.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0, 0.0, f64::INFINITY, vec![]);
    }

    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xx: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(xi, yi)| xi * yi).sum();

    let denom = n * sum_xx - sum_x * sum_x;
    if denom.abs() < 1e-15 {
        return (0.0, sum_y / n, 0.0, f64::INFINITY, vec![0.0; x.len()]);
    }

    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;

    let mean_y = sum_y / n;
    let mut ss_res = 0.0;
    let mut ss_tot = 0.0;
    let mut residuals = Vec::with_capacity(x.len());

    for (xi, yi) in x.iter().zip(y.iter()) {
        let y_pred = intercept + slope * xi;
        let res = yi - y_pred;
        residuals.push(res);
        ss_res += res * res;
        ss_tot += (yi - mean_y) * (yi - mean_y);
    }

    let r_squared = if ss_tot > 1e-15 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };
    let mse = ss_res / (n - 2.0).max(1.0);
    let std_error = (mse / (sum_xx - sum_x * sum_x / n).abs().max(1e-15)).sqrt();

    (slope, intercept, r_squared, std_error, residuals)
}

/// Robust linear regression with automatic detection of linear region.
///
/// Starts from the right (large scales) and progressively adds points from the left,
/// stopping when the residual of the new point exceeds a threshold or R squared drops significantly.
///
/// Returns: (start_index, slope, intercept, r_squared, std_error, residuals_for_all_points)
fn linear_regression_robust(x: &[f64], y: &[f64]) -> (usize, f64, f64, f64, f64, Vec<f64>) {
    let n = x.len();
    if n < 3 {
        let (slope, intercept, r2, se, res) = linear_regression(x, y);
        return (0, slope, intercept, r2, se, res);
    }

    // Parameters for outlier detection
    let min_points = 4.min(n); // Minimum points for regression
    let residual_threshold = 2.0; // Standardized residual threshold
    let r2_drop_threshold = 0.02; // Max allowed R squared drop when adding a point

    // Start with rightmost points (large scales - more reliable)
    // Initial regression with last min_points
    let start_idx = n - min_points;
    let (mut slope, mut intercept, r2, mut std_error, _) =
        linear_regression(&x[start_idx..], &y[start_idx..]);

    let mut best_start = start_idx;
    let mut best_r2 = r2;

    // Progressively add points from the left
    for i in (0..start_idx).rev() {
        // Compute predicted value for new point using current regression
        let y_pred = intercept + slope * x[i];
        let residual = y[i] - y_pred;

        // Compute standardized residual
        let std_residual = if std_error > 1e-15 {
            residual.abs() / std_error
        } else {
            0.0
        };

        // Try adding this point
        let (new_slope, new_intercept, new_r2, new_se, _) = linear_regression(&x[i..], &y[i..]);

        // Check if this point is an outlier
        let r2_drop = best_r2 - new_r2;

        if std_residual > residual_threshold && r2_drop > r2_drop_threshold {
            // This point is an outlier - stop here
            break;
        }

        // Accept this point
        slope = new_slope;
        intercept = new_intercept;
        std_error = new_se;

        if new_r2 > best_r2 - 0.01 {
            // Only update best if R squared is close to or better than before
            best_start = i;
            best_r2 = new_r2.max(best_r2);
        }
    }

    // Final regression on selected range
    let (final_slope, final_intercept, final_r2, final_se, _) =
        linear_regression(&x[best_start..], &y[best_start..]);

    // Compute residuals for ALL points (for visualization)
    let residuals: Vec<f64> = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| yi - (final_intercept + final_slope * xi))
        .collect();

    (
        best_start,
        final_slope,
        final_intercept,
        final_r2,
        final_se,
        residuals,
    )
}

/// Generate approximately uniformly distributed points on a sphere surface.
/// Uses the Fibonacci lattice method.
pub fn generate_sphere_points(
    cx: f64,
    cy: f64,
    cz: f64,
    radius: f64,
    n_points: usize,
) -> Vec<[f64; 3]> {
    let golden_ratio = (1.0 + 5.0_f64.sqrt()) / 2.0;
    let angle_increment = std::f64::consts::TAU / golden_ratio;

    (0..n_points)
        .map(|i| {
            let t = i as f64 / (n_points - 1).max(1) as f64;
            let inclination = (1.0 - 2.0 * t).acos();
            let azimuth = angle_increment * i as f64;

            let sin_inc = inclination.sin();
            let x = cx + radius * sin_inc * azimuth.cos();
            let y = cy + radius * sin_inc * azimuth.sin();
            let z = cz + radius * inclination.cos();

            [x, y, z]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Published fit window (task #332 S3: P1/P3) ─────────────────────

    /// The saturation-plateau fixture used by the truncation witnesses:
    /// an 8x8x8 lattice of distinct positions, each repeated with tiny
    /// jitter so all replicas collapse into one voxel. Every level finer
    /// than the lattice spacing counts 512 boxes, so the effective sequence
    /// opens with a long plateau and the legacy Step 4b truncation fires.
    fn plateau_fixture() -> Vec<[f64; 3]> {
        let mut points: Vec<[f64; 3]> = Vec::new();
        for i in 0..8 {
            for j in 0..8 {
                for k in 0..8 {
                    for r in 0..20 {
                        let jitter = r as f64 * 1e-9;
                        points.push([i as f64 + jitter, j as f64 + jitter, k as f64 + jitter]);
                    }
                }
            }
        }
        points
    }

    #[test]
    fn test_legacy_numbers_match_pre_change_baseline() {
        // S4 witness. PROVENANCE (task Log L5): these four values were
        // captured BEFORE this branch touched anything — by a temporary
        // print test run against the pre-change code (develop, before
        // `fit_window`/`window_source` existed) — and are pinned bit-exact
        // here, so publishing the window cannot silently change the
        // numbers. The citation matters because the test alone cannot
        // distinguish "captured before the change" from "regenerated after
        // it": a silent numeric change plus a re-pin would pass
        // identically. The independent evidence is the branch diff: zero
        // deletions, with every added line outside the numeric path.
        // Update only with diagnostic evidence (see AGENTS.md: tolerances
        // are never weakened in silence).
        let cases: [(&str, Vec<[f64; 3]>, f64, f64, f64); 4] = [
            // line1000: dimension=1.0000000000000004 r2=1 se=2.0093743462551408e-16
            (
                "line1000",
                (0..1000).map(|i| [i as f64, 0.0, 0.0]).collect(),
                1.0000000000000004,
                1.0,
                0.00000000000000020093743462551408,
            ),
            // plateau: dimension=3.000000000000002 r2=1 se=2.43965694143653e-15
            (
                "plateau",
                plateau_fixture(),
                3.000000000000002,
                1.0,
                0.00000000000000243965694143653,
            ),
            // lcg1000: dimension=2.314832040302268 r2=0.9592699460019857 se=0.3372807546638281
            (
                "lcg1000",
                lcg_points(1000),
                2.314832040302268,
                0.9592699460019857,
                0.3372807546638281,
            ),
            // lcg100: dimension=1.1781154656322332 r2=0.8127289832869107 se=0.39988514360755445
            (
                "lcg100",
                lcg_points(100),
                1.1781154656322332,
                0.8127289832869107,
                0.39988514360755445,
            ),
        ];
        for (name, points, dimension, r_squared, std_error) in cases {
            let r = box_counting_3d_morton(&points, 16);
            assert_eq!(r.dimension, dimension, "{name}: dimension moved");
            assert_eq!(r.r_squared, r_squared, "{name}: r_squared moved");
            assert_eq!(r.std_error, std_error, "{name}: std_error moved");
        }
    }

    #[test]
    fn test_fit_window_describes_what_was_fitted_under_truncation() {
        // S1/S2 witness on the case where Step 4b truncation actually fires:
        // the published window must index the EFFECTIVE sequence, not the
        // truncated one, and re-fitting the slice it names must reproduce
        // the reported dimension.
        let points = plateau_fixture();
        let result = box_counting_3d_morton(&points, 16);

        // Truncation fired: the offset (levels dropped from the fine end) is
        // recoverable from public fields as effective_levels - vector length.
        assert!(
            result.effective_levels > result.log_scales.len(),
            "fixture must truncate: effective_levels={}, vec_len={}",
            result.effective_levels,
            result.log_scales.len()
        );
        let offset = result.effective_levels - result.log_scales.len();

        let (start, end) = result
            .fit_window
            .expect("truncated sequence keeps >= 3 levels, so a window exists");

        // The robust fit runs on the truncated sequence, so the start is
        // `linear_region_start` shifted by the truncation offset. The raw
        // `linear_region_start` (a truncated-sequence index) is exactly the
        // naive value the translation must fix.
        assert_eq!(start, offset + result.linear_region_start);
        assert_ne!(start, result.linear_region_start);

        // End: Step 4b drops FINE levels and `linear_regression_robust`
        // always fits through the coarsest level (a suffix of its input),
        // so the last fitted effective index IS effective_levels - 1 — here
        // that is truly what was fitted (see task report: this replaces the
        // witness phrase "end is not effective_levels - 1", which the
        // truncation direction makes unsatisfiable).
        assert_eq!(end, result.effective_levels - 1);

        // The decisive S1/S2 witness: slice the EFFECTIVE sequence at the
        // reported window and run the same plain OLS the final robust step
        // uses — the slope must reproduce the reported dimension. The
        // windowed path with (0, eff-1) returns the full untruncated
        // effective sequence.
        let eff = result.effective_levels;
        let full = box_counting_3d_windowed(&points, 16, (0, eff - 1))
            .expect("full effective window is valid");
        assert_eq!(full.log_scales.len(), eff);
        let (slope, _, _, _, _) =
            linear_regression(&full.log_scales[start..=end], &full.log_counts[start..=end]);
        assert!(
            (slope - result.dimension).abs() < 1e-12,
            "slice [{start}, {end}] slope {slope} != reported dimension {}",
            result.dimension
        );

        // Counterfactual (the translation matters): the naive untranslated
        // window (raw linear_region_start as an effective index) includes
        // the saturation plateau and does NOT reproduce the dimension.
        let naive_start = result.linear_region_start;
        let (naive_slope, _, _, _, _) = linear_regression(
            &full.log_scales[naive_start..=end],
            &full.log_counts[naive_start..=end],
        );
        assert!(
            (naive_slope - result.dimension).abs() > 1e-9,
            "naive window [{naive_start}, {end}] must not reproduce the fit: \
             slope {naive_slope} vs dimension {}",
            result.dimension
        );
    }

    #[test]
    fn test_window_source_is_legacy_on_default_path() {
        // S3 witness: in this step every published window is legacy — R5 is
        // not wired — on both the default robust path and the explicit-window
        // path (no caller passes a measured window yet).
        let points = lcg_points(1000);
        let result = box_counting_3d_morton(&points, 16);
        assert_eq!(result.window_source, "legacy");

        // No truncation in this fixture (vector length == effective count),
        // so the window is the untranslated robust range: start =
        // linear_region_start, end = last fitted level = effective_levels - 1.
        assert_eq!(result.log_scales.len(), result.effective_levels);
        let (start, end) = result
            .fit_window
            .expect("6 effective levels -> a window exists");
        assert_eq!(start, result.linear_region_start);
        assert_eq!(end, result.effective_levels - 1);

        // S1/S2 witness on the untruncated path too: re-fitting the named
        // slice of the effective sequence reproduces the dimension.
        let eff = result.effective_levels;
        let full = box_counting_3d_windowed(&points, 16, (0, eff - 1))
            .expect("full effective window is valid");
        let (slope, _, _, _, _) =
            linear_regression(&full.log_scales[start..=end], &full.log_counts[start..=end]);
        assert!((slope - result.dimension).abs() < 1e-12);

        // Explicit-window path: the window is exactly what the caller passed,
        // and the origin stays "legacy" until R5 is wired (S3b).
        let windowed = box_counting_3d_windowed(&points, 16, (1, 4)).expect("window valid");
        assert_eq!(windowed.fit_window, Some((1, 4)));
        assert_eq!(windowed.window_source, "legacy");
        assert_eq!(windowed.linear_region_start, 1);
    }

    #[test]
    fn test_fit_window_none_below_three_effective_levels() {
        // S6 witness: fewer than 3 effective levels -> fit_window: None,
        // window_source: "legacy", no panic. Three collinear points at
        // precision 2: level 0 separates all three (count == n_points ->
        // saturated, filtered) and only coarser levels are count-valid.
        let points = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
        let r = box_counting_3d_morton(&points, 2);
        assert!(r.effective_levels < 3, "got {}", r.effective_levels);
        assert_eq!(r.fit_window, None);
        assert_eq!(r.window_source, "legacy");

        // Degenerate inputs take the early return: no panic, no window,
        // still legacy.
        let one = [[0.5, 0.5, 0.5]];
        let r1 = box_counting_3d_morton(&one, 16);
        assert_eq!(r1.fit_window, None);
        assert_eq!(r1.window_source, "legacy");
        let r0 = box_counting_3d_morton(&[], 16);
        assert_eq!(r0.fit_window, None);
        assert_eq!(r0.window_source, "legacy");
    }

    /// Task #332 S3 P3 witness for the review gap (task Log L6): every
    /// truncating fixture used to have `linear_region_start == 0`, so the S2
    /// sum `truncation_offset + linear_region_start` was only ever exercised
    /// as `13 + 0`. This fixture makes BOTH terms non-zero.
    ///
    /// Construction: the `lcg_points(1000)` cloud (the same deterministic
    /// generator as the S4 baseline fixture) with every point duplicated
    /// exactly. Both replicas map to the same Morton code at every level, so
    /// the fine end of the effective sequence is a count-valid plateau
    /// (count 1000 < 2000 points) and Step 4b truncation fires; the
    /// post-truncation head (counts 1000, 998, 983 — the cloud's own
    /// point-saturation region) bends relative to the coarse anchor, so
    /// `linear_regression_robust` rejects it and picks a start above zero.
    fn duplicated_lcg_fixture() -> Vec<[f64; 3]> {
        let mut points: Vec<[f64; 3]> = Vec::with_capacity(2000);
        for p in &lcg_points(1000) {
            points.push(*p);
            points.push(*p);
        }
        points
    }

    #[test]
    fn test_fit_window_start_is_sum_of_two_nonzero_terms() {
        // Fixture shape (measured, deterministic): 16 count-valid levels with
        // raw counts [1000 x10, 998, 983, 882, 444, 64, 8]. The ten-level
        // exact-1000 plateau makes Step 4b drop 9 fine levels (its guard
        // keeps the last plateau level), and the robust fit on the truncated
        // sequence [1000, 998, 983, 882, 444, 64, 8] rejects the head,
        // picking linear_region_start = 3.
        let points = duplicated_lcg_fixture();
        let result = box_counting_3d_morton(&points, 16);

        // Step 4b fired: recover the offset from public fields (S2).
        assert!(
            result.effective_levels > result.log_scales.len(),
            "fixture must truncate: effective_levels={}, vec_len={}",
            result.effective_levels,
            result.log_scales.len()
        );
        let offset = result.effective_levels - result.log_scales.len();
        assert!(offset > 0, "truncation must fire, offset={offset}");
        assert!(
            result.linear_region_start > 0,
            "robust fit must reject the truncated head, got linear_region_start=0"
        );

        // The L6 witness: the reported start is the sum of two NON-zero
        // terms. Measured: offset 9 + linear_region_start 3 = 12.
        let (start, end) = result
            .fit_window
            .expect("truncated sequence keeps >= 3 levels, so a window exists");
        assert_eq!(result.effective_levels, 16);
        assert_eq!(result.log_scales.len(), 7);
        assert_eq!(offset, 9);
        assert_eq!(result.linear_region_start, 3);
        assert_eq!(start, offset + result.linear_region_start);
        assert_eq!(start, 12, "expected offset 9 + linear_region_start 3");
        assert_eq!(end, result.effective_levels - 1);

        // S1/S2 witness: slicing the EFFECTIVE sequence at the published
        // window reproduces the reported dimension — here over a window
        // whose start is a genuine two-term sum.
        let eff = result.effective_levels;
        let full = box_counting_3d_windowed(&points, 16, (0, eff - 1))
            .expect("full effective window is valid");
        let (slope, _, _, _, _) =
            linear_regression(&full.log_scales[start..=end], &full.log_counts[start..=end]);
        assert!(
            (slope - result.dimension).abs() < 1e-12,
            "slice [{start}, {end}] slope {slope} != reported dimension {}",
            result.dimension
        );

        // Counterfactual (the sum matters): the naive untranslated window
        // (raw linear_region_start as an effective index) reaches into the
        // plateau and the saturation head, so it must NOT reproduce the fit.
        let naive_start = result.linear_region_start;
        assert_ne!(naive_start, start);
        let (naive_slope, _, _, _, _) = linear_regression(
            &full.log_scales[naive_start..=end],
            &full.log_counts[naive_start..=end],
        );
        assert!(
            (naive_slope - result.dimension).abs() > 1e-9,
            "naive window [{naive_start}, {end}] must not reproduce the fit: \
             slope {naive_slope} vs dimension {}",
            result.dimension
        );
    }

    #[test]
    fn test_morton_encode() {
        // Simple test: encode (0, 0, 0) should be 0
        assert_eq!(morton_encode_3d(0, 0, 0), 0);

        // (1, 0, 0) should be 1 (x in position 0)
        assert_eq!(morton_encode_3d(1, 0, 0), 1);

        // (0, 1, 0) should be 2 (y in position 1)
        assert_eq!(morton_encode_3d(0, 1, 0), 2);

        // (0, 0, 1) should be 4 (z in position 2)
        assert_eq!(morton_encode_3d(0, 0, 1), 4);

        // (1, 1, 1) should be 7 (all bits set at positions 0, 1, 2)
        assert_eq!(morton_encode_3d(1, 1, 1), 7);
    }

    #[test]
    fn test_count_unique_masked() {
        let codes = vec![0, 1, 2, 3, 8, 9, 10, 11];
        // No masking - all unique
        assert_eq!(count_unique_masked(&codes, 0), 8);
        // Mask 3 bits - should group (0-7) and (8-15)
        assert_eq!(count_unique_masked(&codes, 3), 2);
    }

    #[test]
    fn test_box_counting_line() {
        // Line of points should have Df ~ 1
        let points: Vec<[f64; 3]> = (0..1000).map(|i| [i as f64, 0.0, 0.0]).collect();

        let result = box_counting_3d_morton(&points, 16);
        assert!(
            result.dimension > 0.8 && result.dimension < 1.2,
            "Line Df should be ~1, got {}",
            result.dimension
        );
        assert!(result.r_squared > 0.9);
    }

    #[test]
    fn test_box_counting_plane() {
        // Plane of points should have Df ~ 2
        let mut points = Vec::new();
        for i in 0..50 {
            for j in 0..50 {
                points.push([i as f64, j as f64, 0.0]);
            }
        }

        let result = box_counting_3d_morton(&points, 16);
        assert!(
            result.dimension > 1.7 && result.dimension < 2.3,
            "Plane Df should be ~2, got {}",
            result.dimension
        );
        assert!(result.r_squared > 0.9);
    }

    #[test]
    fn test_box_counting_cube() {
        // Filled cube should have Df ~ 3
        let mut points = Vec::new();
        for i in 0..20 {
            for j in 0..20 {
                for k in 0..20 {
                    points.push([i as f64, j as f64, k as f64]);
                }
            }
        }

        let result = box_counting_3d_morton(&points, 16);
        assert!(
            result.dimension > 2.7 && result.dimension < 3.3,
            "Cube Df should be ~3, got {}",
            result.dimension
        );
        assert!(result.r_squared > 0.9);
    }

    #[test]
    fn test_effective_levels_matches_count_valid_levels() {
        // Normal case: `effective_levels` equals the number of count-valid
        // levels. Cross-checked against the windowed path, which fits the
        // full effective sequence `(0, eff-1)` without truncation.
        let points: Vec<[f64; 3]> = (0..1000).map(|i| [i as f64, 0.0, 0.0]).collect();
        let result = box_counting_3d_morton(&points, 16);
        let eff = result.effective_levels;
        assert!(eff >= 3, "line fixture must have enough levels, got {eff}");

        let windowed = box_counting_3d_windowed(&points, 16, (0, eff - 1))
            .expect("full effective window is valid");
        assert_eq!(windowed.effective_levels, eff);
        assert_eq!(windowed.log_scales.len(), eff);
        // The legacy path may truncate; the field reports the pre-truncation
        // count, so it is never smaller than the returned vectors.
        assert!(result.log_scales.len() <= eff);

        // JD-A-008 (fix round A): strengthen the truncation side — mirror the
        // plateau fixture used by `test_effective_levels_reports_pre_truncation_count`
        // and assert the STRICT inequality when Step 4b truncation fires, not
        // just the weak `<=` above.
        let mut plateau: Vec<[f64; 3]> = Vec::new();
        for i in 0..8 {
            for j in 0..8 {
                for k in 0..8 {
                    for r in 0..20 {
                        let jitter = r as f64 * 1e-9;
                        plateau.push([i as f64 + jitter, j as f64 + jitter, k as f64 + jitter]);
                    }
                }
            }
        }
        let truncated = box_counting_3d_morton(&plateau, 16);
        assert!(
            truncated.effective_levels > truncated.log_scales.len(),
            "truncation must fire in the plateau fixture: log_scales.len()={}, effective_levels={}",
            truncated.log_scales.len(),
            truncated.effective_levels
        );
    }

    #[test]
    fn test_effective_levels_reports_pre_truncation_count() {
        // Plateau fixture (R9.1): an 8x8x8 lattice of distinct positions,
        // each repeated with tiny jitter so all replicas collapse into one
        // voxel. At every level finer than the lattice spacing the box count
        // is constant (512), so the effective sequence opens with a long
        // plateau while several coarse levels remain — enough for the legacy
        // Step 4b saturation truncation to fire (its guard keeps ≥3 levels).
        let mut points: Vec<[f64; 3]> = Vec::new();
        for i in 0..8 {
            for j in 0..8 {
                for k in 0..8 {
                    for r in 0..20 {
                        let jitter = r as f64 * 1e-9;
                        points.push([i as f64 + jitter, j as f64 + jitter, k as f64 + jitter]);
                    }
                }
            }
        }
        let result = box_counting_3d_morton(&points, 16);

        // Truncation fired: the returned (post-truncation) vectors hold fewer
        // levels than the reported pre-truncation effective count.
        assert!(
            result.effective_levels > 6,
            "fixture must exceed the truncation threshold, got {}",
            result.effective_levels
        );
        assert!(
            result.log_scales.len() < result.effective_levels,
            "Step 4b truncation must fire in this fixture: log_scales.len()={}, effective_levels={}",
            result.log_scales.len(),
            result.effective_levels
        );
        assert_eq!(result.log_counts.len(), result.log_scales.len());
    }

    #[test]
    fn test_sphere_points() {
        let points = generate_sphere_points(0.0, 0.0, 0.0, 1.0, 100);
        assert_eq!(points.len(), 100);

        // All points should be approximately on the unit sphere
        for p in &points {
            let dist = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
            assert!((dist - 1.0).abs() < 1e-10);
        }
    }

    // ── select_fit_window (task #332 S2, criterion R5) ─────────────────────

    /// Raw per-level box counts for `points`, computed exactly as
    /// `morton_core` does (public helpers only): one count per Morton level,
    /// finest-first, including saturated levels. This is the input contract
    /// of `select_fit_window`.
    fn raw_level_counts(points: &[[f64; 3]], precision: u32) -> Vec<usize> {
        let precision = precision.min(MAX_PRECISION);
        let (min_coords, max_coords) = find_bounding_box(points);
        let scale = compute_scale(&min_coords, &max_coords);
        let max_val = (1u64 << precision) - 1;
        let mut codes: Vec<u64> = points
            .iter()
            .map(|p| {
                morton_encode_3d(
                    normalize_coord(p[0], min_coords[0], scale, max_val),
                    normalize_coord(p[1], min_coords[1], scale, max_val),
                    normalize_coord(p[2], min_coords[2], scale, max_val),
                )
            })
            .collect();
        codes.sort_unstable();
        (0..precision)
            .map(|level| count_unique_masked(&codes, 3 * level))
            .collect()
    }

    /// Deterministic pseudo-random points in the unit cube (small LCG, no
    /// external RNG dependency).
    fn lcg_points(n: usize) -> Vec<[f64; 3]> {
        let mut state = 0x2545_F491_4F6C_DD1Du64;
        let mut next_unit = |state: &mut u64| {
            *state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((*state >> 33) & 0xFFFFF) as f64 / 0xFFFFF as f64
        };
        (0..n)
            .map(|_| {
                [
                    next_unit(&mut state),
                    next_unit(&mut state),
                    next_unit(&mut state),
                ]
            })
            .collect()
    }

    #[test]
    fn test_select_fit_window_four_plus_valid_levels() {
        // Saturated levels (== n_points) and zero levels are filtered out;
        // the 4 remaining count-valid levels yield the R5 coarse window
        // (1, len-1), excluding only the index-0 saturation transition.
        let counts = [1000, 800, 400, 200, 100, 1000];
        let choice = select_fit_window(&counts, 1000);
        assert_eq!(
            choice,
            FitWindowChoice {
                window: Some((1, 3)),
                reliable: true,
                effective_levels: 4
            }
        );
    }

    #[test]
    fn test_select_fit_window_exactly_three_valid_levels() {
        // Only 2 count-valid levels from index 1 onward: no measured window.
        let counts = [1000, 800, 400, 200];
        let choice = select_fit_window(&counts, 1000);
        assert_eq!(
            choice,
            FitWindowChoice {
                window: None,
                reliable: false,
                effective_levels: 3
            }
        );
    }

    #[test]
    fn test_select_fit_window_two_valid_levels() {
        let counts = [800, 200];
        let choice = select_fit_window(&counts, 1000);
        assert_eq!(
            choice,
            FitWindowChoice {
                window: None,
                reliable: false,
                effective_levels: 2
            }
        );
    }

    #[test]
    fn test_select_fit_window_all_counts_saturated() {
        // Every level has count == n_points: nothing is count-valid.
        let counts = [1000; 8];
        let choice = select_fit_window(&counts, 1000);
        assert_eq!(
            choice,
            FitWindowChoice {
                window: None,
                reliable: false,
                effective_levels: 0
            }
        );
    }

    #[test]
    fn test_select_fit_window_monotone_non_saturated_curve() {
        // Strictly decreasing counts, none equal to n_points: the rule is
        // the same, proving it does not depend on saturation being present.
        let counts = [500, 250, 125, 60, 30];
        let choice = select_fit_window(&counts, 1000);
        assert_eq!(
            choice,
            FitWindowChoice {
                window: Some((1, 4)),
                reliable: true,
                effective_levels: 5
            }
        );
    }

    #[test]
    fn test_select_fit_window_empty_input() {
        let choice = select_fit_window(&[], 1000);
        assert_eq!(
            choice,
            FitWindowChoice {
                window: None,
                reliable: false,
                effective_levels: 0
            }
        );
    }

    #[test]
    fn test_select_fit_window_accepted_by_windowed_estimator() {
        // Witness that the selected window is consumable by
        // `box_counting_3d_windowed` and that it actually matters: on a
        // uniform random cloud the finest count-valid level (index 0) bends
        // the curve, so fitting all levels differs from the R5 window.
        let points = lcg_points(1000);
        let precision = 16;
        let counts = raw_level_counts(&points, precision);
        let choice = select_fit_window(&counts, points.len());
        let (start, end) = choice
            .window
            .expect("uniform cloud must yield a reliable window");
        assert!(choice.reliable, "uniform cloud window must be reliable");
        assert!(choice.effective_levels >= 4);

        let windowed = box_counting_3d_windowed(&points, precision, (start, end))
            .expect("selected window must be accepted by the windowed estimator");
        assert_eq!(windowed.linear_region_start, start);
        assert_eq!(windowed.effective_levels, choice.effective_levels);

        let eff = choice.effective_levels;
        let all_levels = box_counting_3d_windowed(&points, precision, (0, eff - 1))
            .expect("full effective window is valid");
        assert!(
            (windowed.dimension - all_levels.dimension).abs() > 1e-3,
            "window must change the dimension on a non-straight curve: \
             windowed {} vs all-levels {}",
            windowed.dimension,
            all_levels.dimension
        );
    }
}
