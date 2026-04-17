//! Closed-form sphere-arrangement generators for limit-case validation.
//! Ported from `BOXCOUNTER/casosLimiteEsferas.m`.
//! Every geometry has a known integer theoretical Df (1, 2, or 3).
//!
//! All generators produce sphere centres with unit radius (`r = 1`).
//! Coincident points are deduplicated with a tolerance of 1e-10.

/// Result of generating a limit case.
#[derive(Debug, Clone)]
pub struct LimitCase {
    /// Sphere centre coordinates `[x, y, z]`.
    pub centres: Vec<[f64; 3]>,
    /// Human-readable name of the configuration.
    pub name: &'static str,
    /// Known integer theoretical fractal dimension (1.0, 2.0, or 3.0).
    pub theoretical_df: f64,
    /// Mode number (1–13), matching MATLAB `modo`.
    pub mode: u8,
}

// ---------------------------------------------------------------------------
// Deduplication helper
// ---------------------------------------------------------------------------

/// Remove duplicate points within an absolute tolerance of `tol` per coordinate.
fn deduplicate(pts: &mut Vec<[f64; 3]>, tol: f64) {
    let mut unique: Vec<[f64; 3]> = Vec::with_capacity(pts.len());
    for p in pts.iter() {
        let dup = unique.iter().any(|q| {
            (p[0] - q[0]).abs() < tol && (p[1] - q[1]).abs() < tol && (p[2] - q[2]).abs() < tol
        });
        if !dup {
            unique.push(*p);
        }
    }
    *pts = unique;
}

// ---------------------------------------------------------------------------
// 1D geometries — theoretical Df = 1
// ---------------------------------------------------------------------------

/// **Mode 1 — Line**: `n_spheres` spheres along the x-axis at spacing `2r`.
///
/// Centre `i` is at `(2*(i-1), 0, 0)` for `i = 0..n_spheres-1`.
pub fn line(n_spheres: usize) -> LimitCase {
    let r = 1.0;
    let centres: Vec<[f64; 3]> = (0..n_spheres)
        .map(|i| [2.0 * r * i as f64, 0.0, 0.0])
        .collect();
    LimitCase {
        centres,
        name: "line",
        theoretical_df: 1.0,
        mode: 1,
    }
}

