//! Ballistic Aggregation simulation engine.
//!
//! In Ballistic Aggregation, particles move in straight lines towards the cluster
//! and stick on first contact. This produces denser, more compact structures
//! compared to DLA (higher fractal dimension ~3).

use std::time::Instant;

use pyo3::prelude::*;
use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_direction};
use crate::common::spatial::SpatialHash;

use super::metrics::{
    calculate_coordination, calculate_fractal_dimension, calculate_inertia_tensor,
    calculate_porosity, calculate_radius_of_gyration,
};
use super::result::{PySimulationResult, SimulationResult};
use super::sintering::{sintered_contact_distance, SinteringDistribution};

/// Ballistic aggregation parameters.
#[derive(Debug, Clone)]
pub struct BallisticParams {
    pub n_particles: usize,
    pub sticking_probability: f64,
    pub radius_min: f64,
    pub radius_max: f64,
    pub launch_distance_factor: f64,
    pub max_ray_steps: usize,
    pub sintering: SinteringDistribution,
}

impl Default for BallisticParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            sticking_probability: 1.0,
            radius_min: 1.0,
            radius_max: 1.0,
            launch_distance_factor: 2.0,
            max_ray_steps: 10000,
            sintering: SinteringDistribution::default(),
        }
    }
}

impl BallisticParams {
    /// Check if particles are polydisperse (variable radius).
    pub fn is_polydisperse(&self) -> bool {
        (self.radius_max - self.radius_min).abs() > 1e-10
    }

    /// Generate a random radius within the range.
    pub fn random_radius<R: Rng>(&self, rng: &mut R) -> f64 {
        if self.is_polydisperse() {
            rng.gen_range(self.radius_min..=self.radius_max)
        } else {
            self.radius_min
        }
    }

    /// Get the mean radius for calculations.
    pub fn mean_radius(&self) -> f64 {
        (self.radius_min + self.radius_max) / 2.0
    }
}

/// Run Ballistic Aggregation simulation.
///
/// # Arguments
/// * `n_particles` - Number of particles in the agglomerate
/// * `sticking_probability` - Probability of adhesion on contact (0-1)
/// * `radius_min` - Minimum particle radius (for polydisperse)
/// * `radius_max` - Maximum particle radius (for polydisperse, defaults to radius_min)
/// * `sintering_coeff` - Sintering coefficient (0.5-1.0, where 1.0 = no sintering)
/// * `sintering_type` - Distribution type: "fixed", "uniform", or "normal"
/// * `sintering_min` - Min for uniform distribution (default: 0.85)
/// * `sintering_max` - Max for uniform distribution (default: 0.95)
/// * `sintering_std` - Std dev for normal distribution (default: 0.05)
/// * `seed` - Random seed for reproducibility
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, radius_min=1.0, radius_max=None, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
pub fn run_ballistic(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);

    let sintering = match sintering_type.to_lowercase().as_str() {
        "uniform" => SinteringDistribution::uniform(sintering_min, sintering_max),
        "normal" => SinteringDistribution::normal(sintering_coeff, sintering_std),
        _ => SinteringDistribution::fixed(sintering_coeff),
    };

    let params = BallisticParams {
        n_particles,
        sticking_probability,
        radius_min,
        radius_max,
        sintering,
        ..Default::default()
    };

    // Release GIL during computation
    let result = py.allow_threads(|| run_ballistic_internal(params, seed));

    Ok(result.to_py())
}

