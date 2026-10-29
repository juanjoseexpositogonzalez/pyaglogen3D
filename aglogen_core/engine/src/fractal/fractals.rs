//! Deterministic fractal generators with known non-integer Df.
//!
//! Used for validating box-counting accuracy on true fractals.
//! Each generator returns a `Vec<[f64; 3]>` of point centres at the
//! deepest recursion level — suitable for direct box-counting consumption.

/// Generate a 3D Menger sponge at a given recursion depth.
///
/// Theoretical Df = log(20)/log(3) ≈ 2.7268
///
/// Construction:
/// 1. Start with a unit cube [0,1]^3
/// 2. Divide into 3×3×3 = 27 sub-cubes
/// 3. Remove sub-cubes where 2 or more coordinates are the middle index (7 removed, 20 kept)
/// 4. Recurse on each of the 20 remaining sub-cubes
///
/// At depth d: 20^d sub-cubes of side 3^{-d}.
/// Returns centres of the deepest sub-cubes.
pub fn menger_sponge(depth: u32) -> Vec<[f64; 3]> {
    // Start with the single unit cube centred at (0.5, 0.5, 0.5)
    let mut cubes: Vec<[f64; 3]> = vec![[0.5, 0.5, 0.5]];
    let mut side = 1.0_f64;

    for _ in 0..depth {
        let new_side = side / 3.0;
        let half_new = new_side / 2.0;
        let mut next = Vec::with_capacity(cubes.len() * 20);

        for centre in &cubes {
            // Subdivide this cube into 3x3x3 children
            for i in 0u32..3 {
                for j in 0u32..3 {
                    for k in 0u32..3 {
                        // Remove if 2+ coordinates are the middle index (1)
                        let mid_count = (i == 1) as u32 + (j == 1) as u32 + (k == 1) as u32;
                        if mid_count >= 2 {
                            continue;
                        }

                        // Child centre relative to parent's lower-left corner
                        let parent_ll = [
                            centre[0] - side / 2.0,
                            centre[1] - side / 2.0,
                            centre[2] - side / 2.0,
                        ];
                        let child = [
                            parent_ll[0] + (i as f64) * new_side + half_new,
                            parent_ll[1] + (j as f64) * new_side + half_new,
                            parent_ll[2] + (k as f64) * new_side + half_new,
                        ];
                        next.push(child);
                    }
                }
            }
        }

        cubes = next;
        side = new_side;
    }

    cubes
}

/// Generate a 2D Sierpinski triangle embedded in 3D (z=0 plane).
///
/// Theoretical Df = log(3)/log(2) ≈ 1.5850
///
/// Construction:
/// 1. Start with equilateral triangle: (0,0,0), (1,0,0), (0.5, √3/2, 0)
/// 2. Subdivide each triangle into 4 by connecting midpoints
/// 3. Remove the centre triangle (formed by the 3 midpoints), keep the 3 corner ones
/// 4. Recurse on each of the 3 remaining triangles
///
/// At depth d: 3^d triangles, each with side 2^{-d}.
/// Returns centroids of the deepest triangles.
pub fn sierpinski_triangle_3d(depth: u32) -> Vec<[f64; 3]> {
    let sqrt3_half = (3.0_f64).sqrt() / 2.0;

    // Initial triangle vertices
    let v0 = [0.0, 0.0, 0.0];
    let v1 = [1.0, 0.0, 0.0];
    let v2 = [0.5, sqrt3_half, 0.0];

    // Start with one triangle defined by its 3 vertices
    let mut triangles: Vec<[[f64; 3]; 3]> = vec![[v0, v1, v2]];

    for _ in 0..depth {
        let mut next = Vec::with_capacity(triangles.len() * 3);

        for tri in &triangles {
            let a = tri[0];
            let b = tri[1];
            let c = tri[2];

            // Midpoints
            let ab = midpoint(a, b);
            let bc = midpoint(b, c);
            let ca = midpoint(c, a);

            // 3 corner sub-triangles (skip centre one: [ab, bc, ca])
            next.push([a, ab, ca]);
            next.push([ab, b, bc]);
            next.push([ca, bc, c]);
        }

        triangles = next;
    }

    // Return centroids
    triangles
        .iter()
        .map(|tri| {
            [
                (tri[0][0] + tri[1][0] + tri[2][0]) / 3.0,
                (tri[0][1] + tri[1][1] + tri[2][1]) / 3.0,
                (tri[0][2] + tri[1][2] + tri[2][2]) / 3.0,
            ]
        })
        .collect()
}

