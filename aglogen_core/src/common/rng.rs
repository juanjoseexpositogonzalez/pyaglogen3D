//! Deterministic random number generation.

use rand::SeedableRng;
use rand_pcg::Pcg64;

/// Create a deterministic RNG from a seed.
pub fn create_rng(seed: u64) -> Pcg64 {
    Pcg64::seed_from_u64(seed)
}

/// Generate a random point on a unit sphere.
pub fn random_point_on_sphere(rng: &mut Pcg64) -> (f64, f64, f64) {
    use rand::Rng;
    use std::f64::consts::PI;

    let theta = rng.gen_range(0.0..2.0 * PI);
    let phi = (1.0 - 2.0 * rng.gen::<f64>()).acos();

    let x = phi.sin() * theta.cos();
    let y = phi.sin() * theta.sin();
    let z = phi.cos();

    (x, y, z)
}

/// Generate a random direction for 3D random walk.
pub fn random_direction(rng: &mut Pcg64) -> (f64, f64, f64) {
    random_point_on_sphere(rng)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_rng() {
        let mut rng1 = create_rng(42);
        let mut rng2 = create_rng(42);

        for _ in 0..100 {
            let (x1, y1, z1) = random_point_on_sphere(&mut rng1);
            let (x2, y2, z2) = random_point_on_sphere(&mut rng2);

            assert!((x1 - x2).abs() < 1e-15);
            assert!((y1 - y2).abs() < 1e-15);
            assert!((z1 - z2).abs() < 1e-15);
        }
    }

    #[test]
    fn test_point_on_unit_sphere() {
        let mut rng = create_rng(123);

        for _ in 0..1000 {
            let (x, y, z) = random_point_on_sphere(&mut rng);
            let r = (x * x + y * y + z * z).sqrt();
            assert!((r - 1.0).abs() < 1e-10);
        }
    }
}
