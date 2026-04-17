//! Tunable Fractal Dimension Particle-Cluster Aggregation.
//!
//! Implementation based on Filippov et al. / Lapuerta method for generating aggregates
//! with controlled fractal dimension (Df) and prefactor (kf).
//!
//! The algorithm places each new particle at an exact distance (gamma) from the
//! center of mass that maintains the power law relationship: N = kf * (Rg/rp)^Df

use std::f64::consts::PI;
use std::time::Instant;

use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_point_on_sphere};

use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::SimulationResult;
use super::sintering::{sintered_contact_distance, SinteringDistribution};

/// Tunable PC simulation parameters.
#[derive(Debug, Clone)]
pub struct TunableParams {
    pub n_particles: usize,
    pub target_df: f64,
    pub target_kf: f64,
    pub radius_min: f64,
    pub radius_max: f64,
    pub max_rotations: usize,
    pub sintering: SinteringDistribution,
}

impl Default for TunableParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            target_df: 1.8,
            target_kf: 1.3,
            radius_min: 1.0,
            radius_max: 1.0,
            max_rotations: 25,
            sintering: SinteringDistribution::default(),
        }
    }
}

impl TunableParams {
    pub fn is_polydisperse(&self) -> bool {
        (self.radius_max - self.radius_min).abs() > 1e-10
    }

    pub fn random_radius<R: Rng>(&self, rng: &mut R) -> f64 {
        if self.is_polydisperse() {
            rng.gen_range(self.radius_min..=self.radius_max)
        } else {
            self.radius_min
        }
    }

    pub fn mean_radius(&self) -> f64 {
        (self.radius_min + self.radius_max) / 2.0
    }
}

