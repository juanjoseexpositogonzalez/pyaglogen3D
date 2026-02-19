//! FRAKTAL 2018 Voxel Model.
//!
//! Simplified voxel-based analysis without particle overlap considerations.
//! Based on buscafractal2018.m.

use std::f64::consts::PI;
use std::time::Instant;

use ndarray::ArrayView2;

use super::bisection::BisectionSolver;
use super::image_processing::{
    apply_3d_correction_voxel, calculate_geometry, smart_segment,
};
use super::params::Voxel2018Params;
use super::result::{FraktalResult, FraktalStatus};

/// Calculate prefactor coefficients for voxel model.
///
/// Simpler than the granulated model.
fn calculate_prefactor_coefficients_voxel(nvox: f64) -> (f64, f64, f64) {
    // Akf = 1 / (2 * sqrt(1/6 * (1/2 + 1/nvox²)))
    let akf = 1.0 / (2.0 * (1.0 / 6.0 * (0.5 + 1.0 / nvox.powi(2))).sqrt());

    // Bkf = nvox / (2/3*nvox + 1/3)
    let bkf = nvox / (2.0 / 3.0 * nvox + 1.0 / 3.0);

    // Ckf = 1
    let ckf = 1.0;

    // Convert to polynomial coefficients
    let akf_coef = akf / 2.0 - bkf + ckf / 2.0;
    let bkf_coef = -5.0 / 2.0 * akf + 4.0 * bkf - 3.0 / 2.0 * ckf;
    let ckf_coef = 3.0 * akf - 3.0 * bkf + ckf;

    (akf_coef, bkf_coef, ckf_coef)
}

/// Calculate kf as a function of Df.
fn calculate_kf(df: f64, akf: f64, bkf: f64, ckf: f64) -> f64 {
    akf * df.powi(2) + bkf * df + ckf
}

/// Calculate overlap exponent zp for voxel model.
fn calculate_zp_voxel(nvox: f64, df: f64, m: f64) -> f64 {
    // Azp = log(nvox) / log(1/2 + π*nvox/4)
    let azp = nvox.ln() / (0.5 + PI * nvox / 4.0).ln();
    // Bzp = 1.5
    let bzp = 1.5;

    azp - 1.0 + (bzp + 1.0 - azp).powf(((df - 1.0) / 2.0).powf(m))
}

/// Analyze image using the 2018 voxel model.
pub fn analyze_voxel_2018(
    image: ArrayView2<u8>,
    params: &Voxel2018Params,
) -> FraktalResult {
    let start_time = Instant::now();

    // Step 1: Smart segmentation with automatic threshold detection
    let (binary, detected_threshold, is_dark_on_light) = smart_segment(
        image,
        params.pixel_min,
        params.pixel_max,
        params.auto_threshold,
    );

    // Debug info available via detected_threshold and is_dark_on_light
    let _ = (detected_threshold, is_dark_on_light); // Mark as intentionally unused

    // Step 2: Calculate geometry
    let geometry = match calculate_geometry(binary.view(), params.npix, params.escala) {
        Some(g) => g,
        None => {
            return FraktalResult {
                status: FraktalStatus::Error("No object pixels found".to_string()),
                execution_time_ms: start_time.elapsed().as_millis() as u64,
                model: "voxel_2018".to_string(),
                ..Default::default()
            }
        }
    };

    // Step 3: Apply 3D correction if enabled
    let m = params.m_exponent;
    let rg = if params.correction_3d {
        apply_3d_correction_voxel(geometry.radius_of_gyration_nm)
    } else {
        geometry.radius_of_gyration_nm
    };
    let dp = 2.0 * rg;
    let ap = geometry.projected_area_nm2;

    // Voxel dimension
    let lvox = params.escala / params.npix;

    // Step 4: Iterative solution for Df
    let mut nvox_estimate = 100_000_000.0;
    let mut df_result = 0.0;
    let mut kf_result = 0.0;
    let mut converged = false;
    let tolerance = 0.0001;
    let max_outer_iterations = 50;

    for outer_iter in 0..max_outer_iterations {
        let (akf, bkf, ckf) = calculate_prefactor_coefficients_voxel(nvox_estimate);

        // Define objective function for bisection
        let objective = |df: f64| {
            let kf = calculate_kf(df, akf, bkf, ckf);
            let zp = calculate_zp_voxel(nvox_estimate, df, m);

            // Equation: kf * (dp/lvox)^Df = (Ap/lvox²)^zp
            let lhs = kf * (dp / lvox).powf(df);
            let rhs = (ap / lvox.powi(2)).powf(zp);
            (lhs - rhs, kf)
        };

        let solver = BisectionSolver::default();
        let result = solver.solve(objective, 1.0, 3.0);

        if result.df == 0.0 || !result.converged {
            break;
        }

        // Calculate new nvox estimate
        let new_nvox = result.kf * (dp / lvox).powf(result.df);

        // Check convergence
        if (result.df - df_result).abs() < tolerance && outer_iter > 0 {
            df_result = result.df;
            kf_result = result.kf;
            nvox_estimate = new_nvox;
            converged = true;
            break;
        }

        df_result = result.df;
        kf_result = result.kf;
        nvox_estimate = new_nvox;
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
            model: "voxel_2018".to_string(),
            ..Default::default()
        };
    }

    let nvox_final = nvox_estimate.round() as u64;

    // Calculate zf
    let zf = calculate_zp_voxel(nvox_estimate, df_result, m);

    // For voxel model, simplified calculations
    // Volume = nvox * lvox³
    let volume = nvox_estimate * lvox.powi(3);

    // Mass = 0 for voxel model (no density consideration)
    let mass = 0.0;

    // Surface area = nvox * 4*lvox² (approximate)
    let surface_area = nvox_estimate * 4.0 * lvox.powi(2);

    FraktalResult {
        rg,
        ap,
        df: df_result,
        npo: nvox_final,  // nvox treated as npo for output
        npo_visual: 0,    // Not applicable for voxel model
        kf: kf_result,
        zf,
        jf: None,  // No Jf for voxel model
        volume,
        mass,
        surface_area,
        npo_ratio: 0.0,       // Not applicable for voxel model
        npo_aligned: true,    // No comparison for voxel model
        dpo_estimated: 0.0,   // Not applicable for voxel model
        status: FraktalStatus::Success,
        execution_time_ms: start_time.elapsed().as_millis() as u64,
        model: "voxel_2018".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefactor_coefficients() {
        let (akf, bkf, ckf) = calculate_prefactor_coefficients_voxel(1000.0);

        // All coefficients should be finite and reasonable
        assert!(akf.is_finite());
        assert!(bkf.is_finite());
        assert!(ckf.is_finite());
    }

    #[test]
    fn test_calculate_zp_voxel() {
        let zp = calculate_zp_voxel(1000.0, 1.8, 1.0);

        // zp should be positive and in reasonable range
        assert!(zp > 0.0);
        assert!(zp < 3.0);
    }

    #[test]
    fn test_calculate_kf() {
        let kf = calculate_kf(2.0, 0.5, -1.0, 1.5);
        // kf = 0.5*4 - 1*2 + 1.5 = 2 - 2 + 1.5 = 1.5
        assert!((kf - 1.5).abs() < 1e-10);
    }
}
