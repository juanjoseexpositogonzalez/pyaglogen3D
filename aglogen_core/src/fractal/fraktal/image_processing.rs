//! Image preprocessing for FRAKTAL analysis.
//!
//! Implements color segmentation and geometry calculations equivalent
//! to MATLAB's roicolor and gyration calculations.

use ndarray::{Array2, ArrayView2};

/// Result of image geometry analysis.
#[derive(Debug, Clone)]
pub struct ImageGeometry {
    /// Number of object pixels
    pub pixel_count: usize,

    /// Center of gyration (x, y) in pixels
    pub center_of_gyration: (f64, f64),

    /// Radius of gyration in pixels
    pub radius_of_gyration_px: f64,

    /// Radius of gyration in nm
    pub radius_of_gyration_nm: f64,

    /// Projected area in nm²
    pub projected_area_nm2: f64,

    /// Length per pixel in nm
    pub length_per_pixel: f64,
}

/// Apply color segmentation to grayscale image.
///
/// Equivalent to MATLAB's `roicolor(image, min, max)`.
/// Returns a binary mask where pixels in range [min, max] are true.
pub fn color_segment(image: ArrayView2<u8>, min_val: u8, max_val: u8) -> Array2<bool> {
    image.mapv(|v| v >= min_val && v <= max_val)
}

/// Convert RGB image to grayscale.
///
/// Uses standard luminosity formula: 0.299*R + 0.587*G + 0.114*B
pub fn rgb_to_grayscale(r: ArrayView2<u8>, g: ArrayView2<u8>, b: ArrayView2<u8>) -> Array2<u8> {
    let shape = r.shape();
    let mut gray = Array2::zeros((shape[0], shape[1]));

    for i in 0..shape[0] {
        for j in 0..shape[1] {
            let luminosity = 0.299 * r[[i, j]] as f64
                + 0.587 * g[[i, j]] as f64
                + 0.114 * b[[i, j]] as f64;
            gray[[i, j]] = luminosity.round() as u8;
        }
    }

    gray
}

/// Calculate image geometry from binary mask.
///
/// Computes center of gyration, radius of gyration, and projected area.
pub fn calculate_geometry(
    binary: ArrayView2<bool>,
    npix: f64,
    escala: f64,
) -> Option<ImageGeometry> {
    // Collect object pixel positions
    let positions: Vec<(usize, usize)> = binary
        .indexed_iter()
        .filter(|(_, &v)| v)
        .map(|((i, j), _)| (i, j))
        .collect();

    let n = positions.len();
    if n == 0 {
        return None;
    }

    // Calculate length per pixel
    let length_per_pixel = escala / npix; // nm per pixel
    let area_per_pixel = length_per_pixel * length_per_pixel; // nm² per pixel

    // Calculate center of gyration (xcg, ycg)
    // Note: In MATLAB, I is row index and J is column index
    let sum_i: f64 = positions.iter().map(|(i, _)| *i as f64).sum();
    let sum_j: f64 = positions.iter().map(|(_, j)| *j as f64).sum();
    let n_f64 = n as f64;
    let ycg = sum_i / n_f64; // Row index = y coordinate
    let xcg = sum_j / n_f64; // Column index = x coordinate

    // Calculate radius of gyration
    // x = J - xcg, y = I - ycg
    // r² = sum(x² + y²)
    // Rg = sqrt(r²/n) * length_per_pixel
    let r2_sum: f64 = positions
        .iter()
        .map(|(i, j)| {
            let x = *j as f64 - xcg;
            let y = *i as f64 - ycg;
            x * x + y * y
        })
        .sum();

    let radius_px = (r2_sum / n_f64).sqrt();
    let radius_nm = radius_px * length_per_pixel;

    // Projected area
    let projected_area = n_f64 * area_per_pixel;

    Some(ImageGeometry {
        pixel_count: n,
        center_of_gyration: (xcg, ycg),
        radius_of_gyration_px: radius_px,
        radius_of_gyration_nm: radius_nm,
        projected_area_nm2: projected_area,
        length_per_pixel,
    })
}