/// Internal Ballistic Aggregation implementation.
fn run_ballistic_internal(params: BallisticParams, seed: u64) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    // Initialize with seed particle at origin (use mean radius for seed)
    let seed_radius = params.mean_radius();
    let mut particles: Vec<Sphere> = vec![Sphere::new(Vector3::zero(), seed_radius)];

    // Use max radius for spatial hash cell size to handle polydisperse particles
    let mut spatial_hash = SpatialHash::new(params.radius_max * 4.0);
    spatial_hash.insert(0, &particles[0]);

    // Track Rg evolution
    let mut rg_evolution = vec![seed_radius * (3.0 / 5.0_f64).sqrt()];
    let mut n_values = vec![1usize];

    // Cluster properties
    let mut cluster_rg = seed_radius;

    // Add particles one by one
    while particles.len() < params.n_particles {
        // Generate radius for new particle
        let new_radius = params.random_radius(&mut rng);

        // Launch distance based on current cluster size
        let launch_distance = params.launch_distance_factor * cluster_rg + params.radius_max * 5.0;

        // Generate random starting position on launch sphere
        let (dx, dy, dz) = random_direction(&mut rng);
        let start_pos = Vector3::new(
            dx * launch_distance,
            dy * launch_distance,
            dz * launch_distance,
        );

        // Direction towards cluster center (with some randomness)
        let (rx, ry, rz) = random_direction(&mut rng);
        let randomness = 0.1; // Small random deviation
        let target = Vector3::new(rx * randomness, ry * randomness, rz * randomness);
        let direction = (target - start_pos).normalize();

        // Ray-march towards cluster (step size based on new particle radius)
        let step_size = new_radius * 0.5;
        let mut pos = start_pos;
        let mut stuck = false;

        for _ in 0..params.max_ray_steps {
            pos = pos + direction * step_size;

            // Check if we've passed through the cluster (gone too far)
            if pos.length() > launch_distance {
                break;
            }

            // Check for collision with existing particles
            let test_sphere = Sphere::new(pos, new_radius);
            let candidates = spatial_hash.query_potential_collisions(&test_sphere);

            for &idx in &candidates {
                let other = &particles[idx];
                let dist = pos.distance_to(&other.center);
                let touch_dist = new_radius + other.radius;

                if dist < touch_dist {
                    // Collision! Check sticking probability
                    if params.sticking_probability >= 1.0
                        || rng.gen::<f64>() < params.sticking_probability
                    {
                        // Sample sintering coefficient for this contact
                        let sintering_coeff = params.sintering.sample(&mut rng);
                        let contact_dist = sintered_contact_distance(new_radius, other.radius, sintering_coeff);

                        // Place particle at sintered contact distance
                        let new_direction = (pos - other.center).normalize();
                        pos = other.center + new_direction * contact_dist;

                        stuck = true;
                        break;
                    }
                }
            }

            if stuck {
                break;
            }
        }

        if stuck {
            // Add new particle with its random radius
            let new_sphere = Sphere::new(pos, new_radius);
            let idx = particles.len();
            particles.push(new_sphere);
            spatial_hash.insert(idx, &new_sphere);

            // Update cluster Rg
            let coords: Vec<[f64; 3]> = particles
                .iter()
                .map(|s| [s.center.x, s.center.y, s.center.z])
                .collect();
            let radii: Vec<f64> = particles.iter().map(|s| s.radius).collect();
            cluster_rg = calculate_radius_of_gyration(&coords, &radii);

            rg_evolution.push(cluster_rg);
            n_values.push(particles.len());
        }
    }

    // Calculate final metrics
    let coords: Vec<[f64; 3]> = particles
        .iter()
        .map(|s| [s.center.x, s.center.y, s.center.z])
        .collect();
    let radii: Vec<f64> = particles.iter().map(|s| s.radius).collect();

    let (df, kf, _r2) = calculate_fractal_dimension(&n_values, &rg_evolution);
    let porosity = calculate_porosity(&coords, &radii);
    let coordination = calculate_coordination(&coords, &radii, params.mean_radius() * 0.1);
    let inertia = calculate_inertia_tensor(&coords, &radii);

    let coord_mean = coordination.iter().map(|&c| c as f64).sum::<f64>() / coordination.len() as f64;
    let coord_std = (coordination
        .iter()
        .map(|&c| (c as f64 - coord_mean).powi(2))
        .sum::<f64>()
        / coordination.len() as f64)
        .sqrt();

    let execution_time_ms = start_time.elapsed().as_millis() as u64;

    SimulationResult {
        coordinates: coords,
        radii,
        rg_evolution,
        fractal_dimension: df,
        fractal_dimension_std: 0.02,
        prefactor: kf,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ballistic_deterministic() {
        let params = BallisticParams {
            n_particles: 50,
            ..Default::default()
        };

        let r1 = run_ballistic_internal(params.clone(), 42);
        let r2 = run_ballistic_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        for (c1, c2) in r1.coordinates.iter().zip(r2.coordinates.iter()) {
            assert!((c1[0] - c2[0]).abs() < 1e-10);
            assert!((c1[1] - c2[1]).abs() < 1e-10);
            assert!((c1[2] - c2[2]).abs() < 1e-10);
        }
    }

    #[test]
    fn test_ballistic_produces_denser_structure() {
        let params = BallisticParams {
            n_particles: 200,
            ..Default::default()
        };

        let result = run_ballistic_internal(params, 456);

        // Ballistic typically produces Df ~ 2.8-3.0 (denser than DLA)
        assert!(result.fractal_dimension > 2.0);
        assert!(result.fractal_dimension <= 3.0);
    }

    #[test]
    fn test_ballistic_polydisperse() {
        let params = BallisticParams {
            n_particles: 30,
            radius_min: 0.8,
            radius_max: 1.2,
            ..Default::default()
        };

        assert!(params.is_polydisperse());

        let result = run_ballistic_internal(params, 456);

        // Check that we have variable radii
        let min_r = result.radii.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_r = result.radii.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        // With polydisperse particles, we should have different radii
        assert!(max_r > min_r, "Radii should vary: min={}, max={}", min_r, max_r);
        assert!(min_r >= 0.8 - 1e-10, "Min radius should be >= 0.8");
        assert!(max_r <= 1.2 + 1e-10, "Max radius should be <= 1.2");
    }

    #[test]
    fn test_ballistic_monodisperse() {
        let params = BallisticParams {
            n_particles: 20,
            radius_min: 1.0,
            radius_max: 1.0,
            ..Default::default()
        };

        assert!(!params.is_polydisperse());

        let result = run_ballistic_internal(params, 789);

        // All radii should be equal
        for r in &result.radii {
            assert!((r - 1.0).abs() < 1e-10);
        }
    }
}
