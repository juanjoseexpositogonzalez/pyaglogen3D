//! Agglomerate metrics calculation.

use crate::common::geometry::Vector3;
use nalgebra::{Matrix3, SymmetricEigen};

/// Results from inertia tensor analysis.
#[derive(Debug, Clone)]
pub struct InertiaTensorResult {
    /// Principal moments of inertia (sorted: I1 <= I2 <= I3)
    pub principal_moments: [f64; 3],
    /// Principal axes (eigenvectors), each column is an axis
    pub principal_axes: [[f64; 3]; 3],
    /// Anisotropy factor: I_max / I_min
    pub anisotropy: f64,
    /// Asphericity: I3 - 0.5*(I1 + I2), normalized
    pub asphericity: f64,
    /// Acylindricity: I2 - I1, normalized
    pub acylindricity: f64,
}

/// Calculate center of gravity of particles (mass-weighted).
pub fn calculate_center_of_gravity(coordinates: &[[f64; 3]], radii: &[f64]) -> Vector3 {
    let mut total_mass = 0.0;
    let mut cg = Vector3::zero();

    for (coord, &r) in coordinates.iter().zip(radii.iter()) {
        let mass = r * r * r; // Proportional to volume
        cg = cg + Vector3::new(coord[0], coord[1], coord[2]) * mass;
        total_mass += mass;
    }

    if total_mass > 0.0 {
        cg * (1.0 / total_mass)
    } else {
        Vector3::zero()
    }
}

/// Calculate radius of gyration.
/// Rg = sqrt(Ip / mp) where:
/// - Ip = sum[(3/5 * r_i^5) + (r_i^3 * d_i^2)]
/// - mp = sum(r_i^3)
/// - d_i = distance from particle center to center of gravity
pub fn calculate_radius_of_gyration(coordinates: &[[f64; 3]], radii: &[f64]) -> f64 {
    if coordinates.is_empty() {
        return 0.0;
    }

    let cg = calculate_center_of_gravity(coordinates, radii);

    let mut ip = 0.0;
    let mut mp = 0.0;

    for (coord, &r) in coordinates.iter().zip(radii.iter()) {
        let pos = Vector3::new(coord[0], coord[1], coord[2]);
        let d = pos.distance_to(&cg);
        let r3 = r * r * r;
        let r5 = r3 * r * r;

        ip += (3.0 / 5.0) * r5 + r3 * d * d;
        mp += r3;
    }

    if mp > 0.0 {
        (ip / mp).sqrt()
    } else {
        0.0
    }
}

/// Calculate fractal dimension from Rg vs N data using log-log regression.
/// Returns (Df, kf, R2)
pub fn calculate_fractal_dimension(n_values: &[usize], rg_values: &[f64]) -> (f64, f64, f64) {
    if n_values.len() < 3 || n_values.len() != rg_values.len() {
        return (2.0, 1.0, 0.0);
    }

    // Filter valid data points (N > 1, Rg > 0)
    let data: Vec<(f64, f64)> = n_values
        .iter()
        .zip(rg_values.iter())
        .filter(|(&n, &rg)| n > 1 && rg > 0.0)
        .map(|(&n, &rg)| ((n as f64).ln(), rg.ln()))
        .collect();

    if data.len() < 3 {
        return (2.0, 1.0, 0.0);
    }

    // Linear regression on log-log data
    let n = data.len() as f64;
    let sum_x: f64 = data.iter().map(|(x, _)| x).sum();
    let sum_y: f64 = data.iter().map(|(_, y)| y).sum();
    let sum_xx: f64 = data.iter().map(|(x, _)| x * x).sum();
    let sum_xy: f64 = data.iter().map(|(x, y)| x * y).sum();

    let slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
    let intercept = (sum_y - slope * sum_x) / n;

    // Df = 1/slope (from N ~ Rg^Df, so log(N) ~ Df * log(Rg))
    // Actually: Rg ~ N^(1/Df), so log(Rg) ~ (1/Df) * log(N)
    // slope = 1/Df, so Df = 1/slope
    let df = if slope.abs() > 0.01 { 1.0 / slope } else { 2.0 };

    // kf from intercept: log(Rg) = intercept + slope*log(N)
    // Rg = exp(intercept) * N^slope = kf^(1/Df) * N^(1/Df)
    // So kf = exp(intercept * Df)
    let kf = (intercept * df).exp();

    // R-squared
    let mean_y = sum_y / n;
    let ss_tot: f64 = data.iter().map(|(_, y)| (y - mean_y).powi(2)).sum();
    let ss_res: f64 = data
        .iter()
        .map(|(x, y)| {
            let y_pred = intercept + slope * x;
            (y - y_pred).powi(2)
        })
        .sum();

    let r2 = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };

    (df.max(1.0).min(3.0), kf.max(0.1), r2)
}

