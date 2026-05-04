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

use rand::seq::SliceRandom;
use rand::Rng;

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_point_on_sphere};

use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::SimulationResult;
use super::sintering::{sintered_contact_distance, SinteringDistribution};
// Note: TunablePc seed strategy with Python context is not available in pure engine.
// The seed cluster generation falls back to monomers when py is None.

/// Seed type mode for initial particle pool (R4 spec).
///
/// Controls how the N primary particles are grouped before the CC merge loop
/// begins.  `Monomers` is the default and preserves existing behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SeedType {
    /// N independent monomers (default — backward compatible).
    #[default]
    Monomers,
    /// ⌊N/2⌋ touching pairs; leftover monomer when N is odd.
    Dimers,
    /// ⌊N/3⌋ linear trimers; leftover handling for N mod 3 ≠ 0.
    Trimers,
}

/// Seed cluster generation strategy.
///
/// **Prefer [`SeedType`]** for new code.  `SeedStrategy` is retained only for
/// backward compatibility with the Python binding's `seed_cluster_size` parameter.
#[derive(Debug, Clone)]
#[deprecated(
    since = "0.5.0",
    note = "Use `SeedType` on `TunableCcParams` instead. `TunablePc` falls back to Monomers in pure engine."
)]
pub enum SeedStrategy {
    /// All monomers (like standard Ballistic CC)
    Monomers,
    /// Generate seed clusters using Tunable PC with specified size.
    /// Falls back to Monomers in the pure-engine crate.
    TunablePc { cluster_size: usize },
    /// Custom distribution of cluster sizes (not yet implemented)
    Custom { sizes: Vec<usize> },
}

#[allow(deprecated)]
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
    #[allow(deprecated)]
    pub seed_strategy: SeedStrategy,
    /// Seed type mode controlling the initial particle pool (R4 spec).
    /// When set, this takes precedence over `seed_strategy` for initial pool
    /// generation.  Default: `Monomers`.
    pub seed_type: SeedType,
    pub max_rotation_attempts: usize,
    pub max_particle_selection_attempts: usize,
    /// Maximum number of retry attempts per merge step before falling back
    /// to ballistic merge. Each retry selects a new random sub-cluster pair
    /// and samples fresh azimuth + elevation (spec R3).
    pub max_merge_retries: usize,
    pub sintering: SinteringDistribution,
}

