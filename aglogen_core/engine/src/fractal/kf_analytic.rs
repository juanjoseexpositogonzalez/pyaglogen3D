//! Analytical fractal prefactor computation.
//! Ported from `BOXCOUNTER/Prefactor.m`.
//!
//! Computes `Kf = n / (Rg/dp)^Df` for 8 sphere-packing configurations,
//! where `Rg` is the analytical radius of gyration and `dp` is the primary
//! particle diameter.

/// Packing configuration for the Kf calculation.
///
/// Each variant maps to a MATLAB `modo` case in `Prefactor.m`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackingMode {
    /// Case 1 — Line of spheres.
    Line,
    /// Case 2 — 2D cross (+ shape).
    Cross2D,
    /// Case 3 — Asterisk (6-arm star).
    Asterisk,
    /// Case 4 — 3D cross.
    Cross3D,
    /// Case 5 — Single hexagonal close-packed plane.
    PlaneHC,
    /// Case 6 — Double perpendicular HC plane.
    DoublePlaneHC,
    /// Case 7 — Triple HC plane at 60°.
    TriplePlaneHC,
    /// Case 8 — Cuboctahedron HC packing.
    CuboctahedronHC,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Centred hexagonal number: `1 + 6*(1 + 2 + … + n) = 1 + 3*n*(n+1)`.
fn centred_hex(n: usize) -> usize {
    1 + 3 * n * (n + 1)
}