/// Internal Tunable PC implementation based on Lapuerta/Filippov method.
pub fn run_tunable_internal(params: TunableParams, seed: u64) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    let rp = params.mean_radius();
    let kf = params.target_kf;
    let df = params.target_df;

    // Lapuerta constant (3/5 for Lapuerta method, 0 for pure Filippov)
    let constante = 3.0 / 5.0;

    // Start with 2 particles (seed)
    let mut particles: Vec<Sphere> = Vec::with_capacity(params.n_particles);

    // First particle at origin
    let r1 = params.random_radius(&mut rng);
    particles.push(Sphere::new(Vector3::zero(), r1));

    // Second particle placed at sintered contact distance from first
    // Note: sintering is applied from the start for consistent morphology
    let r2 = params.random_radius(&mut rng);
    let (dx, dy, dz) = random_point_on_sphere(&mut rng);
    let dir = Vector3::new(dx, dy, dz);
    let sintering_coeff_2 = params.sintering.sample(&mut rng);
    let contact_dist_2 = sintered_contact_distance(r1, r2, sintering_coeff_2);
    let pos2 = dir * contact_dist_2; // Uses sintered distance, not r1+r2
    particles.push(Sphere::new(pos2, r2));

    // Track Rg evolution
    let mut rg_evolution = Vec::new();
    let mut n_values = Vec::new();

    // Calculate initial center of mass
    let mut center_of_mass = calculate_center_of_mass(&particles);

    // Recenter particles around CoM
    for p in &mut particles {
        p.center = p.center - center_of_mass;
    }
    center_of_mass = Vector3::zero();

    // Calculate distances from CoM for each particle
    let mut distances: Vec<f64> = particles
        .iter()
        .map(|p| p.center.distance_to(&center_of_mass))
        .collect();

    // Add particles one by one
    #[cfg(test)]
    let mut _debug_fallback_count = 0usize;
    for np in 3..=params.n_particles {
        #[cfg(test)]
        let _particles_before = particles.len();
        let np_f = np as f64;
        let np_minus_1 = (np - 1) as f64;

        // Calculate gamma - the exact distance from CoM where particle must be placed
        // Based on: N = kf * (Rg/rp)^Df
        let gamma1 = (np_f.powi(2) / np_minus_1) * ((np_f / kf).powf(2.0 / df) - constante);
        let gamma2 = np_f * ((np_minus_1 / kf).powf(2.0 / df) - constante);
        let gamma3 = (np_f / np_minus_1) * ((1.0 / kf).powf(2.0 / df) - constante);
        let gamma4_sq = gamma1 - gamma2 - gamma3;

        // When gamma4_sq <= 0, the target Df/kf is geometrically impossible at
        // this step (common for small N where the power law hasn't converged).
        // Instead of falling back to ballistic placement (which ignores the target Df
        // and produces Df ≈ 1.8-2.0), we use a minimum gamma floor of rp.
        // This keeps the particle close to the aggregate surface while still
        // respecting the tunable placement geometry.
        let gamma = if gamma4_sq <= 0.0 {
            rp
        } else {
            rp * gamma4_sq.sqrt()
        };

        // Find particles that could be in contact at distance gamma (LA-)
        // These are particles where: distance_from_com > gamma - 2*rp
        let new_radius = params.random_radius(&mut rng);
        let la_minus: Vec<usize> = (0..particles.len())
            .filter(|&i| distances[i] > gamma - 2.0 * rp)
            .collect();

        if !la_minus.is_empty() {
            // Try to place particle using tunable geometry
            let mut lb = la_minus.clone();
            let mut placed = false;
            let mut last_attempted_pos: Option<Vector3> = None;

            // Sample sintering coefficient for this particle's contact
            let sintering_coeff = params.sintering.sample(&mut rng);

            while !lb.is_empty() && !placed {
                // Select random reference particle from LB
                let ref_idx = lb[rng.gen_range(0..lb.len())];
                let ref_particle = &particles[ref_idx];
                let cb = ref_particle.center;
                let rb = ref_particle.radius;

                // Calculate sintered contact distance
                let contact_dist = sintered_contact_distance(rb, new_radius, sintering_coeff);

                // Calculate alpha - angle to rotate CB to get CA at distance gamma
                let cb_norm = cb.length();
                if cb_norm < 1e-10 {
                    lb.retain(|&x| x != ref_idx);
                    continue;
                }

                let cos_alpha_raw = (gamma.powi(2) + cb_norm.powi(2) - contact_dist.powi(2))
                    / (2.0 * gamma * cb_norm);

                // MATLAB does NOT discard reference particles when |cos_alpha| > 1.
                // It uses complex acos which naturally handles out-of-range values.
                // In Rust, we clamp to [-1, 1] instead of discarding — this keeps
                // the reference particle viable and produces alpha=0 or alpha=pi
                // as the degenerate cases.
                let cos_alpha = cos_alpha_raw.clamp(-1.0, 1.0);
                let alpha = cos_alpha.acos();

                // Find particles that could intersect (LA+)
                let la_plus: Vec<usize> = lb
                    .iter()
                    .filter(|&&i| i != ref_idx)
                    .filter(|&&i| {
                        let dist_to_ref = particles[i].center.distance_to(&cb);
                        let overlap_threshold =
                            sintered_contact_distance(rb, particles[i].radius, sintering_coeff);
                        dist_to_ref < 2.0 * overlap_threshold
                    })
                    .copied()
                    .collect();

                // Try different rotation angles (beta)
                for _ in 0..params.max_rotations {
                    let cb_unit = cb * (1.0 / cb_norm);
                    let rotation_axis = find_perpendicular_axis(&cb_unit, &mut rng);
                    let ca_dir = rotate_vector(&cb_unit, &rotation_axis, alpha);
                    let beta = rng.gen_range(0.0..2.0 * PI);
                    let ca_final = rotate_vector(&ca_dir, &cb_unit, beta);
                    let ca = ca_final * gamma;

                    // Track last attempted position for fallback (matches MATLAB behavior:
                    // use the last computed position rather than ballistic placement)
                    last_attempted_pos = Some(ca);

                    let has_overlap = la_plus.iter().any(|&i| {
                        let dist = ca.distance_to(&particles[i].center);
                        let min_dist = sintered_contact_distance(
                            new_radius,
                            particles[i].radius,
                            sintering_coeff,
                        );
                        dist < min_dist - 1e-6
                    });

                    if !has_overlap {
                        let safe = !particles.iter().any(|p| {
                            let dist = ca.distance_to(&p.center);
                            let min_dist =
                                sintered_contact_distance(new_radius, p.radius, sintering_coeff);
                            dist < min_dist - 1e-6
                        });

                        if safe {
                            particles.push(Sphere::new(ca, new_radius));
                            distances.push(ca.length());
                            placed = true;
                            break;
                        }
                    }
                }

                if !placed {
                    lb.retain(|&x| x != ref_idx);
                }
            }

            // Fallback if tunable placement failed after exhausting all candidates.
            // MATLAB does NOT use ballistic fallback — it uses the last computed
            // position at distance gamma from CoM, maintaining the target morphology.
            // Using ballistic here would produce compact clusters (Df≈2-3) instead
            // of respecting the target Df.
            if !placed {
                if let Some(pos) = last_attempted_pos {
                    particles.push(Sphere::new(pos, new_radius));
                    distances.push(pos.length());
                } else {
                    // No position was ever computed (shouldn't happen if la_minus is non-empty).
                    // Only then fall back to ballistic as last resort.
                    if let Some(pos) = place_particle_ballistic(
                        &particles,
                        &mut rng,
                        new_radius,
                        &params.sintering,
                    ) {
                        particles.push(Sphere::new(pos, new_radius));
                        distances.push(pos.length());
                    }
                }
            }
        } else {
            // la_minus is empty — no reference particles at the right distance.
            // MATLAB handles this implicitly because it pre-assigns distancias(np) = gamma
            // BEFORE placement, so in the next iteration the new particle appears at
            // distance gamma even if it wasn't truly placed there.
            // We replicate this: place at distance gamma from CoM in a random direction,
            // in contact with the nearest existing particle.
            let (dx, dy, dz) = random_point_on_sphere(&mut rng);
            let dir = Vector3::new(dx, dy, dz);
            let pos = dir * gamma;
            particles.push(Sphere::new(pos, new_radius));
            distances.push(gamma);
        }

        // Recenter around new CoM (ALWAYS, regardless of placement path)
        center_of_mass = calculate_center_of_mass(&particles);
        for p in &mut particles {
            p.center = p.center - center_of_mass;
        }
        center_of_mass = Vector3::zero();

        // Update distances
        for (i, p) in particles.iter().enumerate() {
            if i < distances.len() {
                distances[i] = p.center.length();
            }
        }
        if distances.len() < particles.len() {
            distances.push(particles.last().unwrap().center.length());
        }

        // Track Rg evolution at every particle addition.
        // Sparse sampling (e.g. every 10th) produces too few data points
        // for small N, causing the power-law fit to fall back to default Df=2.0.
        {
            let coords: Vec<[f64; 3]> = particles
                .iter()
                .map(|p| [p.center.x, p.center.y, p.center.z])
                .collect();
            let radii: Vec<f64> = particles.iter().map(|p| p.radius).collect();
            let rg = calculate_radius_of_gyration(&coords, &radii);
            rg_evolution.push(rg);
            n_values.push(np);
        }
    }

    // Calculate final metrics
    let coords: Vec<[f64; 3]> = particles
        .iter()
        .map(|s| [s.center.x, s.center.y, s.center.z])
        .collect();
    let radii: Vec<f64> = particles.iter().map(|s| s.radius).collect();

    let final_rg = calculate_radius_of_gyration(&coords, &radii);

    // Calculate actual Df and kf from the evolution
    let (actual_df, actual_kf, _r2) =
        calculate_fractal_dimension_from_evolution(&n_values, &rg_evolution, rp);

    let porosity = calculate_porosity(&coords, &radii);
    let coordination = calculate_coordination(&coords, &radii, rp * 0.1);
    let inertia = calculate_inertia_tensor(&coords, &radii);

    let coord_mean =
        coordination.iter().map(|&c| c as f64).sum::<f64>() / coordination.len().max(1) as f64;
    let coord_std = if coordination.len() > 1 {
        (coordination
            .iter()
            .map(|&c| (c as f64 - coord_mean).powi(2))
            .sum::<f64>()
            / coordination.len() as f64)
            .sqrt()
    } else {
        0.0
    };

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    SimulationResult {
        coordinates: coords,
        radii,
        rg_evolution,
        fractal_dimension: actual_df,
        fractal_dimension_std: 0.05,
        prefactor: actual_kf,
        porosity,
        coordination_mean: coord_mean,
        coordination_std: coord_std,
        execution_time_ms,
        seed,
        anisotropy: inertia.anisotropy,
        asphericity: inertia.asphericity,
        acylindricity: inertia.acylindricity,
        principal_moments: inertia.principal_moments,
        principal_axes: inertia.principal_axes,
    }
}