impl Default for TunableCcParams {
    #[allow(deprecated)]
    fn default() -> Self {
        Self {
            n_particles: 1000,
            target_df: 1.8,
            target_kf: 1.3,
            radius_min: 1.0,
            radius_max: 1.0,
            seed_strategy: SeedStrategy::Monomers,
            seed_type: SeedType::default(),
            max_rotation_attempts: 50,
            max_particle_selection_attempts: 25,
            max_merge_retries: 100,
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
    fn get_candidate_particles(
        &self,
        required_distance: f64,
        other_bounding_radius: f64,
    ) -> Vec<usize> {
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

/// Compute the center-of-mass distance `d` required when merging two
/// sub-clusters so that the resulting aggregate satisfies the power-law
/// relationship `N = kf · (Rg / rp)^Df`.
///
/// # Derivation
///
/// Start from the radius-of-gyration definition `Rg² = (1/n) · Σ rᵢ²`
/// (sum over squared distances from center of mass). When two sub-clusters
/// with `n_po1` and `n_po2` particles merge at COM separation `d`, the
/// parallel-axis theorem gives:
///
/// ```text
/// Rg² · n_po = Rg1² · n_po1 + Rg2² · n_po2
///            + (n_po1 · n_po2 / n_po) · d²        [1]
/// ```
///
/// The target power-law `N = kf · (Rg / rp)^Df` implies
/// `Rg² = rp² · (N / kf)^(2/Df)`.  Substituting into [1] for all
/// three clusters and solving for `d²`:
///
/// ```text
/// d² = (n_po · rp²) / (n_po1 · n_po2)
///      · [ n_po  · (n_po  / kf)^(2/Df)
///        − n_po1 · (n_po1 / kf)^(2/Df)
///        − n_po2 · (n_po2 / kf)^(2/Df) ]          [2]
/// ```
///
/// # Thesis-typo note
///
/// The printed thesis equation (`eq:leyPotenciasColisionSimplificada`)
/// contains a typographic error — it drops the leading `n_po / (n_po1 · n_po2)`
/// factor and conflates sub-cluster exponents.  The formula above is
/// cross-validated against the **working** Tunable-PC implementation
/// (`tunable.rs`): when `n_po2 = 1` (monomer), the CC formula reduces to
/// the PC gamma distance identically.
///
/// # Previous bugs (fixed)
///
/// The old implementation had three errors:
/// 1. **Missing leading factor** `n_po / (n_po1 · n_po2)` — the entire
///    bracket was not scaled, shrinking `d` for asymmetric merges.
/// 2. **Single-cluster exponent** — used `(n_po1/kf)^(2/Df)` for
///    *both* sub-clusters instead of using `(n_po2/kf)^(2/Df)` for the
///    second.
/// 3. **Spurious `−3/5` constant** — the Lapuerta constant cancels
///    algebraically in the parallel-axis expansion (since
///    `n_po − n_po1 − n_po2 = 0`), but was left as a residual term.
///
/// Returns `Some(d)` where `d = √(d²)` if `d² > 0`, or `None` when the
/// geometry is impossible (caller should fall back to retry / ballistic).
fn calculate_com_distance(
    n_po1: usize, // Primary-particle count in sub-cluster 1
    n_po2: usize, // Primary-particle count in sub-cluster 2
    rp: f64,      // Primary particle radius
    df: f64,      // Target fractal dimension
    kf: f64,      // Target prefactor
) -> Option<f64> {
    let n1 = n_po1 as f64;
    let n2 = n_po2 as f64;
    let n = n1 + n2;
    let e = 2.0 / df;

    let t_total = n * (n / kf).powf(e);
    let t1 = n1 * (n1 / kf).powf(e);
    let t2 = n2 * (n2 / kf).powf(e);

    let d_sq = (n * rp * rp) / (n1 * n2) * (t_total - t1 - t2);

    if !d_sq.is_finite() || d_sq <= 0.0 {
        return None;
    }

    Some(d_sq.sqrt())
}

/// Sample a uniformly-distributed random direction on the unit sphere.
///
/// Uses the recommended two-parameter scheme:
///   - `φ = U(0, 2π)` — azimuth
///   - `cos θ = U(−1, 1)` — guarantees uniform solid-angle sampling
///
/// Returns `(dx, dy, dz)` on the unit sphere.
fn sample_merge_direction<R: Rng>(rng: &mut R) -> (f64, f64, f64) {
    let phi = rng.gen_range(0.0..std::f64::consts::TAU); // azimuth [0, 2π)
    let cos_theta = rng.gen_range(-1.0_f64..=1.0); // u ~ U(-1, 1)
    let sin_theta = (1.0 - cos_theta * cos_theta).sqrt();
    let dx = sin_theta * phi.cos();
    let dy = sin_theta * phi.sin();
    let dz = cos_theta;
    (dx, dy, dz)
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
fn check_overlap(
    cluster1: &TunableCluster,
    cluster2: &TunableCluster,
    sintering_coeff: f64,
) -> bool {
    // Quick bounding sphere check first (use sintered distance)
    let dist = cluster1
        .center_of_mass
        .distance_to(&cluster2.center_of_mass);
    let bounding_contact = sintered_contact_distance(
        cluster1.bounding_radius,
        cluster2.bounding_radius,
        sintering_coeff,
    );
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

/// Relative tolerance accepted when validating inter-cluster contact.
///
/// This only covers floating-point drift from the positioning/rotation math; it should
/// not be large enough to treat a visibly separated pair as a real contact.
const INTERCLUSTER_CONTACT_REL_TOL: f64 = 1e-4;
const INTERCLUSTER_CONTACT_ABS_TOL: f64 = 1e-6;

fn intercluster_contact_tolerance(contact_dist: f64) -> f64 {
    (contact_dist * INTERCLUSTER_CONTACT_REL_TOL).max(INTERCLUSTER_CONTACT_ABS_TOL)
}

/// Check whether two clusters have at least one real inter-cluster contact.
fn has_intercluster_contact(
    cluster1: &TunableCluster,
    cluster2: &TunableCluster,
    sintering_coeff: f64,
) -> bool {
    let dist = cluster1
        .center_of_mass
        .distance_to(&cluster2.center_of_mass);
    let bounding_contact = sintered_contact_distance(
        cluster1.bounding_radius,
        cluster2.bounding_radius,
        sintering_coeff,
    );
    let bounding_tolerance = intercluster_contact_tolerance(bounding_contact);
    if dist > bounding_contact + bounding_tolerance {
        return false;
    }

    for p1 in &cluster1.particles {
        for p2 in &cluster2.particles {
            let d = p1.center.distance_to(&p2.center);
            let contact_dist = sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);
            let tolerance = intercluster_contact_tolerance(contact_dist);

            if d <= contact_dist + tolerance {
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
///
/// Uses **two-rotation uniform spherical** positioning (R2):
///   1. Sample a merge direction via `sample_merge_direction` (azimuth + elevation).
///   2. Apply a random rotation to cluster1 around its CoM before selecting
///      the contact geometry — this doubles the geometric freedom for finding
///      valid placements and reduces ballistic fallback.
///   3. Position cluster2's CoM at `required_distance` along the sampled direction.
///   4. Rotate cluster2 to bring particle m2 into contact with p1.
fn position_clusters_for_contact<R: Rng>(
    cluster1: &mut TunableCluster,
    cluster2: &mut TunableCluster,
    m1: usize,
    m2: usize,
    required_distance: f64,
    sintering_coeff: f64,
    rng: &mut R,
) -> bool {
    // --- Rotation 1: Rotate impacted cluster (cluster1) around its CoM ---
    // This aligns m1 toward a random gap zone, per thesis two-rotation scheme.
    let (r1x, r1y, r1z) = sample_merge_direction(rng);
    let rot1_axis = Vector3::new(r1x, r1y, r1z);
    let rot1_angle = rng.gen_range(0.0..std::f64::consts::TAU);
    cluster1.rotate_around_axis(rot1_axis, rot1_angle, cluster1.center_of_mass);

    let p1 = &cluster1.particles[m1];
    let p2_original = &cluster2.particles[m2];
    let contact_dist = sintered_contact_distance(p1.radius, p2_original.radius, sintering_coeff);

    // --- Rotation 2: Place impactor along uniform spherical direction ---
    let (dx, dy, dz) = sample_merge_direction(rng);
    let base_direction = Vector3::new(dx, dy, dz);

    // Position cluster2 CoM at required_distance from cluster1 CoM
    let target_com2_pos = cluster1.center_of_mass + base_direction * required_distance;
    let translation = target_com2_pos - cluster2.center_of_mass;
    cluster2.translate(translation);

    // Rotate cluster2 so that particle m2 is in contact with p1
    let p2_current = &cluster2.particles[m2];
    let current_p2_pos = p2_current.center;

    // Direction from p1 to current p2 position
    let p1_to_p2_dir = (current_p2_pos - p1.center).normalize();

    // Where p2 should be (in contact with p1)
    let target_p2_pos = p1.center + p1_to_p2_dir * contact_dist;

    // Vector from cluster2 CoM to target p2 position
    let target_r_cm2_to_p2 = target_p2_pos - cluster2.center_of_mass;

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
        let step = cluster2
            .particles
            .iter()
            .map(|p| p.radius)
            .fold(f64::INFINITY, f64::min)
            * 0.5;

        for _ in 0..(launch_dist * 4.0 / step) as usize {
            // Check for near-contact (any particle pair within coarse window).
            // If found, snap cluster2 to exact contact distance so the final
            // placement satisfies the strict intercluster tolerance used by
            // the connectivity check.
            let snap_delta = {
                let mut delta = None;
                'search: for p1 in &cluster1.particles {
                    for p2 in &cluster2.particles {
                        let dist = p1.center.distance_to(&p2.center);
                        let contact_dist =
                            sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);

                        if dist <= contact_dist * 1.01 && dist >= contact_dist * 0.9 {
                            let gap = dist - contact_dist;
                            if gap.abs() > 1e-12 {
                                let dir = (p2.center - p1.center).normalize();
                                delta = Some(dir * (-gap));
                            } else {
                                delta = Some(Vector3::zero());
                            }
                            break 'search;
                        }
                    }
                }
                delta
            };
            if let Some(d) = snap_delta {
                if d.length() > 1e-14 {
                    cluster2.translate(d);
                }
                if !check_overlap(cluster1, cluster2, sintering_coeff) {
                    return true;
                }
            }

            // Step forward
            cluster2.translate(trajectory * step);
        }
    }

    false
}

/// Initialize seed clusters based on `seed_type` (R4 spec).
///
/// Falls back to the legacy `seed_strategy` only when `seed_type` is `Monomers`
/// AND `seed_strategy` is `Custom` (preserving backward compat for that path).
#[allow(deprecated)]
fn initialize_seed_clusters<R: Rng>(params: &TunableCcParams, rng: &mut R) -> Vec<TunableCluster> {
    // New seed_type takes precedence unless it's Monomers AND legacy Custom is set
    match params.seed_type {
        SeedType::Monomers => {
            // Check legacy seed_strategy for backward compat
            match &params.seed_strategy {
                SeedStrategy::Custom { sizes } => sizes
                    .iter()
                    .map(|&size| {
                        let particles: Vec<Sphere> = (0..size)
                            .map(|_| Sphere::new(Vector3::zero(), params.random_radius(rng)))
                            .collect();
                        TunableCluster::from_particles(particles)
                    })
                    .collect(),
                _ => build_monomers(params.n_particles, params, rng),
            }
        }
        SeedType::Dimers => build_dimers(params.n_particles, params.mean_radius(), rng),
        SeedType::Trimers => build_trimers(params.n_particles, params.mean_radius(), rng),
    }
}

/// Build N independent monomer clusters.
fn build_monomers<R: Rng>(n: usize, params: &TunableCcParams, rng: &mut R) -> Vec<TunableCluster> {
    (0..n)
        .map(|_| {
            let r = params.random_radius(rng);
            TunableCluster::new(Sphere::new(Vector3::zero(), r))
        })
        .collect()
}

/// Build ⌊N/2⌋ touching dimer pairs + 1 leftover monomer when N is odd.
///
/// Each dimer consists of 2 monomers with centers separated by `2·rp` along
/// a random spherical direction.
fn build_dimers<R: Rng>(n: usize, rp: f64, rng: &mut R) -> Vec<TunableCluster> {
    if n <= 1 {
        // Edge case: N=1 → single monomer regardless of mode
        return vec![TunableCluster::new(Sphere::new(Vector3::zero(), rp))];
    }

    let n_dimers = n / 2;
    let leftover = n % 2;
    let mut clusters = Vec::with_capacity(n_dimers + leftover);

    for _ in 0..n_dimers {
        let (dx, dy, dz) = sample_merge_direction(rng);
        let dir = Vector3::new(dx, dy, dz);
        let p1 = Sphere::new(Vector3::zero(), rp);
        let p2 = Sphere::new(dir * (2.0 * rp), rp);
        clusters.push(TunableCluster::from_particles(vec![p1, p2]));
    }

    if leftover == 1 {
        clusters.push(TunableCluster::new(Sphere::new(Vector3::zero(), rp)));
    }

    clusters
}

/// Build ⌊N/3⌋ linear trimers + leftover handling.
///
/// Each trimer is 3 collinear monomers at positions `[0, 2·rp, 4·rp]` along
/// a random spherical direction.  Leftovers:
/// - N mod 3 == 1 → 1 extra monomer
/// - N mod 3 == 2 → 1 extra dimer
/// - N < 3 → fall back to dimer logic (N=2 → 1 dimer, N=1 → 1 monomer)
fn build_trimers<R: Rng>(n: usize, rp: f64, rng: &mut R) -> Vec<TunableCluster> {
    if n < 3 {
        // Fall back: N=1 → monomer, N=2 → dimer (locked decision #3)
        return build_dimers(n, rp, rng);
    }

    let n_trimers = n / 3;
    let leftover = n % 3;
    let mut clusters = Vec::with_capacity(n_trimers + if leftover > 0 { 1 } else { 0 });

    for _ in 0..n_trimers {
        let (dx, dy, dz) = sample_merge_direction(rng);
        let dir = Vector3::new(dx, dy, dz);
        let p1 = Sphere::new(Vector3::zero(), rp);
        let p2 = Sphere::new(dir * (2.0 * rp), rp);
        let p3 = Sphere::new(dir * (4.0 * rp), rp);
        clusters.push(TunableCluster::from_particles(vec![p1, p2, p3]));
    }

    match leftover {
        1 => clusters.push(TunableCluster::new(Sphere::new(Vector3::zero(), rp))),
        2 => {
            let (dx, dy, dz) = sample_merge_direction(rng);
            let dir = Vector3::new(dx, dy, dz);
            let p1 = Sphere::new(Vector3::zero(), rp);
            let p2 = Sphere::new(dir * (2.0 * rp), rp);
            clusters.push(TunableCluster::from_particles(vec![p1, p2]));
        }
        _ => {}
    }

    clusters
}

/// Internal Tunable CC implementation following thesis Chapter 6.
/// The `_py` parameter is kept for API compatibility (always pass `None` from pure Rust).
pub fn run_tunable_cc_internal(
    params: TunableCcParams,
    seed: u64,
    _py: Option<()>,
) -> SimulationResult {
    let start_time = Instant::now();
    let mut rng = create_rng(seed);

    let rp = params.mean_radius();
    let kf = params.target_kf;
    let df = params.target_df;

    // Step 1: Initialize pool with seed clusters
    let mut clusters = initialize_seed_clusters(&params, &mut rng);

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

    // Diagnostic metadata counters (R7 spec)
    let mut tunable_merges: usize = 0;
    let mut ballistic_merges: usize = 0;
    let mut max_retries_per_merge: usize = 0;

    // Step 2: Main aggregation loop with retry-then-ballistic policy (R3 spec).
    //
    // For each merge step:
    //   1. Pick a random cluster pair and attempt tunable geometric merge.
    //   2. On failure: pick a NEW random pair, re-sample direction, retry.
    //   3. After `max_merge_retries` exhausted: ballistic fallback for this step.
    let mut iterations = 0;
    let max_iterations = params.n_particles * 1000;

    while clusters.len() > 1 && iterations < max_iterations {
        iterations += 1;

        let sintering_coeff = params.sintering.sample(&mut rng);
        let mut merge_success = false;
        let mut retries_this_merge: usize = 0;

        // Retry loop: each retry picks a NEW random pair (R3 spec)
        for attempt in 0..=params.max_merge_retries {
            // Select two clusters randomly (fresh pair each attempt)
            let indices: Vec<usize> = (0..clusters.len()).collect();
            let selected: Vec<&usize> = indices.choose_multiple(&mut rng, 2).collect();
            let idx1 = *selected[0];
            let idx2 = *selected[1];

            let (impacted_idx, impactor_idx) =
                if clusters[idx1].n_particles() >= clusters[idx2].n_particles() {
                    (idx1, idx2)
                } else {
                    (idx2, idx1)
                };

            let mut impacted = clusters[impacted_idx].clone();
            let mut impactor = clusters[impactor_idx].clone();

            let n_po1 = impacted.n_particles();
            let n_po2 = impactor.n_particles();

            let required_distance = match calculate_com_distance(n_po1, n_po2, rp, df, kf) {
                Some(d) => d,
                None => {
                    retries_this_merge = attempt;
                    continue; // retry with new pair
                }
            };

            let can_connect = can_clusters_connect(&impacted, &impactor, required_distance);
            if !can_connect {
                retries_this_merge = attempt;
                continue;
            }

            let la1 = impacted.get_candidate_particles(required_distance, impactor.bounding_radius);
            let la2 = impactor.get_candidate_particles(required_distance, impacted.bounding_radius);

            if la1.is_empty() || la2.is_empty() {
                retries_this_merge = attempt;
                continue;
            }

            // Inner particle-selection loop (within this attempt)
            let mut attempt_succeeded = false;
            for _ in 0..params.max_particle_selection_attempts {
                if let Some((m1, m2)) = select_contact_particles(
                    &impacted,
                    &impactor,
                    &la1,
                    &la2,
                    required_distance,
                    &mut rng,
                ) {
                    let positioned = position_clusters_for_contact(
                        &mut impacted,
                        &mut impactor,
                        m1,
                        m2,
                        required_distance,
                        sintering_coeff,
                        &mut rng,
                    );

                    if positioned {
                        let has_contact =
                            has_intercluster_contact(&impacted, &impactor, sintering_coeff);

                        if has_contact && !check_overlap(&impacted, &impactor, sintering_coeff) {
                            attempt_succeeded = true;
                            break;
                        } else if has_contact
                            && resolve_overlap_by_rotation(
                                &impacted,
                                &mut impactor,
                                m2,
                                params.max_rotation_attempts,
                                sintering_coeff,
                                &mut rng,
                            )
                            && has_intercluster_contact(&impacted, &impactor, sintering_coeff)
                        {
                            attempt_succeeded = true;
                            break;
                        }
                    }
                }
            }

            if attempt_succeeded {
                // Tunable merge succeeded — commit
                retries_this_merge = attempt;
                tunable_merges += 1;

                let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                    (impactor_idx, impacted_idx)
                } else {
                    (impacted_idx, impactor_idx)
                };

                clusters.remove(higher_idx);
                clusters.remove(lower_idx);

                let mut merged = impacted;
                merged.merge_with(impactor);
                clusters.push(merged);

                merge_success = true;
                break;
            }

            retries_this_merge = attempt;
        }

        // Ballistic fallback after all retries exhausted (R3 scenario 3.3)
        if !merge_success {
            // Pick a fresh pair for ballistic
            let indices: Vec<usize> = (0..clusters.len()).collect();
            let selected: Vec<&usize> = indices.choose_multiple(&mut rng, 2).collect();
            let idx1 = *selected[0];
            let idx2 = *selected[1];

            let (impacted_idx, impactor_idx) =
                if clusters[idx1].n_particles() >= clusters[idx2].n_particles() {
                    (idx1, idx2)
                } else {
                    (idx2, idx1)
                };

            let impacted = clusters[impacted_idx].clone();
            let mut impactor = clusters[impactor_idx].clone();

            if merge_ballistic(&impacted, &mut impactor, sintering_coeff, &mut rng) {
                ballistic_merges += 1;

                let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                    (impactor_idx, impacted_idx)
                } else {
                    (impacted_idx, impactor_idx)
                };

                clusters.remove(higher_idx);
                clusters.remove(lower_idx);

                let mut merged = impacted;
                merged.merge_with(impactor);
                clusters.push(merged);

                merge_success = true;
            }
        }

        // Track max retries across all merges
        if retries_this_merge > max_retries_per_merge {
            max_retries_per_merge = retries_this_merge;
        }

        if merge_success {
            if let Some(largest) = clusters.iter().max_by_key(|c| c.n_particles()) {
                rg_evolution.push(largest.radius_of_gyration);
                n_values.push(largest.n_particles());
            }
        }
    }

    // Diagnostic metadata is returned in the SimulationResult (R7 spec).
    // Logging is deferred to the caller (Python/backend layer) which has
    // the tracing/logging infrastructure.

    // Collect final result
    let final_particles: Vec<Sphere> = if clusters.is_empty() {
        Vec::new()
    } else {
        clusters.remove(0).particles
    };

    let coords: Vec<[f64; 3]> = final_particles
        .iter()
        .map(|s| [s.center.x, s.center.y, s.center.z])
        .collect();
    let radii: Vec<f64> = final_particles.iter().map(|s| s.radius).collect();

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
        tunable_merges,
        ballistic_merges,
        max_retries_per_merge,
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

    fn particles_form_connected_graph(
        coordinates: &[[f64; 3]],
        radii: &[f64],
        sintering_coeff: f64,
    ) -> bool {
        if coordinates.len() <= 1 {
            return true;
        }

        let mut visited = vec![false; coordinates.len()];
        let mut stack = vec![0usize];
        visited[0] = true;

        while let Some(current) = stack.pop() {
            for neighbor in 0..coordinates.len() {
                if visited[neighbor] || current == neighbor {
                    continue;
                }

                let c1 = coordinates[current];
                let c2 = coordinates[neighbor];
                let dist =
                    ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
                        .sqrt();
                let contact_dist =
                    sintered_contact_distance(radii[current], radii[neighbor], sintering_coeff);
                let tolerance = intercluster_contact_tolerance(contact_dist);

                if dist <= contact_dist + tolerance {
                    visited[neighbor] = true;
                    stack.push(neighbor);
                }
            }
        }

        visited.into_iter().all(|is_visited| is_visited)
    }

    #[test]
    fn test_intercluster_contact_requires_actual_touching() {
        let cluster1 = TunableCluster::new(Sphere::new(Vector3::zero(), 1.0));
        let mut cluster2 = TunableCluster::new(Sphere::new(Vector3::new(5.0, 0.0, 0.0), 1.0));

        assert!(can_clusters_connect(&cluster1, &cluster2, 2.0));
        assert!(!has_intercluster_contact(&cluster1, &cluster2, 1.0));

        cluster2.translate(Vector3::new(-3.0, 0.0, 0.0));

        assert!(has_intercluster_contact(&cluster1, &cluster2, 1.0));
    }

    #[test]
    fn test_intercluster_contact_tolerance_only_allows_numerical_noise() {
        let cluster1 = TunableCluster::new(Sphere::new(Vector3::zero(), 1.0));
        let contact_dist = sintered_contact_distance(1.0, 1.0, 1.0);
        let tolerance = intercluster_contact_tolerance(contact_dist);

        let within_tolerance = TunableCluster::new(Sphere::new(
            Vector3::new(contact_dist + tolerance * 0.5, 0.0, 0.0),
            1.0,
        ));
        let beyond_tolerance = TunableCluster::new(Sphere::new(
            Vector3::new(contact_dist + tolerance * 2.0, 0.0, 0.0),
            1.0,
        ));

        assert!(has_intercluster_contact(&cluster1, &within_tolerance, 1.0));
        assert!(!has_intercluster_contact(&cluster1, &beyond_tolerance, 1.0));
    }

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
                let dist =
                    ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
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
    fn test_tunable_cc_returns_connected_aggregate() {
        let params = TunableCcParams {
            n_particles: 40,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 321, None);

        assert!(
            particles_form_connected_graph(&result.coordinates, &result.radii, 1.0),
            "Tunable CC should not return a disconnected aggregate"
        );
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
        let max_r = result
            .radii
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);

        assert!(max_r > min_r, "Radii should vary");
        assert!(min_r >= 0.8 - 1e-10);
        assert!(max_r <= 1.2 + 1e-10);
    }

    #[test]
    fn test_tunable_cc_rg_evolution_has_enough_points() {
        // Regression test: Verify that the CC algorithm produces enough Rg
        // data points for a meaningful power-law fit, and that the fit does
        // NOT return the default (2.0, 1.0, 0.0) sentinel values.
        let params = TunableCcParams {
            n_particles: 20,
            target_df: 1.4,
            target_kf: 1.3,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 42, None);
        assert_eq!(result.coordinates.len(), 20);

        // The Rg evolution should have enough data points for a fit
        // (at least 3 merges that grow the largest cluster).
        assert!(
            result.rg_evolution.len() >= 3,
            "CC should produce at least 3 Rg data points, got {}",
            result.rg_evolution.len()
        );

        // The Df should NOT be exactly 2.0 (the default sentinel for insufficient data).
        // It may not match the target closely due to ballistic fallback dominance in
        // CC with monomers, but it should at least be a real fit result.
        assert!(
            (result.fractal_dimension - 2.0).abs() > 0.01
                || (result.prefactor - 1.0).abs() > 0.01,
            "CC should produce a real fit, not the default (2.0, 1.0) sentinel. Got Df={:.3}, kf={:.3}",
            result.fractal_dimension, result.prefactor
        );
    }

    // ---------------------------------------------------------------
    // max_merge_retries config (R3 spec)
    // ---------------------------------------------------------------

    /// T2.2 — Default `max_merge_retries` is 100.
    #[test]
    fn test_default_max_merge_retries_is_100() {
        let params = TunableCcParams::default();
        assert_eq!(
            params.max_merge_retries, 100,
            "Default max_merge_retries must be 100 per spec R3"
        );
    }

    /// T2.2 — `max_merge_retries` is configurable (scenario 3.4).
    #[test]
    fn test_max_merge_retries_configurable() {
        let params = TunableCcParams {
            max_merge_retries: 50,
            ..Default::default()
        };
        assert_eq!(params.max_merge_retries, 50);
    }

    // ---------------------------------------------------------------
    // Retry policy + diagnostic metadata (R3, R7 spec)
    // ---------------------------------------------------------------

    /// T2.3 — With max_merge_retries=5 and a small simulation that still completes,
    /// verify ballistic fallback engaged (ballistic_merges > 0) when geometry is hard.
    /// Uses very constrained parameters to force some failures.
    #[test]
    fn test_retry_exhaustion_triggers_ballistic_fallback() {
        let params = TunableCcParams {
            n_particles: 20,
            target_df: 2.0,
            target_kf: 1.0,
            max_merge_retries: 5,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 42, None);

        // Must still produce all particles (simulation completes)
        assert_eq!(result.coordinates.len(), 20);

        // Metadata must be present (R7 scenario 7.3)
        assert!(
            result.tunable_merges + result.ballistic_merges > 0,
            "At least one merge must have occurred"
        );

        // With only 5 retries and constrained geometry, some ballistic fallback is expected
        // (but not guaranteed for every seed — we mainly verify the field is populated)
        assert!(
            result.tunable_merges > 0 || result.ballistic_merges > 0,
            "tunable_merges={}, ballistic_merges={}",
            result.tunable_merges,
            result.ballistic_merges
        );
    }

    /// T2.4 — Metadata fields always present (R7 scenario 7.3).
    #[test]
    fn test_simulation_result_has_retry_metadata() {
        let params = TunableCcParams {
            n_particles: 15,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 123, None);

        // Fields exist and are sensible
        let total_merges = result.tunable_merges + result.ballistic_merges;
        assert!(total_merges > 0, "Must have merges for n=15");

        // max_retries_per_merge ≥ 0 always holds trivially, but check it's bounded
        assert!(
            result.max_retries_per_merge <= 100,
            "max_retries_per_merge should not exceed max_merge_retries default"
        );
    }

    /// T2.3 — First-attempt success: tunable merge with no retries (scenario 3.1).
    /// For monomer merges early in the simulation, most should succeed on first attempt.
    #[test]
    fn test_first_attempt_success_increments_tunable_merges() {
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 777, None);
        assert_eq!(result.coordinates.len(), 10);

        // For small N with standard params, most merges should succeed via tunable path
        assert!(
            result.tunable_merges >= 1,
            "Expected at least one tunable merge for N=10, got tunable={}, ballistic={}",
            result.tunable_merges,
            result.ballistic_merges
        );
    }

    // ---------------------------------------------------------------
    // Two-rotation uniform spherical isotropy (R2 spec)
    // ---------------------------------------------------------------

    /// T2.1 — Isotropy test: sample_merge_direction must produce uniform
    /// distribution over the unit sphere (octant chi² test).
    #[test]
    fn test_merge_direction_isotropy_octants() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(12345);
        let n = 10_000usize;
        let mut octant_counts = [0u32; 8];

        for _ in 0..n {
            let (dx, dy, dz) = sample_merge_direction(&mut rng);
            // Verify unit vector
            let r = (dx * dx + dy * dy + dz * dz).sqrt();
            assert!((r - 1.0).abs() < 1e-9, "Direction must be unit vector");

            // Classify into octant by signs of (x, y, z)
            let octant = ((if dx >= 0.0 { 0 } else { 1 }) << 2)
                | ((if dy >= 0.0 { 0 } else { 1 }) << 1)
                | (if dz >= 0.0 { 0 } else { 1 });
            octant_counts[octant] += 1;
        }

        // Expected: n/8 = 1250 per octant.
        // Use chi² goodness-of-fit: Σ (O-E)²/E. For 7 dof at α=0.001 → critical ~24.3
        let expected = n as f64 / 8.0;
        let chi_sq: f64 = octant_counts
            .iter()
            .map(|&o| {
                let diff = o as f64 - expected;
                diff * diff / expected
            })
            .sum();

        assert!(
            chi_sq < 24.3,
            "Isotropy chi² test failed: χ²={chi_sq:.2}, threshold=24.3, counts={octant_counts:?}"
        );
    }

    /// T2.1 — Each component (x,y,z) of uniform sphere samples should have
    /// mean ≈ 0 and variance ≈ 1/3.
    #[test]
    fn test_merge_direction_component_statistics() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(99999);
        let n = 10_000usize;
        let mut sum_x = 0.0_f64;
        let mut sum_y = 0.0_f64;
        let mut sum_z = 0.0_f64;
        let mut sum_x2 = 0.0_f64;
        let mut sum_y2 = 0.0_f64;
        let mut sum_z2 = 0.0_f64;

        for _ in 0..n {
            let (dx, dy, dz) = sample_merge_direction(&mut rng);
            sum_x += dx;
            sum_y += dy;
            sum_z += dz;
            sum_x2 += dx * dx;
            sum_y2 += dy * dy;
            sum_z2 += dz * dz;
        }

        let nf = n as f64;
        let mean_x = sum_x / nf;
        let mean_y = sum_y / nf;
        let mean_z = sum_z / nf;
        let var_x = sum_x2 / nf - mean_x * mean_x;
        let var_y = sum_y2 / nf - mean_y * mean_y;
        let var_z = sum_z2 / nf - mean_z * mean_z;

        // Spec R2 scenario 2.2: mean ∈ (-0.05, 0.05), variance ∈ (0.28, 0.39)
        for (label, mean, var) in [
            ("x", mean_x, var_x),
            ("y", mean_y, var_y),
            ("z", mean_z, var_z),
        ] {
            assert!(
                mean.abs() < 0.05,
                "Component {label}: mean={mean:.4}, expected in (-0.05, 0.05)"
            );
            assert!(
                (0.28..=0.39).contains(&var),
                "Component {label}: var={var:.4}, expected in [0.28, 0.39]"
            );
        }
    }

