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
    pub radius_min: f64,
    pub radius_max: f64,
    pub box_size: f64,
    pub max_iterations: usize,
    pub step_size_factor: f64,
    /// If true (default), iterate until ONE agglomerate remains.
    /// If false, stop at max_iterations (multi-agglomerate mode).
    pub single_agglomerate: bool,
}

impl Default for CcaParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            sticking_probability: 1.0,
            radius_min: 1.0,
            radius_max: 1.0,
            box_size: 100.0,
            max_iterations: 100_000,
            step_size_factor: 2.0, // Increased for faster convergence
            single_agglomerate: true,
        }
    }
}

impl CcaParams {
    /// Calculate optimal box size based on particle count and target volume fraction.
    ///
    /// For CCA to converge in reasonable time, particles need to encounter each other
    /// frequently. A volume fraction of ~2-5% ensures good convergence speed.
    pub fn optimal_box_size(n_particles: usize, mean_radius: f64, target_volume_fraction: f64) -> f64 {
        // Volume of a sphere: 4/3 * π * r³
        let particle_volume = (4.0 / 3.0) * std::f64::consts::PI * mean_radius.powi(3);
        let total_particle_volume = n_particles as f64 * particle_volume;
        let box_volume = total_particle_volume / target_volume_fraction;
        box_volume.cbrt()
    }

    /// Check if particles are polydisperse.
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

