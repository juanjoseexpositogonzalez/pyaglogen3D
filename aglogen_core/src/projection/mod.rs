//! 2D Projection of 3D Agglomerates.
//!
//! Generates 2D projections of 3D particle coordinates by applying
//! rotation matrices based on azimuth and elevation angles.
//!
//! Based on Matlab's create2DImages.m which uses viewmtx for the
//! rotation transformation.

use std::f64::consts::PI;

use numpy::{PyArray1, PyArray2, PyReadonlyArray1, PyReadonlyArray2};
use pyo3::prelude::*;

/// Result of a 2D projection operation.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PyProjectionResult {
    /// 2D X coordinates after projection
    #[pyo3(get)]
    pub x: Vec<f64>,
    /// 2D Y coordinates after projection
    #[pyo3(get)]
    pub y: Vec<f64>,
    /// Particle radii (unchanged from 3D)
    #[pyo3(get)]
    pub radii: Vec<f64>,
    /// Azimuth angle used (degrees)
    #[pyo3(get)]
    pub azimuth: f64,
    /// Elevation angle used (degrees)
    #[pyo3(get)]
    pub elevation: f64,
    /// Bounding box: [min_x, max_x, min_y, max_y]
    #[pyo3(get)]
    pub bounds: [f64; 4],
}

#[pymethods]
impl PyProjectionResult {
    /// Get 2D coordinates as numpy array (N x 2).
    fn coordinates_2d<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray2<f64>> {
        let coords: Vec<[f64; 2]> = self
            .x
            .iter()
            .zip(self.y.iter())
            .map(|(&x, &y)| [x, y])
            .collect();
        PyArray2::from_vec2(py, &coords.iter().map(|c| c.to_vec()).collect::<Vec<_>>()).unwrap()
    }

    /// Get radii as numpy array.
    fn radii_array<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.radii.clone())
    }
}

/// Project 3D coordinates to 2D using azimuth and elevation angles.
///
/// # Arguments
/// * `coordinates` - 3D particle coordinates (N x 3 array)
/// * `radii` - Particle radii (N array)
/// * `azimuth` - Azimuth angle in degrees (rotation around Z axis)
/// * `elevation` - Elevation angle in degrees (tilt from XY plane)
///
/// # Returns
/// * `PyProjectionResult` containing 2D coordinates, radii, and bounds
#[pyfunction]
#[pyo3(signature = (coordinates, radii, azimuth=0.0, elevation=0.0))]
pub fn project_to_2d(
    _py: Python<'_>,
    coordinates: PyReadonlyArray2<f64>,
    radii: PyReadonlyArray1<f64>,
    azimuth: f64,
    elevation: f64,
) -> PyResult<PyProjectionResult> {
    let coords = coordinates.as_array();
    let radii_arr = radii.as_array();

    let n = coords.shape()[0];
    if n == 0 {
        return Ok(PyProjectionResult {
            x: vec![],
            y: vec![],
            radii: vec![],
            azimuth,
            elevation,
            bounds: [0.0, 0.0, 0.0, 0.0],
        });
    }

    // Convert angles to radians
    let az_rad = azimuth * PI / 180.0;
    let el_rad = elevation * PI / 180.0;

    // Build rotation matrix
    // This replicates Matlab's viewmtx(az, el) behavior for 3D to 2D projection
    // The view transformation combines:
    // 1. Rotation around Z by azimuth
    // 2. Rotation around X by elevation (after azimuth rotation)
    let rotation = build_view_matrix(az_rad, el_rad);

    // Project each point
    let mut x_out = Vec::with_capacity(n);
    let mut y_out = Vec::with_capacity(n);
    let mut radii_out = Vec::with_capacity(n);

    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for i in 0..n {
        let x = coords[[i, 0]];
        let y = coords[[i, 1]];
        let z = coords[[i, 2]];
        let r = radii_arr[i];

        // Apply rotation matrix (we only need x' and y' for 2D projection)
        let x_proj = rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z;
        let y_proj = rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z;

        x_out.push(x_proj);
        y_out.push(y_proj);
        radii_out.push(r);

        // Update bounds (including radius for proper image sizing)
        min_x = min_x.min(x_proj - r);
        max_x = max_x.max(x_proj + r);
        min_y = min_y.min(y_proj - r);
        max_y = max_y.max(y_proj + r);
    }

    Ok(PyProjectionResult {
        x: x_out,
        y: y_out,
        radii: radii_out,
        azimuth,
        elevation,
        bounds: [min_x, max_x, min_y, max_y],
    })
}

