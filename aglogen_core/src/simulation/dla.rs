//! Diffusion-Limited Aggregation (DLA) simulation engine.

use std::time::Instant;

use pyo3::prelude::*;
use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_direction};
use crate::common::spatial::SpatialHash;

use super::metrics::{
    calculate_coordination, calculate_fractal_dimension, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::{PySimulationResult, SimulationResult};

/// DLA simulation parameters.
#[derive(Debug, Clone)]
pub struct DlaParams {
    pub n_particles: usize,
    pub sticking_probability: f64,
    pub lattice_size: usize,
    pub seed_radius: f64,
    pub max_walk_steps: usize,
    pub launch_distance_factor: f64,
    pub kill_distance_factor: f64,
}

impl Default for DlaParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            sticking_probability: 1.0,
            lattice_size: 200,
            seed_radius: 1.0,
            max_walk_steps: 1_000_000,
            launch_distance_factor: 2.0,
            kill_distance_factor: 3.0,
        }
    }
}

/// Run DLA simulation.
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, lattice_size=200, seed_radius=1.0, seed=None))]
pub fn run_dla(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    lattice_size: usize,
    seed_radius: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);

    let params = DlaParams {
        n_particles,
        sticking_probability,
        lattice_size,
        seed_radius,
        ..Default::default()
    };

    // Release GIL during computation
    let result = py.allow_threads(|| run_dla_internal(params, seed));

    Ok(result.to_py())
}

/// Internal DLA implementation.
fn run_dla_internal(params: DlaParams, seed: u64) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    // Initialize with seed particle at origin
    let mut particles: Vec<Sphere> = vec![Sphere::new(Vector3::zero(), params.seed_radius)];
    let mut spatial_hash = SpatialHash::new(params.seed_radius * 4.0);
    spatial_hash.insert(0, &particles[0]);

    // Track Rg evolution
    let mut rg_evolution = vec![params.seed_radius * (3.0 / 5.0_f64).sqrt()];
    let mut n_values = vec![1usize];

    // Cluster properties
    let mut cluster_rg = params.seed_radius;

    // Add particles one by one
    while particles.len() < params.n_particles {
        // Launch distance based on current cluster size
        let launch_distance = params.launch_distance_factor * cluster_rg + params.seed_radius * 2.0;
        let kill_distance = params.kill_distance_factor * launch_distance;

        // Generate random starting position on launch sphere
        let (dx, dy, dz) = random_direction(&mut rng);
        let mut pos = Vector3::new(
            dx * launch_distance,
            dy * launch_distance,
            dz * launch_distance,
        );

        // Random walk
        let mut stuck = false;
        for _ in 0..params.max_walk_steps {
            // Check if too far - kill particle
            if pos.length() > kill_distance {
                break;
            }

            // Random step
            let (sx, sy, sz) = random_direction(&mut rng);
            let step_size = params.seed_radius * 0.5;
            pos = pos + Vector3::new(sx * step_size, sy * step_size, sz * step_size);

            // Check for collision with existing particles
            let test_sphere = Sphere::new(pos, params.seed_radius);
            let candidates = spatial_hash.query_potential_collisions(&test_sphere);

            for &idx in &candidates {
                let other = &particles[idx];
                let dist = pos.distance_to(&other.center);
                let contact_dist = params.seed_radius + other.radius;

                if dist < contact_dist {
                    // Collision! Check sticking probability
                    if params.sticking_probability >= 1.0
                        || rng.gen::<f64>() < params.sticking_probability
                    {
                        // Place particle at contact point
                        let direction = (pos - other.center).normalize();
                        pos = other.center + direction * contact_dist;
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
            // Add new particle
            let new_sphere = Sphere::new(pos, params.seed_radius);
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
    let coordination = calculate_coordination(&coords, &radii, params.seed_radius * 0.1);

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
        fractal_dimension_std: 0.02, // TODO: Calculate from fit
        prefactor: kf,
        porosity,
        coordination_mean: coord_mean,
        coordination_std: coord_std,
        execution_time_ms,
        seed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dla_deterministic() {
        let params = DlaParams {
            n_particles: 50,
            ..Default::default()
        };

        let r1 = run_dla_internal(params.clone(), 42);
        let r2 = run_dla_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        for (c1, c2) in r1.coordinates.iter().zip(r2.coordinates.iter()) {
            assert!((c1[0] - c2[0]).abs() < 1e-10);
            assert!((c1[1] - c2[1]).abs() < 1e-10);
            assert!((c1[2] - c2[2]).abs() < 1e-10);
        }
    }

    #[test]
    fn test_dla_fractal_dimension_range() {
        let params = DlaParams {
            n_particles: 30, // Small count for fast tests in debug mode
            sticking_probability: 1.0,
            ..Default::default()
        };

        let result = run_dla_internal(params, 123);

        // With small N, just verify reasonable output (Df estimation improves with more particles)
        assert!(result.fractal_dimension > 0.5);
        assert!(result.fractal_dimension < 4.0);
    }
}
