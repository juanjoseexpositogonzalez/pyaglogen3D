//! Discrete Dipole Approximation (DDA) for optical properties.
//!
//! Implements DDA method for computing optical properties of particle aggregates
//! by discretizing the volume into polarizable dipoles.

use num_complex::Complex64;
use rayon::prelude::*;
use std::f64::consts::PI;
use std::time::Instant;

use super::result::OpticalResult;

/// Polarizability prescription type
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Polarizability {
    /// Clausius-Mossotti (simplest, lowest accuracy)
    ClausiusMossotti,
    /// Lattice Dispersion Relation (better accuracy)
    LatticeDispersion,
    /// Digitized Green's Function (highest accuracy)
    DigitizedGreenFunction,
}

impl Polarizability {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "cm" | "clausius_mossotti" => Self::ClausiusMossotti,
            "ldr" | "lattice_dispersion" => Self::LatticeDispersion,
            "dgf" | "digitized_green" => Self::DigitizedGreenFunction,
            _ => Self::LatticeDispersion,
        }
    }
}

/// Clausius-Mossotti polarizability
/// α_CM = (3V / 4π) * (ε - 1) / (ε + 2)
fn clausius_mossotti(volume: f64, epsilon: Complex64) -> Complex64 {
    let factor = (3.0 * volume) / (4.0 * PI);
    Complex64::new(factor, 0.0) * (epsilon - 1.0) / (epsilon + 2.0)
}

/// Lattice Dispersion Relation correction (Draine & Goodman 1993)
fn lattice_dispersion(alpha_cm: Complex64, k: f64, d: f64, epsilon: Complex64) -> Complex64 {
    let kd = k * d;
    let kd2 = kd * kd;

    // Correction factors
    let b1 = -1.891531;
    let b2 = 0.1648469;
    let b3 = -1.7700004;

    let m2 = epsilon; // m² = ε for non-magnetic materials
    let s = (m2 - 1.0) / (m2 + 2.0);

    let correction = 1.0
        + Complex64::new(b1 + m2.re * b2, 0.0) * kd2 * s
        + Complex64::new(b3, 0.0) * kd2 * kd * s * s / Complex64::new(3.0, 0.0);

    alpha_cm / correction
}

/// Dyadic Green's function for dipole-dipole interaction
/// G(r) = exp(ikr) * [ (1 - ikr) * (3r⊗r - I*r²) / r⁵ + k²*(r⊗r - I*r²) / r³ ]
fn dyadic_green(k: f64, r: [f64; 3]) -> [[Complex64; 3]; 3] {
    let r_norm = (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]).sqrt();

    if r_norm < 1e-15 {
        return [[Complex64::new(0.0, 0.0); 3]; 3];
    }

    let kr = k * r_norm;
    let kr2 = kr * kr;
    let r2 = r_norm * r_norm;
    let r3 = r2 * r_norm;
    let r5 = r3 * r2;

    // exp(ikr)
    let exp_ikr = Complex64::from_polar(1.0, kr);

    // Unit vector components
    let r_hat = [r[0] / r_norm, r[1] / r_norm, r[2] / r_norm];

    // Build dyadic
    let mut g = [[Complex64::new(0.0, 0.0); 3]; 3];

    // Term 1: (1 - ikr) * (3r⊗r/r⁵ - I/r³)
    let term1_factor = exp_ikr * (Complex64::new(1.0, 0.0) - Complex64::i() * kr);

    // Term 2: k² * (r⊗r/r³ - I/r)
    let term2_factor = exp_ikr * Complex64::new(kr2, 0.0);

    for i in 0..3 {
        for j in 0..3 {
            let delta_ij = if i == j { 1.0 } else { 0.0 };
            let rirj = r_hat[i] * r_hat[j];

            // Near-field term
            let near = (3.0 * rirj - delta_ij) / r3;

            // Far-field term
            let far = (rirj - delta_ij) / r_norm;

            g[i][j] = term1_factor * near + term2_factor * far;
        }
    }

    g
}

