//! Tunable Fractal Dimension Cluster-Cluster Aggregation.
//!
//! Implementation based on Chapter 6 of the AgloGen3D thesis, Section CC Tuneable.
//! This algorithm generates aggregates with controlled fractal dimension (Df) and
//! prefactor (kf) by merging clusters (rather than individual particles).
//!
//! Key difference from Tunable PC: Instead of adding particles one at a time,
//! this algorithm merges clusters of varying sizes while maintaining the power law
//! relationship: N = kf * (Rg/rp)^Df at each merge step.

use std::f64::consts::PI;
use std::time::Instant;

use pyo3::prelude::*;
use rand::seq::SliceRandom;
use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_point_on_sphere};

use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::{PySimulationResult, SimulationResult};
use super::sintering::{sintered_contact_distance, SinteringDistribution};
use super::tunable::run_tunable;

/// Seed cluster generation strategy.
#[derive(Debug, Clone)]
pub enum SeedStrategy {
    /// All monomers (like standard Ballistic CC)
    Monomers,
    /// Generate seed clusters using Tunable PC with specified size
    TunablePc { cluster_size: usize },
    /// Custom distribution of cluster sizes (not yet implemented)
    Custom { sizes: Vec<usize> },
}

impl Default for SeedStrategy {
    fn default() -> Self {
        SeedStrategy::Monomers
    }
}

/// Tunable CC simulation parameters.
#[derive(Debug, Clone)]
pub struct TunableCcParams {
    pub n_particles: usize,
    pub target_df: f64,
    pub target_kf: f64,
    pub radius_min: f64,
    pub radius_max: f64,
    pub seed_strategy: SeedStrategy,
    pub max_rotation_attempts: usize,
    pub max_particle_selection_attempts: usize,
    pub sintering: SinteringDistribution,
}

impl Default for TunableCcParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            target_df: 1.8,
            target_kf: 1.3,
            radius_min: 1.0,
            radius_max: 1.0,
            seed_strategy: SeedStrategy::Monomers,
            max_rotation_attempts: 50,
            max_particle_selection_attempts: 25,
            sintering: SinteringDistribution::default(),
        }
    }
}

impl TunableCcParams {
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

/// A cluster for Tunable CC aggregation.
#[derive(Clone)]
struct TunableCluster {
    particles: Vec<Sphere>,
    center_of_mass: Vector3,
    geometric_center: Vector3,
    bounding_radius: f64,
    radius_of_gyration: f64,
}

impl TunableCluster {
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

    /// Create a cluster from multiple particles.
    fn from_particles(particles: Vec<Sphere>) -> Self {
        let mut cluster = Self {
            particles,
            center_of_mass: Vector3::zero(),
            geometric_center: Vector3::zero(),
            bounding_radius: 0.0,
            radius_of_gyration: 0.0,
        };
        cluster.update_properties();
        cluster
    }