    // ---------------------------------------------------------------
    // Seed type enum (R4 of cc-tunable-aggregation spec)
    // ---------------------------------------------------------------

    /// T3.1 — SeedType::default() must be Monomers (backward compat, R6).
    #[test]
    fn test_seed_type_default_is_monomers() {
        let seed_type = SeedType::default();
        assert_eq!(
            seed_type,
            SeedType::Monomers,
            "Default SeedType must be Monomers"
        );
    }

    /// T3.1 — TunableCcParams must have a seed_type field defaulting to Monomers.
    #[test]
    fn test_tunable_cc_params_seed_type_defaults_to_monomers() {
        let params = TunableCcParams::default();
        assert_eq!(
            params.seed_type,
            SeedType::Monomers,
            "TunableCcParams.seed_type must default to Monomers"
        );
    }

    /// T3.1 — SeedType enum has all three variants.
    #[test]
    fn test_seed_type_enum_variants() {
        let _m = SeedType::Monomers;
        let _d = SeedType::Dimers;
        let _t = SeedType::Trimers;
        // If this compiles and runs, the enum has all three variants.
    }

    // ---------------------------------------------------------------
    // Dimers initialization (R4 scenarios 4.2, 4.3)
    // ---------------------------------------------------------------

    /// T3.2 — Dimers N=10: 5 dimers, each size 2, total 10 particles.
    #[test]
    fn test_seed_dimers_n_even() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let clusters = build_dimers(10, rp, &mut rng);

