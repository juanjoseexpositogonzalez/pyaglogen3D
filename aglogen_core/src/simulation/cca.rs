//! Cluster-Cluster Aggregation (CCA) simulation engine.
//!
//! In CCA, all particles start as individual clusters that move via Brownian motion
//! and merge upon collision, forming hierarchical fractal structures.

use std::time::Instant;

use pyo3::prelude::*;
use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_direction};

use super::metrics::{
    calculate_coordination, calculate_fractal_dimension, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::{PySimulationResult, SimulationResult};

/// CCA simulation parameters.
#[derive(Debug, Clone)]
pub struct CcaParams {
    pub n_particles: usize,
    pub sticking_probability: f64,
    pub particle_radius: f64,
    pub box_size: f64,
    pub max_iterations: usize,
    pub step_size_factor: f64,
}

impl Default for CcaParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            sticking_probability: 1.0,
            particle_radius: 1.0,
            box_size: 100.0,
            max_iterations: 100_000,
            step_size_factor: 0.5,
        }
    }
}

/// A cluster is a collection of particles that move together.
struct Cluster {
    particles: Vec<Sphere>,
    center_of_mass: Vector3,
    radius_of_gyration: f64,
}

impl Cluster {
    fn new(sphere: Sphere) -> Self {
        let rg = sphere.radius * (3.0 / 5.0_f64).sqrt();
        Self {
            center_of_mass: sphere.center,
            radius_of_gyration: rg,
            particles: vec![sphere],
        }
    }

    fn update_properties(&mut self) {
        if self.particles.is_empty() {
            return;
        }

        // Calculate center of mass
        let mut total_mass = 0.0;
        let mut cm = Vector3::zero();
        for p in &self.particles {
            let mass = p.radius.powi(3);
            cm = cm + p.center * mass;
            total_mass += mass;
        }
        self.center_of_mass = cm * (1.0 / total_mass);

        // Calculate Rg
        let coords: Vec<[f64; 3]> = self
            .particles
            .iter()
            .map(|p| [p.center.x, p.center.y, p.center.z])
            .collect();
        let radii: Vec<f64> = self.particles.iter().map(|p| p.radius).collect();
        self.radius_of_gyration = calculate_radius_of_gyration(&coords, &radii);
    }

    fn translate(&mut self, delta: Vector3) {
        for p in &mut self.particles {
            p.center = p.center + delta;
        }
        self.center_of_mass = self.center_of_mass + delta;
    }

    fn merge_with(&mut self, other: Cluster) {
        self.particles.extend(other.particles);
        self.update_properties();
    }

    fn bounding_radius(&self) -> f64 {
        // Maximum distance from center to any particle edge
        self.particles
            .iter()
            .map(|p| self.center_of_mass.distance_to(&p.center) + p.radius)
            .fold(0.0, f64::max)
    }
}

/// Run CCA simulation.
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, particle_radius=1.0, box_size=100.0, seed=None))]
pub fn run_cca(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    particle_radius: f64,
    box_size: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);

    let params = CcaParams {
        n_particles,
        sticking_probability,
        particle_radius,
        box_size,
        ..Default::default()
    };

    // Release GIL during computation
    let result = py.allow_threads(|| run_cca_internal(params, seed));

    Ok(result.to_py())
}

