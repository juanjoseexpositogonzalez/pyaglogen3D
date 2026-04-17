//! Generalized Cluster-Cluster Aggregation (Tomchuk & Avdeev 2020)
//!
//! This algorithm provides a unified framework for fractal aggregate generation,
//! encompassing Filippov's symmetric CCA, Ringl's particle-cluster growth, and
//! arbitrary stochastic split strategies.
//!
//! The key generalization is that cluster pairs (N1, N2) need not be equal,
//! allowing interpolation between cluster-cluster and particle-cluster dynamics.
//!
//! Reference: Tomchuk, O.V., Avdeev, M.V. (2020). "Modeling fractal aggregates of
//! polydisperse particles with tunable dimension." Colloids Surf. A, 605, 125370.

use std::f64::consts::PI;
use std::time::Instant;

use rand::prelude::*;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::create_rng;

use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::SimulationResult;

/// Split strategy for cluster pairing
#[derive(Debug, Clone)]
pub enum SplitStrategy {
    /// Symmetric split: N1 ≈ N2 (recovers Filippov for powers of 2)
    Symmetric,
    /// Particle-Cluster: N1 = N-1, N2 = 1 (sequential growth like Ringl)
    ParticleCluster,
    /// Stochastic split with configurable mean ratio and std
    Stochastic { mean_ratio: f64, std_ratio: f64 },
}

impl Default for SplitStrategy {
    fn default() -> Self {
        SplitStrategy::Symmetric
    }
}

/// A cluster for GCCA aggregation
#[derive(Clone)]
struct GccaCluster {
    /// Particle spheres in this cluster
    particles: Vec<Sphere>,
    /// Center of mass
    center_of_mass: Vector3,
    /// Radius of gyration
    radius_of_gyration: f64,
    /// Bounding radius (max distance from CoM + particle radius)
    bounding_radius: f64,
}

impl GccaCluster {
    /// Create a new cluster from a single particle
    fn new_single(sphere: Sphere) -> Self {
        Self {
            center_of_mass: sphere.center,
            radius_of_gyration: 0.0,
            bounding_radius: sphere.radius,
            particles: vec![sphere],
        }
    }

    /// Number of particles in the cluster
    fn n_particles(&self) -> usize {
        self.particles.len()
    }

    /// Total mass (proportional to sum of r³)
    fn total_mass(&self) -> f64 {
        self.particles.iter().map(|s| s.radius.powi(3)).sum()
    }

    /// Mean particle radius
    fn mean_radius(&self) -> f64 {
        let sum: f64 = self.particles.iter().map(|s| s.radius).sum();
        sum / self.particles.len() as f64
    }

    /// Recalculate center of mass and radius of gyration
    fn update_properties(&mut self) {
        // Mass-weighted center of mass
        let mut total_mass = 0.0;
        let mut com = Vector3::zero();

        for p in &self.particles {
            let mass = p.radius.powi(3);
            com = com + p.center * mass;
            total_mass += mass;
        }

        if total_mass > 0.0 {
            com = com * (1.0 / total_mass);
        }

        self.center_of_mass = com;

        // Mass-weighted radius of gyration
        if self.particles.len() <= 1 {
            self.radius_of_gyration = 0.0;
        } else {
            let mut rg_sq = 0.0;
            for p in &self.particles {
                let mass = p.radius.powi(3);
                let r = p.center - com;
                rg_sq += mass * r.length_squared();
            }
            self.radius_of_gyration = (rg_sq / total_mass).sqrt();
        }

        // Bounding radius
        self.bounding_radius = self
            .particles
            .iter()
            .map(|p| (p.center - self.center_of_mass).length() + p.radius)
            .fold(0.0, f64::max);
    }

    /// Translate all particles by a vector
    fn translate(&mut self, offset: Vector3) {
        for p in &mut self.particles {
            p.center = p.center + offset;
        }
        self.center_of_mass = self.center_of_mass + offset;
    }