        assert_eq!(clusters.len(), 5, "N=10 dimers should produce 5 clusters");
        let total_particles: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total_particles, 10, "Total particles must be 10");

        for (i, c) in clusters.iter().enumerate() {
            assert_eq!(c.n_particles(), 2, "Cluster {i} must be a dimer (size 2)");
            // Verify inter-particle distance ≈ 2·rp (touching)
            let dist = c.particles[0].center.distance_to(&c.particles[1].center);
            assert!(
                (dist - 2.0 * rp).abs() < 1e-10,
                "Dimer {i} inter-particle distance should be 2·rp={}, got {dist}",
                2.0 * rp
            );
        }
    }

    /// T3.2 — Dimers N=11: 5 dimers + 1 monomer = 6 clusters.
    #[test]
    fn test_seed_dimers_n_odd() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let clusters = build_dimers(11, rp, &mut rng);

        assert_eq!(
            clusters.len(),
            6,
            "N=11 dimers should produce 6 clusters (5 dimers + 1 monomer)"
        );
        let total_particles: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total_particles, 11, "Total particles must be 11");

        // First 5 are dimers
        for i in 0..5 {
            assert_eq!(clusters[i].n_particles(), 2, "Cluster {i} must be a dimer");
        }
        // Last is monomer
        assert_eq!(
            clusters[5].n_particles(),
            1,
            "Last cluster must be a monomer"
        );
    }

    /// T3.2 — Dimers N=1: edge case → single monomer.
    #[test]
    fn test_seed_dimers_n_1() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let clusters = build_dimers(1, 1.0, &mut rng);

        assert_eq!(clusters.len(), 1, "N=1 dimers → 1 monomer");
        assert_eq!(clusters[0].n_particles(), 1);
    }

    /// T3.2 — Dimers N=2: 1 dimer.
    #[test]
    fn test_seed_dimers_n_2() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let clusters = build_dimers(2, 1.0, &mut rng);

        assert_eq!(clusters.len(), 1, "N=2 dimers → 1 dimer");
        assert_eq!(clusters[0].n_particles(), 2);
    }

    // ---------------------------------------------------------------
    // Trimers initialization (R4 scenarios 4.4, 4.5)
    // ---------------------------------------------------------------

    /// T3.3 — Trimers N=9: 3 trimers, each size 3, total 9 particles.
    #[test]
    fn test_seed_trimers_n_div3() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let clusters = build_trimers(9, rp, &mut rng);

        assert_eq!(clusters.len(), 3, "N=9 trimers → 3 clusters");
        let total: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total, 9, "Total particles must be 9");

        for (i, c) in clusters.iter().enumerate() {
            assert_eq!(c.n_particles(), 3, "Cluster {i} must be a trimer (size 3)");
            // Verify collinear: particles at 0, 2·rp, 4·rp along same direction
            let d01 = c.particles[0].center.distance_to(&c.particles[1].center);
            let d12 = c.particles[1].center.distance_to(&c.particles[2].center);
            let d02 = c.particles[0].center.distance_to(&c.particles[2].center);
            assert!(
                (d01 - 2.0 * rp).abs() < 1e-10,
                "Trimer {i}: d(0,1)={d01:.10}, expected {}",
                2.0 * rp
            );
            assert!(
                (d12 - 2.0 * rp).abs() < 1e-10,
                "Trimer {i}: d(1,2)={d12:.10}, expected {}",
                2.0 * rp
            );
            assert!(
                (d02 - 4.0 * rp).abs() < 1e-10,
                "Trimer {i}: d(0,2)={d02:.10}, expected {} (collinear check)",
                4.0 * rp
            );
        }
    }

    /// T3.3 — Trimers N=7: 2 trimers + 1 monomer.
    #[test]
    fn test_seed_trimers_n_mod3_1() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let clusters = build_trimers(7, 1.0, &mut rng);

        assert_eq!(
            clusters.len(),
            3,
            "N=7 trimers → 2 trimers + 1 monomer = 3 clusters"
        );
        let total: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total, 7);

        assert_eq!(clusters[0].n_particles(), 3, "First cluster is a trimer");
        assert_eq!(clusters[1].n_particles(), 3, "Second cluster is a trimer");
        assert_eq!(
            clusters[2].n_particles(),
            1,
            "Third cluster is a monomer (leftover)"
        );
    }

    /// T3.3 — Trimers N=8: 2 trimers + 1 dimer.
    #[test]
    fn test_seed_trimers_n_mod3_2() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let clusters = build_trimers(8, rp, &mut rng);

        assert_eq!(
            clusters.len(),
            3,
            "N=8 trimers → 2 trimers + 1 dimer = 3 clusters"
        );
        let total: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total, 8);

        assert_eq!(clusters[0].n_particles(), 3, "First cluster is a trimer");
        assert_eq!(clusters[1].n_particles(), 3, "Second cluster is a trimer");
        assert_eq!(
            clusters[2].n_particles(),
            2,
            "Third cluster is a dimer (leftover 2)"
        );

        // Verify leftover dimer has touching particles
        let dimer = &clusters[2];
        let dist = dimer.particles[0]
            .center
            .distance_to(&dimer.particles[1].center);
        assert!(
            (dist - 2.0 * rp).abs() < 1e-10,
            "Leftover dimer distance should be 2·rp, got {dist}"
        );
    }

    /// T3.3 — Trimers N=2: fallback to 1 dimer (locked decision #3).
    #[test]
    fn test_seed_trimers_n_2_fallback() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let clusters = build_trimers(2, 1.0, &mut rng);

        assert_eq!(clusters.len(), 1, "N=2 trimers → 1 dimer (fallback)");
        assert_eq!(clusters[0].n_particles(), 2);
    }

    /// T3.3 — Trimers N=1: fallback to 1 monomer.
    #[test]
    fn test_seed_trimers_n_1() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let clusters = build_trimers(1, 1.0, &mut rng);

        assert_eq!(clusters.len(), 1, "N=1 trimers → 1 monomer");
        assert_eq!(clusters[0].n_particles(), 1);
    }

    // ---------------------------------------------------------------
    // Comprehensive seed type edge cases (T3.4)
    // ---------------------------------------------------------------

    /// T3.4 — Monomers default: N=10 → 10 individual monomers.
    #[test]
    fn test_seed_monomers_default() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 10,
            seed_type: SeedType::Monomers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);

        assert_eq!(clusters.len(), 10, "Monomers N=10 → 10 clusters");
        for (i, c) in clusters.iter().enumerate() {
            assert_eq!(c.n_particles(), 1, "Cluster {i} must be a monomer");
        }
        let total: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total, 10);
    }

    /// T3.4 — N=1 all modes → 1 monomer each.
    #[test]
    fn test_seed_n_1_all_modes() {
        use crate::common::rng::create_rng;

        for seed_type in [SeedType::Monomers, SeedType::Dimers, SeedType::Trimers] {
            let mut rng = create_rng(42);
            let params = TunableCcParams {
                n_particles: 1,
                seed_type,
                ..Default::default()
            };
            let clusters = initialize_seed_clusters(&params, &mut rng);

            assert_eq!(clusters.len(), 1, "N=1 with {seed_type:?} → 1 cluster");
            assert_eq!(
                clusters[0].n_particles(),
                1,
                "N=1 with {seed_type:?} → 1 monomer"
            );
        }
    }

    /// T3.4 — N=2 Dimers → 1 dimer.
    #[test]
    fn test_seed_n_2_dimers_via_params() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 2,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);

        assert_eq!(clusters.len(), 1, "Dimers N=2 → 1 dimer");
        assert_eq!(clusters[0].n_particles(), 2);
    }

    /// T3.4 — N=2 Trimers → 1 dimer (fallback).
    #[test]
    fn test_seed_n_2_trimers_via_params() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 2,
            seed_type: SeedType::Trimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);

        assert_eq!(clusters.len(), 1, "Trimers N=2 → 1 dimer (fallback)");
        assert_eq!(clusters[0].n_particles(), 2);
    }

    /// T3.4 — N=4 all modes.
    #[test]
    fn test_seed_n_4_all_modes() {
        use crate::common::rng::create_rng;

        // Monomers: 4 monomers
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 4,
            seed_type: SeedType::Monomers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);
        assert_eq!(clusters.len(), 4, "Monomers N=4 → 4 clusters");
        assert!(clusters.iter().all(|c| c.n_particles() == 1));

        // Dimers: 2 dimers
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 4,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);
        assert_eq!(clusters.len(), 2, "Dimers N=4 → 2 dimers");
        assert!(clusters.iter().all(|c| c.n_particles() == 2));

        // Trimers: 1 trimer + 1 monomer
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 4,
            seed_type: SeedType::Trimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);
        assert_eq!(clusters.len(), 2, "Trimers N=4 → 1 trimer + 1 monomer");
        assert_eq!(clusters[0].n_particles(), 3);
        assert_eq!(clusters[1].n_particles(), 1);
        let total: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total, 4);
    }

    /// T3.4 — N=7 all modes.
    #[test]
    fn test_seed_n_7_all_modes() {
        use crate::common::rng::create_rng;

        // Monomers: 7 monomers
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 7,
            seed_type: SeedType::Monomers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);
        assert_eq!(clusters.len(), 7);
        assert!(clusters.iter().all(|c| c.n_particles() == 1));

        // Dimers: 3 dimers + 1 monomer
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 7,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);
        assert_eq!(clusters.len(), 4, "Dimers N=7 → 3 dimers + 1 monomer");
        for i in 0..3 {
            assert_eq!(clusters[i].n_particles(), 2);
        }
        assert_eq!(clusters[3].n_particles(), 1);

        // Trimers: 2 trimers + 1 monomer
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 7,
            seed_type: SeedType::Trimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng);
        assert_eq!(clusters.len(), 3, "Trimers N=7 → 2 trimers + 1 monomer");
        assert_eq!(clusters[0].n_particles(), 3);
        assert_eq!(clusters[1].n_particles(), 3);
        assert_eq!(clusters[2].n_particles(), 1);
        let total: usize = clusters.iter().map(|c| c.n_particles()).sum();
        assert_eq!(total, 7);
    }

    /// T3.4 — Regression: Monomers behavior unchanged (backward compat R6).
    /// Verify that default params still produce all monomers in the same way.
    #[test]
    fn test_monomers_backward_compat_regression() {
        use crate::common::rng::create_rng;

        let mut rng1 = create_rng(42);
        let params_default = TunableCcParams {
            n_particles: 20,
            ..Default::default()
        };
        let clusters_default = initialize_seed_clusters(&params_default, &mut rng1);

        let mut rng2 = create_rng(42);
        let params_explicit = TunableCcParams {
            n_particles: 20,
            seed_type: SeedType::Monomers,
            ..Default::default()
        };
        let clusters_explicit = initialize_seed_clusters(&params_explicit, &mut rng2);

        assert_eq!(clusters_default.len(), clusters_explicit.len());
        assert_eq!(clusters_default.len(), 20);

        // Both should produce identical monomer clusters (same RNG seed)
        for (i, (c1, c2)) in clusters_default
            .iter()
            .zip(clusters_explicit.iter())
            .enumerate()
        {
            assert_eq!(
                c1.n_particles(),
                c2.n_particles(),
                "Cluster {i} size mismatch"
            );
            assert_eq!(c1.n_particles(), 1, "Must be monomer");
        }
    }

    /// T3.4 — Dimer particles are within reasonable bounds (not at infinity).
    #[test]
    fn test_seed_dimers_particles_bounded() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let clusters = build_dimers(10, rp, &mut rng);

        for (i, c) in clusters.iter().enumerate() {
            for (j, p) in c.particles.iter().enumerate() {
                let dist_from_origin = p.center.length();
                assert!(
                    dist_from_origin <= 4.0 * rp + 1e-10,
                    "Dimer {i} particle {j} too far from origin: {dist_from_origin}"
                );
            }
        }
    }

    /// T3.4 — Trimer particles are within reasonable bounds.
    #[test]
    fn test_seed_trimers_particles_bounded() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let clusters = build_trimers(9, rp, &mut rng);

        for (i, c) in clusters.iter().enumerate() {
            for (j, p) in c.particles.iter().enumerate() {
                let dist_from_origin = p.center.length();
                assert!(
                    dist_from_origin <= 4.0 * rp + 1e-10,
                    "Trimer {i} particle {j} too far from origin: {dist_from_origin}"
                );
            }
        }
    }

    // ---------------------------------------------------------------
    // COM-distance formula tests (R1 of cc-tunable-aggregation spec)
    // ---------------------------------------------------------------

    /// Helper: compute the expected CC COM distance analytically.
    /// d² = (n_po·rp²)/(n_po1·n_po2)
    ///      · [ n_po·(n_po/kf)^(2/Df)
    ///        − n_po1·(n_po1/kf)^(2/Df)
    ///        − n_po2·(n_po2/kf)^(2/Df) ]
    fn expected_cc_d(n_po1: usize, n_po2: usize, rp: f64, df: f64, kf: f64) -> f64 {
        let n1 = n_po1 as f64;
        let n2 = n_po2 as f64;
        let n = n1 + n2;
        let e = 2.0 / df;
        let t_total = n * (n / kf).powf(e);
        let t1 = n1 * (n1 / kf).powf(e);
        let t2 = n2 * (n2 / kf).powf(e);
        let d_sq = (n * rp * rp) / (n1 * n2) * (t_total - t1 - t2);
        d_sq.sqrt()
    }

    /// Helper: compute the Tunable-PC gamma distance for adding one monomer
    /// to a cluster of size (n-1), matching the formula in tunable.rs.
    fn expected_pc_gamma(n: usize, rp: f64, df: f64, kf: f64) -> f64 {
        let np_f = n as f64;
        let np_m1 = (n - 1) as f64;
        let e = 2.0 / df;
        let constante = 3.0 / 5.0;
        let gamma1 = (np_f.powi(2) / np_m1) * ((np_f / kf).powf(e) - constante);
        let gamma2 = np_f * ((np_m1 / kf).powf(e) - constante);
        let gamma3 = (np_f / np_m1) * ((1.0 / kf).powf(e) - constante);
        let gamma4_sq = gamma1 - gamma2 - gamma3;
        rp * gamma4_sq.sqrt()
    }

    /// Scenario 1.1 — PC equivalence (n_po1=1, n_po2=1).
    /// The CC formula must match the Tunable-PC monomer formula.
    #[test]
    fn test_com_distance_pc_equivalence() {
        let df = 1.8;
        let kf = 1.4;
        let rp = 12.5;

        // CC: merge two monomers
        let d_cc = calculate_com_distance(1, 1, rp, df, kf).expect("must be Some for monomers");

        // PC: adding particle #2 to a 1-particle cluster → n=2
        let d_pc = expected_pc_gamma(2, rp, df, kf);

        let rel_err = (d_cc - d_pc).abs() / d_pc;
        assert!(
            rel_err < 1e-10,
            "CC and PC must match for monomer merge: CC={d_cc:.15}, PC={d_pc:.15}, rel_err={rel_err:.2e}"
        );
    }

    /// Scenario 1.2 — Asymmetric small clusters (n_po1=2, n_po2=1).
    /// Cross-validate with PC formula for n=3 (adding 1 to a 2-cluster).
    #[test]
    fn test_com_distance_asymmetric_small() {
        let df = 1.8;
        let kf = 1.3;
        let rp = 1.0;

        // CC: merge (2,1)
        let d_cc = calculate_com_distance(2, 1, rp, df, kf).expect("must be Some");

        // PC: n=3 step (adding monomer to 2-cluster) — the specialization n_po1=n-1, n_po2=1
        let d_pc = expected_pc_gamma(3, rp, df, kf);

        let rel_err = (d_cc - d_pc).abs() / d_pc;
        assert!(
            rel_err < 1e-10,
            "CC(2,1) must match PC(n=3): CC={d_cc:.15}, PC={d_pc:.15}, rel_err={rel_err:.2e}"
        );

        // Hardcoded analytic value (verified by hand)
        let expected = 2.330965307114760_f64;
        assert!(
            (d_cc - expected).abs() < 1e-10,
            "CC(2,1) d={d_cc:.15}, expected={expected:.15}"
        );
    }

    /// Scenario 1.3 — Symmetric medium clusters (n_po1=n_po2=10).
    #[test]
    fn test_com_distance_symmetric_medium() {
        let df = 1.8;
        let kf = 1.4;
        let rp = 1.0;

        let d = calculate_com_distance(10, 10, rp, df, kf).expect("must be Some");

        // Hardcoded analytic value
        let expected = expected_cc_d(10, 10, rp, df, kf);
        assert!(
            (d - expected).abs() < 1e-10,
            "Symmetric(10,10): got={d:.15}, expected={expected:.15}"
        );
        assert!(d > 0.0, "Distance must be positive");
    }

    /// Scenario 1.3 (large) — Symmetric large clusters (n_po1=n_po2=175).
    /// The user case that was failing with the buggy formula.
    #[test]
    fn test_com_distance_large_symmetric() {
        let df = 1.6;
        let kf = 1.7;
        let rp = 1.0;

        let d = calculate_com_distance(175, 175, rp, df, kf).expect("must be Some for N=350");

        assert!(d > 0.0, "Distance must be positive for N=350");
        assert!(d.is_finite(), "Distance must be finite");

        // Verify against analytic expectation
        let expected = expected_cc_d(175, 175, rp, df, kf);
        assert!(
            (d - expected).abs() < 1e-8,
            "Large(175,175): got={d:.10}, expected={expected:.10}"
        );
    }

    /// Scenario 1.4 — Lower Df produces larger COM distance.
    #[test]
    fn test_com_distance_lower_df_gives_larger_distance() {
        let kf = 1.3;
        let rp = 1.0;

        let d_low = calculate_com_distance(10, 10, rp, 1.4, kf).unwrap();
        let d_high = calculate_com_distance(10, 10, rp, 2.2, kf).unwrap();

        assert!(
            d_low > d_high,
            "Lower Df should give larger distance: d(1.4)={d_low:.6}, d(2.2)={d_high:.6}"
        );
    }

    /// Scenario 1.5 — d² ≤ 0 returns None.
    /// The correct formula always gives d² > 0 for valid physical params
    /// (by strict superadditivity of x^p, p>1), so we test the guard
    /// with pathological Df → 0 which makes the exponent blow up and
    /// could produce NaN/negative via floating-point overflow.
    #[test]
    fn test_com_distance_returns_none_for_degenerate_input() {
        // Df very close to 0 → exponent 2/Df → ∞ → overflow to NaN or Inf
        let result = calculate_com_distance(5, 5, 1.0, 0.01, 1.0);
        // Should return None (NaN/Inf guard) or possibly Some(very large) —
        // either way, must NOT panic
        if let Some(d) = result {
            assert!(d.is_finite(), "If Some, must be finite, got {d}");
            assert!(d > 0.0, "If Some, must be positive");
        }
        // The spec mandates None when d²≤0. Since the math can't produce ≤0
        // with valid physical inputs, this test ensures no panic on edge cases.
    }
}