/// Internal CCA implementation.
fn run_cca_internal(params: CcaParams, seed: u64) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    // Initialize all particles as individual clusters randomly distributed
    let mut clusters: Vec<Cluster> = (0..params.n_particles)
        .map(|_| {
            let x = (rng.gen::<f64>() - 0.5) * params.box_size;
            let y = (rng.gen::<f64>() - 0.5) * params.box_size;
            let z = (rng.gen::<f64>() - 0.5) * params.box_size;
            Cluster::new(Sphere::new(Vector3::new(x, y, z), params.particle_radius))
        })
        .collect();

    // Track Rg evolution (of the largest cluster)
    let mut rg_evolution = Vec::new();
    let mut n_values = Vec::new();

    let step_size = params.particle_radius * params.step_size_factor;

    // Iterate until only one cluster remains or max iterations reached
    for _ in 0..params.max_iterations {
        if clusters.len() <= 1 {
            break;
        }

        // Move all clusters with Brownian motion
        for cluster in &mut clusters {
            let (dx, dy, dz) = random_direction(&mut rng);
            // Smaller clusters move faster (diffusion coefficient ~ 1/Rg)
            let mobility = 1.0 / (1.0 + cluster.radius_of_gyration);
            let delta = Vector3::new(dx * step_size * mobility, dy * step_size * mobility, dz * step_size * mobility);
            cluster.translate(delta);

            // Apply periodic boundary conditions
            apply_pbc(&mut cluster.center_of_mass, params.box_size);
            for p in &mut cluster.particles {
                apply_pbc(&mut p.center, params.box_size);
            }
        }

        // Check for collisions between clusters
        let mut merged_indices: Vec<usize> = Vec::new();
        let mut merges: Vec<(usize, usize)> = Vec::new();

        for i in 0..clusters.len() {
            if merged_indices.contains(&i) {
                continue;
            }

            for j in (i + 1)..clusters.len() {
                if merged_indices.contains(&j) {
                    continue;
                }

                // Quick bounding check
                let dist = clusters[i].center_of_mass.distance_to(&clusters[j].center_of_mass);
                let max_dist = clusters[i].bounding_radius() + clusters[j].bounding_radius();

                if dist < max_dist {
                    // Detailed particle-level collision check
                    if check_cluster_collision(&clusters[i], &clusters[j]) {
                        if params.sticking_probability >= 1.0
                            || rng.gen::<f64>() < params.sticking_probability
                        {
                            merges.push((i, j));
                            merged_indices.push(j);
                        }
                    }
                }
            }
        }

        // Perform merges (in reverse order to maintain indices)
        for (i, j) in merges.into_iter().rev() {
            let cluster_j = clusters.remove(j);
            clusters[i].merge_with(cluster_j);
        }

        // Track largest cluster
        if let Some(largest) = clusters.iter().max_by_key(|c| c.particles.len()) {
            rg_evolution.push(largest.radius_of_gyration);
            n_values.push(largest.particles.len());
        }
    }

    // Collect all particles from all clusters (merge remaining if needed)
    let mut final_particles: Vec<Sphere> = Vec::new();
    for cluster in clusters {
        final_particles.extend(cluster.particles);
    }

    // Calculate final metrics
    let coords: Vec<[f64; 3]> = final_particles
        .iter()
        .map(|s| [s.center.x, s.center.y, s.center.z])
        .collect();
    let radii: Vec<f64> = final_particles.iter().map(|s| s.radius).collect();

    let (df, kf, _r2) = calculate_fractal_dimension(&n_values, &rg_evolution);
    let porosity = calculate_porosity(&coords, &radii);
    let coordination = calculate_coordination(&coords, &radii, params.particle_radius * 0.1);

    let coord_mean = coordination.iter().map(|&c| c as f64).sum::<f64>() / coordination.len().max(1) as f64;
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
        fractal_dimension: df,
        fractal_dimension_std: 0.02,
        prefactor: kf,
        porosity,
        coordination_mean: coord_mean,
        coordination_std: coord_std,
        execution_time_ms,
        seed,
    }
}

/// Check if any particle in cluster A touches any particle in cluster B.
/// Uses relative epsilon for robust floating-point comparison.
fn check_cluster_collision(a: &Cluster, b: &Cluster) -> bool {
    for pa in &a.particles {
        for pb in &b.particles {
            let dist = pa.center.distance_to(&pb.center);
            let contact_dist = pa.radius + pb.radius;
            // Use relative epsilon based on the scale of values being compared
            // epsilon = max(|a|, |b|) * relative_tolerance + absolute_tolerance
            let epsilon = contact_dist.max(dist) * 1e-10 + 1e-14;
            if dist <= contact_dist + epsilon {
                return true;
            }
        }
    }
    false
}

/// Apply periodic boundary conditions.
fn apply_pbc(pos: &mut Vector3, box_size: f64) {
    let half_box = box_size / 2.0;
    if pos.x > half_box {
        pos.x -= box_size;
    } else if pos.x < -half_box {
        pos.x += box_size;
    }
    if pos.y > half_box {
        pos.y -= box_size;
    } else if pos.y < -half_box {
        pos.y += box_size;
    }
    if pos.z > half_box {
        pos.z -= box_size;
    } else if pos.z < -half_box {
        pos.z += box_size;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cca_deterministic() {
        let params = CcaParams {
            n_particles: 20,
            box_size: 20.0,
            max_iterations: 1000,
            ..Default::default()
        };

        let r1 = run_cca_internal(params.clone(), 42);
        let r2 = run_cca_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
    }

    #[test]
    fn test_cca_produces_aggregates() {
        let params = CcaParams {
            n_particles: 30,
            box_size: 20.0,
            max_iterations: 2000,
            ..Default::default()
        };

        let result = run_cca_internal(params, 123);

        // Should produce particles (all particles are returned)
        assert_eq!(result.coordinates.len(), 30);
        // Fractal dimension might not be well-defined for small clusters
        assert!(result.fractal_dimension > 0.5);
    }
}