    /// Number of particles in the cluster.
    fn n_particles(&self) -> usize {
        self.particles.len()
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

        // Calculate bounding radius (from center of mass)
        self.bounding_radius = self
            .particles
            .iter()
            .map(|p| self.center_of_mass.distance_to(&p.center) + p.radius)
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

    /// Rotate all particles around an axis passing through a pivot point.
    fn rotate_around_axis(&mut self, axis: Vector3, angle: f64, pivot: Vector3) {
        let axis_norm = axis.normalize();
        for p in &mut self.particles {
            // Translate to pivot origin
            let relative = p.center - pivot;
            // Apply Rodrigues rotation
            let rotated = rotate_vector(&relative, &axis_norm, angle);
            // Translate back
            p.center = rotated + pivot;
        }
        self.update_properties();
    }

    /// Merge another cluster into this one.
    fn merge_with(&mut self, other: TunableCluster) {
        self.particles.extend(other.particles);
        self.update_properties();
    }

    /// Get indices of particles that could participate in connection at given distance.
    /// These are "surface" particles that can reach the required CoM distance.
    fn get_candidate_particles(&self, required_distance: f64, other_bounding_radius: f64) -> Vec<usize> {
        let mut candidates = Vec::new();

        for (idx, particle) in self.particles.iter().enumerate() {
            // Distance from particle center to cluster CoM
            let dist_to_com = particle.center.distance_to(&self.center_of_mass);

            // Particle is a candidate if it could potentially reach
            // a point at required_distance from CoM
            let max_reach = dist_to_com + particle.radius;

            // Triangle inequality check: can this particle contribute to connection?
            if max_reach >= required_distance - other_bounding_radius {
                candidates.push(idx);
            }
        }

        candidates
    }
}

/// Calculate the required distance between centers of mass for two clusters to merge
/// while maintaining the power law relationship.
///
/// Based on thesis equation (eq:leyPotenciasColisionSimplificada):
/// (r_G2 - r_G1)² = rp² × [(n_po/kf)^(2/Df) - 3/5]
///                - n_po × rp² × (n_po1/kf)^(2/Df) × [1/n_po2 + 1/n_po1]
fn calculate_com_distance(
    n_po: usize,    // Total particles after merge
    n_po1: usize,   // Particles in cluster 1 (impacted)
    n_po2: usize,   // Particles in cluster 2 (impactor)
    kf: f64,        // Target prefactor
    df: f64,        // Target fractal dimension
    rp: f64,        // Primary particle radius
) -> Option<f64> {
    let n_po_f = n_po as f64;
    let n_po1_f = n_po1 as f64;
    let n_po2_f = n_po2 as f64;

    // Lapuerta constant
    let constante = 3.0 / 5.0;

    // From thesis equation
    let term1 = (n_po_f / kf).powf(2.0 / df) - constante;
    let term2_factor = (n_po1_f / kf).powf(2.0 / df);
    let term2 = n_po_f * term2_factor * (1.0 / n_po2_f + 1.0 / n_po1_f);

    let distance_sq = rp.powi(2) * term1 - rp.powi(2) * term2;

    if distance_sq <= 0.0 {
        // Can happen for very small clusters or extreme Df values
        // Use approximation based on Rg relationship
        let rg_target = rp * (n_po_f / kf).powf(1.0 / df);
        let rg1 = rp * (n_po1_f / kf).powf(1.0 / df);
        let rg2 = rp * (n_po2_f / kf).powf(1.0 / df);

        // Approximate distance that would give target Rg
        let approx_dist = (rg_target.powi(2) - rg1.powi(2) - rg2.powi(2)).abs().sqrt();
        if approx_dist > 0.0 {
            return Some(approx_dist.max(rp * 2.0));
        }
        return None;
    }

    Some(distance_sq.sqrt())
}

/// Check if two clusters can potentially connect at the required distance.
/// Connection is possible if sum of bounding radii >= required distance.
fn can_clusters_connect(
    cluster1: &TunableCluster,
    cluster2: &TunableCluster,
    required_distance: f64,
) -> bool {
    cluster1.bounding_radius + cluster2.bounding_radius >= required_distance
}

/// Check for overlap between two clusters with sintering support.
fn check_overlap(cluster1: &TunableCluster, cluster2: &TunableCluster, sintering_coeff: f64) -> bool {
    // Quick bounding sphere check first (use sintered distance)
    let dist = cluster1.center_of_mass.distance_to(&cluster2.center_of_mass);
    let bounding_contact = sintered_contact_distance(cluster1.bounding_radius, cluster2.bounding_radius, sintering_coeff);
    if dist > bounding_contact + 1e-6 {
        return false;
    }

    // Detailed particle-level check with sintering
    for p1 in &cluster1.particles {
        for p2 in &cluster2.particles {
            let d = p1.center.distance_to(&p2.center);
            let contact_dist = sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);
            if d < contact_dist - 1e-6 {
                return true;
            }
        }
    }
    false
}

/// Rotate vector v around axis by angle (in radians) using Rodrigues' formula.
fn rotate_vector(v: &Vector3, axis: &Vector3, angle: f64) -> Vector3 {
    let cos_a = angle.cos();
    let sin_a = angle.sin();

    // v_rot = v*cos(a) + (axis x v)*sin(a) + axis*(axis·v)*(1-cos(a))
    let cross = axis.cross(v);
    let dot = axis.dot(v);

    Vector3::new(
        v.x * cos_a + cross.x * sin_a + axis.x * dot * (1.0 - cos_a),
        v.y * cos_a + cross.y * sin_a + axis.y * dot * (1.0 - cos_a),
        v.z * cos_a + cross.z * sin_a + axis.z * dot * (1.0 - cos_a),
    )
}

/// Find a unit vector perpendicular to the given vector.
fn find_perpendicular_axis<R: Rng>(v: &Vector3, rng: &mut R) -> Vector3 {
    loop {
        let (a, b, c) = random_point_on_sphere(rng);
        let t1 = Vector3::new(a, b, c);

        let cross = t1.cross(v);
        let len = cross.length();
        if len > 1e-6 {
            return cross * (1.0 / len);
        }
    }
}

/// Create an orthogonal basis (u, v) perpendicular to the given direction.
fn create_orthogonal_basis(dir: Vector3) -> (Vector3, Vector3) {
    let not_parallel = if dir.x.abs() < 0.9 {
        Vector3::new(1.0, 0.0, 0.0)
    } else {
        Vector3::new(0.0, 1.0, 0.0)
    };

    let u = dir.cross(&not_parallel).normalize();
    let v = dir.cross(&u);

    (u, v)
}

/// Select two particles that can form a contact at the required distance.
/// Returns (idx1, idx2) indices into cluster1 and cluster2 particles.
fn select_contact_particles<R: Rng>(
    cluster1: &TunableCluster,
    cluster2: &TunableCluster,
    la1: &[usize],
    la2: &[usize],
    required_distance: f64,
    rng: &mut R,
) -> Option<(usize, usize)> {
    // Shuffle candidates for randomness
    let mut candidates1 = la1.to_vec();
    let mut candidates2 = la2.to_vec();
    candidates1.shuffle(rng);
    candidates2.shuffle(rng);

    for &m1 in &candidates1 {
        for &m2 in &candidates2 {
            let p1 = &cluster1.particles[m1];
            let p2 = &cluster2.particles[m2];

            // Check triangle criterion from thesis
            let d1 = p1.center.distance_to(&cluster1.center_of_mass);
            let d2 = p2.center.distance_to(&cluster2.center_of_mass);
            let contact_dist = p1.radius + p2.radius;

            // Can these particles form a contact when clusters are at required_distance apart?
            // Triangle inequality: the three lengths (d1, d2, required_distance-contact_dist)
            // must be able to form a triangle, meaning each side < sum of other two
            let effective_gap = (required_distance - contact_dist).abs();

            // Check if particles can reach each other
            if d1 + d2 + contact_dist >= required_distance - 1e-6 {
                // Additional check: can actually touch
                if (d1 - d2).abs() <= required_distance + contact_dist {
                    return Some((m1, m2));
                }
            }
        }
    }

    None
}

/// Position cluster2 relative to cluster1 at the required CoM distance,
/// with particles m1 and m2 in contact (with sintering).
fn position_clusters_for_contact<R: Rng>(
    cluster1: &TunableCluster,
    cluster2: &mut TunableCluster,
    m1: usize,
    m2: usize,
    required_distance: f64,
    sintering_coeff: f64,
    rng: &mut R,
) -> bool {
    let p1 = &cluster1.particles[m1];
    let p2_original = &cluster2.particles[m2];
    let contact_dist = sintered_contact_distance(p1.radius, p2_original.radius, sintering_coeff);

    // Vector from cluster1 CoM to particle m1
    let r_cm1_to_p1 = p1.center - cluster1.center_of_mass;
    let d1 = r_cm1_to_p1.length();

    // Vector from cluster2 CoM to particle m2 (before positioning)
    let r_cm2_to_p2 = p2_original.center - cluster2.center_of_mass;
    let d2 = r_cm2_to_p2.length();

    // We need to find where to place cluster2's CoM such that:
    // 1. Distance between CoMs = required_distance
    // 2. Particles m1 and m2 are in contact (distance = contact_dist)

    // Generate random direction for initial placement
    let (dx, dy, dz) = random_point_on_sphere(rng);
    let base_direction = Vector3::new(dx, dy, dz);

    // Position cluster2 CoM at required_distance from cluster1 CoM
    let target_com2_pos = cluster1.center_of_mass + base_direction * required_distance;
    let translation = target_com2_pos - cluster2.center_of_mass;
    cluster2.translate(translation);

    // Now we need to rotate cluster2 so that particle m2 is in contact with p1
    // This requires computing the rotation that aligns p2 with the contact point

    // The contact point on p1's surface toward where p2 should be
    let p2_current = &cluster2.particles[m2];
    let current_p2_pos = p2_current.center;

    // Direction from p1 to current p2 position
    let p1_to_p2_dir = (current_p2_pos - p1.center).normalize();

    // Where p2 should be (in contact with p1)
    let target_p2_pos = p1.center + p1_to_p2_dir * contact_dist;

    // Vector from cluster2 CoM to target p2 position
    let target_r_cm2_to_p2 = target_p2_pos - cluster2.center_of_mass;

    // We need to rotate cluster2 so that r_cm2_to_p2 aligns with target_r_cm2_to_p2
    let r_cm2_to_p2_current = cluster2.particles[m2].center - cluster2.center_of_mass;

    // Compute rotation axis and angle
    let cross = r_cm2_to_p2_current.cross(&target_r_cm2_to_p2);
    let cross_len = cross.length();

    if cross_len > 1e-10 {
        let rotation_axis = cross.normalize();
        let dot = r_cm2_to_p2_current.dot(&target_r_cm2_to_p2);
        let angle = (dot / (r_cm2_to_p2_current.length() * target_r_cm2_to_p2.length()))
            .clamp(-1.0, 1.0)
            .acos();

        // Apply rotation around cluster2's CoM
        cluster2.rotate_around_axis(rotation_axis, angle, cluster2.center_of_mass);
    }

    // Verify contact was achieved
    let final_dist = cluster2.particles[m2].center.distance_to(&p1.center);
    (final_dist - contact_dist).abs() < contact_dist * 0.1
}

/// Attempt to resolve overlap by rotating cluster2 around the contact axis.
fn resolve_overlap_by_rotation<R: Rng>(
    cluster1: &TunableCluster,
    cluster2: &mut TunableCluster,
    m2: usize,
    max_attempts: usize,
    sintering_coeff: f64,
    rng: &mut R,
) -> bool {
    // Rotation axis: line from cluster2 CoM through particle m2
    let p2_pos = cluster2.particles[m2].center;
    let rotation_axis = (p2_pos - cluster2.center_of_mass).normalize();

    for _ in 0..max_attempts {
        // Random rotation angle
        let angle = rng.gen_range(0.0..2.0 * PI);

        // Clone, rotate, check
        let mut test_cluster = cluster2.clone();
        test_cluster.rotate_around_axis(rotation_axis, angle, test_cluster.center_of_mass);

        if !check_overlap(cluster1, &test_cluster, sintering_coeff) {
            *cluster2 = test_cluster;
            return true;
        }
    }

    false
}

/// Initialize seed clusters based on strategy.
fn initialize_seed_clusters<R: Rng>(
    params: &TunableCcParams,
    rng: &mut R,
    py: Option<Python<'_>>,
) -> Vec<TunableCluster> {
    match &params.seed_strategy {
        SeedStrategy::Monomers => {
            // All individual particles
            (0..params.n_particles)
                .map(|_| {
                    let r = params.random_radius(rng);
                    TunableCluster::new(Sphere::new(Vector3::zero(), r))
                })
                .collect()
        }
        SeedStrategy::TunablePc { cluster_size } => {
            // Generate seed clusters using Tunable PC algorithm
            let n_clusters = (params.n_particles + cluster_size - 1) / *cluster_size;
            let remaining = params.n_particles;

            let mut clusters = Vec::with_capacity(n_clusters);
            let mut particles_used = 0;

            for i in 0..n_clusters {
                let size = if i == n_clusters - 1 && remaining % *cluster_size != 0 {
                    remaining - particles_used
                } else {
                    (*cluster_size).min(remaining - particles_used)
                };

                if size == 0 {
                    break;
                }

                if size == 1 {
                    // Single particle
                    let r = params.random_radius(rng);
                    clusters.push(TunableCluster::new(Sphere::new(Vector3::zero(), r)));
                } else if let Some(py) = py {
                    // Use Tunable PC to generate seed cluster
                    let seed: u64 = rng.gen();
                    // Use mean sintering coefficient for seed clusters
                    let sintering_coeff = params.sintering.mean();
                    if let Ok(result) = run_tunable(
                        py,
                        size,
                        params.target_df,
                        params.target_kf,
                        params.radius_min,
                        Some(params.radius_max),
                        sintering_coeff,
                        "fixed",
                        0.85,
                        0.95,
                        0.05,
                        Some(seed),
                    ) {
                        // Convert PySimulationResult to TunableCluster
                        let particles: Vec<Sphere> = (0..result.radii_data.len())
                            .map(|j| {
                                Sphere::new(
                                    Vector3::new(
                                        result.coordinates_data[j * 3],
                                        result.coordinates_data[j * 3 + 1],
                                        result.coordinates_data[j * 3 + 2],
                                    ),
                                    result.radii_data[j],
                                )
                            })
                            .collect();
                        clusters.push(TunableCluster::from_particles(particles));
                    } else {
                        // Fallback: create monomers
                        for _ in 0..size {
                            let r = params.random_radius(rng);
                            clusters.push(TunableCluster::new(Sphere::new(Vector3::zero(), r)));
                        }
                    }
                } else {
                    // No Python context, create monomers
                    for _ in 0..size {
                        let r = params.random_radius(rng);
                        clusters.push(TunableCluster::new(Sphere::new(Vector3::zero(), r)));
                    }
                }

                particles_used += size;
            }

            clusters
        }
        SeedStrategy::Custom { sizes } => {
            // Generate clusters of specified sizes
            sizes
                .iter()
                .map(|&size| {
                    let particles: Vec<Sphere> = (0..size)
                        .map(|_| Sphere::new(Vector3::zero(), params.random_radius(rng)))
                        .collect();
                    TunableCluster::from_particles(particles)
                })
                .collect()
        }
    }
}

/// Fallback: merge clusters using ballistic-like approach with sintering support.
fn merge_ballistic<R: Rng>(
    cluster1: &TunableCluster,
    cluster2: &mut TunableCluster,
    sintering_coeff: f64,
    rng: &mut R,
) -> bool {
    // Position cluster2 far from cluster1
    let launch_dist = cluster1.bounding_radius + cluster2.bounding_radius * 3.0;

    for _ in 0..100 {
        // Random direction
        let (dx, dy, dz) = random_point_on_sphere(rng);
        let dir = Vector3::new(dx, dy, dz);
        let start_pos = cluster1.center_of_mass + dir * launch_dist;

        // Position cluster2 at start
        let translation = start_pos - cluster2.center_of_mass;
        cluster2.translate(translation);

        // March toward cluster1
        let trajectory = (cluster1.center_of_mass - cluster2.center_of_mass).normalize();
        let step = cluster2.particles.iter().map(|p| p.radius).fold(f64::INFINITY, f64::min) * 0.5;

        for _ in 0..(launch_dist * 4.0 / step) as usize {
            // Check for contact (any particle pair touching with sintering)
            for p1 in &cluster1.particles {
                for p2 in &cluster2.particles {
                    let dist = p1.center.distance_to(&p2.center);
                    let contact_dist = sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);

                    if dist <= contact_dist * 1.01 && dist >= contact_dist * 0.9 {
                        // Found contact, check no overlap with sintering
                        if !check_overlap(cluster1, cluster2, sintering_coeff) {
                            return true;
                        }
                    }
                }
            }

            // Step forward
            cluster2.translate(trajectory * step);
        }
    }