/// Calculate coordination number (number of neighbors) for each particle.
pub fn calculate_coordination(coordinates: &[[f64; 3]], radii: &[f64], tolerance: f64) -> Vec<u32> {
    let n = coordinates.len();
    let mut coordination = vec![0u32; n];

    for i in 0..n {
        for j in (i + 1)..n {
            let dx = coordinates[i][0] - coordinates[j][0];
            let dy = coordinates[i][1] - coordinates[j][1];
            let dz = coordinates[i][2] - coordinates[j][2];
            let dist = (dx * dx + dy * dy + dz * dz).sqrt();
            let contact_dist = radii[i] + radii[j];

            if (dist - contact_dist).abs() <= tolerance {
                coordination[i] += 1;
                coordination[j] += 1;
            }
        }
    }

    coordination
}

/// Calculate porosity of agglomerate within bounding box.
pub fn calculate_porosity(coordinates: &[[f64; 3]], radii: &[f64]) -> f64 {
    use std::f64::consts::PI;

    if coordinates.is_empty() {
        return 1.0;
    }

    // Calculate total particle volume
    let particle_volume: f64 = radii.iter().map(|&r| (4.0 / 3.0) * PI * r * r * r).sum();

    // Calculate bounding sphere volume (using Rg as approximation)
    let rg = calculate_radius_of_gyration(coordinates, radii);
    // Use 2*Rg as effective radius
    let bounding_volume = (4.0 / 3.0) * PI * (2.0 * rg).powi(3);

    if bounding_volume > 0.0 {
        1.0 - (particle_volume / bounding_volume).min(1.0)
    } else {
        1.0
    }
}