/// Apply 3D correction to radius of gyration for granulated particles.
///
/// Formula: Rg_3D = Rg_2D + (2.165 - 19.315*(δ-1)) × 10^-5 × Rg_2D^(2.928 + 5.414*(δ-1))
pub fn apply_3d_correction_granulated(rg_2d: f64, delta: f64) -> f64 {
    let a = (2.165 - 19.315 * (delta - 1.0)) * 1e-5;
    let b = 2.928 + 5.414 * (delta - 1.0);
    rg_2d + a * rg_2d.powf(b)
}

/// Apply 3D correction to radius of gyration for voxel model.
///
/// Formula: Rg_3D = Rg_2D + 2.165 × 10^-5 × Rg_2D^2.928
pub fn apply_3d_correction_voxel(rg_2d: f64) -> f64 {
    let a = 2.165e-5;
    let b = 2.928;
    rg_2d + a * rg_2d.powf(b)
}

/// Calculate m exponent based on correction mode and model.
pub fn calculate_m_exponent(correction_3d: bool, granulated: bool, delta: f64) -> f64 {
    if correction_3d && granulated {
        1.86 - 1.3 * (delta - 1.0)
    } else if correction_3d {
        1.0
    } else if granulated {
        1.95
    } else {
        1.0
    }
}

/// Compute distance transform of binary image.
///
/// For each foreground pixel, computes the distance to the nearest background pixel.
/// Uses two-pass algorithm for efficiency.
fn compute_distance_transform(binary: ArrayView2<bool>) -> Array2<f64> {
    let (rows, cols) = binary.dim();
    let mut distance = Array2::<f64>::zeros((rows, cols));

    // Initialize: 0 for background, large value for foreground
    for i in 0..rows {
        for j in 0..cols {
            distance[[i, j]] = if binary[[i, j]] { f64::MAX } else { 0.0 };
        }
    }

    // Forward pass
    for i in 0..rows {
        for j in 0..cols {
            if binary[[i, j]] {
                let mut min_dist = distance[[i, j]];
                if i > 0 {
                    min_dist = min_dist.min(distance[[i - 1, j]] + 1.0);
                }
                if j > 0 {
                    min_dist = min_dist.min(distance[[i, j - 1]] + 1.0);
                }
                if i > 0 && j > 0 {
                    min_dist = min_dist.min(distance[[i - 1, j - 1]] + 1.414);
                }
                if i > 0 && j + 1 < cols {
                    min_dist = min_dist.min(distance[[i - 1, j + 1]] + 1.414);
                }
                distance[[i, j]] = min_dist;
            }
        }
    }

    // Backward pass
    for i in (0..rows).rev() {
        for j in (0..cols).rev() {
            if binary[[i, j]] {
                let mut min_dist = distance[[i, j]];
                if i + 1 < rows {
                    min_dist = min_dist.min(distance[[i + 1, j]] + 1.0);
                }
                if j + 1 < cols {
                    min_dist = min_dist.min(distance[[i, j + 1]] + 1.0);
                }
                if i + 1 < rows && j + 1 < cols {
                    min_dist = min_dist.min(distance[[i + 1, j + 1]] + 1.414);
                }
                if i + 1 < rows && j > 0 {
                    min_dist = min_dist.min(distance[[i + 1, j - 1]] + 1.414);
                }
                distance[[i, j]] = min_dist;
            }
        }
    }

    distance
}