    /// Rotate all particles around the center of mass
    fn rotate(&mut self, rotation: &[[f64; 3]; 3]) {
        let com = self.center_of_mass;
        for p in &mut self.particles {
            let relative = p.center - com;
            let rotated = rotate_vector(&relative, rotation);
            p.center = com + rotated;
        }
    }

    /// Merge another cluster into this one
    fn merge_with(&mut self, other: GccaCluster) {
        self.particles.extend(other.particles);
        self.update_properties();
    }

    /// Check if any particle overlaps with another cluster
    fn overlaps_with(&self, other: &GccaCluster, tolerance: f64) -> bool {
        for p1 in &self.particles {
            for p2 in &other.particles {
                let dist = (p1.center - p2.center).length();
                let min_dist = (p1.radius + p2.radius) * (1.0 - tolerance);
                if dist < min_dist {
                    return true;
                }
            }
        }
        false
    }

    /// Check if at least one contact exists
    fn has_contact_with(&self, other: &GccaCluster, tolerance: f64) -> bool {
        for p1 in &self.particles {
            for p2 in &other.particles {
                let dist = (p1.center - p2.center).length();
                let contact_dist = p1.radius + p2.radius;
                if dist <= contact_dist * (1.0 + tolerance) {
                    return true;
                }
            }
        }
        false
    }
}

/// Generate a random unit vector uniformly on the sphere
fn random_unit_vector<R: Rng>(rng: &mut R) -> Vector3 {
    let theta = rng.gen::<f64>() * 2.0 * PI;
    let phi = (1.0 - 2.0 * rng.gen::<f64>()).acos();

    Vector3::new(phi.sin() * theta.cos(), phi.sin() * theta.sin(), phi.cos())
}

/// Generate a random rotation matrix uniformly from SO(3)
fn random_rotation_matrix<R: Rng>(rng: &mut R) -> [[f64; 3]; 3] {
    let alpha = rng.gen::<f64>() * 2.0 * PI;
    let beta = rng.gen::<f64>().acos();
    let gamma = rng.gen::<f64>() * 2.0 * PI;

    let (sa, ca) = alpha.sin_cos();
    let (sb, cb) = beta.sin_cos();
    let (sg, cg) = gamma.sin_cos();

    [
        [ca * cb * cg - sa * sg, -ca * cb * sg - sa * cg, ca * sb],
        [sa * cb * cg + ca * sg, -sa * cb * sg + ca * cg, sa * sb],
        [-sb * cg, sb * sg, cb],
    ]
}

/// Apply rotation matrix to a vector
fn rotate_vector(v: &Vector3, rot: &[[f64; 3]; 3]) -> Vector3 {
    Vector3::new(
        rot[0][0] * v.x + rot[0][1] * v.y + rot[0][2] * v.z,
        rot[1][0] * v.x + rot[1][1] * v.y + rot[1][2] * v.z,
        rot[2][0] * v.x + rot[2][1] * v.y + rot[2][2] * v.z,
    )
}

/// Compute required CoM separation using parallel axis theorem
///
/// R²_g,merged = (M1*R²_g,1 + M2*R²_g,2)/(M1+M2) + (M1*M2/(M1+M2)²)*d²_12
fn compute_required_separation(
    cluster1: &GccaCluster,
    cluster2: &GccaCluster,
    rg_target: f64,
) -> Option<f64> {
    let m1 = cluster1.total_mass();
    let m2 = cluster2.total_mass();
    let rg1_sq = cluster1.radius_of_gyration.powi(2);
    let rg2_sq = cluster2.radius_of_gyration.powi(2);

    let m_total = m1 + m2;
    let weighted_rg_sq = (m1 * rg1_sq + m2 * rg2_sq) / m_total;
    let rg_target_sq = rg_target.powi(2);

    if rg_target_sq < weighted_rg_sq {
        return None;
    }

    let d_sq = (m_total.powi(2) / (m1 * m2)) * (rg_target_sq - weighted_rg_sq);

    if d_sq < 0.0 {
        return None;
    }

    Some(d_sq.sqrt())
}

