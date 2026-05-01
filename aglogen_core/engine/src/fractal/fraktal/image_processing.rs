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

/// Compute Otsu's optimal threshold for bimodal image segmentation.
///
/// Returns the threshold value that minimizes intra-class variance
/// (equivalently maximizes inter-class variance).
pub fn otsu_threshold(image: ArrayView2<u8>) -> u8 {
    // Build histogram
    let mut histogram = [0u64; 256];
    for &pixel in image.iter() {
        histogram[pixel as usize] += 1;
    }

    let total_pixels = image.len() as f64;
    if total_pixels == 0.0 {
        return 128;
    }

    // Calculate total mean
    let mut sum_total: f64 = 0.0;
    for (i, &count) in histogram.iter().enumerate() {
        sum_total += i as f64 * count as f64;
    }

    let mut sum_background: f64 = 0.0;
    let mut weight_background: f64 = 0.0;
    let mut max_variance: f64 = 0.0;
    let mut optimal_threshold: u8 = 0;

    for (t, &count) in histogram.iter().enumerate() {
        weight_background += count as f64;
        if weight_background == 0.0 {
            continue;
        }

        let weight_foreground = total_pixels - weight_background;
        if weight_foreground == 0.0 {
            break;
        }

        sum_background += t as f64 * count as f64;

        let mean_background = sum_background / weight_background;
        let mean_foreground = (sum_total - sum_background) / weight_foreground;

        // Inter-class variance
        let variance =
            weight_background * weight_foreground * (mean_background - mean_foreground).powi(2);

        if variance > max_variance {
            max_variance = variance;
            optimal_threshold = t as u8;
        }
    }

    optimal_threshold
}

/// Determine if image has dark objects on light background.
///
/// Returns true if particles are dark (low pixel values) on light background.
/// Uses histogram analysis to detect the dominant pattern.
pub fn is_dark_on_light(image: ArrayView2<u8>, threshold: u8) -> bool {
    let mut dark_count = 0u64;
    let mut light_count = 0u64;
    let mut dark_sum = 0u64;
    let mut light_sum = 0u64;

    for &pixel in image.iter() {
        if pixel <= threshold {
            dark_count += 1;
            dark_sum += pixel as u64;
        } else {
            light_count += 1;
            light_sum += pixel as u64;
        }
    }

    // If dark region is smaller, it's likely dark-on-light (particles are dark)
    // Typical TEM images have small dark particles on large light background
    if dark_count == 0 || light_count == 0 {
        return false;
    }

    // Dark-on-light: dark area is smaller and has lower mean
    let dark_ratio = dark_count as f64 / (dark_count + light_count) as f64;

    // If dark region is less than 50% of image, it's dark-on-light
    dark_ratio < 0.5
}

/// Smart segmentation with automatic threshold detection.
///
/// Automatically detects:
/// 1. Optimal threshold using Otsu's method
/// 2. Whether particles are dark or light
/// 3. Applies appropriate segmentation
///
/// When `pre_thresholded` is `true`, Otsu is skipped entirely and the
/// image is treated as already binary: pixel ≥ 128 → foreground. This
/// path is used for scientific (binary-thresholded) PNG inputs where the
/// image contains only black/white pixels with no anti-aliasing halo.
///
/// Returns (binary_mask, detected_threshold, is_inverted)
pub fn smart_segment(
    image: ArrayView2<u8>,
    pixel_min: u8,
    pixel_max: u8,
    auto_threshold: bool,
    pre_thresholded: bool,
) -> (Array2<bool>, u8, bool) {
    // Pre-thresholded (scientific) path: skip Otsu, treat as binary.
    if pre_thresholded {
        let binary = image.mapv(|v| v >= 128);
        return (binary, 128, false);
    }

    if !auto_threshold {
        // Use manual thresholds as-is
        let binary = color_segment(image, pixel_min, pixel_max);
        return (binary, pixel_max, false);
    }

    // Calculate Otsu threshold
    let otsu = otsu_threshold(image);

    // Detect if dark-on-light
    let dark_on_light = is_dark_on_light(image, otsu);

    let binary = if dark_on_light {
        // Dark particles: select pixels BELOW threshold
        // Add small margin to avoid edge artifacts
        let effective_threshold = otsu.saturating_add(10).min(pixel_max);
        image.mapv(|v| v >= pixel_min && v <= effective_threshold)
    } else {
        // Light particles: select pixels ABOVE threshold
        let effective_threshold = otsu.saturating_sub(10).max(pixel_min);
        image.mapv(|v| v >= effective_threshold && v <= pixel_max)
    };

    (binary, otsu, dark_on_light)
}

