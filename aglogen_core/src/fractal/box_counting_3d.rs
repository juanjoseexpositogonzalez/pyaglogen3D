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

use std::time::Instant;

use numpy::{PyArray1, PyArrayMethods, PyReadonlyArray2};
use pyo3::prelude::*;
use rayon::prelude::*;

use super::result::PyFractalResult;

/// Maximum precision in bits (21 bits per dimension = 63 bits total for 3D Morton code).
const MAX_PRECISION: u32 = 21;

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
fn morton_encode_3d(x: u64, y: u64, z: u64) -> u64 {
    expand_bits_3d(x) | (expand_bits_3d(y) << 1) | (expand_bits_3d(z) << 2)
}

/// Result from 3D box-counting analysis.
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
}

impl BoxCountingResult3D {
    /// Convert to PyFractalResult for Python interop.
    pub fn to_py(&self) -> PyFractalResult {
        PyFractalResult {
            dimension: self.dimension,
            r_squared: self.r_squared,
            std_error: self.std_error,
            confidence_interval: self.confidence_interval,
            log_scales_data: self.log_scales.clone(),
            log_values_data: self.log_counts.clone(),
            residuals_data: self.residuals.clone(),
            execution_time_ms: self.execution_time_ms,
            linear_region_start: self.linear_region_start,
        }
    }
}

/// Fast 3D box-counting using Morton codes.
///
/// # Arguments
/// * `points` - Nx3 array of (x, y, z) coordinates
/// * `precision` - Number of bits per dimension (higher = finer resolution)
///
/// # Returns
/// BoxCountingResult3D with fractal dimension and statistics.
pub fn box_counting_3d_morton(
    points: &[[f64; 3]],
    precision: u32,
) -> BoxCountingResult3D {
    let start_time = Instant::now();
    let n_points = points.len();

    if n_points < 2 {
        return BoxCountingResult3D {
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
        };
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
    let mut log_scales = Vec::with_capacity(precision as usize);
    let mut log_counts = Vec::with_capacity(precision as usize);

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

    // Step 5: Robust linear regression to find fractal dimension
    // Automatically detects linear region by excluding outliers from small scales
    let (linear_start, slope, _intercept, r_squared, std_error, residuals) =
        linear_regression_robust(&log_scales, &log_counts);

    let dimension = slope;
    let ci_half = 1.96 * std_error;
    let confidence_interval = (dimension - ci_half, dimension + ci_half);

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    BoxCountingResult3D {
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
    }
}

/// Count unique values after masking off `shift` low bits.
/// Takes advantage of sorted array for O(N) counting.
#[inline]
fn count_unique_masked(sorted: &[u64], shift: u32) -> usize {
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
fn find_bounding_box(points: &[[f64; 3]]) -> ([f64; 3], [f64; 3]) {
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
fn compute_scale(min: &[f64; 3], max: &[f64; 3]) -> f64 {
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
fn normalize_coord(val: f64, min: f64, scale: f64, max_val: u64) -> u64 {
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

    let r_squared = if ss_tot > 1e-15 { 1.0 - ss_res / ss_tot } else { 0.0 };
    let mse = ss_res / (n - 2.0).max(1.0);
    let std_error = (mse / (sum_xx - sum_x * sum_x / n).abs().max(1e-15)).sqrt();

    (slope, intercept, r_squared, std_error, residuals)
}

/// Robust linear regression with automatic detection of linear region.
///
/// Starts from the right (large scales) and progressively adds points from the left,
/// stopping when the residual of the new point exceeds a threshold or R² drops significantly.
///
/// Returns: (start_index, slope, intercept, r_squared, std_error, residuals_for_all_points)
fn linear_regression_robust(x: &[f64], y: &[f64]) -> (usize, f64, f64, f64, f64, Vec<f64>) {
    let n = x.len();
    if n < 3 {
        let (slope, intercept, r2, se, res) = linear_regression(x, y);
        return (0, slope, intercept, r2, se, res);
    }

    // Parameters for outlier detection
    let min_points = 4.min(n);  // Minimum points for regression
    let residual_threshold = 2.0;  // Standardized residual threshold
    let r2_drop_threshold = 0.02;  // Max allowed R² drop when adding a point

    // Start with rightmost points (large scales - more reliable)
    let mut best_start = 0;
    let mut best_r2 = 0.0;

    // Initial regression with last min_points
    let start_idx = n - min_points;
    let (mut slope, mut intercept, mut r2, mut std_error, _) =
        linear_regression(&x[start_idx..], &y[start_idx..]);

    best_start = start_idx;
    best_r2 = r2;

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
        let (new_slope, new_intercept, new_r2, new_se, _) =
            linear_regression(&x[i..], &y[i..]);

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
            // Only update best if R² is close to or better than before
            best_start = i;
            best_r2 = new_r2.max(best_r2);
        }

        r2 = new_r2;
    }

    // Final regression on selected range
    let (final_slope, final_intercept, final_r2, final_se, _) =
        linear_regression(&x[best_start..], &y[best_start..]);

    // Compute residuals for ALL points (for visualization)
    let residuals: Vec<f64> = x.iter().zip(y.iter())
        .map(|(xi, yi)| yi - (final_intercept + final_slope * xi))
        .collect();

    (best_start, final_slope, final_intercept, final_r2, final_se, residuals)
}

// ============================================================================
// Python bindings
// ============================================================================

/// Run fast 3D box-counting analysis on point cloud.
///
/// Uses Morton codes (Z-order curve) for O(N log N) complexity.
///
/// # Arguments
/// * `coordinates` - Nx3 array of (x, y, z) coordinates
/// * `precision` - Bits per dimension (default: 18, max: 21)
///
/// # Returns
/// FractalResult with dimension estimate and statistics.
#[pyfunction]
#[pyo3(signature = (coordinates, precision=18))]
pub fn box_counting_3d(
    py: Python<'_>,
    coordinates: PyReadonlyArray2<'_, f64>,
    precision: u32,
) -> PyResult<PyFractalResult> {
    let coords = coordinates.as_array();
    let n = coords.shape()[0];

    if coords.shape()[1] != 3 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Coordinates must be Nx3 array",
        ));
    }

    // Convert to Vec<[f64; 3]>
    let points: Vec<[f64; 3]> = (0..n)
        .map(|i| [coords[[i, 0]], coords[[i, 1]], coords[[i, 2]]])
        .collect();

    // Release GIL during computation
    let result = py.allow_threads(|| box_counting_3d_morton(&points, precision));

    Ok(result.to_py())
}

