//! Mie scattering coefficients for spherical particles.
//!
//! Implements Mie theory for computing scattering coefficients An and Bn
//! using Riccati-Bessel functions.

use num_complex::Complex64;
use std::f64::consts::PI;

/// Size parameter x = 2πr/λ
pub fn size_parameter(radius: f64, wavelength: f64, medium_index: f64) -> f64 {
    2.0 * PI * radius * medium_index / wavelength
}

/// Riccati-Bessel function ψ_n(z) = z * j_n(z)
/// Uses downward recurrence for numerical stability
fn riccati_bessel_psi(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let mut psi = vec![Complex64::new(0.0, 0.0); n_max + 1];

    // Starting values
    psi[0] = z.sin();
    if n_max >= 1 {
        psi[1] = z.sin() / z - z.cos();
    }

    // Upward recurrence for small n
    for n in 1..n_max {
        let n_f = n as f64;
        psi[n + 1] = ((2.0 * n_f + 1.0) / z) * psi[n] - psi[n - 1];
    }

    psi
}

/// Riccati-Bessel function χ_n(z) = -z * y_n(z)
fn riccati_bessel_chi(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let mut chi = vec![Complex64::new(0.0, 0.0); n_max + 1];

    // Starting values
    chi[0] = z.cos();
    if n_max >= 1 {
        chi[1] = z.cos() / z + z.sin();
    }

    // Upward recurrence
    for n in 1..n_max {
        let n_f = n as f64;
        chi[n + 1] = ((2.0 * n_f + 1.0) / z) * chi[n] - chi[n - 1];
    }

    chi
}

/// Riccati-Bessel function ξ_n(z) = ψ_n(z) + i*χ_n(z)
fn riccati_bessel_xi(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let psi = riccati_bessel_psi(n_max, z);
    let chi = riccati_bessel_chi(n_max, z);

    psi.iter()
        .zip(chi.iter())
        .map(|(&p, &c)| p + Complex64::i() * c)
        .collect()
}

/// Logarithmic derivative D_n(z) = d/dz [ln(ψ_n(z))] = ψ'_n(z)/ψ_n(z)
/// Uses downward recurrence (Lentz-Thompson method) for numerical stability
fn log_derivative_d(n_max: usize, z: Complex64) -> Vec<Complex64> {
    let mut d = vec![Complex64::new(0.0, 0.0); n_max + 2];

    // Starting value at n_max + 15 for convergence
    let n_start = n_max + 15;
    let mut d_n = Complex64::new(0.0, 0.0);

    // Downward recurrence: D_{n-1} = n/z - 1/(D_n + n/z)
    for n in (1..=n_start).rev() {
        let n_f = n as f64;
        d_n = (n_f / z) - Complex64::new(1.0, 0.0) / (d_n + n_f / z);
        if n <= n_max + 1 {
            d[n] = d_n;
        }
    }

    d
}

/// Mie scattering coefficients an and bn for a sphere.
///
/// # Arguments
/// * `n_max` - Maximum multipole order
/// * `x` - Size parameter (2πr/λ in medium)
/// * `m` - Relative refractive index (particle/medium)
///
/// # Returns
/// Tuple of (an, bn) vectors of complex coefficients
pub fn mie_coefficients(
    n_max: usize,
    x: f64,
    m: Complex64,
) -> (Vec<Complex64>, Vec<Complex64>) {
    let mut an = vec![Complex64::new(0.0, 0.0); n_max + 1];
    let mut bn = vec![Complex64::new(0.0, 0.0); n_max + 1];

    let z = Complex64::new(x, 0.0);
    let mz = m * z;

    // Compute Riccati-Bessel functions
    let psi_x = riccati_bessel_psi(n_max, z);
    let xi_x = riccati_bessel_xi(n_max, z);
    let d_mx = log_derivative_d(n_max, mz);

    // Compute derivatives: ψ'_n(x) = ψ_{n-1}(x) - n*ψ_n(x)/x
    // and ξ'_n(x) = ξ_{n-1}(x) - n*ξ_n(x)/x
    for n in 1..=n_max {
        let n_f = n as f64;

        // Logarithmic derivatives at x
        let d_n_x = if n > 0 {
            psi_x[n - 1] / psi_x[n] - Complex64::new(n_f, 0.0) / z
        } else {
            Complex64::new(0.0, 0.0)
        };

        // Mie coefficients using logarithmic derivative formulation
        // a_n = [D_n(mx)/m + n/x] * ψ_n(x) - ψ_{n-1}(x)
        //       / [D_n(mx)/m + n/x] * ξ_n(x) - ξ_{n-1}(x)
        let d_mx_over_m = d_mx[n] / m;
        let m_d_mx = m * d_mx[n];
        let n_over_x = Complex64::new(n_f / x, 0.0);

        let numerator_a = (d_mx_over_m + n_over_x) * psi_x[n] - psi_x[n - 1];
        let denominator_a = (d_mx_over_m + n_over_x) * xi_x[n] - xi_x[n - 1];

        let numerator_b = (m_d_mx + n_over_x) * psi_x[n] - psi_x[n - 1];
        let denominator_b = (m_d_mx + n_over_x) * xi_x[n] - xi_x[n - 1];

        an[n] = numerator_a / denominator_a;
        bn[n] = numerator_b / denominator_b;
    }

    (an, bn)
}

