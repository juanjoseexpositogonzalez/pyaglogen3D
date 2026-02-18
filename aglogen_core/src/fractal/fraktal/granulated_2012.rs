//! FRAKTAL 2012 Granulated Particle Model.
//!
//! Implementation of the 2012 model for soot/agglomerates with spherical
//! primary particles. Based on buscafractal2012.m and dimfrac2012.m.

use std::f64::consts::PI;
use std::time::Instant;

use ndarray::ArrayView2;

use super::bisection::BisectionSolver;
use super::image_processing::{
    apply_3d_correction_granulated, calculate_geometry, calculate_m_exponent, color_segment,
};
use super::params::Granulated2012Params;
use super::result::{FraktalResult, FraktalStatus};

/// Soot density in fg/nm³
const SOOT_DENSITY: f64 = 1.85e-06;

/// Constants for coordination index Jf calculation.
const JF_A: f64 = 1.85;
const JF_B: f64 = 0.0191;
const JF_C: f64 = 1.45;
const JF_D: f64 = 1.5;
const JF_A_EXP: f64 = 17.0;
const JF_B_EXP: f64 = 3.609;
const JF_C_EXP: f64 = -0.3901;
const JF_D_EXP: f64 = 6.2;

/// Helper function alfa from MATLAB.
///
/// alfa(delta, J) = 1 - J/2 + J*(3*delta² - 1)/(4*delta³)
fn alfa(delta: f64, j: f64) -> f64 {
    1.0 - j / 2.0 + j * (3.0 * delta.powi(2) - 1.0) / (4.0 * delta.powi(3))
}

/// Helper function beta from MATLAB.
///
/// beta(delta, J) = (delta^5 * (8 - 4*J) + J*(5*delta^4 - 1)) / (8*delta^5)
fn beta(delta: f64, j: f64) -> f64 {
    (delta.powi(5) * (8.0 - 4.0 * j) + j * (5.0 * delta.powi(4) - 1.0)) / (8.0 * delta.powi(5))
}

/// Helper function mu from MATLAB.
///
/// mu(npo, h) = sqrt(12*npo - 3) - h
fn mu(npo: f64, h: f64) -> f64 {
    (12.0 * npo - 3.0).sqrt() - h
}