/// **Mode 2 — 2D Cross**: a cross shape with `n_per_arm` spheres on each of
/// the 4 arms plus a shared centre region.
///
/// For *odd* `n_per_arm`: a horizontal spine of `n_per_arm` spheres, plus
/// `floor(n_per_arm/2)` spheres above and below from the midpoint.
///
/// For *even* `n_per_arm`: two horizontal half-segments separated by a
/// `2*(sqrt(2)-1)` gap, plus vertical arms from the junction.
pub fn cross_2d(n_per_arm: usize) -> LimitCase {
    let r = 1.0;
    let n = n_per_arm;
    let mut pts: Vec<[f64; 3]> = Vec::new();

    if n % 2 != 0 {
        // Odd case
        let ultima = n as f64 * 2.0 * r;
        // Horizontal spine
        for i in 0..n {
            pts.push([2.0 * r * i as f64, 0.0, 0.0]);
        }
        let half = n / 2;
        // Upper arm
        for j in 1..=half {
            pts.push([ultima / 2.0 - r, 2.0 * r * j as f64, 0.0]);
        }
        // Lower arm
        for k in 1..=half {
            pts.push([ultima / 2.0 - r, -(2.0 * r * k as f64), 0.0]);
        }
    } else {
        // Even case
        let ultima = n as f64 * 2.0 * r;
        let half = n / 2;
        let gap = 2.0 * (2.0_f64.sqrt() - 1.0);

        // Left horizontal segment
        for i in 0..half {
            pts.push([2.0 * r * i as f64, 0.0, 0.0]);
        }
        // Right horizontal segment (offset by gap)
        for j in 0..half {
            pts.push([ultima / 2.0 + gap + 2.0 * r * j as f64, 0.0, 0.0]);
        }
        let junction_x = ultima / 2.0 + (2.0_f64.sqrt() - 1.0) - r;
        let sqrt2 = 2.0_f64.sqrt();
        // Upper arm
        for k in 0..half {
            pts.push([junction_x, sqrt2 + 2.0 * r * k as f64, 0.0]);
        }
        // Lower arm
        for s in 0..half {
            pts.push([junction_x, -(sqrt2 + 2.0 * r * s as f64), 0.0]);
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "cross_2d",
        theoretical_df: 1.0,
        mode: 2,
    }
}

/// **Mode 3 — Asterisk**: a 6-arm star pattern (3 lines at 60° in the
/// xy-plane).
///
/// If `n_per_arm` is even, it is silently incremented to the next odd number
/// (matching MATLAB behaviour).
pub fn asterisk(n_per_arm: usize) -> LimitCase {
    let r = 1.0;
    let n = if n_per_arm % 2 == 0 {
        n_per_arm + 1
    } else {
        n_per_arm
    };
    let half = n / 2; // floor(n/2)
    let sqrt3 = 3.0_f64.sqrt();
    let mut pts: Vec<[f64; 3]> = Vec::with_capacity(half * 6 + 1);

    // Vertical arm (along y, centred)
    let cx = 2.0 * r * n as f64 / 2.0;
    for i in 0..n {
        let yy = half as f64 * 2.0 * r + 2.0 * r * (-(i as f64));
        pts.push([cx, yy, 0.0]);
    }

    // Diagonal arm +60° (upper-left to lower-right)
    for j in 0..n {
        let xx = 2.0 * r * half as f64 + r - half as f64 * sqrt3 + j as f64 * sqrt3;
        let yy = -(r * half as f64) + j as f64 * r;
        pts.push([xx, yy, 0.0]);
    }

    // Diagonal arm -60° (lower-left to upper-right)
    for k in 0..n {
        let xx = 2.0 * r * half as f64 + r - half as f64 * sqrt3 + k as f64 * sqrt3;
        let yy = r * half as f64 - k as f64 * r;
        pts.push([xx, yy, 0.0]);
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "asterisk",
        theoretical_df: 1.0,
        mode: 3,
    }
}

/// **Mode 4 — 3D Cross**: a 3D cross (z-spine + two 60° diagonals in xy,
/// like the asterisk but with the vertical arm along z instead of y).
///
/// If `n_per_arm` is even, it is silently incremented to odd.
pub fn cross_3d(n_per_arm: usize) -> LimitCase {
    let r = 1.0;
    let n = if n_per_arm % 2 == 0 {
        n_per_arm + 1
    } else {
        n_per_arm
    };
    let half = n / 2;
    let sqrt3 = 3.0_f64.sqrt();
    let ultima = n as f64 * 2.0 * r;
    let mut pts: Vec<[f64; 3]> = Vec::new();

    // Vertical spine along z
    for i in 0..n {
        let zz = -r + 2.0 * r * n as f64 / 2.0 - 2.0 * r * i as f64;
        pts.push([ultima / 2.0, 0.0, zz]);
    }

    // Diagonal arm +60° in xy-plane at z=0
    for j in 0..n {
        let xx = 2.0 * r * half as f64 + r - half as f64 * sqrt3 + j as f64 * sqrt3;
        let yy = -(r * half as f64) + j as f64 * r;
        pts.push([xx, yy, 0.0]);
    }

    // Diagonal arm -60° in xy-plane at z=0
    for k in 0..n {
        let xx = 2.0 * r * half as f64 + r - half as f64 * sqrt3 + k as f64 * sqrt3;
        let yy = r * half as f64 - k as f64 * r;
        pts.push([xx, yy, 0.0]);
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "cross_3d",
        theoretical_df: 1.0,
        mode: 4,
    }
}

// ---------------------------------------------------------------------------
// 2D geometries — theoretical Df = 2
// ---------------------------------------------------------------------------

/// **Mode 5 (HC) — Hexagonal close-packed plane**: a single hexagonal-lattice
/// plane with `n_layers` concentric rings around a central sphere.
///
/// The total number of spheres is the centred hexagonal number:
/// `n = 1 + 6*(1 + 2 + … + n_layers) = 1 + 3*n_layers*(n_layers+1)`.
pub fn plane_hc(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let sqrt3 = 3.0_f64.sqrt();
    let esferas2 = n_layers * 2 + 1;
    let half = (esferas2 + 1) / 2; // ceil(esferas2/2)
    let mut pts: Vec<[f64; 3]> = Vec::new();

    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let yy = sqrt3 * (i as f64 - 1.0);
            pts.push([xx, yy, 0.0]);
            // Mirror in y for rows above the first (i > 1)
            if i > 1 {
                pts.push([xx, -yy, 0.0]);
            }
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "plane_hc",
        theoretical_df: 2.0,
        mode: 5,
    }
}

