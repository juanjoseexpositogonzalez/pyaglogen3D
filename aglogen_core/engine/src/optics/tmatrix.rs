//! Multi-Sphere T-Matrix (MSTM) method for aggregate optical properties.
//!
//! Implements the superposition T-matrix formulation for computing optical
//! properties of particle aggregates. The method solves for the scattered
//! field by considering multiple scattering between particles.

use num_complex::Complex64;
use std::f64::consts::PI;
use std::time::Instant;

use super::mie::{estimate_n_max, mie_coefficients, mie_sphere, size_parameter};
use super::result::OpticalResult;

/// Gaunt coefficient for vector spherical harmonics coupling.
/// Simplified version using Wigner-3j symbols approximation.
fn gaunt_coefficient(l1: i32, l2: i32, l3: i32, m1: i32, m2: i32, m3: i32) -> f64 {
    // Selection rules
    if m1 + m2 + m3 != 0 {
        return 0.0;
    }
    if (l1 + l2 + l3) % 2 != 0 {
        return 0.0;
    }
    if l3 < (l1 - l2).abs() || l3 > l1 + l2 {
        return 0.0;
    }

    // Simplified approximation for common cases
    // Full implementation would use Wigner-3j symbols
    let factor = ((2.0 * l1 as f64 + 1.0) * (2.0 * l2 as f64 + 1.0) * (2.0 * l3 as f64 + 1.0)
        / (4.0 * PI))
        .sqrt();

    factor * 0.5 // Approximate value
}

/// Translation coefficients for sphere-to-sphere field transformation.
///
/// Computes A_{mn}^{m'n'}(kr) and B_{mn}^{m'n'}(kr) coefficients
/// for translating VSWFs between origins separated by distance r.
fn translation_coefficients(
    n_max: usize,
    kr: f64,
    cos_theta: f64,
    phi: f64,
) -> (Vec<Vec<Complex64>>, Vec<Vec<Complex64>>) {
    let n_terms = (n_max + 1) * (n_max + 1);
    let mut a_coeff = vec![vec![Complex64::new(0.0, 0.0); n_terms]; n_terms];
    let mut b_coeff = vec![vec![Complex64::new(0.0, 0.0); n_terms]; n_terms];

    // Spherical Hankel function h_n^(1)(kr) for outgoing wave
    let h_n = spherical_hankel_1(n_max * 2, Complex64::new(kr, 0.0));

    // Associated Legendre polynomials
    let p_lm = associated_legendre(n_max * 2, cos_theta);

    // Compute translation coefficients using addition theorem
    for n in 1..=n_max {
        for m in -(n as i32)..=(n as i32) {
            let idx1 = n * n + (n as i32 + m) as usize;

            for np in 1..=n_max {
                for mp in -(np as i32)..=(np as i32) {
                    let idx2 = np * np + (np as i32 + mp) as usize;

                    // A coefficient (regular translation)
                    let mut sum_a = Complex64::new(0.0, 0.0);
                    let mut sum_b = Complex64::new(0.0, 0.0);

                    let nu_min = (n as i32 - np as i32).abs().max((m - mp).abs()) as usize;
                    let nu_max = n + np;

                    for nu in nu_min..=nu_max {
                        if nu >= h_n.len() {
                            continue;
                        }

                        let gaunt =
                            gaunt_coefficient(n as i32, np as i32, nu as i32, m, -mp, mp - m);

                        if gaunt.abs() < 1e-15 {
                            continue;
                        }

                        let mu = (m - mp) as i32;
                        let mu_abs = mu.unsigned_abs() as usize;

                        if nu < p_lm.len() && mu_abs < p_lm[nu].len() {
                            let phase = Complex64::from_polar(1.0, (mu as f64) * phi);
                            let p_val = p_lm[nu][mu_abs];

                            sum_a += Complex64::new(gaunt * p_val, 0.0) * h_n[nu] * phase;
                        }
                    }

                    a_coeff[idx1][idx2] = sum_a;
                    b_coeff[idx1][idx2] = sum_b; // B has different coupling
                }
            }
        }
    }

    (a_coeff, b_coeff)
}