/// Calculate prefactor coefficients Akf, Bkf, Ckf.
///
/// These coefficients are used to compute kf as a function of Df:
/// kf = akf*Df² + bkf*Df + ckf
fn calculate_prefactor_coefficients(npo: f64, delta: f64) -> (f64, f64, f64) {
    // gamma = 5/4 * (1 - 1/delta)² / (2 - 1/delta)
    let gamma = 5.0 / 4.0 * (1.0 - 1.0 / delta).powi(2) / (2.0 - 1.0 / delta);

    // Akf calculation (complex formula from MATLAB)
    let akf_numer = npo
        * (3.0 / 5.0
            * ((npo - 2.0) * beta(delta, 2.0)
                + 2.0 * (beta(delta, 1.0) - 3.0 / 5.0 * alfa(delta, 1.0) * gamma.powi(2)))
            + 1.0 / (3.0 * delta.powi(2))
                * (npo - 1.0)
                * (npo - 2.0)
                * (npo - 3.0)
                * alfa(delta, 2.0)
            + 2.0 * alfa(delta, 1.0) * ((npo - 1.0) / delta + 3.0 / 5.0 * gamma).powi(2));
    let akf_denom = (npo - 2.0) * alfa(delta, 2.0) + 2.0 * alfa(delta, 1.0);
    let akf = npo * (akf_numer / akf_denom).powf(-0.5);

    // Bkf calculation
    let mu3 = mu(npo, 3.0);
    let mu9 = mu(npo, 9.0);
    let mu21_5 = mu(npo, 21.0 / 5.0);

    let bkf_numer =
        npo * ((npo - mu3) * alfa(delta, 6.0) + 6.0 * alfa(delta, 3.0) + mu9 * alfa(delta, 4.0));
    let bkf_denom = 3.0 / 5.0
        * ((npo - mu3) * beta(delta, 6.0)
            + 6.0 * (beta(delta, 3.0) - 12.0 / 5.0 * alfa(delta, 3.0) * gamma.powi(2))
            + mu9 * (beta(delta, 4.0) - 9.0 / 5.0 * alfa(delta, 4.0) * gamma.powi(2)))
        + alfa(delta, 6.0) / (108.0 * delta.powi(2)) * mu3 * mu9 * (5.0 * npo - 5.0 * mu3 + 1.0)
        + 2.0 / (3.0 * delta.powi(2)) * alfa(delta, 3.0) * mu3.powi(2)
        + alfa(delta, 4.0) / (54.0 * delta.powi(2)) * 5.0 * mu3 * mu9 * mu21_5;
    let bkf = bkf_numer / bkf_denom;

    // Ckf calculation (using 'in' variable from MATLAB)
    let cube_root_arg = 3.0 / 20.0 * npo + 1.0 / 120.0 * (324.0 * npo.powi(2) + 343.0 / 15.0).sqrt();
    let cube_root = cube_root_arg.powf(1.0 / 3.0);
    let in_val = cube_root - 7.0 / 60.0 * cube_root.powf(-1.0) - 0.5;

    let ckf_numer = 1.0 + 10.0 / 3.0 * in_val.powi(3) + 5.0 * in_val.powi(2) + 11.0 / 3.0 * in_val;

    let sqrt2 = 2.0_f64.sqrt();
    let ckf_denom_part1 = 3.0 / 5.0
        * ((10.0 / 3.0 * in_val.powi(3) - 5.0 * in_val.powi(2) + 11.0 / 3.0 * in_val - 1.0)
            * beta(delta, 12.0)
            + 24.0 * (in_val - 1.0)
                * (beta(delta, 7.0) - 27.0 / 5.0 * alfa(delta, 7.0) * gamma.powi(2))
            + 12.0
                * (beta(delta, 5.0)
                    - (27.0 + 12.0 * sqrt2) / 5.0 * alfa(delta, 5.0) * gamma.powi(2))
            + (4.0 * in_val.powi(2) - 12.0 * in_val + 8.0)
                * (beta(delta, 9.0) - 6.0 / 5.0 * alfa(delta, 9.0) * gamma.powi(2))
            + 6.0
                * (in_val - 1.0).powi(2)
                * (beta(delta, 8.0) - 24.0 / 5.0 * alfa(delta, 8.0) * gamma.powi(2)));

    let ckf_denom_part2 = 4.0 / delta.powi(2)
        * (alfa(delta, 12.0)
            * (7.0 / 5.0 * in_val.powi(5) - 7.0 / 2.0 * in_val.powi(4) + 4.0 * in_val.powi(3)
                - 5.0 / 2.0 * in_val.powi(2)
                + 3.0 / 5.0 * in_val)
            + 12.0 * alfa(delta, 5.0) * in_val.powi(2)
            + alfa(delta, 7.0)
                * (20.0 * in_val.powi(3) - 24.0 * in_val.powi(2) + 4.0 * in_val)
            + alfa(delta, 9.0)
                * (3.0 * in_val.powi(4) - 10.0 * in_val.powi(3) + 9.0 * in_val.powi(2)
                    - 2.0 * in_val)
            + alfa(delta, 8.0)
                * (4.0 * in_val.powi(4) - 10.0 * in_val.powi(3) + 8.0 * in_val.powi(2)
                    - 2.0 * in_val));

    let ckf_denom_part3 = alfa(delta, 12.0) / 3.0
        * (2.0 * in_val - 1.0)
        * (5.0 * in_val.powi(2) - 5.0 * in_val + 3.0)
        + 24.0 * (in_val - 1.0) * alfa(delta, 7.0)
        + 12.0 * alfa(delta, 5.0)
        + (4.0 * in_val.powi(2) - 12.0 * in_val + 8.0) * alfa(delta, 9.0)
        + 6.0 * (in_val - 1.0).powi(2) * alfa(delta, 8.0);

    let ckf = (ckf_numer / ((ckf_denom_part1 + ckf_denom_part2) / ckf_denom_part3)).powf(1.5);

    // Convert to polynomial coefficients: kf = akf*df² + bkf*df + ckf
    let akf_coef = akf / 2.0 - bkf + ckf / 2.0;
    let bkf_coef = -5.0 / 2.0 * akf + 4.0 * bkf - 3.0 / 2.0 * ckf;
    let ckf_coef = 3.0 * akf - 3.0 * bkf + ckf;

    (akf_coef, bkf_coef, ckf_coef)
}