/// **Mode 5 (CS) — Simple-cubic plane**: a square grid of `(n_layers+1)^2`
/// spheres at spacing `2r`.
pub fn plane_cs(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let n = n_layers + 1;
    let mut pts: Vec<[f64; 3]> = Vec::with_capacity(n * n);

    for j in 0..n {
        for i in 0..n {
            pts.push([2.0 * r * i as f64, 2.0 * r * j as f64, 0.0]);
        }
    }

    // No dedup needed for a perfect grid, but call it for safety.
    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "plane_cs",
        theoretical_df: 2.0,
        mode: 5,
    }
}

/// **Mode 6 — Double plane (HC)**: two perpendicular hexagonal close-packed
/// planes (one in xy, one in xz) sharing a common x-axis row.
pub fn double_plane_hc(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let sqrt3 = 3.0_f64.sqrt();
    let esferas2 = n_layers * 2 + 1;
    let half = (esferas2 + 1) / 2;
    let mut pts: Vec<[f64; 3]> = Vec::new();

    // First plane: xy (z = 0)
    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let yy = sqrt3 * (i as f64 - 1.0);
            pts.push([xx, yy, 0.0]);
            if i > 1 {
                pts.push([xx, -yy, 0.0]);
            }
        }
    }

    // Second plane: xz (y = 0)
    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let zz = sqrt3 * (i as f64 - 1.0);
            pts.push([xx, 0.0, zz]);
            // Always mirror for the second plane (no conditional skip)
            pts.push([xx, 0.0, -zz]);
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "double_plane_hc",
        theoretical_df: 2.0,
        mode: 6,
    }
}

/// **Mode 7 — Triple plane (HC)**: three hexagonal close-packed planes at
/// 60° to each other, intersecting along a common x-axis. HC only.
pub fn triple_plane_hc(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let sqrt3 = 3.0_f64.sqrt();
    let esferas2 = n_layers * 2 + 1;
    let half = (esferas2 + 1) / 2;
    let mut pts: Vec<[f64; 3]> = Vec::new();

    // Plane 1: xy (flat, z = 0)
    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let yy = sqrt3 * (i as f64 - 1.0);
            pts.push([xx, yy, 0.0]);
            pts.push([xx, -yy, 0.0]);
        }
    }

    // Plane 2: tilted +60° (y = sqrt(3)/2 * t, z = 3/2 * t)
    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let yy = sqrt3 / 2.0 * (i as f64 - 1.0);
            let zz = 1.5 * (i as f64 - 1.0);
            pts.push([xx, yy, zz]);
            pts.push([xx, -yy, -zz]);
        }
    }

    // Plane 3: tilted -60° (y = -sqrt(3)/2 * t, z = 3/2 * t)
    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let yy = -(sqrt3 / 2.0) * (i as f64 - 1.0);
            let zz = 1.5 * (i as f64 - 1.0);
            pts.push([xx, yy, zz]);
            pts.push([xx, sqrt3 / 2.0 * (i as f64 - 1.0), -zz]);
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "triple_plane_hc",
        theoretical_df: 2.0,
        mode: 7,
    }
}

// ---------------------------------------------------------------------------
// 3D geometries — theoretical Df = 3
// ---------------------------------------------------------------------------

/// Exact HC inter-plane z-spacing: `2*sqrt(6)/3`.
const HC_Z_SPACING: f64 = {
    // 2.0 * sqrt(6.0) / 3.0
    // sqrt(6) ≈ 2.449489742783178
    // We rely on the compiler evaluating this at const time via a literal,
    // since f64::sqrt is not const. The value is exact to f64 precision.
    1.632_993_161_855_452_1
};