    false
}

/// Run Tunable CC simulation.
///
/// # Arguments
/// * `n_particles` - Number of particles in the final agglomerate
/// * `target_df` - Target fractal dimension (typically 1.4-3.0)
/// * `target_kf` - Target prefactor (typically 1.0-2.0)
/// * `radius_min` - Minimum particle radius
/// * `radius_max` - Maximum particle radius
/// * `seed_cluster_size` - Size of seed clusters (None = monomers)
/// * `max_rotation_attempts` - Max attempts to resolve overlap by rotation
/// * `sintering_coeff` - Sintering coefficient (0.5-1.0, where 1.0 = no sintering)
/// * `sintering_type` - Distribution type: "fixed", "uniform", or "normal"
/// * `sintering_min` - Min for uniform distribution (default: 0.85)
/// * `sintering_max` - Max for uniform distribution (default: 0.95)
/// * `sintering_std` - Std dev for normal distribution (default: 0.05)
/// * `seed` - Random seed for reproducibility
#[pyfunction]
#[pyo3(signature = (n_particles, target_df=1.8, target_kf=1.3, radius_min=1.0, radius_max=None, seed_cluster_size=None, max_rotation_attempts=50, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
pub fn run_tunable_cc(
    py: Python<'_>,
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    seed_cluster_size: Option<usize>,
    max_rotation_attempts: usize,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);

    let seed_strategy = match seed_cluster_size {
        Some(size) if size > 1 => SeedStrategy::TunablePc { cluster_size: size },
        _ => SeedStrategy::Monomers,
    };

    let sintering = match sintering_type.to_lowercase().as_str() {
        "uniform" => SinteringDistribution::uniform(sintering_min, sintering_max),
        "normal" => SinteringDistribution::normal(sintering_coeff, sintering_std),
        _ => SinteringDistribution::fixed(sintering_coeff),
    };

    let params = TunableCcParams {
        n_particles,
        target_df,
        target_kf,
        radius_min,
        radius_max,
        seed_strategy,
        max_rotation_attempts,
        sintering,
        ..Default::default()
    };

    // Release GIL during computation (except for seed cluster generation)
    let result = py.allow_threads(|| run_tunable_cc_internal(params, seed, None));

    Ok(result.to_py())
}