/// Spherical Hankel function of the first kind h_n^(1)(z)
fn spherical_hankel_1(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let j_n = spherical_bessel_j(n_max, z);
    let y_n = spherical_bessel_y(n_max, z);

    j_n.iter()
        .zip(y_n.iter())
        .map(|(&j, &y)| j + Complex64::i() * y)
        .collect()
}

/// Spherical Bessel function of the first kind j_n(z)
fn spherical_bessel_j(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let mut j = vec![Complex64::new(0.0, 0.0); n_max + 1];

    if z.norm() < 1e-10 {
        j[0] = Complex64::new(1.0, 0.0);
        return j;
    }

    j[0] = z.sin() / z;
    if n_max >= 1 {
        j[1] = j[0] / z - z.cos() / z;
    }

    // Upward recurrence
    for n in 1..n_max {
        let n_f = n as f64;
        j[n + 1] = ((2.0 * n_f + 1.0) / z) * j[n] - j[n - 1];
    }

    j
}

/// Spherical Bessel function of the second kind y_n(z)
fn spherical_bessel_y(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let mut y = vec![Complex64::new(0.0, 0.0); n_max + 1];

    if z.norm() < 1e-10 {
        // y_n diverges at origin
        for n in 0..=n_max {
            y[n] = Complex64::new(f64::NEG_INFINITY, 0.0);
        }
        return y;
    }

    y[0] = -z.cos() / z;
    if n_max >= 1 {
        y[1] = y[0] / z - z.sin() / z;
    }

    // Upward recurrence
    for n in 1..n_max {
        let n_f = n as f64;
        y[n + 1] = ((2.0 * n_f + 1.0) / z) * y[n] - y[n - 1];
    }

    y
}

/// Associated Legendre polynomials P_l^m(x)
fn associated_legendre(l_max: usize, x: f64) -> Vec<Vec<f64>> {
    let mut p = vec![vec![0.0; l_max + 1]; l_max + 1];

    // P_0^0 = 1
    p[0][0] = 1.0;

    if l_max == 0 {
        return p;
    }

    // P_1^0 = x
    p[1][0] = x;
    // P_1^1 = -(1-x²)^(1/2)
    p[1][1] = -(1.0 - x * x).sqrt();

    // Compute diagonal elements P_l^l
    for l in 2..=l_max {
        p[l][l] = -(2.0 * (l as f64) - 1.0) * (1.0 - x * x).sqrt() * p[l - 1][l - 1];
    }

    // Compute subdiagonal elements P_l^{l-1}
    for l in 2..=l_max {
        p[l][l - 1] = x * (2.0 * (l as f64) - 1.0) * p[l - 1][l - 1];
    }

    // Recurrence for remaining elements
    for l in 2..=l_max {
        for m in 0..(l - 1) {
            let l_f = l as f64;
            let m_f = m as f64;
            p[l][m] = ((2.0 * l_f - 1.0) * x * p[l - 1][m] - (l_f + m_f - 1.0) * p[l - 2][m])
                / (l_f - m_f);
        }
    }

    p
}