/// Estimate required multipole order for convergence.
/// Uses Wiscombe criterion: n_max ≈ x + 4*x^(1/3) + 2
pub fn estimate_n_max(x: f64) -> usize {
    let n_stop = x + 4.0 * x.powf(1.0 / 3.0) + 2.0;
    (n_stop.ceil() as usize).max(10)
}

/// Compute Mie cross-sections for a single sphere.
///
/// # Arguments
/// * `radius` - Sphere radius (nm)
/// * `wavelength` - Wavelength in vacuum (nm)
/// * `n_particle` - Complex refractive index of particle
/// * `n_medium` - Refractive index of surrounding medium (real)
///
/// # Returns
/// (C_ext, C_sca, C_abs, Q_ext, Q_sca, Q_abs, g) cross-sections (nm²) and efficiencies
pub fn mie_sphere(
    radius: f64,
    wavelength: f64,
    n_particle: Complex64,
    n_medium: f64,
) -> (f64, f64, f64, f64, f64, f64, f64) {
    let x = size_parameter(radius, wavelength, n_medium);
    let m = n_particle / Complex64::new(n_medium, 0.0);

    let n_max = estimate_n_max(x);
    let (an, bn) = mie_coefficients(n_max, x, m);

    let mut q_ext = 0.0;
    let mut q_sca = 0.0;
    let mut g_numerator = 0.0;

    for n in 1..=n_max {
        let n_f = n as f64;
        let factor = 2.0 * n_f + 1.0;

        // Extinction efficiency
        q_ext += factor * (an[n].re + bn[n].re);

        // Scattering efficiency
        q_sca += factor * (an[n].norm_sqr() + bn[n].norm_sqr());

        // Asymmetry parameter numerator
        if n < n_max {
            let n_f1 = (n + 1) as f64;
            g_numerator += (n_f * (n_f + 2.0) / (n_f + 1.0))
                * (an[n] * an[n + 1].conj() + bn[n] * bn[n + 1].conj()).re;
            g_numerator +=
                ((2.0 * n_f + 1.0) / (n_f * (n_f + 1.0))) * (an[n] * bn[n].conj()).re;
        }
    }

    // Apply 2/x² factor
    let x_sq = x * x;
    q_ext *= 2.0 / x_sq;
    q_sca *= 2.0 / x_sq;
    let q_abs = q_ext - q_sca;

    // Asymmetry parameter
    let g = if q_sca > 1e-10 {
        (4.0 / (x_sq * q_sca)) * g_numerator
    } else {
        0.0
    };

    // Convert to cross-sections
    let geom_cs = PI * radius * radius;
    let c_ext = q_ext * geom_cs;
    let c_sca = q_sca * geom_cs;
    let c_abs = q_abs * geom_cs;

    (c_ext, c_sca, c_abs, q_ext, q_sca, q_abs, g)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_size_parameter() {
        // r = 100 nm, λ = 500 nm, n = 1.0
        let x = size_parameter(100.0, 500.0, 1.0);
        assert!((x - 1.2566).abs() < 0.001);
    }

    #[test]
    fn test_mie_non_absorbing() {
        // Non-absorbing sphere
        let (c_ext, c_sca, c_abs, q_ext, q_sca, q_abs, g) =
            mie_sphere(100.0, 500.0, Complex64::new(1.5, 0.0), 1.0);

        // Extinction should equal scattering for non-absorbing
        assert!((c_ext - c_sca).abs() < 1e-10);
        assert!(c_abs.abs() < 1e-10);
        assert!((q_ext - q_sca).abs() < 1e-10);
        assert!(q_abs.abs() < 1e-10);
    }

    #[test]
    fn test_mie_absorbing() {
        // Absorbing sphere (soot-like)
        let (c_ext, c_sca, c_abs, q_ext, q_sca, q_abs, g) =
            mie_sphere(25.0, 550.0, Complex64::new(1.95, 0.79), 1.0);

        // Should have significant absorption
        assert!(c_abs > 0.0);
        assert!(q_abs > 0.0);
        assert!(c_ext > c_sca);
        // Asymmetry should be between -1 and 1
        assert!(g >= -1.0 && g <= 1.0);
    }
}
