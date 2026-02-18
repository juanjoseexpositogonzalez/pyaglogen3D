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
}