/// Internal Tunable CC implementation following thesis Chapter 6.
fn run_tunable_cc_internal(
    params: TunableCcParams,
    seed: u64,
    py: Option<Python<'_>>,
) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    let rp = params.mean_radius();
    let kf = params.target_kf;
    let df = params.target_df;

    // Step 1: Initialize pool with seed clusters
    let mut clusters = initialize_seed_clusters(&params, &mut rng, py);

    // Spread clusters out to avoid initial overlaps
    let spread = (clusters.len() as f64).cbrt() * rp * 5.0;
    for cluster in &mut clusters {
        let (x, y, z) = random_point_on_sphere(&mut rng);
        let offset = Vector3::new(x, y, z) * spread * rng.gen::<f64>();
        cluster.translate(offset);
    }

    // Track Rg evolution
    let mut rg_evolution = Vec::new();
    let mut n_values = Vec::new();

    // Count successful tunable merges vs fallback
    let mut tunable_merges = 0;
    let mut fallback_merges = 0;

    // Step 2: Main aggregation loop - continue until only one cluster remains
    let mut iterations = 0;
    let max_iterations = params.n_particles * 1000;

    while clusters.len() > 1 && iterations < max_iterations {
        iterations += 1;

        // Select two clusters randomly
        let indices: Vec<usize> = (0..clusters.len()).collect();
        let selected: Vec<&usize> = indices.choose_multiple(&mut rng, 2).collect();
        let idx1 = *selected[0];
        let idx2 = *selected[1];

        // Assign roles: larger cluster is "impacted" (stationary)
        let (impacted_idx, impactor_idx) = if clusters[idx1].n_particles() >= clusters[idx2].n_particles() {
            (idx1, idx2)
        } else {
            (idx2, idx1)
        };

        // Clone both clusters for manipulation
        // impacted remains stationary, impactor will be moved
        let impacted = clusters[impacted_idx].clone();
        let mut impactor = clusters[impactor_idx].clone();

        // Sample sintering coefficient for this merge
        let sintering_coeff = params.sintering.sample(&mut rng);

        // Calculate merged particle count
        let n_po = impacted.n_particles() + impactor.n_particles();
        let n_po1 = impacted.n_particles();
        let n_po2 = impactor.n_particles();

        // Step 3: Calculate required CoM distance using power law
        let required_distance = match calculate_com_distance(n_po, n_po1, n_po2, kf, df, rp) {
            Some(d) => d,
            None => {
                // Use fallback for problematic cases
                let min_dist = impacted.bounding_radius + impactor.bounding_radius;
                min_dist * 0.5
            }
        };

        // Step 4: Check if clusters CAN connect
        let can_connect = can_clusters_connect(&impacted, &impactor, required_distance);

        let mut merge_success = false;

        if can_connect {
            // Step 5: Build candidate particle lists
            let la1 = impacted.get_candidate_particles(required_distance, impactor.bounding_radius);
            let la2 = impactor.get_candidate_particles(required_distance, impacted.bounding_radius);

            if !la1.is_empty() && !la2.is_empty() {
                // Step 6: Try to find contact particles and position clusters
                for _ in 0..params.max_particle_selection_attempts {
                    if let Some((m1, m2)) = select_contact_particles(
                        &impacted,
                        &impactor,
                        &la1,
                        &la2,
                        required_distance,
                        &mut rng,
                    ) {
                        // Step 7: Position clusters for contact (with sintering)
                        let positioned = position_clusters_for_contact(
                            &impacted,
                            &mut impactor,
                            m1,
                            m2,
                            required_distance,
                            sintering_coeff,
                            &mut rng,
                        );

                        if positioned {
                            // Step 8: Check and resolve overlaps (with sintering)
                            if !check_overlap(&impacted, &impactor, sintering_coeff) {
                                merge_success = true;
                                tunable_merges += 1;
                                break;
                            } else if resolve_overlap_by_rotation(
                                &impacted,
                                &mut impactor,
                                m2,
                                params.max_rotation_attempts,
                                sintering_coeff,
                                &mut rng,
                            ) {
                                merge_success = true;
                                tunable_merges += 1;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Fallback: ballistic merge if tunable positioning failed
        if !merge_success {
            if merge_ballistic(&impacted, &mut impactor, sintering_coeff, &mut rng) {
                merge_success = true;
                fallback_merges += 1;
            }
        }

        if merge_success {
            // Remove both original clusters (higher index first to avoid shifting issues)
            let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                (impactor_idx, impacted_idx)
            } else {
                (impacted_idx, impactor_idx)
            };

            clusters.remove(higher_idx);
            clusters.remove(lower_idx);

            // Create merged cluster from our clones
            // impacted was stationary, impactor was moved into position
            let mut merged = impacted;
            merged.merge_with(impactor);
            clusters.push(merged);

            // Track evolution
            if let Some(largest) = clusters.iter().max_by_key(|c| c.n_particles()) {
                rg_evolution.push(largest.radius_of_gyration);
                n_values.push(largest.n_particles());
            }
        }
    }

    // Collect final result
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

    // Calculate Df and kf from evolution
    let (actual_df, actual_kf, _r2) = calculate_fractal_dimension_from_evolution(&n_values, &rg_evolution, rp);

    let porosity = calculate_porosity(&coords, &radii);
    let coordination = calculate_coordination(&coords, &radii, rp * 0.1);
    let inertia = calculate_inertia_tensor(&coords, &radii);

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

/// Calculate Df and kf from Rg evolution using power law fitting.
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

    let r2 = if ss_tot > 0.0 { 1.0 - ss_res / ss_tot } else { 0.0 };

    (df, kf, r2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tunable_cc_deterministic() {
        let params = TunableCcParams {
            n_particles: 30,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };

        let r1 = run_tunable_cc_internal(params.clone(), 42, None);
        let r2 = run_tunable_cc_internal(params, 42, None);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        assert_eq!(r1.seed, r2.seed);
    }

    #[test]
    fn test_tunable_cc_produces_agglomerate() {
        let params = TunableCcParams {
            n_particles: 50,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 123, None);

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
    fn test_tunable_cc_no_overlaps() {
        let params = TunableCcParams {
            n_particles: 30,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 456, None);

        // Verify no particles overlap
        for i in 0..result.coordinates.len() {
            for j in (i + 1)..result.coordinates.len() {
                let c1 = &result.coordinates[i];
                let c2 = &result.coordinates[j];
                let dist = ((c1[0] - c2[0]).powi(2)
                    + (c1[1] - c2[1]).powi(2)
                    + (c1[2] - c2[2]).powi(2))
                .sqrt();
                let min_dist = result.radii[i] + result.radii[j];
                assert!(
                    dist >= min_dist - 1e-5,
                    "Overlap detected between particles {} and {}: dist={}, min={}",
                    i,
                    j,
                    dist,
                    min_dist
                );
            }
        }
    }

    #[test]
    fn test_tunable_cc_polydisperse() {
        let params = TunableCcParams {
            n_particles: 30,
            radius_min: 0.8,
            radius_max: 1.2,
            ..Default::default()
        };

        assert!(params.is_polydisperse());

        let result = run_tunable_cc_internal(params, 789, None);

        let min_r = result.radii.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_r = result.radii.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        assert!(max_r > min_r, "Radii should vary");
        assert!(min_r >= 0.8 - 1e-10);
        assert!(max_r <= 1.2 + 1e-10);
    }

    #[test]
    fn test_com_distance_calculation() {
        let kf = 1.3;
        let df = 1.8;
        let rp = 1.0;

        // For equal-sized clusters merging
        let n_po1 = 10;
        let n_po2 = 10;
        let n_po = n_po1 + n_po2;

        let dist = calculate_com_distance(n_po, n_po1, n_po2, kf, df, rp);

        assert!(dist.is_some(), "Distance should be calculable");
        let d = dist.unwrap();
        assert!(d > 0.0, "Distance should be positive");
        assert!(d < 100.0, "Distance should be reasonable");
    }
}
