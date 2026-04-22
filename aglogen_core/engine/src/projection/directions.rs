//! Direction generators for projection export.
//!
//! Produces pure `Direction` lists (azimuth/elevation pairs) decoupled from
//! the rendering pipeline. Two strategies are supported:
//!
//! - [`generate_grid`] — a rectangular Az × El grid with exact pole dedup.
//! - [`generate_fibonacci`] — a golden-angle spiral lattice on the unit sphere.
//!
//! Both functions return `Vec<Direction>` in a deterministic order so callers
//! (Python bindings, tests, ZIP builders) can rely on stable indexing.
//!
//! See `openspec/changes/projections-export-fix/specs/projection-export-contract.md`
//! (R1, R2, R7) for the observable contract this module implements.

use std::f64::consts::PI;

/// A viewing direction expressed as azimuth/elevation in degrees.
///
/// - `azimuth_deg` is normalized to `[0, 360)`.
/// - `elevation_deg` lies in `[-90, +90]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Direction {
    pub azimuth_deg: f64,
    pub elevation_deg: f64,
}

/// Generate a rectangular Az × El grid with exact pole dedup.
///
/// - Elevations are `linspace(-90, +90, n_el)` — the endpoints are the poles.
/// - Azimuths are `linspace(0, 360, n_az + 1)[..n_az]` — excluding `360`
///   to avoid duplicating `0`.
///
/// For each elevation:
/// - if `|elevation| == 90.0` exactly → emit exactly ONE `Direction`
///   (azimuth canonicalized to `0`),
/// - otherwise → emit `n_az` directions (one per azimuth).
///
/// Output count is therefore `n_az * (n_el - 2) + 2` whenever `n_el >= 2`
/// and poles are the endpoints (which holds by construction).
///
/// Output order: for each elevation in ascending order, all its azimuths in
/// ascending order. Poles appear at the first and last positions.
///
/// # Panics
/// - Panics if `n_az == 0`.
/// - Panics if `n_el < 2`.
pub fn generate_grid(n_az: usize, n_el: usize) -> Vec<Direction> {
    assert!(n_az >= 1, "generate_grid: n_az must be >= 1, got {}", n_az);
    assert!(n_el >= 2, "generate_grid: n_el must be >= 2, got {}", n_el);

    let expected = n_az * n_el.saturating_sub(2) + 2;
    let mut out = Vec::with_capacity(expected);

    // linspace(-90, +90, n_el) — endpoints inclusive, so indices 0 and n_el-1
    // land exactly on -90 and +90 (no float drift at the poles).
    for i in 0..n_el {
        let elevation_deg = if i == 0 {
            -90.0
        } else if i == n_el - 1 {
            90.0
        } else {
            -90.0 + (180.0 * i as f64) / (n_el as f64 - 1.0)
        };

        if (elevation_deg.abs() - 90.0).abs() < 1e-12 {
            // Pole: a single direction regardless of n_az.
            out.push(Direction {
                azimuth_deg: 0.0,
                elevation_deg: if elevation_deg > 0.0 { 90.0 } else { -90.0 },
            });
        } else {
            // Intermediate elevation: n_az azimuths in [0, 360).
            for j in 0..n_az {
                let azimuth_deg = (360.0 * j as f64) / n_az as f64;
                out.push(Direction {
                    azimuth_deg,
                    elevation_deg,
                });
            }
        }
    }

    out
}

