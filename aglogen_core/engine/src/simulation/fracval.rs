//! FracVAL Algorithm (Morán et al. 2019)
//!
//! Fractal aggregate generator with Variable primary particle sizes,
//! Algorithm based on cluster-cluster aggregation for Lognormally distributed particles.
//!
//! This is the state-of-the-art algorithm for generating fractal aggregates of
//! polydisperse primary particles, extending the Filippov algorithm with an
//! adaptive aggregation strategy that preserves Df and kf for each individual
//! aggregate.
//!
//! Reference: Morán, J., Fuentes, A., Liu, F., Yon, J. (2019). "FracVAL: An improved
//! tunable algorithm of cluster-cluster aggregation for generation of fractal structures
//! formed by polydisperse primary particles." Comput. Phys. Commun., 239, 225-237.

use std::f64::consts::PI;

// ============================================================================
// Algorithm Constants (documented magic numbers)
// ============================================================================

/// Tolerance for overlap detection: particles overlap if distance < sum_radii * (1 - OVERLAP_TOLERANCE)
/// A value of 0.01 means 1% penetration is allowed to handle numerical precision issues.
const OVERLAP_TOLERANCE: f64 = 0.01;

/// Tolerance for contact detection: particles are in contact if distance <= sum_radii * (1 + CONTACT_TOLERANCE)
/// A value of 0.10 means particles within 10% of touching distance count as contacting.
const CONTACT_TOLERANCE: f64 = 0.10;

/// Fractal dimension threshold below which structures are considered "very open"
/// and placement is accepted even without explicit contact (DLA-like structures).
const OPEN_STRUCTURE_DF_THRESHOLD: f64 = 1.5;

/// Initial box size multiplier for random particle placement before aggregation.
/// Larger values spread particles more initially, reducing early collisions.
const INITIAL_BOX_SIZE_MULTIPLIER: f64 = 10.0;

/// Minimum separation multiplier when target Rg calculation fails.
/// Uses 2x contact distance as fallback to ensure physical separation.
const FALLBACK_SEPARATION_MULTIPLIER: f64 = 2.0;

/// Minimum number of data points required for reliable Df/kf regression.
const MIN_REGRESSION_POINTS: usize = 3;

/// Default fractal dimension when regression fails.
const DEFAULT_DF: f64 = 2.0;

/// Default prefactor when regression fails.
const DEFAULT_KF: f64 = 1.0;

/// Minimum Rg threshold (relative to rp) for including in regression.
/// Filters out early aggregation stages with unreliable Rg values.
const MIN_RG_FOR_REGRESSION: f64 = 0.1;

/// Estimated standard deviation for fractal dimension (conservative estimate).
const DF_STD_ESTIMATE: f64 = 0.05;

/// Tolerance for geometric mean test validation (30% relative error).
const GEO_MEAN_TEST_TOLERANCE: f64 = 0.3;
use std::time::Instant;

use rand::prelude::*;
use rand_distr::{Distribution, LogNormal};

use crate::common::geometry::Vector3;
use crate::common::rng::create_rng;

use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::SimulationResult;

/// A cluster of particles during the aggregation process
#[derive(Clone)]
struct Cluster {
    /// Indices of particles in this cluster
    particle_indices: Vec<usize>,
    /// Center of mass (mass-weighted)
    center_of_mass: Vector3,
    /// Radius of gyration (mass-weighted)
    radius_of_gyration: f64,
    /// Total mass of the cluster
    total_mass: f64,
}

impl Cluster {
    /// Create a new cluster from a single particle
    fn new_single(index: usize, position: Vector3, radius: f64) -> Self {
        // Mass proportional to volume (r³)
        let mass = radius.powi(3);
        Self {
            particle_indices: vec![index],
            center_of_mass: position,
            radius_of_gyration: 0.0, // Single particle has Rg = 0
            total_mass: mass,
        }
    }

    /// Get the number of particles in this cluster
    fn n_particles(&self) -> usize {
        self.particle_indices.len()
    }
}

/// Generate particle radii from a lognormal distribution
///
/// f(a) = 1 / (a * ln(σ_geo) * sqrt(2π)) * exp(-(ln(a) - ln(a_g))² / (2 * ln²(σ_geo)))
fn generate_lognormal_radii<R: Rng>(
    n_particles: usize,
    geometric_mean: f64,
    geometric_std: f64,
    rng: &mut R,
) -> Vec<f64> {
    // For lognormal: μ = ln(geometric_mean), σ = ln(geometric_std)
    // The rand_distr LogNormal uses mu and sigma of the underlying normal distribution
    let mu = geometric_mean.ln();
    let sigma = geometric_std.ln();

    let lognormal = LogNormal::new(mu, sigma).expect("Invalid lognormal parameters");

    (0..n_particles).map(|_| lognormal.sample(rng)).collect()
}