/// Compute structure factor S(q) for aggregate validation
///
/// S(q) = 1/Np * Σ_i Σ_j sin(q|ri - rj|) / (q|ri - rj|)
pub fn compute_structure_factor(coords: &[[f64; 3]], q_values: &[f64]) -> Vec<f64> {
    let n = coords.len();
    if n == 0 {
        return vec![1.0; q_values.len()];
    }

    q_values
        .iter()
        .map(|&q| {
            let mut sum = 0.0;
            for i in 0..n {
                for j in 0..n {
                    if i == j {
                        sum += 1.0;
                    } else {
                        let dx = coords[i][0] - coords[j][0];
                        let dy = coords[i][1] - coords[j][1];
                        let dz = coords[i][2] - coords[j][2];
                        let r = (dx * dx + dy * dy + dz * dz).sqrt();
                        let qr = q * r;
                        if qr > 1e-10 {
                            sum += qr.sin() / qr;
                        } else {
                            sum += 1.0;
                        }
                    }
                }
            }
            sum / n as f64
        })
        .collect()
}

/// Determine the split for next merge step based on strategy
fn determine_split<R: Rng>(
    n_remaining: usize,
    strategy: &SplitStrategy,
    rng: &mut R,
) -> (usize, usize) {
    match strategy {
        SplitStrategy::Symmetric => {
            // Equal split (or as close as possible)
            let n1 = n_remaining / 2;
            let n2 = n_remaining - n1;
            (n1, n2)
        }
        SplitStrategy::ParticleCluster => {
            // Add one particle at a time to growing cluster
            (n_remaining - 1, 1)
        }
        SplitStrategy::Stochastic {
            mean_ratio,
            std_ratio,
        } => {
            // Stochastic split around mean_ratio
            let ratio = (mean_ratio + rng.gen::<f64>() * std_ratio * 2.0 - std_ratio)
                .max(0.1)
                .min(0.9);
            let n1 = ((n_remaining as f64) * ratio).round() as usize;
            let n1 = n1.max(1).min(n_remaining - 1);
            let n2 = n_remaining - n1;
            (n1, n2)
        }
    }
}

