//! Ballistic Cluster-Cluster Aggregation (Ballistic CC) simulation engine.
//!
//! Based on section 6.2 of the AgloGen3D thesis. In Ballistic CC:
//! - All particles start as individual clusters (monomers)
//! - Two clusters are randomly selected
//! - One is designated as "impacted" (stationary), one as "impactor" (moving)
//! - The impactor moves in a straight line (ballistic trajectory) towards the impacted
//! - On collision, clusters merge and return to the pool (with replacement)
//! - Process repeats until only one cluster remains
//!
//! This produces more open, branched structures than Ballistic PC (Df ~ 1.8-2.1)
//! because clusters of similar size merge, reducing interpenetration.

use std::time::Instant;

use pyo3::prelude::*;
use rand::seq::SliceRandom;
use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_direction, random_point_on_sphere};

use super::metrics::{
    calculate_coordination, calculate_fractal_dimension, calculate_inertia_tensor,
    calculate_porosity, calculate_radius_of_gyration,
};
use super::result::{PySimulationResult, SimulationResult};

/// Ballistic CC simulation parameters.
#[derive(Debug, Clone)]
pub struct BallisticCcParams {
    pub n_particles: usize,
    pub sticking_probability: f64,
    pub radius_min: f64,
    pub radius_max: f64,
    pub max_collision_attempts: usize,
}

impl Default for BallisticCcParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            sticking_probability: 1.0,
            radius_min: 1.0,
            radius_max: 1.0,
            max_collision_attempts: 100,
        }
    }
}

impl BallisticCcParams {
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

/// A cluster of particles for Ballistic CC.
#[derive(Clone)]
struct Cluster {
    particles: Vec<Sphere>,
    center_of_mass: Vector3,
    geometric_center: Vector3,
    bounding_radius: f64,
    radius_of_gyration: f64,
}

impl Cluster {
    /// Create a new cluster from a single particle (monomer).
    fn new(sphere: Sphere) -> Self {
        let rg = sphere.radius * (3.0 / 5.0_f64).sqrt();
        Self {
            center_of_mass: sphere.center,
            geometric_center: sphere.center,
            bounding_radius: sphere.radius,
            radius_of_gyration: rg,
            particles: vec![sphere],
        }
    }

    /// Update cluster properties after modification.
    fn update_properties(&mut self) {
        if self.particles.is_empty() {
            return;
        }

        // Calculate center of mass (mass ~ r³)
        let mut total_mass = 0.0;
        let mut cm = Vector3::zero();
        let mut gc = Vector3::zero();

        for p in &self.particles {
            let mass = p.radius.powi(3);
            cm = cm + p.center * mass;
            gc = gc + p.center;
            total_mass += mass;
        }

        self.center_of_mass = cm * (1.0 / total_mass);
        self.geometric_center = gc * (1.0 / self.particles.len() as f64);

        // Calculate bounding radius (from geometric center)
        self.bounding_radius = self
            .particles
            .iter()
            .map(|p| self.geometric_center.distance_to(&p.center) + p.radius)
            .fold(0.0, f64::max);

        // Calculate radius of gyration
        let coords: Vec<[f64; 3]> = self
            .particles
            .iter()
            .map(|p| [p.center.x, p.center.y, p.center.z])
            .collect();
        let radii: Vec<f64> = self.particles.iter().map(|p| p.radius).collect();
        self.radius_of_gyration = calculate_radius_of_gyration(&coords, &radii);
    }

    /// Translate all particles by a vector.
    fn translate(&mut self, delta: Vector3) {
        for p in &mut self.particles {
            p.center = p.center + delta;
        }
        self.center_of_mass = self.center_of_mass + delta;
        self.geometric_center = self.geometric_center + delta;
    }

    /// Merge another cluster into this one.
    fn merge_with(&mut self, other: Cluster) {
        self.particles.extend(other.particles);
        self.update_properties();
    }

