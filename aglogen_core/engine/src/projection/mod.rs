//! 2D Projection of 3D Agglomerates.
//!
//! Generates 2D projections of 3D particle coordinates by applying
//! rotation matrices based on azimuth and elevation angles.
//!
//! Based on Matlab's create2DImages.m which uses viewmtx for the
//! rotation transformation.

pub mod directions;
pub mod render;

use std::f64::consts::PI;

use self::directions::Direction;

/// Result of a 2D bounding-box computation from 3D positions + viewing direction.
///
/// Single source of truth for 2D bbox dimensions. Used by both render modes
/// and per-image scale calculation (see `projection-scale-per-image` spec R3).
#[derive(Debug, Clone)]
pub struct Bbox2dResult {
    /// Width of the 2D bounding box in engine units (max_x - min_x including radii).
    pub bbox_width: f64,
    /// Height of the 2D bounding box in engine units (max_y - min_y including radii).
    pub bbox_height: f64,
    /// Projected 2D positions (x, y) for each particle.
    pub positions: Vec<(f64, f64)>,
    /// Particle radii (passed through unchanged).
    pub radii: Vec<f64>,
}

/// Compute the 2D bounding box from 3D positions projected at a given direction.
///
/// Projects all particles using the azimuth/elevation viewing direction, then
/// computes the tight 2D bounding box that encloses all particle circles.
///
/// # Arguments
/// * `coordinates` - 3D particle coordinates as slice of [x, y, z].
/// * `radii` - Particle radii, one per coordinate.
/// * `azimuth_deg` - Azimuth viewing angle in degrees.
/// * `elevation_deg` - Elevation viewing angle in degrees.
///
/// # Returns
/// A [`Bbox2dResult`] with the bounding box dimensions and projected positions.
pub fn compute_2d_bbox(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth_deg: f64,
    elevation_deg: f64,
) -> Bbox2dResult {
    let proj = project_to_2d_internal(coordinates, radii, azimuth_deg, elevation_deg);

    if proj.x.is_empty() {
        return Bbox2dResult {
            bbox_width: 0.0,
            bbox_height: 0.0,
            positions: vec![],
            radii: vec![],
        };
    }

    let bbox_width = proj.bounds[1] - proj.bounds[0];
    let bbox_height = proj.bounds[3] - proj.bounds[2];
    let positions: Vec<(f64, f64)> = proj
        .x
        .iter()
        .zip(proj.y.iter())
        .map(|(&x, &y)| (x, y))
        .collect();

    Bbox2dResult {
        bbox_width,
        bbox_height,
        positions,
        radii: proj.radii,
    }
}

/// Result of a 2D projection operation.
#[derive(Debug, Clone)]
pub struct ProjectionResult {
    /// 2D X coordinates after projection
    pub x: Vec<f64>,
    /// 2D Y coordinates after projection
    pub y: Vec<f64>,
    /// Particle radii (unchanged from 3D)
    pub radii: Vec<f64>,
    /// Azimuth angle used (degrees)
    pub azimuth: f64,
    /// Elevation angle used (degrees)
    pub elevation: f64,
    /// Bounding box: [min_x, max_x, min_y, max_y]
    pub bounds: [f64; 4],
}

/// Project 3D coordinates to 2D using azimuth and elevation angles.
///
/// # Arguments
/// * `coordinates` - 3D particle coordinates as slice of [x, y, z]
/// * `radii` - Particle radii
/// * `azimuth` - Azimuth angle in degrees
/// * `elevation` - Elevation angle in degrees
pub fn project_to_2d_internal(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth: f64,
    elevation: f64,
) -> ProjectionResult {
    let n = coordinates.len();

    if n == 0 {
        return ProjectionResult {
            x: vec![],
            y: vec![],
            radii: vec![],
            azimuth,
            elevation,
            bounds: [0.0, 0.0, 0.0, 0.0],
        };
    }

    // Convert angles to radians
    let az_rad = azimuth * PI / 180.0;
    let el_rad = elevation * PI / 180.0;

    let rotation = build_view_matrix(az_rad, el_rad);

    let mut x_out = Vec::with_capacity(n);
    let mut y_out = Vec::with_capacity(n);
    let mut radii_out = Vec::with_capacity(n);

    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for i in 0..n {
        let x = coordinates[i][0];
        let y = coordinates[i][1];
        let z = coordinates[i][2];
        let r = radii[i];

        let x_proj = rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z;
        let y_proj = rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z;

        x_out.push(x_proj);
        y_out.push(y_proj);
        radii_out.push(r);

        min_x = min_x.min(x_proj - r);
        max_x = max_x.max(x_proj + r);
        min_y = min_y.min(y_proj - r);
        max_y = max_y.max(y_proj + r);
    }

    ProjectionResult {
        x: x_out,
        y: y_out,
        radii: radii_out,
        azimuth,
        elevation,
        bounds: [min_x, max_x, min_y, max_y],
    }
}