/// Compute the volume-mean radius: ā = (1/N * Σ ai³)^(1/3)
fn compute_volume_mean_radius(radii: &[f64]) -> f64 {
    let n = radii.len() as f64;
    let sum_cubed: f64 = radii.iter().map(|r| r.powi(3)).sum();
    (sum_cubed / n).cbrt()
}

/// Compute mass-weighted center of mass for a set of particles
fn compute_center_of_mass(
    positions: &[Vector3],
    radii: &[f64],
    indices: &[usize],
) -> (Vector3, f64) {
    let mut total_mass = 0.0;
    let mut com = Vector3::zero();

    for &idx in indices {
        let mass = radii[idx].powi(3); // Mass ∝ r³
        com = com + positions[idx] * mass;
        total_mass += mass;
    }

    if total_mass > 0.0 {
        com = com * (1.0 / total_mass);
    }

    (com, total_mass)
}

/// Compute mass-weighted radius of gyration for a set of particles
fn compute_rg_for_indices(
    positions: &[Vector3],
    radii: &[f64],
    indices: &[usize],
    center_of_mass: &Vector3,
    total_mass: f64,
) -> f64 {
    if indices.len() <= 1 || total_mass <= 0.0 {
        return 0.0;
    }

    let mut rg_squared = 0.0;
    for &idx in indices {
        let mass = radii[idx].powi(3);
        let r = positions[idx] - *center_of_mass;
        rg_squared += mass * r.length_squared();
    }

    (rg_squared / total_mass).sqrt()
}

/// Compute the required center-of-mass separation using mass-weighted parallel axis theorem
///
/// R²_g,merged = (M1*R²_g,1 + M2*R²_g,2)/(M1+M2) + (M1*M2/(M1+M2)²)*d²_12
///
/// Solving for d_12:
/// d²_12 = ((M1+M2)²/(M1*M2)) * (R²_g,target - (M1*R²_g,1 + M2*R²_g,2)/(M1+M2))
fn compute_required_separation(
    cluster1: &Cluster,
    cluster2: &Cluster,
    rg_target: f64,
) -> Option<f64> {
    let m1 = cluster1.total_mass;
    let m2 = cluster2.total_mass;
    let rg1_sq = cluster1.radius_of_gyration.powi(2);
    let rg2_sq = cluster2.radius_of_gyration.powi(2);

    let m_total = m1 + m2;
    let weighted_rg_sq = (m1 * rg1_sq + m2 * rg2_sq) / m_total;
    let rg_target_sq = rg_target.powi(2);

    // Check if target Rg is achievable
    if rg_target_sq < weighted_rg_sq {
        return None; // Target Rg is too small
    }

    let d_sq = (m_total.powi(2) / (m1 * m2)) * (rg_target_sq - weighted_rg_sq);

    if d_sq < 0.0 {
        return None;
    }

    Some(d_sq.sqrt())
}

/// Generate a random unit vector uniformly distributed on the sphere
fn random_unit_vector<R: Rng>(rng: &mut R) -> Vector3 {
    let theta = rng.gen::<f64>() * 2.0 * PI;
    let phi = (1.0 - 2.0 * rng.gen::<f64>()).acos();

    Vector3::new(phi.sin() * theta.cos(), phi.sin() * theta.sin(), phi.cos())
}