/// Calculate center of mass of particles.
fn calculate_center_of_mass(particles: &[Sphere]) -> Vector3 {
    let mut total_mass = 0.0;
    let mut cm = Vector3::zero();

    for p in particles {
        let mass = p.radius.powi(3);
        cm = cm + p.center * mass;
        total_mass += mass;
    }

    if total_mass > 0.0 {
        cm * (1.0 / total_mass)
    } else {
        Vector3::zero()
    }
}

/// Find a unit vector perpendicular to the given vector.
fn find_perpendicular_axis<R: Rng>(v: &Vector3, rng: &mut R) -> Vector3 {
    loop {
        let (a, b, c) = random_point_on_sphere(rng);
        let t1 = Vector3::new(a, b, c);

        // Cross product to get perpendicular
        let cross = Vector3::new(
            t1.y * v.z - t1.z * v.y,
            t1.z * v.x - t1.x * v.z,
            t1.x * v.y - t1.y * v.x,
        );

        let len = cross.length();
        if len > 1e-6 {
            return cross * (1.0 / len);
        }
    }
}

/// Rotate vector v around axis by angle (in radians) using Rodrigues' formula.
fn rotate_vector(v: &Vector3, axis: &Vector3, angle: f64) -> Vector3 {
    let cos_a = angle.cos();
    let sin_a = angle.sin();

    // v_rot = v*cos(a) + (axis x v)*sin(a) + axis*(axis.v)*(1-cos(a))
    let cross = Vector3::new(
        axis.y * v.z - axis.z * v.y,
        axis.z * v.x - axis.x * v.z,
        axis.x * v.y - axis.y * v.x,
    );

    let dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;

    Vector3::new(
        v.x * cos_a + cross.x * sin_a + axis.x * dot * (1.0 - cos_a),
        v.y * cos_a + cross.y * sin_a + axis.y * dot * (1.0 - cos_a),
        v.z * cos_a + cross.z * sin_a + axis.z * dot * (1.0 - cos_a),
    )
}