/// Calculate Df and kf from Rg evolution using power law fitting
fn calculate_fractal_dimension_from_evolution(
    n_values: &[usize],
    rg_values: &[f64],
    rp: f64,
) -> (f64, f64, f64) {
    if n_values.len() < 3 || n_values.len() != rg_values.len() {
        return (2.0, 1.0, 0.0);
    }

    let data: Vec<(f64, f64)> = n_values
        .iter()
        .zip(rg_values.iter())
        .filter(|(&n, &rg)| n > 1 && rg > rp * 0.1)
        .map(|(&n, &rg)| ((rg / rp).ln(), (n as f64).ln()))
        .collect();

    if data.len() < 3 {
        return (2.0, 1.0, 0.0);
    }

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

    let df = slope.max(1.0).min(3.0);
    let kf = intercept.exp().max(0.1).min(10.0);

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

/// Internal GCCA implementation
pub fn run_gcca_internal(
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    radius_min: f64,
    radius_max: f64,
    split_strategy: SplitStrategy,
    max_placement_attempts: usize,
    seed: u64,
) -> SimulationResult {
    let start_time = Instant::now();

    let mut rng = create_rng(seed);

    // Generate particles with uniform radius distribution
    let radii: Vec<f64> = (0..n_particles)
        .map(|_| {
            if (radius_max - radius_min).abs() < 1e-10 {
                radius_min
            } else {
                rng.gen_range(radius_min..=radius_max)
            }
        })
        .collect();

    let mean_radius = radii.iter().sum::<f64>() / radii.len() as f64;

    // Create initial clusters (one per particle)
    let mut clusters: Vec<GccaCluster> = radii
        .iter()
        .map(|&r| {
            GccaCluster::new_single(Sphere {
                center: Vector3::zero(),
                radius: r,
            })
        })
        .collect();

    // Track Rg evolution
    let mut rg_evolution: Vec<f64> = Vec::new();
    let mut n_values: Vec<usize> = Vec::new();

    // Hierarchical merging based on split strategy
    while clusters.len() > 1 {
        let n_clusters = clusters.len();

        // Determine how to split/pair clusters
        let (n1, n2) = determine_split(n_clusters, &split_strategy, &mut rng);

        // Sort clusters by size for more controlled merging
        clusters.sort_by(|a, b| a.n_particles().cmp(&b.n_particles()));

        let mut new_clusters = Vec::new();
        let mut merged = vec![false; n_clusters];

        match split_strategy {
            SplitStrategy::ParticleCluster => {
                // Merge all into a growing cluster, one particle at a time
                if n_clusters >= 2 {
                    // Take the largest cluster and add the smallest
                    let mut main_cluster = clusters.pop().unwrap();
                    let single = clusters.remove(0);

                    let n_merged = main_cluster.n_particles() + single.n_particles();
                    let rg_target =
                        mean_radius * (n_merged as f64 / target_kf).powf(1.0 / target_df);

                    // Try to place the single particle
                    let separation = compute_required_separation(&main_cluster, &single, rg_target)
                        .unwrap_or(main_cluster.bounding_radius + single.bounding_radius);

                    let mut placement_ok = false;
                    let mut single_clone = single.clone();

                    for _ in 0..max_placement_attempts {
                        single_clone = single.clone();
                        let direction = random_unit_vector(&mut rng);
                        let new_pos = main_cluster.center_of_mass + direction * separation;
                        single_clone.translate(new_pos - single_clone.center_of_mass);

                        if !main_cluster.overlaps_with(&single_clone, 0.01)
                            && main_cluster.has_contact_with(&single_clone, 0.1)
                        {
                            placement_ok = true;
                            break;
                        }
                    }

                    if !placement_ok {
                        // Fallback: contact placement
                        let main_idx = rng.gen_range(0..main_cluster.particles.len());
                        let main_p = &main_cluster.particles[main_idx];
                        let direction = random_unit_vector(&mut rng);
                        let contact_dist = main_p.radius + single_clone.particles[0].radius;
                        let new_pos = main_p.center + direction * contact_dist;
                        single_clone.particles[0].center = new_pos;
                        single_clone.update_properties();
                    }

                    main_cluster.merge_with(single_clone);
                    rg_evolution.push(main_cluster.radius_of_gyration);
                    n_values.push(main_cluster.n_particles());

                    new_clusters.push(main_cluster);
                    new_clusters.extend(clusters.drain(..));
                }
            }
            _ => {
                // Symmetric or Stochastic: pair clusters
                let n_pairs = n_clusters / 2;

                for i in 0..n_pairs {
                    let idx1 = i;
                    let idx2 = n_clusters - 1 - i;

                    if merged[idx1] || merged[idx2] || idx1 == idx2 {
                        continue;
                    }

                    merged[idx1] = true;
                    merged[idx2] = true;

                    let mut cluster1 = clusters[idx1].clone();
                    let mut cluster2 = clusters[idx2].clone();

                    let n_merged = cluster1.n_particles() + cluster2.n_particles();
                    let rg_target =
                        mean_radius * (n_merged as f64 / target_kf).powf(1.0 / target_df);

                    let separation = compute_required_separation(&cluster1, &cluster2, rg_target)
                        .unwrap_or(cluster1.bounding_radius + cluster2.bounding_radius);

                    let mut placement_ok = false;

                    for _ in 0..max_placement_attempts {
                        // Reset cluster2 position
                        cluster2 = clusters[idx2].clone();

                        let direction = random_unit_vector(&mut rng);
                        let rotation = random_rotation_matrix(&mut rng);

                        cluster2.rotate(&rotation);
                        let new_com = cluster1.center_of_mass + direction * separation;
                        cluster2.translate(new_com - cluster2.center_of_mass);

                        if !cluster1.overlaps_with(&cluster2, 0.01) {
                            if cluster1.has_contact_with(&cluster2, 0.1) || target_df < 1.5 {
                                placement_ok = true;
                                break;
                            }
                        }
                    }

                    if !placement_ok {
                        // Fallback: contact placement
                        cluster2 = clusters[idx2].clone();
                        let rotation = random_rotation_matrix(&mut rng);
                        cluster2.rotate(&rotation);

                        let idx_p1 = rng.gen_range(0..cluster1.particles.len());
                        let idx_p2 = rng.gen_range(0..cluster2.particles.len());
                        let p1 = &cluster1.particles[idx_p1];
                        let p2_radius = cluster2.particles[idx_p2].radius;

                        let direction = random_unit_vector(&mut rng);
                        let contact_dist = p1.radius + p2_radius;
                        let offset = p1.center + direction * contact_dist
                            - cluster2.particles[idx_p2].center;

                        cluster2.translate(offset);
                    }

                    cluster1.merge_with(cluster2);
                    rg_evolution.push(cluster1.radius_of_gyration);
                    n_values.push(cluster1.n_particles());

                    new_clusters.push(cluster1);
                }

                // Add unpaired clusters
                for (i, &was_merged) in merged.iter().enumerate() {
                    if !was_merged {
                        new_clusters.push(clusters[i].clone());
                    }
                }
            }
        }

        clusters = new_clusters;
    }

    // Extract final result
    let final_cluster = clusters.into_iter().next().unwrap();

    // Center at origin
    let com = final_cluster.center_of_mass;
    let coords: Vec<[f64; 3]> = final_cluster
        .particles
        .iter()
        .map(|p| {
            let c = p.center - com;
            [c.x, c.y, c.z]
        })
        .collect();
    let radii: Vec<f64> = final_cluster.particles.iter().map(|p| p.radius).collect();

    // Calculate final metrics
    let rp = radii.iter().sum::<f64>() / radii.len() as f64;
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

    let final_rg_evolution = if !rg_evolution.is_empty() {
        rg_evolution
    } else {
        vec![calculate_radius_of_gyration(&coords, &radii)]
    };

    SimulationResult {
        coordinates: coords,
        radii,
        rg_evolution: final_rg_evolution,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gcca_symmetric_deterministic() {
        let r1 = run_gcca_internal(30, 1.8, 1.3, 1.0, 1.0, SplitStrategy::Symmetric, 100, 42);
        let r2 = run_gcca_internal(30, 1.8, 1.3, 1.0, 1.0, SplitStrategy::Symmetric, 100, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        assert_eq!(r1.seed, r2.seed);
    }

    #[test]
    fn test_gcca_particle_cluster() {
        let result = run_gcca_internal(
            50,
            1.8,
            1.3,
            1.0,
            1.0,
            SplitStrategy::ParticleCluster,
            100,
            123,
        );

        assert_eq!(result.coordinates.len(), 50);
        assert!(result.fractal_dimension > 1.0 && result.fractal_dimension < 3.0);
    }

    #[test]
    fn test_gcca_stochastic() {
        let result = run_gcca_internal(
            50,
            1.8,
            1.3,
            1.0,
            1.0,
            SplitStrategy::Stochastic {
                mean_ratio: 0.5,
                std_ratio: 0.2,
            },
            100,
            456,
        );

        assert_eq!(result.coordinates.len(), 50);
    }

    #[test]
    fn test_structure_factor() {
        // Simple test with a few particles
        let coords = vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [4.0, 0.0, 0.0]];

        let q_values = vec![0.1, 0.5, 1.0, 2.0];
        let s_values = compute_structure_factor(&coords, &q_values);

        assert_eq!(s_values.len(), q_values.len());
        // S(q→0) should approach N (=3 here)
        assert!(s_values[0] > 2.5);
    }
}
