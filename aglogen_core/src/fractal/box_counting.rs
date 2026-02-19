//! Box-counting fractal dimension analysis.

use std::time::Instant;

use numpy::PyReadonlyArray2;
use pyo3::prelude::*;

use super::result::{FractalResult, PyFractalResult};

/// Run box-counting fractal analysis on a binary image.
#[pyfunction]
#[pyo3(signature = (binary_image, min_box_size=2, max_box_size=512, num_scales=20))]
pub fn box_counting(
    py: Python<'_>,
    binary_image: PyReadonlyArray2<'_, bool>,
    min_box_size: usize,
    max_box_size: usize,
    num_scales: usize,
) -> PyResult<PyFractalResult> {
    let image = binary_image.as_array();
    let (height, width) = (image.shape()[0], image.shape()[1]);

    // Convert to owned Vec<Vec<bool>>
    let image_data: Vec<Vec<bool>> = (0..height)
        .map(|i| (0..width).map(|j| image[[i, j]]).collect())
        .collect();

    // Release GIL during computation
    let result = py.allow_threads(|| {
        box_counting_internal(&image_data, min_box_size, max_box_size, num_scales)
    });

    Ok(result.to_py())
}

/// Internal box-counting implementation.
fn box_counting_internal(
    image: &[Vec<bool>],
    min_box_size: usize,
    max_box_size: usize,
    num_scales: usize,
) -> FractalResult {
    let start_time = Instant::now();

    let height = image.len();
    let width = if height > 0 { image[0].len() } else { 0 };

    // Generate logarithmically spaced box sizes
    let log_min = (min_box_size as f64).ln();
    let log_max = (max_box_size.min(height.min(width)) as f64).ln();

    let box_sizes: Vec<usize> = (0..num_scales)
        .map(|i| {
            let log_size = log_min + (log_max - log_min) * (i as f64) / ((num_scales - 1) as f64);
            log_size.exp().round() as usize
        })
        .filter(|&s| s >= min_box_size && s <= max_box_size)
        .collect();

    // Remove duplicates
    let mut box_sizes: Vec<usize> = box_sizes;
    box_sizes.dedup();

    // Count boxes at each scale
    let mut log_scales = Vec::new();
    let mut log_counts = Vec::new();

    for &box_size in &box_sizes {
        let count = count_boxes(image, box_size);
        if count > 0 {
            log_scales.push((1.0 / box_size as f64).ln());
            log_counts.push((count as f64).ln());
        }
    }

    // Linear regression to find fractal dimension
    let (slope, intercept, r_squared, std_error, residuals) =
        linear_regression(&log_scales, &log_counts);

    // Fractal dimension is the negative slope (box-counting: N ~ s^(-Df))
    let dimension = slope;

    // 95% confidence interval (approximate)
    let ci_half = 1.96 * std_error;
    let confidence_interval = (dimension - ci_half, dimension + ci_half);

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    FractalResult {
        dimension,
        r_squared,
        std_error,
        confidence_interval,
        log_scales,
        log_values: log_counts,
        residuals,
        execution_time_ms,
        linear_region_start: 0,  // 2D box-counting uses all points
    }
}

/// Count non-empty boxes at a given box size.
fn count_boxes(image: &[Vec<bool>], box_size: usize) -> usize {
    let height = image.len();
    let width = if height > 0 { image[0].len() } else { 0 };

    let mut count = 0;

    let n_rows = (height + box_size - 1) / box_size;
    let n_cols = (width + box_size - 1) / box_size;

    for row in 0..n_rows {
        for col in 0..n_cols {
            let y_start = row * box_size;
            let x_start = col * box_size;
            let y_end = (y_start + box_size).min(height);
            let x_end = (x_start + box_size).min(width);

            // Check if any pixel in box is true
            let mut has_pixel = false;
            'outer: for y in y_start..y_end {
                for x in x_start..x_end {
                    if image[y][x] {
                        has_pixel = true;
                        break 'outer;
                    }
                }
            }

            if has_pixel {
                count += 1;
            }
        }
    }

    count
}

/// Linear regression returning (slope, intercept, r_squared, std_error, residuals).
fn linear_regression(x: &[f64], y: &[f64]) -> (f64, f64, f64, f64, Vec<f64>) {
    let n = x.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0, 0.0, 0.0, vec![]);
    }

    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xx: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(xi, yi)| xi * yi).sum();

    let denom = n * sum_xx - sum_x * sum_x;
    if denom.abs() < 1e-15 {
        return (0.0, sum_y / n, 0.0, 0.0, vec![0.0; x.len()]);
    }

    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;

    // Calculate residuals and R-squared
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

    let r_squared = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };

    // Standard error of slope
    let mse = ss_res / (n - 2.0);
    let std_error = (mse / (sum_xx - sum_x * sum_x / n)).sqrt();

    (slope, intercept, r_squared, std_error, residuals)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_box_counting_line() {
        // Horizontal line should have Df ~ 1
        let mut image = vec![vec![false; 100]; 100];
        for x in 0..100 {
            image[50][x] = true;
        }

        let result = box_counting_internal(&image, 2, 64, 10);
        assert!(result.dimension > 0.8 && result.dimension < 1.2);
    }

    #[test]
    fn test_box_counting_filled() {
        // Filled square should have Df ~ 2
        let image = vec![vec![true; 64]; 64];

        let result = box_counting_internal(&image, 2, 32, 8);
        assert!(result.dimension > 1.8 && result.dimension < 2.2);
    }

    #[test]
    fn test_linear_regression() {
        let x = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let y = vec![2.0, 4.0, 6.0, 8.0, 10.0];

        let (slope, intercept, r_squared, _, _) = linear_regression(&x, &y);

        assert!((slope - 2.0).abs() < 1e-10);
        assert!((intercept - 0.0).abs() < 1e-10);
        assert!((r_squared - 1.0).abs() < 1e-10);
    }
}