/// **Mode 8 (HC) — Cuboctahedron, hexagonal close-packed**: a 3D
/// cuboctahedral arrangement with `n_layers` concentric shells.
///
/// The number of spheres follows OEIS A005902:
/// `n = 1, 13, 55, 147, 309, …` for `n_layers = 0, 1, 2, 3, 4, …`
/// (i.e., `n(0) = 1`, `n(L) = 1 + Σ_{i=1}^{L} (10*i² + 2)`).
///
/// Uses exact z-spacing `2*sqrt(6)/3` instead of the MATLAB approximation `1.6345`.
pub fn cuboctahedron_hc(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let sqrt3 = 3.0_f64.sqrt();
    let sqrt3_inv3 = sqrt3 / 3.0;
    let capas = n_layers;

    if capas == 0 {
        return LimitCase {
            centres: vec![[0.0, 0.0, 0.0]],
            name: "cuboctahedron_hc",
            theoretical_df: 3.0,
            mode: 8,
        };
    }

    let esferas2 = capas * 2 + 1;
    let half = (esferas2 + 1) / 2; // ceil(esferas2/2)
    let mut pts: Vec<[f64; 3]> = Vec::new();

    // Base hexagonal plane (z = 0)
    for i in 1..=half {
        for j in i..=esferas2 {
            let xx = 2.0 * r * (j as f64 - 1.0) - (i as f64 - 1.0);
            let yy = sqrt3 * (i as f64 - 1.0);
            pts.push([xx, yy, 0.0]);
            pts.push([xx, -yy, 0.0]);
        }
    }

    // --- FRONT (positive z) ---
    // Lines on top of the triangles
    if capas >= 2 {
        for j in 1..capas {
            for k in 1..=(capas - j) {
                for i in 0..(esferas2 - k - j) {
                    // MATLAB: xx = 2*r + 2*r*(i-1) + r*(j-1) + r*(k-1)
                    // With 0-indexed i in Rust, j/k are 1-based as in MATLAB.
                    let xx_m =
                        2.0 * r + 2.0 * r * i as f64 + r * (j as f64 - 1.0) + r * (k as f64 - 1.0);
                    let yy_m = sqrt3 * j as f64 + sqrt3_inv3 * k as f64;
                    let zz_m = HC_Z_SPACING * k as f64;
                    pts.push([xx_m, yy_m, zz_m]);
                }
            }
        }
    }

    // Triangles on both sides (front)
    // MATLAB: for k=1:ceil(esferas2/2)-1; for j=1:ceil(esferas2/2);
    //         for i=1:esferas2-j-(k-1)
    for k in 1..half {
        for j in 1..=half {
            let i_count = esferas2 as isize - j as isize - (k as isize - 1);
            for i in 0..i_count.max(0) as usize {
                // MATLAB: xx = (k-1)*r + r*j + 2*r*(i-1)  (i is 1-based)
                // With 0-indexed i: xx = (k-1)*r + r*j + 2*r*i
                let xx = (k as f64 - 1.0) * r + r * j as f64 + 2.0 * r * i as f64;
                let yy = sqrt3_inv3 - sqrt3 * (j as f64 - 1.0) + (k as f64 - 1.0) * sqrt3_inv3;
                let zz = HC_Z_SPACING * k as f64;
                pts.push([xx, yy, zz]);
            }
        }
    }

    // --- BACK (negative z) — mirror of front ---
    // Lines on top of triangles (back)
    if capas >= 2 {
        for j in 1..capas {
            for k in 1..=(capas - j) {
                for i in 0..(esferas2 - k - j) {
                    let xx_m =
                        2.0 * r + 2.0 * r * i as f64 + r * (j as f64 - 1.0) + r * (k as f64 - 1.0);
                    let yy_m = -(sqrt3 * j as f64 + sqrt3_inv3 * k as f64);
                    let zz_m = -(HC_Z_SPACING * k as f64);
                    pts.push([xx_m, yy_m, zz_m]);
                }
            }
        }
    }

    // Triangles on both sides (back)
    // MATLAB: for k=1:ceil(esferas2/2)-1; for j=1:ceil(esferas2/2);
    //         for i=1:esferas2-j-(k-1)
    for k in 1..half {
        for j in 1..=half {
            let i_count = esferas2 as isize - j as isize - (k as isize - 1);
            for i in 0..i_count.max(0) as usize {
                let xx = (k as f64 - 1.0) * r + r * j as f64 + 2.0 * r * i as f64;
                // MATLAB back side: yy = -sqrt(3)/3 + sqrt(3)*(j-1) - (k-1)*sqrt(3)/3
                // NOTE: MATLAB line 797 has a bug: missing *sqrt(3)/3 on (k-1).
                // We use the CORRECTED formula: yy = -sqrt3_inv3 + sqrt3*(j-1) - (k-1)*sqrt3_inv3
                let yy = -sqrt3_inv3 + sqrt3 * (j as f64 - 1.0) - (k as f64 - 1.0) * sqrt3_inv3;
                let zz = -(HC_Z_SPACING * k as f64);
                pts.push([xx, yy, zz]);
            }
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "cuboctahedron_hc",
        theoretical_df: 3.0,
        mode: 8,
    }
}

/// **Mode 8 (CS) — Cuboctahedron, simple cubic**: a cube of
/// `(n_layers+1)^3` spheres at spacing `2r`.
pub fn cuboctahedron_cs(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let n = n_layers + 1;
    let mut pts: Vec<[f64; 3]> = Vec::with_capacity(n * n * n);

    for j in 0..n {
        for i in 0..n {
            for k in 0..n {
                pts.push([2.0 * r * i as f64, 2.0 * r * j as f64, 2.0 * r * k as f64]);
            }
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "cuboctahedron_cs",
        theoretical_df: 3.0,
        mode: 8,
    }
}

/// **Mode 8 (CCC/FCC) — Cuboctahedron, face-centred cubic**: two
/// interpenetrating simple-cubic lattices at spacing `4/sqrt(3)*r`, offset
/// by `2/sqrt(3)*r`.
pub fn cuboctahedron_ccc(n_layers: usize) -> LimitCase {
    let r = 1.0;
    let spacing = 4.0 / 3.0_f64.sqrt() * r;
    let offset = 2.0 / 3.0_f64.sqrt();
    let n = n_layers + 1;
    let cap = n_layers;
    let mut pts: Vec<[f64; 3]> = Vec::with_capacity(n * n * n + cap * cap * cap);

    // First lattice
    for j in 0..n {
        for i in 0..n {
            for k in 0..n {
                pts.push([spacing * i as f64, spacing * j as f64, spacing * k as f64]);
            }
        }
    }

    // Second lattice (offset)
    for j in 0..cap {
        for i in 0..cap {
            for k in 0..cap {
                pts.push([
                    offset + spacing * i as f64,
                    offset + spacing * j as f64,
                    offset + spacing * k as f64,
                ]);
            }
        }
    }

    deduplicate(&mut pts, 1e-10);
    LimitCase {
        centres: pts,
        name: "cuboctahedron_ccc",
        theoretical_df: 3.0,
        mode: 8,
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: centred hexagonal number: 1 + 3*n*(n+1)
    fn centred_hex(n: usize) -> usize {
        1 + 3 * n * (n + 1)
    }

    // Helper: cuboctahedral number (OEIS A005902)
    fn cuboctahedral(layers: usize) -> usize {
        let mut total: usize = 1;
        for i in 1..=layers {
            total += 10 * i * i + 2;
        }
        total
    }

    // ----- 1D cases -----

    #[test]
    fn test_line_basic() {
        let lc = line(1);
        assert_eq!(lc.centres.len(), 1);
        assert_eq!(lc.theoretical_df, 1.0);

        let lc = line(10);
        assert_eq!(lc.centres.len(), 10);

        let lc = line(100);
        assert_eq!(lc.centres.len(), 100);

        // Verify spacing: last sphere at x = 2*99 = 198
        assert!((lc.centres[99][0] - 198.0).abs() < 1e-10);
    }

    #[test]
    fn test_cross_2d_odd() {
        // n_per_arm=5 (odd): 5 on spine + 2 up + 2 down = 9
        let lc = cross_2d(5);
        assert_eq!(lc.centres.len(), 9);
        assert_eq!(lc.theoretical_df, 1.0);
    }

    #[test]
    fn test_cross_2d_even() {
        // n_per_arm=4 (even): 2 left + 2 right + 2 up + 2 down = 8
        let lc = cross_2d(4);
        assert_eq!(lc.centres.len(), 8);
        assert_eq!(lc.theoretical_df, 1.0);
    }

    #[test]
    fn test_cross_2d_total_spheres() {
        // Odd n: total = n + 2*floor(n/2) = n + n-1 = 2n-1
        let lc = cross_2d(7);
        assert_eq!(lc.centres.len(), 2 * 7 - 1);

        // Even n: total = 4*(n/2) = 2n
        let lc = cross_2d(6);
        assert_eq!(lc.centres.len(), 2 * 6);
    }

    #[test]
    fn test_asterisk_odd() {
        // n_per_arm=5: 3 arms of 5, meeting at centre → 3*5 - 2 = 13
        let lc = asterisk(5);
        assert_eq!(lc.centres.len(), 3 * 5 - 2);
        assert_eq!(lc.theoretical_df, 1.0);
    }

    #[test]
    fn test_asterisk_even_incremented() {
        // n_per_arm=4 → incremented to 5 → 13
        let lc = asterisk(4);
        assert_eq!(lc.centres.len(), 3 * 5 - 2);
    }

    #[test]
    fn test_cross_3d_odd() {
        // Same structure as asterisk: 3 arms at 60°, but z-spine instead of y
        let lc = cross_3d(5);
        assert_eq!(lc.centres.len(), 3 * 5 - 2);
        assert_eq!(lc.theoretical_df, 1.0);
    }

    // ----- 2D cases -----

    #[test]
    fn test_plane_hc_layer_counts() {
        // layers=0: just 1 sphere
        let lc = plane_hc(0);
        assert_eq!(lc.centres.len(), 1);

        // layers=1: 1 + 6 = 7
        let lc = plane_hc(1);
        assert_eq!(lc.centres.len(), centred_hex(1));
        assert_eq!(lc.centres.len(), 7);

        // layers=2: 1 + 6 + 12 = 19
        let lc = plane_hc(2);
        assert_eq!(lc.centres.len(), centred_hex(2));
        assert_eq!(lc.centres.len(), 19);

        // layers=3: 1 + 6 + 12 + 18 = 37
        let lc = plane_hc(3);
        assert_eq!(lc.centres.len(), centred_hex(3));
        assert_eq!(lc.centres.len(), 37);

        assert_eq!(lc.theoretical_df, 2.0);
    }

    #[test]
    fn test_plane_cs() {
        // n_layers=2 → (2+1)^2 = 9
        let lc = plane_cs(2);
        assert_eq!(lc.centres.len(), 9);

        // n_layers=3 → 16
        let lc = plane_cs(3);
        assert_eq!(lc.centres.len(), 16);
        assert_eq!(lc.theoretical_df, 2.0);
    }

    #[test]
    fn test_double_plane_hc() {
        // Mode 6: two perpendicular HC planes share the central row
        // Expected: 2 * hex_plane - shared_row = 2*centred_hex(n) - (2*n+1)
        let lc = double_plane_hc(1);
        let expected = 2 * centred_hex(1) - (2 * 1 + 1);
        assert_eq!(lc.centres.len(), expected); // 2*7 - 3 = 11
        assert_eq!(lc.theoretical_df, 2.0);

        let lc = double_plane_hc(2);
        let expected = 2 * centred_hex(2) - (2 * 2 + 1);
        assert_eq!(lc.centres.len(), expected); // 2*19 - 5 = 33
    }

    #[test]
    fn test_triple_plane_hc() {
        // Mode 7: three HC planes share the central row
        // Expected: 3*centred_hex(n) - 2*(2*n+1)
        let lc = triple_plane_hc(1);
        let expected = 3 * centred_hex(1) - 2 * (2 * 1 + 1);
        assert_eq!(lc.centres.len(), expected); // 3*7 - 6 = 15
        assert_eq!(lc.theoretical_df, 2.0);

        let lc = triple_plane_hc(2);
        let expected = 3 * centred_hex(2) - 2 * (2 * 2 + 1);
        assert_eq!(lc.centres.len(), expected); // 3*19 - 10 = 47
    }

    // ----- 3D cases -----

    #[test]
    fn test_cuboctahedron_hc_known_counts() {
        // OEIS A005902: 1, 13, 55, 147, 309
        let lc = cuboctahedron_hc(0);
        assert_eq!(lc.centres.len(), 1);

        let lc = cuboctahedron_hc(1);
        assert_eq!(lc.centres.len(), cuboctahedral(1));
        assert_eq!(lc.centres.len(), 13);

        let lc = cuboctahedron_hc(2);
        assert_eq!(lc.centres.len(), cuboctahedral(2));
        assert_eq!(lc.centres.len(), 55);

        assert_eq!(lc.theoretical_df, 3.0);
    }

    #[test]
    fn test_cuboctahedron_cs() {
        // Simple cubic: (n+1)^3
        let lc = cuboctahedron_cs(1);
        assert_eq!(lc.centres.len(), 8);

        let lc = cuboctahedron_cs(2);
        assert_eq!(lc.centres.len(), 27);

        let lc = cuboctahedron_cs(3);
        assert_eq!(lc.centres.len(), 64);
        assert_eq!(lc.theoretical_df, 3.0);
    }

    #[test]
    fn test_cuboctahedron_ccc() {
        // FCC: (n+1)^3 + n^3
        let lc = cuboctahedron_ccc(1);
        assert_eq!(lc.centres.len(), 8 + 1); // 2^3 + 1^3 = 9

        let lc = cuboctahedron_ccc(2);
        assert_eq!(lc.centres.len(), 27 + 8); // 3^3 + 2^3 = 35
        assert_eq!(lc.theoretical_df, 3.0);
    }

    // ----- Metadata checks -----

    #[test]
    fn test_all_modes_have_correct_metadata() {
        assert_eq!(line(5).mode, 1);
        assert_eq!(cross_2d(5).mode, 2);
        assert_eq!(asterisk(5).mode, 3);
        assert_eq!(cross_3d(5).mode, 4);
        assert_eq!(plane_hc(2).mode, 5);
        assert_eq!(plane_cs(2).mode, 5);
        assert_eq!(double_plane_hc(2).mode, 6);
        assert_eq!(triple_plane_hc(2).mode, 7);
        assert_eq!(cuboctahedron_hc(2).mode, 8);
        assert_eq!(cuboctahedron_cs(2).mode, 8);
        assert_eq!(cuboctahedron_ccc(2).mode, 8);
    }

    #[test]
    fn test_dedup_removes_coincident() {
        // Double plane shares the central row — verify dedup works
        let lc1 = plane_hc(2);
        let lc2 = double_plane_hc(2);
        // Double plane should have strictly more than a single plane
        assert!(lc2.centres.len() > lc1.centres.len());
        // But less than 2× (because shared row is deduplicated)
        assert!(lc2.centres.len() < 2 * lc1.centres.len());
    }

    #[test]
    fn test_no_duplicate_in_output() {
        // Verify all points in each generator are unique
        let cases: Vec<LimitCase> = vec![
            line(10),
            cross_2d(7),
            cross_2d(6),
            asterisk(5),
            cross_3d(5),
            plane_hc(3),
            plane_cs(3),
            double_plane_hc(2),
            triple_plane_hc(2),
            cuboctahedron_hc(2),
            cuboctahedron_cs(2),
            cuboctahedron_ccc(2),
        ];
        for lc in &cases {
            for (i, a) in lc.centres.iter().enumerate() {
                for (j, b) in lc.centres.iter().enumerate() {
                    if i != j {
                        let same = (a[0] - b[0]).abs() < 1e-10
                            && (a[1] - b[1]).abs() < 1e-10
                            && (a[2] - b[2]).abs() < 1e-10;
                        assert!(
                            !same,
                            "Duplicate found in {} at indices {} and {}: {:?}",
                            lc.name, i, j, a
                        );
                    }
                }
            }
        }
    }
}