/// Generate a random rotation matrix uniformly from SO(3)
fn random_rotation_matrix<R: Rng>(rng: &mut R) -> [[f64; 3]; 3] {
    // Using Euler angles with proper distribution
    let alpha = rng.gen::<f64>() * 2.0 * PI;
    let beta = rng.gen::<f64>().acos(); // For uniform distribution on sphere
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

/// Check if any particles from two clusters overlap
fn check_overlaps(
    positions: &[Vector3],
    radii: &[f64],
    indices1: &[usize],
    indices2: &[usize],
) -> bool {
    for &i in indices1 {
        for &j in indices2 {
            let dist = (positions[i] - positions[j]).length();
            let min_dist = radii[i] + radii[j];
            if dist < min_dist * 0.99 {
                // Small tolerance
                return true;
            }
        }
    }
    false
}

/// Check if at least one contact exists between clusters
fn has_contact(
    positions: &[Vector3],
    radii: &[f64],
    indices1: &[usize],
    indices2: &[usize],
    tolerance: f64,
) -> bool {
    for &i in indices1 {
        for &j in indices2 {
            let dist = (positions[i] - positions[j]).length();
            let contact_dist = radii[i] + radii[j];
            if dist <= contact_dist * (1.0 + tolerance) {
                return true;
            }
        }
    }
    false
}

/// Calculate Df and kf from Rg evolution using power law fitting.
fn calculate_fractal_dimension_from_evolution(
    n_values: &[usize],
    rg_values: &[f64],
    rp: f64,
) -> (f64, f64, f64) {
    if n_values.len() < MIN_REGRESSION_POINTS || n_values.len() != rg_values.len() {
        return (DEFAULT_DF, DEFAULT_KF, 0.0);
    }

    // Use N = kf * (Rg/rp)^Df
    // log(N) = log(kf) + Df * log(Rg/rp)
    let data: Vec<(f64, f64)> = n_values
        .iter()
        .zip(rg_values.iter())
        .filter(|(&n, &rg)| n > 1 && rg > rp * MIN_RG_FOR_REGRESSION)
        .map(|(&n, &rg)| ((rg / rp).ln(), (n as f64).ln()))
        .collect();

    if data.len() < MIN_REGRESSION_POINTS {
        return (DEFAULT_DF, DEFAULT_KF, 0.0);
    }

    // Linear regression
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

/// Internal FracVAL implementation
pub fn run_fracval_internal(
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    geometric_mean: f64,
    geometric_std: f64,
    max_placement_attempts: usize,
    seed: u64,
) -> SimulationResult {
    let start_time = Instant::now();

    // Initialize RNG
    let mut rng = create_rng(seed);

    // Step 1: Generate primary particle radii from lognormal distribution
    let radii = if geometric_std <= 1.001 {
        // Monodisperse case
        vec![geometric_mean; n_particles]
    } else {
        generate_lognormal_radii(n_particles, geometric_mean, geometric_std, &mut rng)
    };

    // Step 2: Initialize particle positions and clusters
    let mut positions: Vec<Vector3> = vec![Vector3::zero(); n_particles];

    // Initialize each particle as its own cluster at origin (will be repositioned during merging)
    // For now, place them randomly in a large volume to start
    let volume_mean_radius = compute_volume_mean_radius(&radii);
    let initial_box_size = volume_mean_radius
        * (n_particles as f64).powf(1.0 / target_df)
        * INITIAL_BOX_SIZE_MULTIPLIER;

    for i in 0..n_particles {
        positions[i] = Vector3::new(
            (rng.gen::<f64>() - 0.5) * initial_box_size,
            (rng.gen::<f64>() - 0.5) * initial_box_size,
            (rng.gen::<f64>() - 0.5) * initial_box_size,
        );
    }

    // Create initial clusters (one per particle)
    let mut clusters: Vec<Cluster> = (0..n_particles)
        .map(|i| Cluster::new_single(i, positions[i], radii[i]))
        .collect();

    // Track Rg evolution
    let mut rg_evolution: Vec<f64> = Vec::new();
    let mut n_values: Vec<usize> = Vec::new();

    // Step 3: Hierarchical merging with adaptive pairing
    while clusters.len() > 1 {
        // Sort clusters by total mass (or number of particles)
        clusters.sort_by(|a, b| a.total_mass.partial_cmp(&b.total_mass).unwrap());

        // Adaptive pairing: pair largest with smallest
        let n_clusters = clusters.len();
        let n_pairs = n_clusters / 2;

        let mut new_clusters = Vec::new();
        let mut paired = vec![false; n_clusters];

        for i in 0..n_pairs {
            let small_idx = i;
            let large_idx = n_clusters - 1 - i;

            if paired[small_idx] || paired[large_idx] {
                continue;
            }

            let cluster1 = clusters[small_idx].clone();
            let cluster2 = clusters[large_idx].clone();

            paired[small_idx] = true;
            paired[large_idx] = true;

            // Compute target Rg for merged cluster using fractal law
            let n_merged = cluster1.n_particles() + cluster2.n_particles();
            let rg_target =
                volume_mean_radius * (n_merged as f64 / target_kf).powf(1.0 / target_df);

            // Compute required separation
            let separation = match compute_required_separation(&cluster1, &cluster2, rg_target) {
                Some(d) => d,
                None => {
                    // If target Rg is too small, use minimum separation (fallback)
                    let min_sep =
                        radii[cluster1.particle_indices[0]] + radii[cluster2.particle_indices[0]];
                    min_sep * FALLBACK_SEPARATION_MULTIPLIER
                }
            };

            // Try to place cluster2 relative to cluster1
            let mut placement_successful = false;
            let mut final_positions2: Option<Vec<Vector3>> = None;

            // Store original positions for cluster2 particles (for reference during placement)
            let original_positions2: Vec<Vector3> = cluster2
                .particle_indices
                .iter()
                .map(|&idx| positions[idx])
                .collect();
            let cluster2_original_com = cluster2.center_of_mass;

            for _ in 0..max_placement_attempts {
                // Random direction (uniform on sphere)
                let direction = random_unit_vector(&mut rng);

                // Random rotation for cluster2 (uniform on SO(3))
                let rotation = random_rotation_matrix(&mut rng);

                // Compute new positions for cluster2 particles relative to original positions
                let new_com2 = cluster1.center_of_mass + direction * separation;

                // Apply rotation and translation to cluster2 particles using ORIGINAL positions
                let candidate_positions2: Vec<Vector3> = original_positions2
                    .iter()
                    .map(|&pos| {
                        let relative_pos = pos - cluster2_original_com;
                        let rotated = rotate_vector(&relative_pos, &rotation);
                        new_com2 + rotated
                    })
                    .collect();

                // Create temporary position lookup for overlap checking
                // Use candidate positions for cluster2, original positions for cluster1
                let check_overlaps_with_candidates = || {
                    for &i in &cluster1.particle_indices {
                        for (j_local, &j) in cluster2.particle_indices.iter().enumerate() {
                            let pos_j = candidate_positions2[j_local];
                            let dist = (positions[i] - pos_j).length();
                            let min_dist = radii[i] + radii[j];
                            if dist < min_dist * (1.0 - OVERLAP_TOLERANCE) {
                                return true;
                            }
                        }
                    }
                    false
                };

                let check_contact_with_candidates = || {
                    for &i in &cluster1.particle_indices {
                        for (j_local, &j) in cluster2.particle_indices.iter().enumerate() {
                            let pos_j = candidate_positions2[j_local];
                            let dist = (positions[i] - pos_j).length();
                            let contact_dist = radii[i] + radii[j];
                            if dist <= contact_dist * (1.0 + CONTACT_TOLERANCE) {
                                return true;
                            }
                        }
                    }
                    false
                };

                // Check for overlaps using candidate positions (NOT modifying actual positions)
                if !check_overlaps_with_candidates() {
                    // Check for contact (at least one pair should be touching or close)
                    if check_contact_with_candidates() {
                        final_positions2 = Some(candidate_positions2);
                        placement_successful = true;
                        break;
                    }
                    // Accept without contact for very open structures (low Df)
                    if target_df < OPEN_STRUCTURE_DF_THRESHOLD {
                        final_positions2 = Some(candidate_positions2);
                        placement_successful = true;
                        break;
                    }
                }
            }

            // Only now update actual positions if placement was successful
            if let Some(new_pos) = final_positions2 {
                for (i, &idx) in cluster2.particle_indices.iter().enumerate() {
                    positions[idx] = new_pos[i];
                }
            }

            if !placement_successful {
                // Fallback: place cluster2 at contact distance from a random particle in cluster1
                // Use original (uncorrupted) positions for the fallback calculation
                let contact_idx1 =
                    cluster1.particle_indices[rng.gen_range(0..cluster1.particle_indices.len())];
                let local_contact_idx2 = rng.gen_range(0..cluster2.particle_indices.len());
                let contact_idx2 = cluster2.particle_indices[local_contact_idx2];

                let direction = random_unit_vector(&mut rng);
                let contact_dist = radii[contact_idx1] + radii[contact_idx2];

                // Use original position of contact particle in cluster2 for offset calculation
                let original_pos2 = original_positions2[local_contact_idx2];
                let offset = positions[contact_idx1] + direction * contact_dist - original_pos2;

                // Apply offset to original positions (not potentially corrupted positions)
                for (i, &idx) in cluster2.particle_indices.iter().enumerate() {
                    positions[idx] = original_positions2[i] + offset;
                }
            }

            // Create merged cluster
            let mut merged_indices = cluster1.particle_indices.clone();
            merged_indices.extend(&cluster2.particle_indices);

            let (merged_com, merged_mass) =
                compute_center_of_mass(&positions, &radii, &merged_indices);
            let merged_rg = compute_rg_for_indices(
                &positions,
                &radii,
                &merged_indices,
                &merged_com,
                merged_mass,
            );

            new_clusters.push(Cluster {
                particle_indices: merged_indices,
                center_of_mass: merged_com,
                radius_of_gyration: merged_rg,
                total_mass: merged_mass,
            });

            // Track evolution for the largest cluster
            rg_evolution.push(merged_rg);
            n_values.push(n_merged);
        }

        // Add unpaired clusters (if odd number)
        for (i, &is_paired) in paired.iter().enumerate() {
            if !is_paired {
                new_clusters.push(clusters[i].clone());
            }
        }

        clusters = new_clusters;
    }

    // Center the final aggregate at origin
    let final_com = clusters[0].center_of_mass;
    for pos in &mut positions {
        *pos = *pos - final_com;
    }

    // Convert to coordinate arrays
    let coords: Vec<[f64; 3]> = positions.iter().map(|p| [p.x, p.y, p.z]).collect();

    // Calculate final metrics
    let rp = compute_volume_mean_radius(&radii);
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

    // Final Rg from last evolution value or calculate directly
    let final_rg_evolution = if !rg_evolution.is_empty() {
        rg_evolution.clone()
    } else {
        vec![calculate_radius_of_gyration(&coords, &radii)]
    };

    SimulationResult {
        coordinates: coords,
        radii,
        rg_evolution: final_rg_evolution,
        fractal_dimension: actual_df,
        fractal_dimension_std: DF_STD_ESTIMATE,
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
        tunable_merges: 0,
        ballistic_merges: 0,
        max_retries_per_merge: 0,
        dpo_used: None,
        target_kf_used: None,
        merge_trace: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lognormal_radii() {
        let mut rng = create_rng(42);
        let radii = generate_lognormal_radii(100, 1.0, 1.5, &mut rng);

        assert_eq!(radii.len(), 100);
        assert!(radii.iter().all(|&r| r > 0.0));

        // Check that geometric mean is approximately correct
        let log_mean: f64 = radii.iter().map(|r| r.ln()).sum::<f64>() / 100.0;
        let geo_mean = log_mean.exp();
        assert!((geo_mean - 1.0).abs() < GEO_MEAN_TEST_TOLERANCE);
    }

    #[test]
    fn test_volume_mean_radius() {
        let radii = vec![1.0, 1.0, 1.0, 1.0];
        let mean = compute_volume_mean_radius(&radii);
        assert!((mean - 1.0).abs() < 1e-10);

        let radii2 = vec![1.0, 2.0];
        let mean2 = compute_volume_mean_radius(&radii2);
        // (1³ + 2³) / 2 = 4.5, ³√4.5 ≈ 1.651
        assert!((mean2 - 1.651).abs() < 0.01);
    }

    #[test]
    fn test_required_separation() {
        let c1 = Cluster {
            particle_indices: vec![0],
            center_of_mass: Vector3::zero(),
            radius_of_gyration: 0.0,
            total_mass: 1.0,
        };
        let c2 = Cluster {
            particle_indices: vec![1],
            center_of_mass: Vector3::zero(),
            radius_of_gyration: 0.0,
            total_mass: 1.0,
        };

        // For two equal mass particles with Rg=0, merging at distance d
        // R²_g,merged = (M1*M2/(M1+M2)²) * d²_12 = 0.25 * d²
        // So for Rg_target = 1.0, d = 2.0
        let d = compute_required_separation(&c1, &c2, 1.0).unwrap();
        assert!((d - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_fracval_deterministic() {
        let r1 = run_fracval_internal(30, 1.8, 1.3, 1.0, 1.0, 100, 42);
        let r2 = run_fracval_internal(30, 1.8, 1.3, 1.0, 1.0, 100, 42);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        assert_eq!(r1.seed, r2.seed);
    }

    #[test]
    fn test_fracval_produces_agglomerate() {
        let result = run_fracval_internal(50, 1.8, 1.3, 1.0, 1.0, 100, 123);

        // Should produce all particles
        assert_eq!(result.coordinates.len(), 50);

        // Df should be reasonable
        assert!(
            result.fractal_dimension > 1.0 && result.fractal_dimension < 3.0,
            "Df should be between 1 and 3, got {}",
            result.fractal_dimension
        );
    }

    #[test]
    fn test_fracval_polydisperse() {
        let result = run_fracval_internal(50, 1.8, 1.3, 1.0, 1.5, 100, 456);

        // Radii should vary
        let min_r = result.radii.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_r = result
            .radii
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(
            max_r > min_r * 1.1,
            "Polydisperse should have varying radii"
        );
    }
}