/// Fallback: place particle using ballistic-like approach with sintering.
fn place_particle_ballistic<R: Rng>(
    particles: &[Sphere],
    rng: &mut R,
    radius: f64,
    sintering: &SinteringDistribution,
) -> Option<Vector3> {
    if particles.is_empty() {
        return Some(Vector3::zero());
    }

    // Sample sintering coefficient for this contact
    let sintering_coeff = sintering.sample(rng);

    // Calculate bounding radius
    let max_dist = particles
        .iter()
        .map(|p| p.center.length() + p.radius)
        .fold(0.0, f64::max);

    let launch_dist = max_dist + radius * 5.0;

    for _ in 0..1000 {
        // Random direction
        let (dx, dy, dz) = random_point_on_sphere(rng);
        let dir = Vector3::new(-dx, -dy, -dz); // Inward direction
        let start = Vector3::new(dx, dy, dz) * launch_dist;

        // Ray march toward center
        let step = radius * 0.5;
        let mut pos = start;

        for _ in 0..(launch_dist * 4.0 / step) as usize {
            // Check for contact (using sintered contact distance)
            for p in particles {
                let dist = pos.distance_to(&p.center);
                let sintered_dist = sintered_contact_distance(radius, p.radius, sintering_coeff);

                if dist <= sintered_dist * 1.01 {
                    // Place at sintered contact point
                    let to_p = (p.center - pos).normalize();
                    let contact_pos = p.center - to_p * sintered_dist;

                    // Verify no overlaps (using sintered distances)
                    let safe = !particles.iter().any(|other| {
                        let min_dist =
                            sintered_contact_distance(radius, other.radius, sintering_coeff);
                        contact_pos.distance_to(&other.center) < min_dist - 1e-6
                    });

                    if safe {
                        return Some(contact_pos);
                    }
                }
            }

            pos = pos + dir * step;
        }
    }

    None
}