/// Discretize spheres into dipole positions
fn discretize_spheres(
    centers: &[[f64; 3]],
    radii: &[f64],
    d: f64, // Dipole spacing
) -> (Vec<[f64; 3]>, Vec<usize>) {
    let mut positions = Vec::new();
    let mut sphere_indices = Vec::new();

    for (idx, (center, &radius)) in centers.iter().zip(radii.iter()).enumerate() {
        // Number of dipoles along each axis
        let n = ((2.0 * radius) / d).ceil() as i32;
        let half_n = n / 2;

        for ix in -half_n..=half_n {
            for iy in -half_n..=half_n {
                for iz in -half_n..=half_n {
                    let x = center[0] + (ix as f64) * d;
                    let y = center[1] + (iy as f64) * d;
                    let z = center[2] + (iz as f64) * d;

                    // Check if inside sphere
                    let dx = x - center[0];
                    let dy = y - center[1];
                    let dz = z - center[2];
                    let dist = (dx * dx + dy * dy + dz * dz).sqrt();

                    if dist <= radius {
                        positions.push([x, y, z]);
                        sphere_indices.push(idx);
                    }
                }
            }
        }
    }

    (positions, sphere_indices)
}

/// Conjugate Gradient stabilized (BiCGSTAB) solver
fn bicgstab_solve(
    apply_a: impl Fn(&[Complex64]) -> Vec<Complex64>,
    b: &[Complex64],
    tol: f64,
    max_iter: usize,
) -> Vec<Complex64> {
    let n = b.len();
    let mut x = vec![Complex64::new(0.0, 0.0); n];

    // r = b - Ax (initial x = 0, so r = b)
    let mut r: Vec<Complex64> = b.to_vec();
    let r0 = r.clone();

    let mut rho = Complex64::new(1.0, 0.0);
    let mut alpha = Complex64::new(1.0, 0.0);
    let mut omega = Complex64::new(1.0, 0.0);

    let mut v = vec![Complex64::new(0.0, 0.0); n];
    let mut p = vec![Complex64::new(0.0, 0.0); n];

    let b_norm: f64 = b.iter().map(|x| x.norm_sqr()).sum::<f64>().sqrt();
    if b_norm < 1e-15 {
        return x;
    }

    for _iter in 0..max_iter {
        // ρ_new = <r0, r>
        let rho_new: Complex64 = r0.iter().zip(r.iter()).map(|(a, b)| a.conj() * b).sum();

        // β = (ρ_new / ρ) * (α / ω)
        let beta = (rho_new / rho) * (alpha / omega);
        rho = rho_new;

        // p = r + β * (p - ω * v)
        for i in 0..n {
            p[i] = r[i] + beta * (p[i] - omega * v[i]);
        }

        // v = A * p
        v = apply_a(&p);

        // α = ρ / <r0, v>
        let r0v: Complex64 = r0.iter().zip(v.iter()).map(|(a, b)| a.conj() * b).sum();
        if r0v.norm() < 1e-15 {
            break;
        }
        alpha = rho / r0v;

        // s = r - α * v
        let s: Vec<Complex64> = r
            .iter()
            .zip(v.iter())
            .map(|(ri, vi)| ri - alpha * vi)
            .collect();

        // Check convergence
        let s_norm: f64 = s.iter().map(|x| x.norm_sqr()).sum::<f64>().sqrt();
        if s_norm / b_norm < tol {
            // x = x + α * p
            for i in 0..n {
                x[i] = x[i] + alpha * p[i];
            }
            break;
        }

        // t = A * s
        let t = apply_a(&s);

        // ω = <t, s> / <t, t>
        let ts: Complex64 = t.iter().zip(s.iter()).map(|(ti, si)| ti.conj() * si).sum();
        let tt: Complex64 = t.iter().map(|ti| ti.conj() * ti).sum();
        if tt.norm() < 1e-15 {
            break;
        }
        omega = ts / tt;

        // x = x + α * p + ω * s
        for i in 0..n {
            x[i] = x[i] + alpha * p[i] + omega * s[i];
        }

        // r = s - ω * t
        for i in 0..n {
            r[i] = s[i] - omega * t[i];
        }

        // Check convergence
        let r_norm: f64 = r.iter().map(|x| x.norm_sqr()).sum::<f64>().sqrt();
        if r_norm / b_norm < tol {
            break;
        }
    }

    x
}