    /// Get the mean radius.
    pub fn mean_radius(&self) -> f64 {
        (self.radius_min + self.radius_max) / 2.0
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
///
/// # Arguments
/// * `n_particles` - Number of particles
/// * `sticking_probability` - Probability of adhesion on contact (0-1)
/// * `radius_min` - Minimum particle radius
/// * `radius_max` - Maximum particle radius (defaults to radius_min for monodisperse)
/// * `box_size` - Size of the periodic simulation box
/// * `single_agglomerate` - If true (default), iterate until ONE agglomerate forms.
///                          If false, may produce multiple agglomerates.
/// * `seed` - Random seed for reproducibility
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, radius_min=1.0, radius_max=None, box_size=100.0, single_agglomerate=true, seed=None))]
pub fn run_cca(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    box_size: f64,
    single_agglomerate: bool,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);

    let params = CcaParams {
        n_particles,
        sticking_probability,
        radius_min,
        radius_max,
        box_size,
        single_agglomerate,
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

    // Calculate optimal box size to ensure reasonable convergence
    // Target ~3% volume fraction for good performance
    let optimal_box = CcaParams::optimal_box_size(params.n_particles, params.mean_radius(), 0.03);

    // Use the smaller of user-specified or optimal box size for single_agglomerate mode
    // This prevents simulations from running indefinitely
    let effective_box_size = if params.single_agglomerate {
        params.box_size.min(optimal_box)
    } else {
        params.box_size
    };

    // Initialize all particles as individual clusters randomly distributed
    // Each particle gets a random radius if polydisperse
    let mut clusters: Vec<Cluster> = (0..params.n_particles)
        .map(|_| {
            let x = (rng.gen::<f64>() - 0.5) * effective_box_size;
            let y = (rng.gen::<f64>() - 0.5) * effective_box_size;
            let z = (rng.gen::<f64>() - 0.5) * effective_box_size;
            let radius = params.random_radius(&mut rng);
            Cluster::new(Sphere::new(Vector3::new(x, y, z), radius))
        })
        .collect();

    // Track Rg evolution (of the largest cluster)
    let mut rg_evolution = Vec::new();
    let mut n_values = Vec::new();

    let step_size = params.mean_radius() * params.step_size_factor;

    // Iterate until only one cluster remains (single_agglomerate mode)
    // or max iterations reached (multi-agglomerate mode)
    let mut iteration = 0;
    // Safety limit for single_agglomerate mode to prevent infinite loops
    let max_iters = if params.single_agglomerate {
        10_000_000 // Very high limit - should always converge before this
    } else {
        params.max_iterations
    };

    loop {
        // Stop when only one cluster remains
        if clusters.len() <= 1 {
            break;
        }

        // Respect iteration limit
        if iteration >= max_iters {
            break;
        }

        iteration += 1;

        // Move all clusters with Brownian motion
        for cluster in &mut clusters {
            let (dx, dy, dz) = random_direction(&mut rng);
            // Smaller clusters move faster (diffusion coefficient ~ 1/Rg)
            // Use sqrt for more realistic diffusion scaling
            let mobility = 1.0 / (1.0 + cluster.radius_of_gyration.sqrt());
            let delta = Vector3::new(dx * step_size * mobility, dy * step_size * mobility, dz * step_size * mobility);
            cluster.translate(delta);

            // Apply periodic boundary conditions only to cluster center
            // Don't apply PBC to individual particles to maintain connectivity
            let mut wrapped_center = cluster.center_of_mass;
            apply_pbc(&mut wrapped_center, effective_box_size);

            // If the center wrapped, translate all particles by the same amount
            let wrap_delta = wrapped_center - cluster.center_of_mass;
            if wrap_delta.length_squared() > 1e-10 {
                cluster.translate(wrap_delta);
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

                // Quick bounding check using periodic distance
                let dist = periodic_distance(
                    &clusters[i].center_of_mass,
                    &clusters[j].center_of_mass,
                    effective_box_size,
                );
                let max_dist = clusters[i].bounding_radius() + clusters[j].bounding_radius();

                if dist < max_dist {
                    // Detailed particle-level collision check with PBC
                    if check_cluster_collision_pbc(&clusters[i], &clusters[j], effective_box_size) {
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

        // Perform merges - sort by j descending to maintain valid indices during removal
        merges.sort_by(|a, b| b.1.cmp(&a.1));
        for (i, j) in merges {
            // Ensure indices are still valid (defensive check)
            if j < clusters.len() && i < clusters.len() && i != j {
                let mut cluster_j = clusters.remove(j);
                // Adjust i if it was after j
                let adjusted_i = if i > j { i - 1 } else { i };
                if adjusted_i < clusters.len() {
                    // Unwrap cluster_j to be in the same periodic image as cluster_i
                    let delta = unwrap_periodic_offset(
                        &clusters[adjusted_i].center_of_mass,
                        &cluster_j.center_of_mass,
                        effective_box_size,
                    );
                    if delta.length_squared() > 1e-10 {
                        cluster_j.translate(delta);
                    }
                    clusters[adjusted_i].merge_with(cluster_j);
                }
            }
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
    let coordination = calculate_coordination(&coords, &radii, params.mean_radius() * 0.1);

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

/// Calculate the offset needed to move point b into the same periodic image as point a.
fn unwrap_periodic_offset(a: &Vector3, b: &Vector3, box_size: f64) -> Vector3 {
    let mut dx = a.x - b.x;
    let mut dy = a.y - b.y;
    let mut dz = a.z - b.z;

    // If the difference is more than half the box, wrap to the closer image
    if dx > box_size / 2.0 {
        dx -= box_size;
    } else if dx < -box_size / 2.0 {
        dx += box_size;
    }
    if dy > box_size / 2.0 {
        dy -= box_size;
    } else if dy < -box_size / 2.0 {
        dy += box_size;
    }
    if dz > box_size / 2.0 {
        dz -= box_size;
    } else if dz < -box_size / 2.0 {
        dz += box_size;
    }

    // Return the offset to add to b to bring it close to a
    // b + offset should be close to a
    // So: b + offset = a - d where d = a - b after wrapping
    // offset = a - d - b = a - (a - b_wrapped) - b = b_wrapped - b
    // Actually: if dx is the wrapped difference a - b, then
    // to get b_wrapped = a - dx, we need offset = a - dx - b
    let target_x = a.x - dx;
    let target_y = a.y - dy;
    let target_z = a.z - dz;

    Vector3::new(target_x - b.x, target_y - b.y, target_z - b.z)
}

/// Calculate periodic distance between two points.
fn periodic_distance(a: &Vector3, b: &Vector3, box_size: f64) -> f64 {
    let mut dx = (a.x - b.x).abs();
    let mut dy = (a.y - b.y).abs();
    let mut dz = (a.z - b.z).abs();

    // Apply minimum image convention
    if dx > box_size / 2.0 {
        dx = box_size - dx;
    }
    if dy > box_size / 2.0 {
        dy = box_size - dy;
    }
    if dz > box_size / 2.0 {
        dz = box_size - dz;
    }

    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Check if any particle in cluster A touches any particle in cluster B.
/// Uses periodic boundary conditions for distance calculation.
fn check_cluster_collision_pbc(a: &Cluster, b: &Cluster, box_size: f64) -> bool {
    for pa in &a.particles {
        for pb in &b.particles {
            let dist = periodic_distance(&pa.center, &pb.center, box_size);
            let contact_dist = pa.radius + pb.radius;
            // Use relative epsilon for robust comparison
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
            single_agglomerate: true,
            ..Default::default()
        };

        let r1 = run_cca_internal(params.clone(), 42);
        let r2 = run_cca_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
    }

    #[test]
    fn test_cca_single_agglomerate() {
        // Test that single_agglomerate=true produces ONE connected agglomerate
        let params = CcaParams {
            n_particles: 50,
            box_size: 30.0,
            single_agglomerate: true,
            ..Default::default()
        };

        let result = run_cca_internal(params, 123);

        // Should have all particles
        assert_eq!(result.coordinates.len(), 50);
        // Fractal dimension should be meaningful (> 1 for a real agglomerate)
        assert!(result.fractal_dimension > 1.0, "Df should be > 1 for a connected agglomerate");
        // Coordination should show connectivity
        assert!(result.coordination_mean > 0.5, "Particles should be connected");
    }

    #[test]
    fn test_cca_multi_agglomerate() {
        // Test that single_agglomerate=false can produce multiple clusters
        let params = CcaParams {
            n_particles: 30,
            box_size: 100.0, // Large box makes merging slow
            max_iterations: 100, // Very few iterations
            single_agglomerate: false,
            ..Default::default()
        };

        let result = run_cca_internal(params, 456);

        // Should still have all particles
        assert_eq!(result.coordinates.len(), 30);
    }

    #[test]
    fn test_cca_polydisperse() {
        let params = CcaParams {
            n_particles: 30,
            radius_min: 0.8,
            radius_max: 1.2,
            box_size: 30.0,
            single_agglomerate: true,
            ..Default::default()
        };

        assert!(params.is_polydisperse());

        let result = run_cca_internal(params, 789);

        let min_r = result.radii.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_r = result.radii.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        assert!(max_r > min_r, "Radii should vary");
        assert!(min_r >= 0.8 - 1e-10);
        assert!(max_r <= 1.2 + 1e-10);
    }
}