/// Calculate kf as a function of Df.
fn calculate_kf(df: f64, akf: f64, bkf: f64, ckf: f64) -> f64 {
    akf * df.powi(2) + bkf * df + ckf
}

/// Calculate coordination index Jf.
fn calculate_jf(df: f64, kf: f64, npo: f64, delta: f64) -> f64 {
    2.0 + JF_D * (delta - 1.0) * (df - 1.0)
        + (JF_A + JF_B * kf.powf(JF_B_EXP) + JF_C * npo.powf(JF_C_EXP))
            * 1e-8
            * df.powf(JF_A_EXP + JF_D_EXP * (delta - 1.0))
}

/// Calculate overlap exponent zp for granulated model.
fn calculate_zp_granulated(npo: f64, df: f64, m: f64) -> f64 {
    let azp = npo.ln() / (0.8488 * npo + 0.1512).ln();
    let bzp = 1.5 / (1.0 + 0.3005 / npo.ln());
    azp - 1.0 + (bzp + 1.0 - azp).powf(((df - 1.0) / 2.0).powf(m))
}

/// Calculate projected area of a single primary particle with overlap.
fn calculate_apo(dpo: f64, jf: f64, delta: f64) -> f64 {
    let cos_inv = (1.0 / delta).acos();
    let sin_val = cos_inv.sin();
    0.25 * dpo.powi(2) * (PI - jf * cos_inv + jf / delta * sin_val)
}