/// Estimate number of primary particles using adaptive scale detection.
///
/// This provides a visual estimate of particle count by:
/// 1. Computing distance transform (distance from each pixel to background)
/// 2. Finding ALL local maxima with minimal threshold
/// 3. Auto-detecting particle radius from peak distance values
/// 4. Applying non-maximum suppression with detected radius
///
/// Returns (npo_estimate, average_particle_radius_px)
pub fn estimate_particle_count_adaptive(binary: ArrayView2<bool>) -> (usize, f64) {
    let (rows, cols) = binary.dim();

    // Step 1: Compute distance transform
    let distance = compute_distance_transform(binary);

    // Step 2: Find ALL local maxima with small neighborhood (3x3)
    // Use very low threshold to find all candidates
    let neighborhood = 2;
    let min_peak_threshold = 2.0; // At least 2 pixels from edge

    let mut all_peaks: Vec<(usize, usize, f64)> = Vec::new();

    for i in neighborhood..rows.saturating_sub(neighborhood) {
        for j in neighborhood..cols.saturating_sub(neighborhood) {
            let val = distance[[i, j]];

            // Skip if below minimum threshold
            if val < min_peak_threshold {
                continue;
            }

            // Check if this is a local maximum in 5x5 neighborhood
            let mut is_max = true;
            'outer: for di in 0..=neighborhood * 2 {
                for dj in 0..=neighborhood * 2 {
                    let ni = i + di - neighborhood;
                    let nj = j + dj - neighborhood;
                    if ni < rows && nj < cols && (ni != i || nj != j) {
                        if distance[[ni, nj]] > val {
                            is_max = false;
                            break 'outer;
                        }
                    }
                }
            }

            if is_max {
                all_peaks.push((i, j, val));
            }
        }
    }

    if all_peaks.is_empty() {
        return (0, 0.0);
    }

    // Step 3: Auto-detect particle radius from peak distance values
    // Sort by distance value (descending) - highest peaks are true particle centers
    all_peaks.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    // Use median of top peaks to estimate particle radius
    // Take top 30% of peaks (but at least 3, at most 50)
    let n_top = (all_peaks.len() * 3 / 10).max(3).min(50).min(all_peaks.len());
    let mut top_distances: Vec<f64> = all_peaks.iter().take(n_top).map(|p| p.2).collect();
    top_distances.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let estimated_radius = if top_distances.len() >= 2 {
        // Use median
        let mid = top_distances.len() / 2;
        if top_distances.len() % 2 == 0 {
            (top_distances[mid - 1] + top_distances[mid]) / 2.0
        } else {
            top_distances[mid]
        }
    } else if !top_distances.is_empty() {
        top_distances[0]
    } else {
        5.0 // Fallback
    };

    // Step 4: Non-maximum suppression with detected radius
    // Use full diameter as separation (particles shouldn't overlap centers)
    let min_separation = estimated_radius * 2.0;
    let min_sep_sq = min_separation * min_separation;

    let mut final_peaks: Vec<(usize, usize, f64)> = Vec::new();
    for peak in &all_peaks {
        let too_close = final_peaks.iter().any(|p| {
            let di = peak.0 as f64 - p.0 as f64;
            let dj = peak.1 as f64 - p.1 as f64;
            di * di + dj * dj < min_sep_sq
        });

        if !too_close {
            final_peaks.push(*peak);
        }
    }

    // Calculate average particle radius from final peaks
    let avg_radius = if final_peaks.is_empty() {
        estimated_radius
    } else {
        final_peaks.iter().map(|p| p.2).sum::<f64>() / final_peaks.len() as f64
    };

    (final_peaks.len(), avg_radius)
}

/// Estimate particles and primary particle diameter from image.
///
/// Returns (npo_visual, estimated_dpo_nm, avg_radius_px)
pub fn estimate_particles_and_dpo(
    binary: ArrayView2<bool>,
    length_per_pixel: f64,
) -> (usize, f64, f64) {
    let (count, avg_radius_px) = estimate_particle_count_adaptive(binary);
    let estimated_dpo_nm = 2.0 * avg_radius_px * length_per_pixel;
    (count, estimated_dpo_nm, avg_radius_px)
}