/// Calculate the inertia tensor and its principal components.
///
/// The inertia tensor I is calculated as:
/// I = Σ mᵢ [(rᵢ·rᵢ)I₃ - rᵢ⊗rᵢ]
///
/// where rᵢ is the position vector relative to the center of mass,
/// mᵢ is the mass (proportional to r³), and ⊗ denotes outer product.
///
/// Returns principal moments (eigenvalues) and axes (eigenvectors),
/// plus derived shape descriptors (anisotropy, asphericity, acylindricity).
pub fn calculate_inertia_tensor(coordinates: &[[f64; 3]], radii: &[f64]) -> InertiaTensorResult {
    // Default result for empty or single-particle cases
    let default_result = InertiaTensorResult {
        principal_moments: [1.0, 1.0, 1.0],
        principal_axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        anisotropy: 1.0,
        asphericity: 0.0,
        acylindricity: 0.0,
    };

    if coordinates.len() < 2 {
        return default_result;
    }

    // Calculate center of mass
    let cg = calculate_center_of_gravity(coordinates, radii);

    // Build the inertia tensor matrix
    let mut ixx = 0.0;
    let mut iyy = 0.0;
    let mut izz = 0.0;
    let mut ixy = 0.0;
    let mut ixz = 0.0;
    let mut iyz = 0.0;

    for (coord, &r) in coordinates.iter().zip(radii.iter()) {
        // Position relative to center of mass
        let x = coord[0] - cg.x;
        let y = coord[1] - cg.y;
        let z = coord[2] - cg.z;

        // Mass proportional to volume (r³)
        let mass = r * r * r;

        // Diagonal terms: m * (r² - component²)
        // r² = x² + y² + z²
        let r_sq = x * x + y * y + z * z;

        ixx += mass * (r_sq - x * x); // m * (y² + z²)
        iyy += mass * (r_sq - y * y); // m * (x² + z²)
        izz += mass * (r_sq - z * z); // m * (x² + y²)

        // Off-diagonal terms (negative of products)
        ixy -= mass * x * y;
        ixz -= mass * x * z;
        iyz -= mass * y * z;
    }

    // Construct symmetric inertia tensor matrix
    let inertia_matrix = Matrix3::new(
        ixx, ixy, ixz,
        ixy, iyy, iyz,
        ixz, iyz, izz,
    );

    // Compute eigendecomposition
    let eigen = SymmetricEigen::new(inertia_matrix);
    let mut eigenvalues: Vec<f64> = eigen.eigenvalues.iter().copied().collect();
    let eigenvectors = eigen.eigenvectors;

    // Sort eigenvalues (and track indices for eigenvectors)
    let mut indices: Vec<usize> = (0..3).collect();
    indices.sort_by(|&a, &b| eigenvalues[a].partial_cmp(&eigenvalues[b]).unwrap());

    let sorted_eigenvalues = [
        eigenvalues[indices[0]].max(1e-10), // Avoid zero/negative
        eigenvalues[indices[1]].max(1e-10),
        eigenvalues[indices[2]].max(1e-10),
    ];

    // Extract sorted eigenvectors (principal axes)
    let mut principal_axes = [[0.0; 3]; 3];
    for (i, &idx) in indices.iter().enumerate() {
        principal_axes[i] = [
            eigenvectors[(0, idx)],
            eigenvectors[(1, idx)],
            eigenvectors[(2, idx)],
        ];
    }

    // Calculate shape descriptors
    let i1 = sorted_eigenvalues[0];
    let i2 = sorted_eigenvalues[1];
    let i3 = sorted_eigenvalues[2];

    // Anisotropy: ratio of max to min principal moments
    let anisotropy = i3 / i1;

    // For asphericity and acylindricity, normalize by trace
    let trace = i1 + i2 + i3;

    // Asphericity: deviation from spherical symmetry
    // b = I3 - 0.5*(I1 + I2), normalized
    let asphericity = if trace > 0.0 {
        (i3 - 0.5 * (i1 + i2)) / trace
    } else {
        0.0
    };

    // Acylindricity: deviation from cylindrical symmetry
    // c = I2 - I1, normalized
    let acylindricity = if trace > 0.0 {
        (i2 - i1) / trace
    } else {
        0.0
    };

    InertiaTensorResult {
        principal_moments: sorted_eigenvalues,
        principal_axes,
        anisotropy,
        asphericity,
        acylindricity,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_center_of_gravity() {
        let coords = vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
        let radii = vec![1.0, 1.0];

        let cg = calculate_center_of_gravity(&coords, &radii);
        assert!((cg.x - 1.0).abs() < 1e-10);
        assert!((cg.y - 0.0).abs() < 1e-10);
        assert!((cg.z - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_radius_of_gyration() {
        // Single particle at origin
        let coords = vec![[0.0, 0.0, 0.0]];
        let radii = vec![1.0];

        let rg = calculate_radius_of_gyration(&coords, &radii);
        // Rg = sqrt(3/5) * r for single sphere
        let expected = (3.0 / 5.0_f64).sqrt();
        assert!((rg - expected).abs() < 1e-10);
    }

    #[test]
    fn test_inertia_tensor_symmetric() {
        // Symmetric distribution: 6 particles at unit distance along each axis
        let coords = vec![
            [1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, -1.0],
        ];
        let radii = vec![0.5; 6];

        let result = calculate_inertia_tensor(&coords, &radii);

        // For symmetric distribution, anisotropy should be close to 1
        assert!((result.anisotropy - 1.0).abs() < 0.1);
        // Asphericity should be near 0
        assert!(result.asphericity.abs() < 0.1);
    }

    #[test]
    fn test_inertia_tensor_elongated() {
        // Chain-like: particles along X axis
        let coords = vec![
            [0.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [6.0, 0.0, 0.0],
            [8.0, 0.0, 0.0],
        ];
        let radii = vec![1.0; 5];

        let result = calculate_inertia_tensor(&coords, &radii);

        // Elongated structure should have high anisotropy
        assert!(result.anisotropy > 1.5);
        // High asphericity for chain-like structure
        assert!(result.asphericity > 0.1);
    }
}