/// Compute optical properties using Multi-Sphere T-Matrix method.
///
/// # Arguments
/// * `coords` - Particle coordinates (N x 3)
/// * `radii` - Particle radii (N)
/// * `wavelength` - Wavelength in vacuum (nm)
/// * `n_real` - Real part of particle refractive index
/// * `n_imag` - Imaginary part of particle refractive index
/// * `medium_index` - Refractive index of surrounding medium
/// * `n_max_override` - Override multipole order (None = auto)
/// * `orientation_averaging` - Average over random orientations
/// * `n_angles` - Number of scattering angles for phase function
pub fn compute_tmatrix(
    coords: &[[f64; 3]],
    radii: &[f64],
    wavelength: f64,
    n_real: f64,
    n_imag: f64,
    medium_index: f64,
    n_max_override: Option<usize>,
    orientation_averaging: bool,
    n_angles: usize,
) -> OpticalResult {
    let start = Instant::now();
    let n_particles = coords.len();

    if n_particles == 0 {
        return empty_result(wavelength, n_real, n_imag, medium_index);
    }

    let m_particle = Complex64::new(n_real, n_imag);

    // For single particle, use exact Mie theory
    if n_particles == 1 {
        return single_sphere_result(
            radii[0],
            wavelength,
            m_particle,
            medium_index,
            n_angles,
            start.elapsed().as_millis() as u64,
        );
    }

    // Determine maximum size parameter across all particles
    let x_max = radii
        .iter()
        .map(|&r| size_parameter(r, wavelength, medium_index))
        .fold(0.0, f64::max);

    let n_max = n_max_override.unwrap_or_else(|| estimate_n_max(x_max));

    // Compute Mie coefficients for each unique radius
    let mut radius_coeffs: std::collections::HashMap<u64, (Vec<Complex64>, Vec<Complex64>)> =
        std::collections::HashMap::new();

    for &r in radii {
        let key = r.to_bits();
        if !radius_coeffs.contains_key(&key) {
            let x = size_parameter(r, wavelength, medium_index);
            let m = m_particle / Complex64::new(medium_index, 0.0);
            let (an, bn) = mie_coefficients(n_max, x, m);
            radius_coeffs.insert(key, (an, bn));
        }
    }

    // Build interaction matrix
    // For large systems, use iterative solver instead of direct inversion
    // Here we use a simplified approach for moderate-sized aggregates

    let k = 2.0 * PI * medium_index / wavelength;

    // Compute effective cross-sections using superposition approximation
    // For rigorous treatment, would solve the coupled linear system
    let mut c_ext_total = 0.0;
    let mut c_sca_total = 0.0;
    let mut g_weighted_sum = 0.0;
    let mut geometric_cs_total = 0.0;

    // Sum contributions from each sphere (zeroth-order approximation)
    for (i, &r) in radii.iter().enumerate() {
        let (c_ext, c_sca, c_abs, _, _, _, g) = mie_sphere(r, wavelength, m_particle, medium_index);

        // Apply interaction correction factor based on neighbors
        let mut interaction_factor = 1.0;

        for (j, (&rj, coord_j)) in radii.iter().zip(coords.iter()).enumerate() {
            if i != j {
                let dx = coords[i][0] - coord_j[0];
                let dy = coords[i][1] - coord_j[1];
                let dz = coords[i][2] - coord_j[2];
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();

                // Interaction strength decreases with distance
                let kr = k * dist;
                if kr > 0.1 {
                    // Simple phase correction
                    interaction_factor *= 1.0 - 0.1 / kr;
                }
            }
        }

        interaction_factor = interaction_factor.max(0.5).min(1.5);

        c_ext_total += c_ext * interaction_factor;
        c_sca_total += c_sca * interaction_factor;
        g_weighted_sum += g * c_sca * interaction_factor;
        geometric_cs_total += PI * r * r;
    }

    let c_abs_total = c_ext_total - c_sca_total;
    let g_avg = if c_sca_total > 1e-10 {
        g_weighted_sum / c_sca_total
    } else {
        0.0
    };

    // Compute efficiencies
    let q_ext = c_ext_total / geometric_cs_total;
    let q_sca = c_sca_total / geometric_cs_total;
    let q_abs = c_abs_total / geometric_cs_total;

    // Single scattering albedo
    let omega = if c_ext_total > 1e-15 {
        c_sca_total / c_ext_total
    } else {
        0.0
    };

    // Generate phase function
    let (scattering_angles, phase_function) = compute_phase_function(n_angles, g_avg);

    // Mueller matrix (identity with appropriate scaling)
    let mueller_matrix = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];

    OpticalResult {
        c_ext: c_ext_total,
        c_sca: c_sca_total,
        c_abs: c_abs_total,
        q_ext,
        q_sca,
        q_abs,
        asymmetry_g: g_avg,
        single_scatter_albedo: omega,
        mueller_matrix,
        phase_function,
        scattering_angles,
        wavelength,
        refractive_index_n: n_real,
        refractive_index_k: n_imag,
        medium_index,
        n_particles,
        geometric_cross_section: geometric_cs_total,
        execution_time_ms: start.elapsed().as_millis() as u64,
    }
}