/// Generate a 3D Cantor dust at a given recursion depth.
///
/// Theoretical Df = log(8)/log(3) ≈ 1.8928
///
/// Construction:
/// 1. Start with a unit cube [0,1]^3
/// 2. Divide into 3×3×3 = 27 sub-cubes
/// 3. Keep only the 8 corner sub-cubes (i,j,k ∈ {0,2})
/// 4. Recurse on each of the 8 remaining sub-cubes
///
/// At depth d: 8^d sub-cubes of side 3^{-d}.
/// Returns centres of the deepest sub-cubes.
pub fn cantor_dust_3d(depth: u32) -> Vec<[f64; 3]> {
    let mut cubes: Vec<[f64; 3]> = vec![[0.5, 0.5, 0.5]];
    let mut side = 1.0_f64;

    for _ in 0..depth {
        let new_side = side / 3.0;
        let half_new = new_side / 2.0;
        let mut next = Vec::with_capacity(cubes.len() * 8);

        for centre in &cubes {
            let parent_ll = [
                centre[0] - side / 2.0,
                centre[1] - side / 2.0,
                centre[2] - side / 2.0,
            ];

            // Keep only corners: i,j,k ∈ {0, 2}
            for &i in &[0u32, 2] {
                for &j in &[0u32, 2] {
                    for &k in &[0u32, 2] {
                        let child = [
                            parent_ll[0] + (i as f64) * new_side + half_new,
                            parent_ll[1] + (j as f64) * new_side + half_new,
                            parent_ll[2] + (k as f64) * new_side + half_new,
                        ];
                        next.push(child);
                    }
                }
            }
        }

        cubes = next;
        side = new_side;
    }

    cubes
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[inline]
fn midpoint(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        (a[0] + b[0]) / 2.0,
        (a[1] + b[1]) / 2.0,
        (a[2] + b[2]) / 2.0,
    ]
}

// ===========================================================================
// Unit tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- Menger sponge counts: 20^d -----------------------------------------

    #[test]
    fn menger_depth_0() {
        assert_eq!(menger_sponge(0).len(), 1);
    }

    #[test]
    fn menger_depth_1() {
        assert_eq!(menger_sponge(1).len(), 20);
    }

    #[test]
    fn menger_depth_2() {
        assert_eq!(menger_sponge(2).len(), 400);
    }

    // -- Cantor dust counts: 8^d ---------------------------------------------

    #[test]
    fn cantor_depth_0() {
        assert_eq!(cantor_dust_3d(0).len(), 1);
    }

    #[test]
    fn cantor_depth_1() {
        assert_eq!(cantor_dust_3d(1).len(), 8);
    }

    #[test]
    fn cantor_depth_2() {
        assert_eq!(cantor_dust_3d(2).len(), 64);
    }

    // -- Sierpinski triangle counts: 3^d -------------------------------------

    #[test]
    fn sierpinski_depth_0() {
        assert_eq!(sierpinski_triangle_3d(0).len(), 1);
    }

    #[test]
    fn sierpinski_depth_1() {
        assert_eq!(sierpinski_triangle_3d(1).len(), 3);
    }

    #[test]
    fn sierpinski_depth_2() {
        assert_eq!(sierpinski_triangle_3d(2).len(), 9);
    }

    // -- Bounds checks -------------------------------------------------------

    #[test]
    fn menger_points_within_unit_cube() {
        for p in menger_sponge(2) {
            assert!(p[0] >= 0.0 && p[0] <= 1.0, "x out of bounds: {}", p[0]);
            assert!(p[1] >= 0.0 && p[1] <= 1.0, "y out of bounds: {}", p[1]);
            assert!(p[2] >= 0.0 && p[2] <= 1.0, "z out of bounds: {}", p[2]);
        }
    }

    #[test]
    fn cantor_points_within_unit_cube() {
        for p in cantor_dust_3d(2) {
            assert!(p[0] >= 0.0 && p[0] <= 1.0, "x out of bounds: {}", p[0]);
            assert!(p[1] >= 0.0 && p[1] <= 1.0, "y out of bounds: {}", p[1]);
            assert!(p[2] >= 0.0 && p[2] <= 1.0, "z out of bounds: {}", p[2]);
        }
    }

    #[test]
    fn sierpinski_points_in_expected_region() {
        let sqrt3_half = (3.0_f64).sqrt() / 2.0;
        for p in sierpinski_triangle_3d(3) {
            assert!(p[0] >= 0.0 && p[0] <= 1.0, "x out of bounds: {}", p[0]);
            assert!(
                p[1] >= 0.0 && p[1] <= sqrt3_half + 1e-10,
                "y out of bounds: {}",
                p[1]
            );
            assert!((p[2]).abs() < 1e-10, "z should be ~0: {}", p[2]);
        }
    }
}