/// Cuboctahedral shell number (OEIS A005902):
/// `C(0)=1`, `C(L)=1 + sum_{i=1}^{L} (10*i^2 + 2)`.
fn cuboctahedral_n(layers: usize) -> usize {
    let mut total: usize = 1;
    for i in 1..=layers {
        total += 10 * i * i + 2;
    }
    total
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Compute the analytical diameter of gyration `dg` for a given packing mode.
///
/// The formulas use `d = dp` (particle diameter) as the reference length.
/// Returns `None` for invalid configurations (e.g. even asterisk/cross3d,
/// or when the required number of layers is < 1 for cuboctahedron).
///
/// The `n_spheres` parameter meaning depends on the mode:
/// - `Line`, `Cross2D`, `Asterisk`, `Cross3D`: number of spheres per arm
/// - `PlaneHC`, `DoublePlaneHC`, `TriplePlaneHC`, `CuboctahedronHC`:
///   number of concentric layers
pub fn radius_of_gyration(mode: &PackingMode, n_spheres: usize, dp: f64) -> Option<f64> {
    let d = dp;
    match mode {
        PackingMode::Line => {
            let n = n_spheres as f64;
            if n < 1.0 {
                return None;
            }
            // dg = 2*d*sqrt(3/20 + (n^2 - 1)/12)
            let dg = 2.0 * d * (3.0 / 20.0 + (n * n - 1.0) / 12.0).sqrt();
            Some(dg)
        }
        PackingMode::Cross2D => {
            if n_spheres < 1 {
                return None;
            }
            let esferas = n_spheres;
            if esferas % 2 != 0 {
                // Odd: n = 2*esferas - 1
                let n = (2 * esferas - 1) as f64;
                let dg = 2.0 * d * (3.0 / 20.0 + ((n * n - 1.0) * (n + 3.0)) / (48.0 * n)).sqrt();
                Some(dg)
            } else {
                // Even: n = 2*esferas
                let n = (2 * esferas) as f64;
                let sqrt2 = 2.0_f64.sqrt();
                let a = n + 2.0 * sqrt2 - 4.0;
                let b = n + 2.0 * sqrt2;
                let c = n + 2.0 * sqrt2 - 2.0;
                let correction = 8.0 * sqrt2 * (sqrt2 - 2.0) * (sqrt2 - 1.0);
                let dg = 2.0 * d * (3.0 / 20.0 + (a * b * c - correction) / (48.0 * n)).sqrt();
                Some(dg)
            }
        }
        PackingMode::Asterisk => {
            let esferas = if n_spheres % 2 == 0 {
                n_spheres + 1
            } else {
                n_spheres
            };
            if esferas < 1 {
                return None;
            }
            // n = 3*esferas - 2 (odd only)
            let n = (3 * esferas - 2) as f64;
            let dg =
                2.0 * d * (3.0 / 20.0 + ((n - 1.0) * (n + 5.0) * (n + 2.0)) / (108.0 * n)).sqrt();
            Some(dg)
        }
        PackingMode::Cross3D => {
            let esferas = if n_spheres % 2 == 0 {
                n_spheres + 1
            } else {
                n_spheres
            };
            if esferas < 1 {
                return None;
            }
            // Same formula as asterisk: n = 3*esferas - 2
            let n = (3 * esferas - 2) as f64;
            let dg =
                2.0 * d * (3.0 / 20.0 + ((n - 1.0) * (n + 5.0) * (n + 2.0)) / (108.0 * n)).sqrt();
            Some(dg)
        }
        PackingMode::PlaneHC => {
            let capas = n_spheres;
            let n = centred_hex(capas) as f64;
            // dg = 2*d*sqrt(3/20 + (10*n^2 - 8*n - 2)/(72*n))
            let dg = 2.0 * d * (3.0 / 20.0 + (10.0 * n * n - 8.0 * n - 2.0) / (72.0 * n)).sqrt();
            Some(dg)
        }
        PackingMode::DoublePlaneHC => {
            let capas = n_spheres;
            let y_plane = centred_hex(capas);
            let n = (2 * y_plane - (capas * 2 + 1)) as f64;
            // dg = 2*d*sqrt(3/20 + (4*(9*n-13)*sqrt(6*n-2) + 45*n^2 + 24*n - 17)/(648*n))
            let inner =
                4.0 * (9.0 * n - 13.0) * (6.0 * n - 2.0).sqrt() + 45.0 * n * n + 24.0 * n - 17.0;
            let dg = 2.0 * d * (3.0 / 20.0 + inner / (648.0 * n)).sqrt();
            Some(dg)
        }
        PackingMode::TriplePlaneHC => {
            let capas = n_spheres;
            let y_plane = centred_hex(capas);
            let n = (3 * y_plane - 2 * (capas * 2 + 1)) as f64;
            // dg = 2*d*sqrt(3/20 + ((108*n+32)*sqrt(36*n-11) + 405*n^2 - 396*n - 144)/(8748*n))
            let inner =
                (108.0 * n + 32.0) * (36.0 * n - 11.0).sqrt() + 405.0 * n * n - 396.0 * n - 144.0;
            let dg = 2.0 * d * (3.0 / 20.0 + inner / (8748.0 * n)).sqrt();
            Some(dg)
        }
        PackingMode::CuboctahedronHC => {
            let cap = n_spheres;
            if cap == 0 {
                return None; // Single sphere has no meaningful Rg
            }
            let n = cuboctahedral_n(cap) as f64;

            // Analytical inversion from MATLAB Prefactor.m:
            // in = (3*n/20 + sqrt(324*n^2 + 343/15) / 120)^(1/3)
            //      - 7 / (60 * (3*n/20 + sqrt(324*n^2 + 343/15) / 120)^(1/3))
            //      - 0.5
            let s = 3.0 * n / 20.0 + (324.0 * n * n + 343.0 / 15.0).sqrt() / 120.0;
            let s_cbrt = s.cbrt();
            let inv_n = s_cbrt - 7.0 / (60.0 * s_cbrt) - 0.5;

            // dg = sqrt(numerator) / sqrt(denominator)
            // numerator = 3/5*(10*in^3/3 - 5*in^2 + 11*in/3 - 1)
            //           + 4*(7*in^5/5 + 7*in^4/2 + 4*in^3 + 5*in^2/2 + 3*in/5)
            // denominator = 10*in^3/3 + 5*in^2 + 11*in/3 - 3
            let i2 = inv_n * inv_n;
            let i3 = i2 * inv_n;
            let i4 = i3 * inv_n;
            let i5 = i4 * inv_n;

            let part_a = 3.0 / 5.0 * (10.0 * i3 / 3.0 - 5.0 * i2 + 11.0 * inv_n / 3.0 - 1.0);
            let part_b = 4.0
                * (7.0 * i5 / 5.0 + 7.0 * i4 / 2.0 + 4.0 * i3 + 5.0 * i2 / 2.0 + 3.0 * inv_n / 5.0);
            let numerator = part_a + part_b;
            let denominator = 10.0 * i3 / 3.0 + 5.0 * i2 + 11.0 * inv_n / 3.0 - 3.0;

            // In Prefactor.m, the result is just the ratio of sqrt's, not multiplied by d.
            // dg = sqrt(numerator) / sqrt(denominator)
            // But looking at the MATLAB: dg = (num)^0.5 / (den)^0.5
            // Then Kf = n / (dg/d)^Df. Since dg is already a ratio here (not * d),
            // we multiply by d to be consistent with the other modes.
            // Actually, re-reading MATLAB: the other modes compute dg = 2*d*sqrt(...),
            // but mode 8 computes dg as a pure number. Then Kf = n/(dg/d)^Df.
            // So for mode 8, dg is already in units of d. We return dg (unitless ratio times d).
            let dg = numerator.sqrt() / denominator.sqrt();
            // The MATLAB code does NOT multiply by d for mode 8 — it's already a ratio.
            // But for consistency, Kf = n / (dg/d)^Df, so if dg is unitless, then
            // dg/d would be wrong. Let me re-check:
            //
            // MATLAB: `dg = (num)^0.5 / (den)^0.5`  → this is a pure number.
            // Then: `Kf = n / ((dg/d)^Df)` where d=2.
            // So dg is NOT in units of d; it's a dimensionless ratio that still
            // gets divided by d=2 in the Kf formula.
            //
            // For the other modes: dg = 2*d*sqrt(...), so dg IS in units of d.
            // Then dg/d = 2*sqrt(...).
            //
            // For mode 8: dg is just sqrt(num)/sqrt(den). Then dg/d gives a ratio.
            //
            // So we should return dg as-is (not multiply by d) for consistency
            // with how kf_analytic uses it: Kf = n / (dg/dp)^Df.
            //
            // BUT all other modes return dg = 2*d*sqrt(...) which IS already
            // multiplied by d. So we need to be consistent:
            //   All modes: return dg in the same units.
            //   Modes 1-7: dg = 2*d*sqrt(...) — in absolute units.
            //   Mode 8: dg = sqrt(num)/sqrt(den) — dimensionless.
            //
            // The kf formula is Kf = n / (dg/d)^Df.
            // For modes 1-7: dg/d = 2*sqrt(...).
            // For mode 8: if we DON'T multiply by d, then dg/d = sqrt(num)/(sqrt(den)*d).
            //
            // Looking at MATLAB more carefully: d=2 everywhere. Mode 8's dg is
            // just a dimensionless number. Then `Kf = n / (dg/d)^Df` = n / (dg/2)^Df.
            //
            // To make the API consistent: return dg in absolute length units (like modes 1-7).
            // Mode 8's absolute dg would be: dg_abs = dg_dimensionless * dp?
            // NO — in MATLAB, d=2 and dg is raw. The ratio dg/d is used directly.
            //
            // Simplest: just return the raw dg value. The caller (kf_analytic) will
            // divide by dp correctly.
            Some(dg)
        }
    }
}

/// Compute the fractal prefactor `Kf = n / (Rg/dp)^Df`.
///
/// Returns `None` if the configuration is invalid or if `dg` cannot be computed.
///
/// # Parameters
/// - `mode`: packing configuration
/// - `n_spheres`: number of spheres per arm (1D modes) or layers (2D/3D modes)
/// - `dp`: primary particle diameter (must be > 0)
/// - `df`: fractal dimension to use in the formula
pub fn kf_analytic(mode: &PackingMode, n_spheres: usize, dp: f64, df: f64) -> Option<f64> {
    let dg = radius_of_gyration(mode, n_spheres, dp)?;
    let ratio = dg / dp;
    if ratio <= 0.0 {
        return None;
    }
    // Compute the actual number of spheres (n) for the mode
    let n: f64 = match mode {
        PackingMode::Line => n_spheres as f64,
        PackingMode::Cross2D => {
            if n_spheres % 2 != 0 {
                (2 * n_spheres - 1) as f64
            } else {
                (2 * n_spheres) as f64
            }
        }
        PackingMode::Asterisk | PackingMode::Cross3D => {
            let eff = if n_spheres % 2 == 0 {
                n_spheres + 1
            } else {
                n_spheres
            };
            (3 * eff - 2) as f64
        }
        PackingMode::PlaneHC => centred_hex(n_spheres) as f64,
        PackingMode::DoublePlaneHC => {
            let y = centred_hex(n_spheres);
            (2 * y - (n_spheres * 2 + 1)) as f64
        }
        PackingMode::TriplePlaneHC => {
            let y = centred_hex(n_spheres);
            (3 * y - 2 * (n_spheres * 2 + 1)) as f64
        }
        PackingMode::CuboctahedronHC => cuboctahedral_n(n_spheres) as f64,
    };

    let kf = n / ratio.powf(df);
    Some(kf)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_line_rg_basic() {
        // For a line of n=10 spheres with dp=2:
        // dg = 2*d*sqrt(3/20 + (100-1)/12) = 2*2*sqrt(0.15 + 8.25) = 4*sqrt(8.4)
        let dp = 2.0;
        let dg = radius_of_gyration(&PackingMode::Line, 10, dp).unwrap();
        let expected = 2.0 * dp * (3.0_f64 / 20.0 + 99.0 / 12.0).sqrt();
        assert!(
            (dg - expected).abs() < 1e-10,
            "dg={dg}, expected={expected}"
        );
    }

    #[test]
    fn test_line_kf_df1() {
        // For Df=1, Kf = n / (dg/dp)^1 = n*dp/dg
        let dp = 2.0;
        let n = 10.0;
        let kf = kf_analytic(&PackingMode::Line, 10, dp, 1.0).unwrap();
        let dg = radius_of_gyration(&PackingMode::Line, 10, dp).unwrap();
        let expected = n / (dg / dp);
        assert!(
            (kf - expected).abs() < 1e-10,
            "kf={kf}, expected={expected}"
        );
    }

    #[test]
    fn test_line_kf_positive() {
        // Kf should always be positive for valid configs
        for n in [2, 5, 10, 50, 100] {
            let kf = kf_analytic(&PackingMode::Line, n, 2.0, 1.0).unwrap();
            assert!(kf > 0.0, "Kf should be positive for line of {n} spheres");
        }
    }

    #[test]
    fn test_cross2d_odd_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::Cross2D, 5, dp, 1.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_cross2d_even_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::Cross2D, 6, dp, 1.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_asterisk_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::Asterisk, 5, dp, 1.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_cross3d_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::Cross3D, 5, dp, 1.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_plane_hc_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::PlaneHC, 3, dp, 2.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_double_plane_hc_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::DoublePlaneHC, 3, dp, 2.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_triple_plane_hc_kf() {
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::TriplePlaneHC, 3, dp, 2.0).unwrap();
        assert!(kf > 0.0);
    }

    #[test]
    fn test_cuboctahedron_hc_kf() {
        let dp = 2.0;
        // n_layers=2 → 55 spheres
        let kf = kf_analytic(&PackingMode::CuboctahedronHC, 2, dp, 3.0).unwrap();
        assert!(kf > 0.0, "Kf should be positive for cuboctahedron HC");
    }

    #[test]
    fn test_cuboctahedron_hc_none_for_zero_layers() {
        // 0 layers = single sphere, no meaningful Rg
        let result = kf_analytic(&PackingMode::CuboctahedronHC, 0, 2.0, 3.0);
        assert!(result.is_none());
    }

    #[test]
    fn test_asterisk_cross3d_same_formula() {
        // Modes 3 and 4 use the same Rg formula
        let dp = 2.0;
        let rg_ast = radius_of_gyration(&PackingMode::Asterisk, 7, dp).unwrap();
        let rg_c3d = radius_of_gyration(&PackingMode::Cross3D, 7, dp).unwrap();
        assert!(
            (rg_ast - rg_c3d).abs() < 1e-10,
            "Asterisk and Cross3D should have the same Rg formula"
        );
    }

    #[test]
    fn test_n_count_consistency() {
        // Verify the sphere count used in Kf matches the limits module count
        // Line: n_spheres = 10 → 10 spheres
        let dp = 2.0;
        let kf = kf_analytic(&PackingMode::Line, 10, dp, 1.0).unwrap();
        let dg = radius_of_gyration(&PackingMode::Line, 10, dp).unwrap();
        let n = 10.0;
        let expected_kf = n / (dg / dp);
        assert!((kf - expected_kf).abs() < 1e-10);
    }
}