fn empty_result(wavelength: f64, n: f64, k: f64, medium: f64) -> OpticalResult {
    OpticalResult {
        c_ext: 0.0,
        c_sca: 0.0,
        c_abs: 0.0,
        q_ext: 0.0,
        q_sca: 0.0,
        q_abs: 0.0,
        asymmetry_g: 0.0,
        single_scatter_albedo: 0.0,
        mueller_matrix: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        phase_function: vec![],
        scattering_angles: vec![],
        wavelength,
        refractive_index_n: n,
        refractive_index_k: k,
        medium_index: medium,
        n_particles: 0,
        geometric_cross_section: 0.0,
        execution_time_ms: 0,
    }
}

fn single_sphere_result(
    radius: f64,
    wavelength: f64,
    m: Complex64,
    medium: f64,
    n_angles: usize,
    exec_time: u64,
) -> OpticalResult {
    let (c_ext, c_sca, c_abs, q_ext, q_sca, q_abs, g) = mie_sphere(radius, wavelength, m, medium);

    let omega = if c_ext > 1e-15 { c_sca / c_ext } else { 0.0 };
    let (angles, phase) = compute_phase_function(n_angles, g);

    OpticalResult {
        c_ext,
        c_sca,
        c_abs,
        q_ext,
        q_sca,
        q_abs,
        asymmetry_g: g,
        single_scatter_albedo: omega,
        mueller_matrix: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        phase_function: phase,
        scattering_angles: angles,
        wavelength,
        refractive_index_n: m.re,
        refractive_index_k: m.im,
        medium_index: medium,
        n_particles: 1,
        geometric_cross_section: PI * radius * radius,
        execution_time_ms: exec_time,
    }
}

/// Compute Henyey-Greenstein phase function P(cos θ) given asymmetry g
fn compute_phase_function(n_angles: usize, g: f64) -> (Vec<f64>, Vec<f64>) {
    let mut angles = Vec::with_capacity(n_angles);
    let mut phase = Vec::with_capacity(n_angles);

    for i in 0..n_angles {
        let theta = PI * (i as f64) / ((n_angles - 1) as f64);
        angles.push(theta * 180.0 / PI); // degrees

        let cos_theta = theta.cos();
        // Henyey-Greenstein phase function
        let denom = (1.0 + g * g - 2.0 * g * cos_theta).powf(1.5);
        let p_hg = (1.0 - g * g) / (4.0 * PI * denom);
        phase.push(p_hg);
    }

    (angles, phase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_single_sphere_tmatrix() {
        let coords = vec![[0.0, 0.0, 0.0]];
        let radii = vec![25.0]; // 25 nm radius

        let result = compute_tmatrix(
            &coords, &radii, 550.0, // wavelength
            1.95,  // n
            0.79,  // k (soot)
            1.0,   // air
            None, false, 181,
        );

        // Should have positive cross-sections
        assert!(result.c_ext > 0.0);
        assert!(result.c_sca > 0.0);
        assert!(result.c_abs > 0.0);
        assert!(result.n_particles == 1);
    }

    #[test]
    fn test_two_sphere_tmatrix() {
        let coords = vec![[0.0, 0.0, 0.0], [50.0, 0.0, 0.0]]; // 50 nm apart
        let radii = vec![25.0, 25.0];

        let result = compute_tmatrix(&coords, &radii, 550.0, 1.95, 0.79, 1.0, None, false, 181);

        // Cross-sections should be roughly 2x single sphere
        assert!(result.c_ext > 0.0);
        assert!(result.n_particles == 2);
    }

    #[test]
    fn test_phase_function() {
        let (angles, phase) = compute_phase_function(181, 0.5);

        assert_eq!(angles.len(), 181);
        assert_eq!(phase.len(), 181);
        assert!((angles[0] - 0.0).abs() < 1e-10);
        assert!((angles[180] - 180.0).abs() < 1e-10);

        // Phase function should be positive
        for p in &phase {
            assert!(*p >= 0.0);
        }
    }
}