/// Build view transformation matrix from azimuth and elevation angles.
///
/// This replicates Matlab's viewmtx(az, el) for orthographic projection.
/// The matrix transforms 3D coordinates to a 2D view plane.
///
/// Convention (Matlab compatible):
/// - Azimuth: rotation around Z axis (0° = looking from +X, 90° = from +Y)
/// - Elevation: angle above XY plane (0° = in plane, 90° = from +Z)
fn build_view_matrix(azimuth: f64, elevation: f64) -> [[f64; 3]; 3] {
    let cos_az = azimuth.cos();
    let sin_az = azimuth.sin();
    let cos_el = elevation.cos();
    let sin_el = elevation.sin();

    // View matrix for orthographic projection
    // Equivalent to Matlab's view transformation:
    // 1. Rotate by azimuth around Z
    // 2. Rotate by (90° - elevation) around the new X axis
    //
    // The resulting x' axis points right in the view
    // The resulting y' axis points up in the view
    // The z' axis is the viewing direction (discarded for 2D)
    [
        [-sin_az, cos_az, 0.0],
        [-cos_az * sin_el, -sin_az * sin_el, cos_el],
        [cos_az * cos_el, sin_az * cos_el, sin_el],
    ]
}

/// Generate multiple projections at different angles.
///
/// # Arguments
/// * `coordinates` - 3D particle coordinates (N x 3 array)
/// * `radii` - Particle radii (N array)
/// * `azimuth_start` - Starting azimuth angle (degrees)
/// * `azimuth_end` - Ending azimuth angle (degrees)
/// * `azimuth_step` - Azimuth step size (degrees)
/// * `elevation_start` - Starting elevation angle (degrees)
/// * `elevation_end` - Ending elevation angle (degrees)
/// * `elevation_step` - Elevation step size (degrees)
///
/// # Returns
/// * List of `PyProjectionResult` for each angle combination
#[pyfunction]
#[pyo3(signature = (
    coordinates,
    radii,
    azimuth_start=0.0,
    azimuth_end=150.0,
    azimuth_step=30.0,
    elevation_start=0.0,
    elevation_end=150.0,
    elevation_step=30.0
))]
pub fn project_batch(
    py: Python<'_>,
    coordinates: PyReadonlyArray2<f64>,
    radii: PyReadonlyArray1<f64>,
    azimuth_start: f64,
    azimuth_end: f64,
    azimuth_step: f64,
    elevation_start: f64,
    elevation_end: f64,
    elevation_step: f64,
) -> PyResult<Vec<PyProjectionResult>> {
    let mut results = Vec::new();

    // Generate azimuth angles
    let mut az = azimuth_start;
    while az <= azimuth_end + 1e-10 {
        // Generate elevation angles
        let mut el = elevation_start;
        while el <= elevation_end + 1e-10 {
            // Skip redundant projections at poles (like Matlab does)
            // At elevation 90° or -90°, all azimuths give the same view
            if (el.abs() - 90.0).abs() < 1e-10 && az > azimuth_start + 1e-10 {
                el += elevation_step;
                continue;
            }

            let result = project_to_2d(
                py,
                coordinates.clone(),
                radii.clone(),
                az,
                el,
            )?;
            results.push(result);

            el += elevation_step;
        }
        az += azimuth_step;
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_view_matrix_identity() {
        // At az=0, el=0, looking from +X direction
        let mat = build_view_matrix(0.0, 0.0);

        // Check that a point on X axis projects to origin
        let x = mat[0][0] * 1.0 + mat[0][1] * 0.0 + mat[0][2] * 0.0;
        let y = mat[1][0] * 1.0 + mat[1][1] * 0.0 + mat[1][2] * 0.0;

        assert!((x - 0.0).abs() < 1e-10, "x should be 0, got {}", x);
        assert!((y - 0.0).abs() < 1e-10, "y should be 0, got {}", y);
    }

    #[test]
    fn test_view_matrix_az90() {
        // At az=90°, el=0°, looking from +Y direction
        let mat = build_view_matrix(PI / 2.0, 0.0);

        // A point at (1, 0, 0) should project to x'=-1, y'=0
        let x = mat[0][0] * 1.0 + mat[0][1] * 0.0 + mat[0][2] * 0.0;
        let y = mat[1][0] * 1.0 + mat[1][1] * 0.0 + mat[1][2] * 0.0;

        assert!((x - (-1.0)).abs() < 1e-10, "x should be -1, got {}", x);
        assert!(y.abs() < 1e-10, "y should be 0, got {}", y);
    }

    #[test]
    fn test_view_matrix_el90() {
        // At az=0°, el=90°, looking from +Z direction (top view)
        let mat = build_view_matrix(0.0, PI / 2.0);

        // A point at (1, 0, 0) should project based on top view
        let x = mat[0][0] * 1.0 + mat[0][1] * 0.0 + mat[0][2] * 0.0;
        let y = mat[1][0] * 1.0 + mat[1][1] * 0.0 + mat[1][2] * 0.0;

        // From top, X maps to -X in view, Y maps to -Y in view
        assert!((x - 0.0).abs() < 1e-10, "x should be 0, got {}", x);
        assert!((y - (-1.0)).abs() < 1e-10, "y should be -1, got {}", y);
    }
}