/// Legacy function for backward compatibility.
/// Calls the adaptive version but ignores the min_particle_radius_px parameter.
pub fn estimate_particle_count(
    binary: ArrayView2<bool>,
    _min_particle_radius_px: f64,
) -> (usize, f64) {
    estimate_particle_count_adaptive(binary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::arr2;

    #[test]
    fn test_color_segment() {
        let image = arr2(&[
            [0u8, 50, 100],
            [150, 200, 250],
            [10, 240, 241],
        ]);

        let binary = color_segment(image.view(), 10, 240);

        assert!(!binary[[0, 0]]); // 0 < 10
        assert!(binary[[0, 1]]);  // 50 in range
        assert!(binary[[0, 2]]);  // 100 in range
        assert!(binary[[1, 0]]);  // 150 in range
        assert!(binary[[1, 1]]);  // 200 in range
        assert!(!binary[[1, 2]]); // 250 > 240
        assert!(binary[[2, 0]]);  // 10 in range (edge)
        assert!(binary[[2, 1]]);  // 240 in range (edge)
        assert!(!binary[[2, 2]]); // 241 > 240
    }

    #[test]
    fn test_geometry_single_pixel() {
        let binary = arr2(&[
            [false, false, false],
            [false, true, false],
            [false, false, false],
        ]);

        let geom = calculate_geometry(binary.view(), 100.0, 100.0).unwrap();

        assert_eq!(geom.pixel_count, 1);
        assert!((geom.center_of_gyration.0 - 1.0).abs() < 1e-10); // col = 1
        assert!((geom.center_of_gyration.1 - 1.0).abs() < 1e-10); // row = 1
        assert!((geom.radius_of_gyration_px - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_3d_correction_granulated() {
        let rg_2d = 100.0;
        let delta = 1.1;
        let rg_3d = apply_3d_correction_granulated(rg_2d, delta);

        // Should be slightly larger than 2D value
        assert!(rg_3d > rg_2d);
        // Sanity check: not too much larger
        assert!(rg_3d < rg_2d * 1.5);
    }

    #[test]
    fn test_estimate_particle_count_adaptive_single_particle() {
        // Create a binary image with a single circular-ish particle
        // 15x15 image with a circle of radius ~5 in the center
        let mut binary = ndarray::Array2::<bool>::from_elem((15, 15), false);
        let center = 7;
        let radius = 5.0;

        for i in 0..15 {
            for j in 0..15 {
                let dist = (((i as f64) - (center as f64)).powi(2)
                    + ((j as f64) - (center as f64)).powi(2))
                .sqrt();
                if dist <= radius {
                    binary[[i, j]] = true;
                }
            }
        }

        let (count, avg_radius) = estimate_particle_count_adaptive(binary.view());

        // Should detect exactly 1 particle
        assert_eq!(count, 1, "Should detect single particle");
        // Detected radius should be approximately the actual radius
        assert!(
            (avg_radius - radius).abs() < 2.0,
            "Detected radius {} should be close to actual radius {}",
            avg_radius,
            radius
        );
    }

    #[test]
    fn test_estimate_particle_count_adaptive_multiple_particles() {
        // Create a binary image with 3 well-separated particles
        let mut binary = ndarray::Array2::<bool>::from_elem((40, 40), false);
        let radius = 4.0;
        let centers = [(8, 8), (8, 30), (30, 20)];

        for (cy, cx) in centers.iter() {
            for i in 0..40 {
                for j in 0..40 {
                    let dist = (((i as f64) - (*cy as f64)).powi(2)
                        + ((j as f64) - (*cx as f64)).powi(2))
                    .sqrt();
                    if dist <= radius {
                        binary[[i, j]] = true;
                    }
                }
            }
        }

        let (count, _avg_radius) = estimate_particle_count_adaptive(binary.view());

        // Should detect 3 particles
        assert_eq!(count, 3, "Should detect 3 separate particles");
    }

    #[test]
    fn test_estimate_particles_and_dpo() {
        // Create a single particle with known size
        let mut binary = ndarray::Array2::<bool>::from_elem((20, 20), false);
        let center = 10;
        let radius_px = 5.0;

        for i in 0..20 {
            for j in 0..20 {
                let dist = (((i as f64) - (center as f64)).powi(2)
                    + ((j as f64) - (center as f64)).powi(2))
                .sqrt();
                if dist <= radius_px {
                    binary[[i, j]] = true;
                }
            }
        }

        let length_per_pixel = 10.0; // 10 nm per pixel
        let (count, estimated_dpo, avg_radius) =
            estimate_particles_and_dpo(binary.view(), length_per_pixel);

        assert_eq!(count, 1, "Should detect 1 particle");

        // Expected dpo = 2 * radius_px * length_per_pixel = 2 * 5 * 10 = 100 nm
        let expected_dpo = 2.0 * radius_px * length_per_pixel;
        assert!(
            (estimated_dpo - expected_dpo).abs() < 30.0,
            "Estimated dpo {} should be close to expected {}",
            estimated_dpo,
            expected_dpo
        );
        assert!(avg_radius > 0.0, "Average radius should be positive");
    }

    #[test]
    fn test_estimate_particle_count_adaptive_empty_image() {
        let binary = ndarray::Array2::<bool>::from_elem((20, 20), false);
        let (count, avg_radius) = estimate_particle_count_adaptive(binary.view());

        assert_eq!(count, 0, "Empty image should have 0 particles");
        assert_eq!(avg_radius, 0.0, "Empty image should have 0 radius");
    }
}