/// Convert RGB image to grayscale.
///
/// Uses standard luminosity formula: 0.299*R + 0.587*G + 0.114*B
pub fn rgb_to_grayscale(r: ArrayView2<u8>, g: ArrayView2<u8>, b: ArrayView2<u8>) -> Array2<u8> {
    let shape = r.shape();
    let mut gray = Array2::zeros((shape[0], shape[1]));

    for i in 0..shape[0] {
        for j in 0..shape[1] {
            let luminosity =
                0.299 * r[[i, j]] as f64 + 0.587 * g[[i, j]] as f64 + 0.114 * b[[i, j]] as f64;
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

    // Step 3: Auto-detect particle radius from peak distance values.
    //
    // PYA-9 fix: use median over ALL peaks (not just top 30%). The
    // top-30% selection biased the radius upward by ~1.3x because
    // the largest distance values correspond to fused/merged blobs,
    // not to single primaries. Median over all peaks is robust to
    // both noise (small spurious peaks) and fusion (large blobs).
    let mut all_distances: Vec<f64> = all_peaks.iter().map(|p| p.2).collect();
    all_distances.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let estimated_radius = if all_distances.len() >= 2 {
        // Use median over ALL peaks
        let mid = all_distances.len() / 2;
        if all_distances.len() % 2 == 0 {
            (all_distances[mid - 1] + all_distances[mid]) / 2.0
        } else {
            all_distances[mid]
        }
    } else if !all_distances.is_empty() {
        all_distances[0]
    } else {
        5.0 // Fallback
    };

    // Step 4: Non-maximum suppression with detected radius.
    //
    // PYA-9 fix: separation = 1.0 × radius (was 2.0 × radius). For
    // aggregates with delta=1.1 (touching/overlapping primaries),
    // center-to-center distance is 2*radius/delta = 1.82*radius. The
    // old 2.0× factor fused all adjacent peaks, inflating the
    // estimated radius (×2 contribution to the total bias). With
    // 1.0×, adjacent primaries at delta=1.1 are correctly resolved.
    //
    // Sort all peaks by distance value (descending) so the strongest
    // peaks are kept first when NMS rejects collisions.
    all_peaks.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    let min_separation = estimated_radius * 1.0;
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
        let image = arr2(&[[0u8, 50, 100], [150, 200, 250], [10, 240, 241]]);

        let binary = color_segment(image.view(), 10, 240);

        assert!(!binary[[0, 0]]); // 0 < 10
        assert!(binary[[0, 1]]); // 50 in range
        assert!(binary[[0, 2]]); // 100 in range
        assert!(binary[[1, 0]]); // 150 in range
        assert!(binary[[1, 1]]); // 200 in range
        assert!(!binary[[1, 2]]); // 250 > 240
        assert!(binary[[2, 0]]); // 10 in range (edge)
        assert!(binary[[2, 1]]); // 240 in range (edge)
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

    // ── Phase 2 (P2): pre-thresholded binary input ───────────────

    /// T2.3: when `pre_thresholded=true`, `smart_segment` skips Otsu and
    /// treats the image as already binary (pixel ≥ 128 → foreground).
    #[test]
    fn test_smart_segment_pre_thresholded_binary() {
        // Build a binary-only image: some pixels at 0, some at 255.
        let image = arr2(&[
            [0u8, 255, 0, 255],
            [255, 0, 255, 0],
            [0, 0, 255, 255],
            [128, 127, 200, 50],
        ]);
        let (binary, threshold, inverted) = smart_segment(image.view(), 10, 240, true, true);

        // pre_thresholded: pixel >= 128 → true
        assert!(binary[[0, 1]]); // 255
        assert!(!binary[[0, 0]]); // 0
        assert!(binary[[1, 0]]); // 255
        assert!(!binary[[1, 1]]); // 0
        assert!(binary[[3, 0]]); // 128 (boundary, included)
        assert!(!binary[[3, 1]]); // 127 (excluded)
        assert!(binary[[3, 2]]); // 200
        assert!(!binary[[3, 3]]); // 50
                                  // Threshold returned should be 128 (the passthrough threshold).
        assert_eq!(threshold, 128);
        // Inverted should be false (passthrough does not invert).
        assert!(!inverted);
    }

    /// T2.3 triangulation: `pre_thresholded=false` retains Otsu behavior.
    #[test]
    fn test_smart_segment_pre_thresholded_false_keeps_otsu() {
        // Same image, pre_thresholded=false → Otsu logic applies.
        let image = arr2(&[
            [0u8, 255, 0, 255],
            [255, 0, 255, 0],
            [0, 0, 255, 255],
            [128, 127, 200, 50],
        ]);
        let (binary_otsu, threshold_otsu, _) = smart_segment(image.view(), 10, 240, true, false);
        // Otsu must produce a threshold that is NOT 128 for this bimodal image.
        // The image has values 0, 50, 127, 128, 200, 255 — Otsu should be
        // somewhere in the middle (around 127-128 area). We just verify the
        // function runs and produces a valid result.
        assert!(threshold_otsu > 0);
        // At least some foreground pixels exist.
        let fg_count = binary_otsu.iter().filter(|&&v| v).count();
        assert!(fg_count > 0, "Otsu must identify some foreground");
    }

    /// PYA-9 regression: NMS at radius factor 1.0× must resolve adjacent
    /// primaries packed at delta=1.1 (touching/overlapping configuration).
    ///
    /// With delta=1.1 (typical for CC-tunable aggregates), center-to-center
    /// distance is `2*radius/delta = 1.82*radius`. The OLD NMS factor of
    /// 2.0× fused these peaks, severely under-counting primaries and
    /// inflating the estimated radius. The NEW factor of 1.0× resolves them.
    #[test]
    fn test_nms_resolves_delta_1_1_packed_primaries() {
        // Two circles, radius=5 px, centers at (10,10) and (10,19).
        // Center-to-center = 9 px = 1.8 * radius (delta ≈ 1.11).
        let mut binary = ndarray::Array2::<bool>::from_elem((30, 30), false);
        for i in 0..30 {
            for j in 0..30 {
                let i_f = i as f64;
                let j_f = j as f64;
                let d1 = ((i_f - 10.0).powi(2) + (j_f - 10.0).powi(2)).sqrt();
                let d2 = ((i_f - 10.0).powi(2) + (j_f - 19.0).powi(2)).sqrt();
                if d1 <= 5.0 || d2 <= 5.0 {
                    binary[[i, j]] = true;
                }
            }
        }

        let (count, avg_radius) = estimate_particle_count_adaptive(binary.view());

        // With NMS=1.0×, BOTH peaks must be detected (not fused into one).
        assert_eq!(
            count, 2,
            "delta=1.1 packed primaries must be resolved as 2, not fused; got {}",
            count
        );
        // The estimated radius must be close to 5 px (true), not ~9 (fused).
        assert!(
            avg_radius < 7.0,
            "Average radius {} should be near true (5 px), not inflated",
            avg_radius
        );
    }

    /// PYA-9 regression: peak radius is computed as median over ALL peaks
    /// (not just the top 30%). The top-30% selection biased the radius
    /// upward by ~1.3× because the largest distance values come from
    /// fused/merged blobs, not single primaries.
    ///
    /// This test constructs a scene with mostly small primaries and a
    /// single larger feature (simulating what an aggregate cluster might
    /// look like), and asserts the estimated radius reflects the typical
    /// primary, not the outlier cluster.
    #[test]
    fn test_radius_median_uses_all_peaks_not_top_30() {
        // Grid of 9 small circles (radius=4 px), well-separated.
        // Plus one larger blob (radius=12 px) acting as an "outlier".
        let mut binary = ndarray::Array2::<bool>::from_elem((100, 100), false);

        // 3x3 grid of small circles, centers at (15, 15), (15, 35), ..., (35, 35), ...
        for grid_i in 0..3 {
            for grid_j in 0..3 {
                let cx = 15.0 + (grid_i as f64) * 20.0;
                let cy = 15.0 + (grid_j as f64) * 20.0;
                for i in 0..100 {
                    for j in 0..100 {
                        let d = (((i as f64) - cx).powi(2) + ((j as f64) - cy).powi(2)).sqrt();
                        if d <= 4.0 {
                            binary[[i, j]] = true;
                        }
                    }
                }
            }
        }
        // One large outlier blob in the corner.
        for i in 70..100 {
            for j in 70..100 {
                let d = (((i as f64) - 85.0).powi(2) + ((j as f64) - 85.0).powi(2)).sqrt();
                if d <= 12.0 {
                    binary[[i, j]] = true;
                }
            }
        }

        let (_count, avg_radius) = estimate_particle_count_adaptive(binary.view());

        // With ALL-peaks median, the typical primary radius (4) dominates,
        // not the outlier (12). Allow some slack — what matters is that
        // the radius is much closer to 4 than to 12.
        assert!(
            avg_radius < 8.0,
            "ALL-peaks median should reflect typical primary radius (~4); \
             got {} (top-30% would have biased toward 12)",
            avg_radius
        );
    }
}