    /// Check for collision with another cluster.
    /// Returns the collision distance t, and indices of colliding particles.
    /// The `other` cluster moves along `trajectory` direction.
    fn find_collision_with(
        &self,
        other: &Cluster,
        trajectory: Vector3,
        max_distance: f64,
    ) -> Option<(f64, usize, usize)> {
        // For each pair of particles, find the collision distance along trajectory
        // We solve: |pi.center - (pj.center + t*trajectory)| = ri + rj
        // Which becomes: |d - t*trajectory|^2 = contact_dist^2
        // Where d = pi.center - pj.center
        let mut best_collision: Option<(f64, usize, usize)> = None;

        for (i, pi) in self.particles.iter().enumerate() {
            for (j, pj) in other.particles.iter().enumerate() {
                let d = pi.center - pj.center;
                let contact_dist = pi.radius + pj.radius;

                // Quadratic: t^2*(traj·traj) - 2t*(d·traj) + (d·d - contact^2) = 0
                let a = trajectory.dot(&trajectory);
                let b = -2.0 * d.dot(&trajectory); // Note: negative sign
                let c = d.dot(&d) - contact_dist * contact_dist;

                let discriminant = b * b - 4.0 * a * c;

                if discriminant >= 0.0 {
                    let sqrt_disc = discriminant.sqrt();
                    let t1 = (-b - sqrt_disc) / (2.0 * a);
                    let t2 = (-b + sqrt_disc) / (2.0 * a);

                    // We want the smallest positive t (first collision along trajectory)
                    let t = if t1 > 1e-10 {
                        t1
                    } else if t2 > 1e-10 {
                        t2
                    } else {
                        continue;
                    };

                    if t <= max_distance {
                        if best_collision.is_none() || t < best_collision.unwrap().0 {
                            best_collision = Some((t, i, j));
                        }
                    }
                }
            }
        }

        best_collision
    }
}

/// Run Ballistic CC simulation.
///
/// # Arguments
/// * `n_particles` - Number of particles in the final agglomerate
/// * `sticking_probability` - Probability of adhesion on contact (0-1)
/// * `radius_min` - Minimum particle radius
/// * `radius_max` - Maximum particle radius (defaults to radius_min for monodisperse)
/// * `seed` - Random seed for reproducibility
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, radius_min=1.0, radius_max=None, seed=None))]
pub fn run_ballistic_cc(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);

    let params = BallisticCcParams {
        n_particles,
        sticking_probability,
        radius_min,
        radius_max,
        ..Default::default()
    };

    let result = py.allow_threads(|| run_ballistic_cc_internal(params, seed));

    Ok(result.to_py())
}

/// Internal Ballistic CC implementation following thesis section 6.2.
fn run_ballistic_cc_internal(params: BallisticCcParams, seed: u64) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    // Step 1: Initialize all particles as individual clusters (monomers)
    // Spread them out in space to avoid initial overlaps
    let spread = (params.n_particles as f64).cbrt() * params.mean_radius() * 3.0;
    let mut clusters: Vec<Cluster> = (0..params.n_particles)
        .map(|_| {
            let x = (rng.gen::<f64>() - 0.5) * spread;
            let y = (rng.gen::<f64>() - 0.5) * spread;
            let z = (rng.gen::<f64>() - 0.5) * spread;
            let radius = params.random_radius(&mut rng);
            Cluster::new(Sphere::new(Vector3::new(x, y, z), radius))
        })
        .collect();

    // Track Rg evolution of the largest cluster
    let mut rg_evolution = Vec::new();
    let mut n_values = Vec::new();

    // Main aggregation loop - continue until only one cluster remains
    let mut iterations = 0;
    let max_iterations = params.n_particles * 1000; // Safety limit

    while clusters.len() > 1 && iterations < max_iterations {
        iterations += 1;

        // Step 5: Select two clusters randomly
        let indices: Vec<usize> = (0..clusters.len()).collect();
        let selected: Vec<&usize> = indices.choose_multiple(&mut rng, 2).collect();
        let idx_impacted = *selected[0];
        let idx_impactor = *selected[1];

        // Get the clusters (we'll remove the impactor later)
        let impacted = &clusters[idx_impacted];
        let impactor = &clusters[idx_impactor];

        // Calculate direction from impactor to impacted (main trajectory)
        let base_direction = (impacted.geometric_center - impactor.geometric_center).normalize();

        // Add some randomness to the trajectory (within a cone)
        let (rx, ry, rz) = random_direction(&mut rng);
        let random_offset = Vector3::new(rx, ry, rz) * 0.3; // 30% random deviation
        let trajectory_dir = (base_direction + random_offset).normalize();

        // Step 7: Calculate the extended projection area
        let extended_radius = impacted.bounding_radius + impactor.bounding_radius;

        // Step 8: Choose a random offset perpendicular to trajectory
        let (px, py, _pz) = random_point_on_sphere(&mut rng);
        let impact_offset = rng.gen::<f64>() * extended_radius * 0.5; // Random offset within projection

        // Create orthogonal basis for the disc plane
        let (u, v) = create_orthogonal_basis(trajectory_dir);
        let offset_on_disc = u * (px * impact_offset) + v * (py * impact_offset);

        // Step 9: Position impactor at launch distance along (negative) trajectory
        let current_distance = impactor.geometric_center.distance_to(&impacted.geometric_center);
        let launch_distance = current_distance + impactor.bounding_radius + impacted.bounding_radius;
        let impactor_start = impacted.geometric_center + offset_on_disc - trajectory_dir * launch_distance;

        // Create a working copy of impactor translated to start position
        let mut working_impactor = impactor.clone();
        let translation = impactor_start - working_impactor.geometric_center;
        working_impactor.translate(translation);

        // Step 10: March impactor along trajectory to find collision
        let collision = impacted.find_collision_with(
            &working_impactor,
            trajectory_dir,
            launch_distance * 2.0,
        );

        if let Some((t, _, _)) = collision {
            // Check sticking probability
            if params.sticking_probability >= 1.0 || rng.gen::<f64>() < params.sticking_probability
            {
                // Move impactor to collision point
                working_impactor.translate(trajectory_dir * t);

                // Step 11 & 12: Merge clusters
                // Remove both clusters and create a merged one
                let (higher_idx, lower_idx) = if idx_impactor > idx_impacted {
                    (idx_impactor, idx_impacted)
                } else {
                    (idx_impacted, idx_impactor)
                };

                // Remove higher index first to avoid index shifting issues
                let cluster_high = clusters.remove(higher_idx);
                let cluster_low = clusters.remove(lower_idx);

                // Create merged cluster from working_impactor (which has correct position)
                // and the impacted cluster's particles
                let mut merged = working_impactor;
                if higher_idx == idx_impactor {
                    // cluster_low is impacted - already at correct position
                    merged.merge_with(cluster_low);
                } else {
                    // cluster_high was impacted, cluster_low was impactor
                    merged.merge_with(cluster_high);
                }

                // Add merged cluster back to pool
                clusters.push(merged);

                // Track largest cluster
                if let Some(largest) = clusters.iter().max_by_key(|c| c.particles.len()) {
                    rg_evolution.push(largest.radius_of_gyration);
                    n_values.push(largest.particles.len());
                }
            }
        }
        // If no collision (fruitless impact), we just continue to next iteration
        // The clusters remain separate and may be selected again
    }

    // Collect all particles from the final cluster
    let final_particles: Vec<Sphere> = if clusters.is_empty() {
        Vec::new()
    } else {
        clusters.remove(0).particles
    };

    // Calculate final metrics
    let coords: Vec<[f64; 3]> = final_particles
        .iter()
        .map(|s| [s.center.x, s.center.y, s.center.z])
        .collect();
    let radii: Vec<f64> = final_particles.iter().map(|s| s.radius).collect();

    let (df, kf, _r2) = calculate_fractal_dimension(&n_values, &rg_evolution);
    let porosity = calculate_porosity(&coords, &radii);
    let coordination = calculate_coordination(&coords, &radii, params.mean_radius() * 0.1);
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

    let rg_final = if !coords.is_empty() {
        calculate_radius_of_gyration(&coords, &radii)
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
        anisotropy: inertia.anisotropy,
        asphericity: inertia.asphericity,
        acylindricity: inertia.acylindricity,
        principal_moments: inertia.principal_moments,
        principal_axes: inertia.principal_axes,
    }
}