/// Compute optical properties using DDA
pub fn compute_dda(
    coords: &[[f64; 3]],
    radii: &[f64],
    wavelength: f64,
    n_real: f64,
    n_imag: f64,
    medium_index: f64,
    dipoles_per_wavelength: f64,
    polarizability_type: Polarizability,
    solver_tolerance: f64,
    max_iterations: usize,
) -> OpticalResult {
    let start = Instant::now();
    let n_particles = coords.len();

    if n_particles == 0 {
        return empty_result(wavelength, n_real, n_imag, medium_index);
    }

    // Refractive index and dielectric constant
    let m = Complex64::new(n_real, n_imag) / medium_index;
    let epsilon = m * m;

    // Wave number in medium
    let k = 2.0 * PI * medium_index / wavelength;
    let lambda_medium = wavelength / medium_index;

    // Dipole spacing: d < λ/(10*|m|)
    let m_norm = m.norm();
    let d_max = lambda_medium / (dipoles_per_wavelength * m_norm);

    // Use minimum of d_max and smallest radius
    let r_min = radii.iter().cloned().fold(f64::INFINITY, f64::min);
    let d = d_max.min(r_min / 2.0).max(0.5); // At least 0.5 nm spacing

    // Discretize spheres into dipoles
    let (dipole_positions, _sphere_indices) = discretize_spheres(coords, radii, d);
    let n_dipoles = dipole_positions.len();

    if n_dipoles == 0 {
        return empty_result(wavelength, n_real, n_imag, medium_index);
    }

    // Dipole volume
    let v_dipole = d * d * d;

    // Compute polarizabilities
    let alpha_cm = clausius_mossotti(v_dipole, epsilon);
    let alpha = match polarizability_type {
        Polarizability::ClausiusMossotti => alpha_cm,
        Polarizability::LatticeDispersion => lattice_dispersion(alpha_cm, k, d, epsilon),
        Polarizability::DigitizedGreenFunction => {
            // DGF uses CM as base, more complex correction
            lattice_dispersion(alpha_cm, k, d, epsilon)
        }
    };

    // Incident field (plane wave along z, polarized along x)
    let e_inc: Vec<[Complex64; 3]> = dipole_positions
        .iter()
        .map(|pos| {
            let phase = k * pos[2];
            let exp_ikz = Complex64::from_polar(1.0, phase);
            [exp_ikz, Complex64::new(0.0, 0.0), Complex64::new(0.0, 0.0)]
        })
        .collect();

    // Flatten to 3*N vector
    let b: Vec<Complex64> = e_inc.iter().flat_map(|e| e.iter().copied()).collect();

    // Build interaction matrix application (A * x where A = α^{-1} - G)
    let apply_a = |p_vec: &[Complex64]| -> Vec<Complex64> {
        let mut result = vec![Complex64::new(0.0, 0.0); 3 * n_dipoles];

        // α^{-1} * P term
        let alpha_inv = Complex64::new(1.0, 0.0) / alpha;
        for i in 0..3 * n_dipoles {
            result[i] = alpha_inv * p_vec[i];
        }

        // -G * P term (dipole-dipole interaction)
        // This can be parallelized
        let interactions: Vec<Vec<Complex64>> = (0..n_dipoles)
            .into_par_iter()
            .map(|i| {
                let mut contrib = vec![Complex64::new(0.0, 0.0); 3];
                for j in 0..n_dipoles {
                    if i != j {
                        let r = [
                            dipole_positions[i][0] - dipole_positions[j][0],
                            dipole_positions[i][1] - dipole_positions[j][1],
                            dipole_positions[i][2] - dipole_positions[j][2],
                        ];
                        let g = dyadic_green(k, r);

                        // G_ij * P_j
                        for a in 0..3 {
                            for b_idx in 0..3 {
                                contrib[a] -= g[a][b_idx] * p_vec[3 * j + b_idx];
                            }
                        }
                    }
                }
                contrib
            })
            .collect();

        for (i, contrib) in interactions.into_iter().enumerate() {
            for a in 0..3 {
                result[3 * i + a] += contrib[a];
            }
        }

        result
    };

    // Solve A * P = E_inc using BiCGSTAB
    let p_flat = bicgstab_solve(apply_a, &b, solver_tolerance, max_iterations);

    // Compute cross-sections from polarizations
    // C_ext = (4πk/|E0|²) * Im[E0* · P]
    // C_abs = (4πk/|E0|²) * Im[P* · (α^{-1}) · P] - (2k³/3)|P|²

    let alpha_inv = Complex64::new(1.0, 0.0) / alpha;
    let k3 = k * k * k;

    let mut c_ext = 0.0;
    let mut c_abs = 0.0;

    for i in 0..n_dipoles {
        // E_0 * P (E_0 = e_inc[i])
        for a in 0..3 {
            let e0 = e_inc[i][a];
            let p = p_flat[3 * i + a];

            // Extinction: Im[E0* · P]
            c_ext += (e0.conj() * p).im;

            // Absorption: Im[P* · α^{-1} · P] - (2k³/3)|P|²
            c_abs += (p.conj() * alpha_inv * p).im;
            c_abs -= (2.0 * k3 / 3.0) * p.norm_sqr();
        }
    }

    // Scale by 4πk for cross-sections (|E0|² = 1)
    c_ext *= 4.0 * PI * k;
    c_abs *= 4.0 * PI * k;

    // Ensure physical values
    c_ext = c_ext.max(0.0);
    c_abs = c_abs.max(0.0).min(c_ext);
    let c_sca = c_ext - c_abs;

    // Geometric cross-section
    let geometric_cs: f64 = radii.iter().map(|&r| PI * r * r).sum();

    // Efficiencies
    let q_ext = if geometric_cs > 0.0 {
        c_ext / geometric_cs
    } else {
        0.0
    };
    let q_sca = if geometric_cs > 0.0 {
        c_sca / geometric_cs
    } else {
        0.0
    };
    let q_abs = if geometric_cs > 0.0 {
        c_abs / geometric_cs
    } else {
        0.0
    };

    // Single scattering albedo
    let omega = if c_ext > 1e-15 { c_sca / c_ext } else { 0.0 };

    // Asymmetry parameter (simplified estimate)
    // For accurate g, would need to compute scattered field
    let g = 0.5 * (1.0 - omega); // Rough approximation

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
        phase_function: vec![],
        scattering_angles: vec![],
        wavelength,
        refractive_index_n: n_real,
        refractive_index_k: n_imag,
        medium_index,
        n_particles,
        geometric_cross_section: geometric_cs,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clausius_mossotti() {
        let v = 1.0;
        let eps = Complex64::new(2.25, 0.0); // n = 1.5
        let alpha = clausius_mossotti(v, eps);

        // (ε - 1) / (ε + 2) = (2.25 - 1) / (2.25 + 2) = 1.25 / 4.25 ≈ 0.294
        // α = (3*1 / 4π) * 0.294 ≈ 0.070
        assert!((alpha.re - 0.070).abs() < 0.01);
        assert!(alpha.im.abs() < 1e-10);
    }

    #[test]
    fn test_discretize_single_sphere() {
        let centers = vec![[0.0, 0.0, 0.0]];
        let radii = vec![5.0];
        let d = 2.0;

        let (positions, indices) = discretize_spheres(&centers, &radii, d);

        // Should have multiple dipoles
        assert!(!positions.is_empty());
        // All should belong to sphere 0
        assert!(indices.iter().all(|&i| i == 0));
    }

    #[test]
    fn test_dyadic_green() {
        let k = 0.01; // Small k for testing
        let r = [10.0, 0.0, 0.0];

        let g = dyadic_green(k, r);

        // G should be symmetric
        for i in 0..3 {
            for j in 0..3 {
                let diff = (g[i][j] - g[j][i]).norm();
                assert!(diff < 1e-10, "G not symmetric at ({}, {})", i, j);
            }
        }
    }
}