/// Run box-counting on an agglomerate defined by sphere centers and radii.
///
/// Generates surface points for each sphere and runs 3D box-counting.
///
/// # Arguments
/// * `centers` - Nx3 array of sphere center coordinates
/// * `radii` - N-element array of sphere radii
/// * `points_per_sphere` - Number of surface points per sphere (default: 100)
/// * `precision` - Bits per dimension (default: 18)
#[pyfunction]
#[pyo3(signature = (centers, radii, points_per_sphere=100, precision=18))]
pub fn box_counting_agglomerate(
    py: Python<'_>,
    centers: PyReadonlyArray2<'_, f64>,
    radii: &Bound<'_, PyArray1<f64>>,
    points_per_sphere: usize,
    precision: u32,
) -> PyResult<PyFractalResult> {
    let centers_arr = centers.as_array();
    let radii_arr = radii.try_readonly()?;
    let radii_slice = radii_arr.as_slice()?;
    let n_spheres = centers_arr.shape()[0];

    if centers_arr.shape()[1] != 3 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Centers must be Nx3 array",
        ));
    }
    if radii_slice.len() != n_spheres {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Radii length must match number of centers",
        ));
    }

    // Generate sphere surface points
    let points: Vec<[f64; 3]> = (0..n_spheres)
        .flat_map(|i| {
            let cx = centers_arr[[i, 0]];
            let cy = centers_arr[[i, 1]];
            let cz = centers_arr[[i, 2]];
            let r = radii_slice[i];
            generate_sphere_points(cx, cy, cz, r, points_per_sphere)
        })
        .collect();

    // Release GIL during computation
    let result = py.allow_threads(|| box_counting_3d_morton(&points, precision));

    Ok(result.to_py())
}

/// Generate approximately uniformly distributed points on a sphere surface.
/// Uses the Fibonacci lattice method.
fn generate_sphere_points(
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
        let points: Vec<[f64; 3]> = (0..1000)
            .map(|i| [i as f64, 0.0, 0.0])
            .collect();

        let result = box_counting_3d_morton(&points, 16);
        assert!(result.dimension > 0.8 && result.dimension < 1.2,
            "Line Df should be ~1, got {}", result.dimension);
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
        assert!(result.dimension > 1.7 && result.dimension < 2.3,
            "Plane Df should be ~2, got {}", result.dimension);
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
        assert!(result.dimension > 2.7 && result.dimension < 3.3,
            "Cube Df should be ~3, got {}", result.dimension);
        assert!(result.r_squared > 0.9);
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
}