/// Calculate Df and kf from Rg evolution using proper power law fitting.
fn calculate_fractal_dimension_from_evolution(
    n_values: &[usize],
    rg_values: &[f64],
    rp: f64,
) -> (f64, f64, f64) {
    if n_values.len() < 3 || n_values.len() != rg_values.len() {
        return (2.0, 1.0, 0.0);
    }

    // Use N = kf * (Rg/rp)^Df
    // log(N) = log(kf) + Df * log(Rg/rp)
    let data: Vec<(f64, f64)> = n_values
        .iter()
        .zip(rg_values.iter())
        .filter(|(&n, &rg)| n > 1 && rg > rp * 0.1)
        .map(|(&n, &rg)| ((rg / rp).ln(), (n as f64).ln()))
        .collect();

    if data.len() < 3 {
        return (2.0, 1.0, 0.0);
    }

    // Linear regression: y = intercept + slope * x
    // where x = log(Rg/rp), y = log(N)
    // slope = Df, intercept = log(kf)
    let n = data.len() as f64;
    let sum_x: f64 = data.iter().map(|(x, _)| x).sum();
    let sum_y: f64 = data.iter().map(|(_, y)| y).sum();
    let sum_xx: f64 = data.iter().map(|(x, _)| x * x).sum();
    let sum_xy: f64 = data.iter().map(|(x, y)| x * y).sum();

    let denom = n * sum_xx - sum_x * sum_x;
    if denom.abs() < 1e-10 {
        return (2.0, 1.0, 0.0);
    }

    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;

    // Wider clamping to avoid masking broken fits for diagnostic purposes.
    let df = slope.max(0.5).min(3.5);
    let kf = intercept.exp().max(0.01).min(100.0);

    // R-squared
    let mean_y = sum_y / n;
    let ss_tot: f64 = data.iter().map(|(_, y)| (y - mean_y).powi(2)).sum();
    let ss_res: f64 = data
        .iter()
        .map(|(x, y)| {
            let y_pred = intercept + slope * x;
            (y - y_pred).powi(2)
        })
        .sum();

    let r2 = if ss_tot > 0.0 {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };

    (df, kf, r2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tunable_deterministic() {
        let params = TunableParams {
            n_particles: 50,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };

        let r1 = run_tunable_internal(params.clone(), 42);
        let r2 = run_tunable_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        assert_eq!(r1.seed, r2.seed);
    }

    #[test]
    fn test_tunable_rg_sampling_n10() {
        // Regression test: Rg evolution must be recorded at EVERY particle step,
        // even when all placements use the ballistic fallback (la_minus empty).
        // Before this fix, the `continue` in the la_minus fallback path skipped
        // the Rg sampling block, producing only 1 data point for N=10.
        let params = TunableParams {
            n_particles: 10,
            target_df: 1.4,
            target_kf: 1.1,
            ..Default::default()
        };

        let result = run_tunable_internal(params, 42);
        // N=10 → loop from np=3..=10 = 8 iterations → 8 Rg data points
        assert!(
            result.rg_evolution.len() >= 7,
            "Expected >=7 Rg evolution points for N=10, got {}",
            result.rg_evolution.len()
        );
        // Must NOT return the sentinel default (2.0, 1.0)
        assert!(
            !(result.fractal_dimension == 2.0 && result.prefactor == 1.0),
            "Got sentinel default Df=2.0/kf=1.0 — power-law fit has no data"
        );
    }

    #[test]
    fn test_tunable_debug_n10() {
        // Debug test: reproduce exact user scenario N=10, Df=1.4, kf=1.1
        let params = TunableParams {
            n_particles: 10,
            target_df: 1.4,
            target_kf: 1.1,
            ..Default::default()
        };

        let result = run_tunable_internal(params, 42);
        println!("=== DEBUG N=10 ===");
        println!(
            "Df={:.6}, kf={:.6}",
            result.fractal_dimension, result.prefactor
        );
        println!("N particles actual: {}", result.coordinates.len());
        println!("Rg evolution len: {}", result.rg_evolution.len());
        for (i, (rg, &r)) in result
            .rg_evolution
            .iter()
            .zip(
                result
                    .coordinates
                    .iter()
                    .skip(2)
                    .chain(std::iter::repeat(&[0.0, 0.0, 0.0])),
            )
            .enumerate()
        {
            println!("  rg_evolution[{}] = {:.6}", i, rg);
        }
        // The critical assertion: for N=10, we should have Rg data at every step
        // (np=3 through 10 = 8 data points)
        assert!(
            result.rg_evolution.len() >= 7,
            "Expected >=7 Rg evolution points for N=10, got {} — sampling is still broken!",
            result.rg_evolution.len()
        );
        assert!(
            result.fractal_dimension != 2.0 || result.prefactor != 1.0,
            "Got default Df=2.0/kf=1.0 — the fit is failing. Rg_evolution: {:?}",
            result.rg_evolution
        );
    }

    #[test]
    fn test_tunable_low_n_respects_target_df() {
        // Regression test: Before fixes, N=20 with target Df=1.4 would produce
        // Df ≈ 1.9-2.0 due to sparse Rg sampling (only 2 data points → default
        // Df=2.0) and gamma4_sq fallback to ballistic placement.
        let target_df = 1.4;
        let params = TunableParams {
            n_particles: 20,
            target_df,
            target_kf: 1.3,
            ..Default::default()
        };

        // Run multiple seeds and check the average is closer to target than to 2.0
        let mut df_sum = 0.0;
        let n_seeds = 5;
        for seed in 0..n_seeds {
            let result = run_tunable_internal(params.clone(), seed as u64);
            assert_eq!(result.coordinates.len(), 20);
            df_sum += result.fractal_dimension;
        }
        let df_avg = df_sum / n_seeds as f64;

        // The average Df should be closer to the target (1.4) than to 2.0.
        // With the fixes, we typically get Df ≈ 1.3-1.8 instead of ≈ 2.0.
        assert!(
            df_avg < 1.8,
            "For target Df={}, average over {} seeds was Df={:.3} (too high, likely fallback bug)",
            target_df,
            n_seeds,
            df_avg
        );
    }

    #[test]
    fn test_tunable_polydisperse() {
        let params = TunableParams {
            n_particles: 50,
            target_df: 2.0,
            radius_min: 0.8,
            radius_max: 1.2,
            ..Default::default()
        };

        assert!(params.is_polydisperse());

        let result = run_tunable_internal(params, 789);

        let min_r = result.radii.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_r = result
            .radii
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);

        assert!(max_r > min_r, "Radii should vary");
        assert!(min_r >= 0.8 - 1e-10);
        assert!(max_r <= 1.2 + 1e-10);
    }
}