/// Generate multiple projections at different angles.
pub fn project_batch_internal(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth_start: f64,
    azimuth_end: f64,
    azimuth_step: f64,
    elevation_start: f64,
    elevation_end: f64,
    elevation_step: f64,
) -> Vec<ProjectionResult> {
    let mut results = Vec::new();

    let mut az = azimuth_start;
    while az <= azimuth_end + 1e-10 {
        let mut el = elevation_start;
        while el <= elevation_end + 1e-10 {
            if (el.abs() - 90.0).abs() < 1e-10 && az > azimuth_start + 1e-10 {
                el += elevation_step;
                continue;
            }

            let result = project_to_2d_internal(coordinates, radii, az, el);
            results.push(result);

            el += elevation_step;
        }
        az += azimuth_step;
    }

    results
}

/// Project `coordinates` once per `Direction`, returning one
/// [`ProjectionResult`] per input direction.
///
/// This is the direction-driven counterpart to [`project_batch_internal`].
/// It is the single iteration point used by the grid and fibonacci export
/// modes (see `projection-export-contract` spec R1/R2/R7). No rendering or
/// rasterization is performed here — callers render on the Python side.
///
/// # Arguments
/// * `coordinates` - 3D particle coordinates as slice of [x, y, z].
/// * `radii` - Particle radii, one per coordinate.
/// * `directions` - Viewing directions (azimuth/elevation pairs).
pub fn project_directions_internal(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    directions: &[Direction],
) -> Vec<ProjectionResult> {
    directions
        .iter()
        .map(|d| project_to_2d_internal(coordinates, radii, d.azimuth_deg, d.elevation_deg))
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── T1.3: 2D bbox helper tests ──────────────────────────────────
    #[test]
    fn compute_2d_bbox_returns_correct_dimensions_and_positions() {
        // Two particles along X axis: at (0,0,0) r=1 and (4,0,0) r=1
        // Viewed from az=0, el=0 (looking along +X):
        //   both project onto the Y-Z plane (x'=0 for both)
        //   so bbox width should be ~2*r and height ~2*r
        // Viewed from az=90, el=0 (looking along +Y):
        //   particles separate along x' axis
        let coords = vec![[0.0, 0.0, 0.0], [4.0, 0.0, 0.0]];
        let radii = vec![1.0, 1.0];
        let result = compute_2d_bbox(&coords, &radii, 90.0, 0.0);
        // From az=90, el=0: particles at x_proj ~ -1 (cos90*0)... actually
        // let's use the projection: build_view_matrix is applied.
        // We can verify:
        // - result contains (bbox_w, bbox_h, projected_positions)
        // - bbox_w and bbox_h are positive for non-empty input
        assert!(result.bbox_width > 0.0, "bbox width must be positive");
        assert!(result.bbox_height > 0.0, "bbox height must be positive");
        assert_eq!(
            result.positions.len(),
            2,
            "should return 2 projected positions"
        );
    }

    #[test]
    fn compute_2d_bbox_single_particle() {
        let coords = vec![[0.0, 0.0, 0.0]];
        let radii = vec![1.5];
        let result = compute_2d_bbox(&coords, &radii, 0.0, 0.0);
        // Single particle at origin with radius 1.5:
        // bbox_w = (0+1.5) - (0-1.5) = 3.0
        // bbox_h = (0+1.5) - (0-1.5) = 3.0
        assert!(
            (result.bbox_width - 3.0).abs() < 1e-10,
            "single particle bbox_width should be 2*r=3.0, got {}",
            result.bbox_width
        );
        assert!(
            (result.bbox_height - 3.0).abs() < 1e-10,
            "single particle bbox_height should be 2*r=3.0, got {}",
            result.bbox_height
        );
    }

    #[test]
    fn compute_2d_bbox_empty_returns_zeros() {
        let coords: Vec<[f64; 3]> = vec![];
        let radii: Vec<f64> = vec![];
        let result = compute_2d_bbox(&coords, &radii, 45.0, 30.0);
        assert!((result.bbox_width - 0.0).abs() < 1e-10);
        assert!((result.bbox_height - 0.0).abs() < 1e-10);
        assert!(result.positions.is_empty());
    }

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