/// Analyze image using the 2012 granulated particle model.
pub fn analyze_granulated_2012(
    image: ArrayView2<u8>,
    params: &Granulated2012Params,
) -> FraktalResult {
    let start_time = Instant::now();

    // Step 1: Color segmentation
    let binary = color_segment(image, params.pixel_min, params.pixel_max);

    // Step 2: Calculate geometry
    let geometry = match calculate_geometry(binary.view(), params.npix, params.escala) {
        Some(g) => g,
        None => {
            return FraktalResult {
                status: FraktalStatus::Error("No object pixels found".to_string()),
                execution_time_ms: start_time.elapsed().as_millis() as u64,
                model: "granulated_2012".to_string(),
                ..Default::default()
            }
        }
    };

    // Step 3: Apply 3D correction if enabled
    let m = calculate_m_exponent(params.correction_3d, true, params.delta);
    let rg = if params.correction_3d {
        apply_3d_correction_granulated(geometry.radius_of_gyration_nm, params.delta)
    } else {
        geometry.radius_of_gyration_nm
    };
    let dp = 2.0 * rg; // Diameter from Rg
    let ap = geometry.projected_area_nm2;

    // Step 4: Iterative solution for Df
    let mut npo_estimate = 1_000_000.0;
    let mut df_result = 0.0;
    let mut kf_result = 0.0;
    let mut converged = false;
    let tolerance = 0.0001;
    let max_outer_iterations = 50;

    for outer_iter in 0..max_outer_iterations {
        let (akf, bkf, ckf) = calculate_prefactor_coefficients(npo_estimate, params.delta);

        // Define objective function for bisection
        let objective = |df: f64| {
            let kf = calculate_kf(df, akf, bkf, ckf);
            let jf = calculate_jf(df, kf, npo_estimate, params.delta);
            let apo = calculate_apo(params.dpo, jf, params.delta);
            let zp = calculate_zp_granulated(npo_estimate, df, m);

            // Equation: kf * (dp/dpo)^Df = (Ap/Apo)^zp
            let lhs = kf * (dp / params.dpo).powf(df);
            let rhs = (ap / apo).powf(zp);
            (lhs - rhs, kf)
        };

        let solver = BisectionSolver::default();
        let result = solver.solve(objective, 1.0, 3.0);

        if result.df == 0.0 || !result.converged {
            break;
        }

        // Calculate new npo estimate
        let new_npo = result.kf * (dp / params.dpo).powf(result.df);

        // Check convergence
        if (result.df - df_result).abs() < tolerance && outer_iter > 0 {
            df_result = result.df;
            kf_result = result.kf;
            npo_estimate = new_npo;
            converged = true;
            break;
        }

        df_result = result.df;
        kf_result = result.kf;
        npo_estimate = new_npo;
    }

    // Check for valid solution
    if df_result == 0.0 || !converged {
        return FraktalResult {
            rg,
            ap,
            status: if df_result == 0.0 {
                FraktalStatus::DfOutOfRange
            } else {
                FraktalStatus::NoConvergence
            },
            execution_time_ms: start_time.elapsed().as_millis() as u64,
            model: "granulated_2012".to_string(),
            ..Default::default()
        };
    }

    let npo_final = npo_estimate.round() as u64;

    // Check minimum particle count
    if npo_final < params.npo_limit as u64 {
        return FraktalResult {
            rg,
            ap,
            df: df_result,
            npo: npo_final,
            kf: kf_result,
            status: FraktalStatus::NpoTooSmall,
            execution_time_ms: start_time.elapsed().as_millis() as u64,
            model: "granulated_2012".to_string(),
            ..Default::default()
        };
    }

    // Calculate final derived properties
    let jf = calculate_jf(df_result, kf_result, npo_estimate, params.delta);
    let zf = calculate_zp_granulated(npo_estimate, df_result, m);

    // Volume calculation
    let delta = params.delta;
    let dpo = params.dpo;
    let vol_factor = 1.0 - jf * (4.0 * delta.powi(3) - 6.0 * delta.powi(2) + 2.0) / (8.0 * delta.powi(3));
    let volume = npo_estimate * (PI / 6.0 * dpo.powi(3)) * vol_factor;

    // Mass calculation (using soot density)
    let mass = SOOT_DENSITY * volume;

    // Surface area calculation
    let surf_factor = 1.0 - jf * (delta - 1.0) / (2.0 * delta);
    let surface_area = npo_estimate * (PI * dpo.powi(2)) * surf_factor;

    FraktalResult {
        rg,
        ap,
        df: df_result,
        npo: npo_final,
        kf: kf_result,
        zf,
        jf: Some(jf),
        volume,
        mass,
        surface_area,
        status: FraktalStatus::Success,
        execution_time_ms: start_time.elapsed().as_millis() as u64,
        model: "granulated_2012".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alfa() {
        // Test with delta=1.1, J=2
        let result = alfa(1.1, 2.0);
        assert!(result.is_finite());
        // alfa should be approximately 1 - 1 + small correction
        assert!(result > 0.0 && result < 1.0);
    }

    #[test]
    fn test_beta() {
        let result = beta(1.1, 2.0);
        assert!(result.is_finite());
        assert!(result > 0.0 && result < 2.0);
    }

    #[test]
    fn test_mu() {
        let result = mu(100.0, 3.0);
        // sqrt(12*100 - 3) - 3 = sqrt(1197) - 3 ≈ 34.6 - 3 ≈ 31.6
        assert!((result - 31.6).abs() < 0.5);
    }

    #[test]
    fn test_calculate_kf() {
        // Simple polynomial test
        let kf = calculate_kf(2.0, 1.0, 1.0, 1.0);
        // kf = 1*4 + 1*2 + 1 = 7
        assert!((kf - 7.0).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_jf() {
        let jf = calculate_jf(1.8, 1.3, 100.0, 1.1);
        // Jf should be around 2+ for typical values
        assert!(jf >= 2.0);
        assert!(jf < 10.0);
    }

    #[test]
    fn test_calculate_zp() {
        let zp = calculate_zp_granulated(100.0, 1.8, 1.95);
        // zp should be positive and reasonable
        assert!(zp > 0.0 && zp < 3.0);
    }
}