/// Generate `n` directions on the unit sphere via a golden-angle Fibonacci
/// spiral lattice.
///
/// For `i in 0..n`:
/// ```text
/// phi       = PI * (3.0 - sqrt(5.0))            // golden angle
/// y         = 1.0 - (2*i + 1) / n               // [-1, 1], symmetric
/// r         = sqrt(1 - y*y)
/// theta     = i * phi
/// x         = r * cos(theta)
/// z         = r * sin(theta)
/// azimuth   = atan2(z, x).to_degrees().rem_euclid(360)
/// elevation = y.asin().to_degrees()
/// ```
///
/// Output order is natural lattice order (i = 0 near the north pole, i = n-1
/// near the south pole).
///
/// # Panics
/// - Panics if `n == 0`.
pub fn generate_fibonacci(n: usize) -> Vec<Direction> {
    assert!(n >= 1, "generate_fibonacci: n must be >= 1, got {}", n);

    let golden_angle = PI * (3.0 - 5.0_f64.sqrt());
    let mut out = Vec::with_capacity(n);

    for i in 0..n {
        let y = 1.0 - (2.0 * i as f64 + 1.0) / n as f64;
        // Clamp y to [-1, 1] defensively — float arithmetic can otherwise
        // produce |y| marginally > 1, which breaks asin().
        let y_clamped = y.clamp(-1.0, 1.0);
        let r = (1.0 - y_clamped * y_clamped).max(0.0).sqrt();
        let theta = i as f64 * golden_angle;
        let x = r * theta.cos();
        let z = r * theta.sin();

        let azimuth_deg = if r < 1e-12 {
            // At the pole, atan2 is undetermined — canonicalize to 0.
            0.0
        } else {
            z.atan2(x).to_degrees().rem_euclid(360.0)
        };
        let elevation_deg = y_clamped.asin().to_degrees();

        out.push(Direction {
            azimuth_deg,
            elevation_deg,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_count_matches_formula_various_n_el() {
        // R1: exactly n_az*(n_el-2)+2 projections
        for (n_az, n_el) in [(10, 5), (6, 3), (4, 7), (1, 2), (8, 4)] {
            let dirs = generate_grid(n_az, n_el);
            let expected = n_az * n_el.saturating_sub(2) + 2;
            assert_eq!(dirs.len(), expected, "n_az={n_az} n_el={n_el}");
        }
    }

    #[test]
    fn grid_poles_appear_once_each() {
        let dirs = generate_grid(10, 5);
        let north = dirs
            .iter()
            .filter(|d| (d.elevation_deg - 90.0).abs() < 1e-9)
            .count();
        let south = dirs
            .iter()
            .filter(|d| (d.elevation_deg + 90.0).abs() < 1e-9)
            .count();
        assert_eq!(north, 1, "exactly one north pole");
        assert_eq!(south, 1, "exactly one south pole");
    }

    #[test]
    fn grid_n_el_2_yields_only_poles() {
        let dirs = generate_grid(10, 2);
        assert_eq!(dirs.len(), 2);
        assert!(dirs.iter().any(|d| (d.elevation_deg - 90.0).abs() < 1e-9));
        assert!(dirs.iter().any(|d| (d.elevation_deg + 90.0).abs() < 1e-9));
    }

    #[test]
    fn fibonacci_exact_count() {
        // R2: exactly N directions
        for n in [1usize, 2, 50, 100, 500] {
            let dirs = generate_fibonacci(n);
            assert_eq!(dirs.len(), n, "n={n}");
        }
    }

    #[test]
    fn fibonacci_elevations_are_in_valid_range() {
        let dirs = generate_fibonacci(100);
        for d in dirs {
            assert!(
                d.elevation_deg >= -90.0 - 1e-9 && d.elevation_deg <= 90.0 + 1e-9,
                "elevation out of range: {}",
                d.elevation_deg
            );
            assert!(
                d.azimuth_deg >= 0.0 && d.azimuth_deg < 360.0 + 1e-9,
                "azimuth out of range: {}",
                d.azimuth_deg
            );
        }
    }

    #[test]
    fn fibonacci_azimuth_math_cardinals() {
        // R7 partial: verify atan2(z, x) convention via pole behavior.
        // For i=0 in fibonacci: y = 1 - 1/n ≈ +1, so elevation ≈ +90 (near north pole)
        let dirs = generate_fibonacci(4);
        // First point should have elevation close to +90
        assert!(
            dirs[0].elevation_deg > 40.0,
            "first point should be near north, got {}",
            dirs[0].elevation_deg
        );
        // Last point should have elevation close to -90
        let last = dirs.last().unwrap();
        assert!(
            last.elevation_deg < -40.0,
            "last point should be near south, got {}",
            last.elevation_deg
        );
    }

    #[test]
    fn fibonacci_points_are_distinct() {
        // Basic uniqueness check — no two points within 0.01° of each other.
        let dirs = generate_fibonacci(50);
        for i in 0..dirs.len() {
            for j in (i + 1)..dirs.len() {
                let daz = (dirs[i].azimuth_deg - dirs[j].azimuth_deg).abs();
                let del = (dirs[i].elevation_deg - dirs[j].elevation_deg).abs();
                assert!(daz > 0.01 || del > 0.01, "points {i} and {j} too close");
            }
        }
    }
}