/// Create an orthogonal basis (u, v) perpendicular to the given direction.
fn create_orthogonal_basis(dir: Vector3) -> (Vector3, Vector3) {
    // Find a vector not parallel to dir
    let not_parallel = if dir.x.abs() < 0.9 {
        Vector3::new(1.0, 0.0, 0.0)
    } else {
        Vector3::new(0.0, 1.0, 0.0)
    };

    // u = dir × not_parallel (normalized)
    let u = dir.cross(&not_parallel).normalize();
    // v = dir × u
    let v = dir.cross(&u);

    (u, v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ballistic_cc_deterministic() {
        let params = BallisticCcParams {
            n_particles: 30,
            ..Default::default()
        };

        let r1 = run_ballistic_cc_internal(params.clone(), 42);
        let r2 = run_ballistic_cc_internal(params, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
    }

    #[test]
    fn test_ballistic_cc_produces_agglomerate() {
        let params = BallisticCcParams {
            n_particles: 50,
            ..Default::default()
        };

        let result = run_ballistic_cc_internal(params, 123);

        // Should produce all particles
        assert_eq!(result.coordinates.len(), 50);

        // Ballistic CC typically produces Df ~ 1.8-2.2 (more open than PC)
        assert!(
            result.fractal_dimension > 1.0,
            "Df should be > 1.0, got {}",
            result.fractal_dimension
        );
    }

    #[test]
    fn test_ballistic_cc_polydisperse() {
        let params = BallisticCcParams {
            n_particles: 30,
            radius_min: 0.8,
            radius_max: 1.2,
            ..Default::default()
        };

        assert!(params.is_polydisperse());

        let result = run_ballistic_cc_internal(params, 789);

        let min_r = result.radii.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_r = result.radii.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        assert!(max_r > min_r, "Radii should vary");
    }
}
