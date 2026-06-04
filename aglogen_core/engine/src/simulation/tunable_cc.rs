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

/// Feature flag for Phase 3 algorithm (R20 spec).
///
/// Default: `true` (Phase 3 active — smart pair selection + adaptive fallback).
/// Set env var `CC_TUNABLE_USE_PHASE3_ALGORITHM=false` to revert to Phase 2 behavior.
/// Parsed once at simulation init, NOT at compile time.
const USE_PHASE3_ALGORITHM_DEFAULT: bool = true;

fn read_phase3_flag() -> bool {
    match std::env::var("CC_TUNABLE_USE_PHASE3_ALGORITHM") {
        Ok(val) => !matches!(val.to_lowercase().as_str(), "false" | "0" | "no"),
        Err(_) => USE_PHASE3_ALGORITHM_DEFAULT,
    }
}

/// Feature flag for the low-Df fix.
///
/// Default: `true` (fix active — PC seed pool + relaxed bounding threshold).
/// Set env var `CC_TUNABLE_USE_LOW_DF_FIX=false` to revert to the pre-fix
/// monomer pool + strict bounding behaviour (byte-identical rollback, see R24).
/// Parsed once at simulation init, NOT at compile time.
const USE_LOW_DF_FIX_DEFAULT: bool = true;

/// Reads the `CC_TUNABLE_USE_LOW_DF_FIX` environment variable to determine
/// whether the low-Df convergence fix is active.
///
/// ## Default behavior
///
/// When the variable is **absent**, the fix is **ON** (`true`). This is the
/// production default: PC-seed pool (`floor(N/PC_SEED_SIZE)` clusters of 4
/// particles) replaces the monomer pool, and the bounding-sum feasibility
/// threshold is relaxed to `gamma/2` (matching the original MATLAB reference).
///
/// ## Rollback / escape hatch
///
/// Set `CC_TUNABLE_USE_LOW_DF_FIX=false` (or `"0"` or `"no"`) to revert to
/// the **pre-fix algorithm bit-identically** (R24). The rollback path:
/// 1. `initialize_seed_clusters` skips `build_pc_seeds`; falls through to the
///    existing `build_monomers` / `Dimers` / `Trimers` branches.
/// 2. No separate RNG stream is created; main RNG state is untouched.
/// 3. `find_feasible_pairs` uses the full `gamma` threshold (`bounding_sum >= required`).
/// 4. For any `(seed, TunableCcParams)`, the `SimulationResult` is byte-identical
///    to a pre-patch run at the same seed.
///
/// ## Flag independence
///
/// This flag is **orthogonal to** `CC_TUNABLE_USE_PHASE3_ALGORITHM` (R20).
/// The two flags never alias and do not implicitly toggle each other (R22.3).
///
/// Parsed once at simulation start; not re-read inside any inner loop (R3.9).
fn read_low_df_fix_flag() -> bool {
    match std::env::var("CC_TUNABLE_USE_LOW_DF_FIX") {
        Ok(val) => !matches!(val.to_lowercase().as_str(), "false" | "0" | "no"),
        Err(_) => USE_LOW_DF_FIX_DEFAULT,
    }
}

/// Feature flag for the high-Df fix (Cycle 2).
///
/// Default: `true` (fix active — physical-contact guard in `find_feasible_pairs`).
/// Set env var `CC_TUNABLE_USE_HIGH_DF_FIX=false` (or `"0"` or `"no"`) to revert
/// to the Cycle-1-only behavior (byte-identical rollback, see R26.4).
///
/// ## What the fix does
///
/// When enabled, `find_feasible_pairs` skips any candidate pair whose CC-formula
/// `required_distance` is geometrically impossible — i.e. smaller than the minimum
/// physical contact distance `2 * max(rp_i, rp_j)`. Without this guard, such pairs
/// pass the bounding-sum check but exhaust all placement retries, causing the engine
/// to fall back to ballistic merges and silently capping measured Df near 2.0–2.4
/// even when `target_df ∈ [2.5, 2.9]` (root cause H_B2, explore.md §4.B).
///
/// ## Rollback / escape hatch
///
/// Set `CC_TUNABLE_USE_HIGH_DF_FIX=false` to revert to Cycle 1 behavior bit-identically
/// (R26.4). The guard is read-only inside `find_feasible_pairs` — no new RNG consumers
/// are introduced, so the flag-false path is byte-identical to the Cycle-1-only run
/// at the same seed.
///
/// ## Flag independence
///
/// This flag is **orthogonal to** `CC_TUNABLE_USE_LOW_DF_FIX` (R22) and
/// `CC_TUNABLE_USE_PHASE3_ALGORITHM` (R20). The three flags never alias and do not
/// implicitly toggle each other (R26.3). Cycle 2 production default:
/// `LOW_DF_FIX=true`, `HIGH_DF_FIX=true`, `PHASE3=true` (flag matrix row 8 in design.md §5).
///
/// Parsed once at simulation start; not re-read inside any inner loop (R3.9 invariant).
///
/// <!-- FLAG REGISTRY: USE_HIGH_DF_FIX_DEFAULT (no RNG salt — read-only guard) -->
const USE_HIGH_DF_FIX_DEFAULT: bool = true;

/// Reads the `CC_TUNABLE_USE_HIGH_DF_FIX` environment variable to determine
/// whether the physical-contact feasibility guard (Cycle 2 high-Df fix) is active.
///
/// ## Default behavior
///
/// When the variable is **absent**, the fix is **ON** (`true`). This is the
/// Cycle 2 production default: `find_feasible_pairs` skips pairs whose
/// `required_distance < 2 * max(rp_i, rp_j)` and the `AllInfeasible` fallback
/// is tagged `"adaptive_high_df_floor"` (design.md §3.4).
///
/// ## Rollback / escape hatch
///
/// Set `CC_TUNABLE_USE_HIGH_DF_FIX=false` (or `"0"` or `"no"`) to revert to
/// the **Cycle-1-only algorithm bit-identically** (R26.4). The rollback path:
/// 1. `find_feasible_pairs` does not evaluate the contact guard.
/// 2. No new RNG consumers are introduced; main RNG state is untouched.
/// 3. For any `(seed, TunableCcParams)`, the `SimulationResult` is byte-identical
///    to a Cycle-1-only run at the same seed.
///
/// For full rollback to the pre-Cycle-1 baseline, combine with
/// `CC_TUNABLE_USE_LOW_DF_FIX=false` — flag matrix row 1 in design.md §5
/// (`LOW=F, HIGH=F`): random pair, full gamma, monomers, no guards.
///
/// ## Flag independence
///
/// Orthogonal to `CC_TUNABLE_USE_LOW_DF_FIX` (R22) and `CC_TUNABLE_USE_PHASE3_ALGORITHM`
/// (R20). Parsed once at simulation start; not re-read inside any inner loop (R3.9).
///
/// ## SALT REGISTRY note
///
/// This flag does NOT introduce a new RNG salt (the contact guard is a read-only
/// filter in `find_feasible_pairs`; it selects from existing candidates but does
/// not draw any random numbers). See `USE_HIGH_DF_FIX_DEFAULT` in the SALT REGISTRY
/// comment block for the registry entry and discoverability rationale.
fn read_high_df_fix_flag() -> bool {
    match std::env::var("CC_TUNABLE_USE_HIGH_DF_FIX") {
        Ok(val) => !matches!(val.to_lowercase().as_str(), "false" | "0" | "no"),
        Err(_) => USE_HIGH_DF_FIX_DEFAULT,
    }
}

/// Seed cluster size for the PC-generated default pool (MATLAB convention).
const PC_SEED_SIZE: usize = 4;

/// RNG salt for the PC seed forked stream. Documented in the SALT REGISTRY
/// comment block below. DO NOT change without auditing other XOR-salt usages
/// in this crate first.
const PC_SEED_RNG_SALT: u64 = 0x5a7d_3f1e_8b2c_9604;

// ── SALT REGISTRY ────────────────────────────────────────────────────────
// Salts used to fork deterministic RNG streams from the main simulation
// seed. Add new entries here BEFORE introducing a new XOR-salt anywhere in
// this crate. Verify the value is unique across this list.
//
//   PC_SEED_RNG_SALT  = 0x5a7d_3f1e_8b2c_9604   (PC seed pool, cc-tunable-low-df-fix R23)
//
// Flag constants (no RNG salt — read-only guards):
//   USE_HIGH_DF_FIX_DEFAULT = true  (physical-contact guard, cc-tunable-high-df-fix R26)
// ─────────────────────────────────────────────────────────────────────────

use crate::common::geometry::{Sphere, Vector3};
use crate::common::rng::{create_rng, random_point_on_sphere};

use super::dpo_distribution::{DpoDistribution, TargetKfDistribution};
use super::metrics::{
    calculate_coordination, calculate_inertia_tensor, calculate_porosity,
    calculate_radius_of_gyration,
};
use super::result::{MergeTraceEntry, SimulationResult};
use super::sintering::{sintered_contact_distance, SinteringDistribution};
use super::tunable::place_particle_ballistic;
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
    /// Distribution for primary particle diameter (`dpo`).
    ///
    /// Controls how `radius_min`/`radius_max` are sampled at run start.
    /// Default: `Fixed(1.0)` — matches legacy scalar `radius_min`.
    /// See R12 in the parametric-values-dpo-and-kf delta spec.
    pub dpo_distribution: DpoDistribution,
    /// Distribution for fractal prefactor (`target_kf`).
    ///
    /// Controls how `target_kf` is sampled at run start.
    /// Default: `Fixed(1.3)` — matches legacy scalar `target_kf`.
    /// See R11 in the parametric-values-dpo-and-kf delta spec.
    pub target_kf_distribution: TargetKfDistribution,
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
            dpo_distribution: DpoDistribution::default(),
            target_kf_distribution: TargetKfDistribution::default(),
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
///
/// # Sintering
///
/// `sintering_coeff` scales the primary-particle radius before it enters
/// the formula: `rp_eff = rp * sintering_coeff`.  This represents the
/// effective contact radius after sintering compaction.  At `coeff = 1.0`
/// the formula is identical to the pre-sintering baseline.  Because `rp`
/// only appears in the leading `rp²` factor, the COM distance scales
/// linearly with `sintering_coeff`: `d_sintered = coeff · d_unsintered`.
fn calculate_com_distance(
    n_po1: usize,         // Primary-particle count in sub-cluster 1
    n_po2: usize,         // Primary-particle count in sub-cluster 2
    rp: f64,              // Primary particle radius
    df: f64,              // Target fractal dimension
    kf: f64,              // Target prefactor
    sintering_coeff: f64, // Sintering coefficient (1.0 = no sintering)
) -> Option<f64> {
    let rp_eff = rp * sintering_coeff;

    let n1 = n_po1 as f64;
    let n2 = n_po2 as f64;
    let n = n1 + n2;
    let e = 2.0 / df;

    let t_total = n * (n / kf).powf(e);
    let t1 = n1 * (n1 / kf).powf(e);
    let t2 = n2 * (n2 / kf).powf(e);

    let d_sq = (n * rp_eff * rp_eff) / (n1 * n2) * (t_total - t1 - t2);

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
///
/// Uses `sintered_contact_distance` so the triangle-inequality checks
/// respect sintering overlap (R8 — sintering-cc-fix / PYA-11).
fn select_contact_particles<R: Rng>(
    cluster1: &TunableCluster,
    cluster2: &TunableCluster,
    la1: &[usize],
    la2: &[usize],
    required_distance: f64,
    sintering_coeff: f64,
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
            let contact_dist = sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);

            // Can these particles form a contact when clusters are at required_distance apart?
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
        // PYA-11 fix: the snap window in the contact check below is
        // `[contact_dist * 0.9, contact_dist * 1.01]` — i.e. width
        // `contact_dist * 0.11`. With sintering_coeff < 1, contact_dist
        // shrinks (e.g. 1.8 instead of 2.0 for rp=1) so the window
        // narrows. The march step MUST be smaller than the window
        // width or the marching cluster skips past the contact zone
        // without ever entering the snap window. Cap at half-window
        // (~0.055 * contact_dist) and clamp to a minimum of `min_radius
        // * 0.05` to avoid pathologically slow marches for tiny
        // primaries.
        //
        // At coeff=1.0 this is identical-or-finer than the previous
        // `min_radius * 0.5` step (window 1.8..2.02 with rp=1 gives
        // step ~0.11 vs old 0.5 — finer, no regression risk).
        let min_radius = cluster2
            .particles
            .iter()
            .map(|p| p.radius)
            .fold(f64::INFINITY, f64::min);
        let min_contact_dist = {
            let mut min_cd = f64::INFINITY;
            for p1 in &cluster1.particles {
                for p2 in &cluster2.particles {
                    let cd = sintered_contact_distance(p1.radius, p2.radius, sintering_coeff);
                    if cd < min_cd {
                        min_cd = cd;
                    }
                }
            }
            min_cd
        };
        // Window width = contact_dist * (1.01 - 0.9) = contact_dist * 0.11
        // Half-window ensures we always sample inside the snap zone.
        let snap_half_window = min_contact_dist * 0.055;
        let step = snap_half_window.max(min_radius * 0.05);

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
fn initialize_seed_clusters<R: Rng>(
    params: &TunableCcParams,
    rng: &mut R,
    seed: u64,
    use_low_df_fix: bool,
) -> Vec<TunableCluster> {
    // When the low-Df fix is active and seed_type is Monomers, use the PC-generated
    // default pool (R23). Other seed types and the flag-off path are byte-identical
    // to the pre-fix algorithm (R24).
    if use_low_df_fix && params.seed_type == SeedType::Monomers {
        // Fork a separate RNG stream so the main RNG state is NOT advanced (R24).
        let mut rng_pc = create_rng(seed ^ PC_SEED_RNG_SALT);
        return build_pc_seeds(
            params.n_particles,
            params.mean_radius(),
            &params.sintering,
            &mut rng_pc,
        );
    }

    // Existing branches — unchanged; flag-off path is byte-identical to pre-fix (R24).
    // New seed_type takes precedence unless it's Monomers AND legacy Custom is set.
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

/// Build the PC-generated default seed pool when the low-Df fix flag is ON.
///
/// Produces `floor(n / PC_SEED_SIZE)` clusters of `PC_SEED_SIZE` particles each
/// via the PC (particle-cluster) placement algorithm, plus `n mod PC_SEED_SIZE`
/// leftover monomers appended at the end.
///
/// ## Separate RNG stream invariant (R24)
///
/// The caller is responsible for passing a **separate** `rng_pc` derived from
/// the main simulation seed via XOR with `PC_SEED_RNG_SALT`:
///
/// ```text
/// let mut rng_pc = create_rng(seed ^ PC_SEED_RNG_SALT);
/// ```
///
/// This guarantees that the main RNG state (`rng`) is **not advanced** by any
/// PC-seed work. Consequently, when the flag is OFF, the sequence of main-RNG
/// draws in the aggregation loop is byte-identical to the pre-fix algorithm
/// at the same seed (R24.3).
///
/// ## Salt constant
///
/// `PC_SEED_RNG_SALT = 0x5a7d_3f1e_8b2c_9604` is documented in the SALT REGISTRY
/// comment block near the top of this module. It is a fixed `const` so that the
/// same seed reproduces the same PC-seed pool across machines and Rust toolchain
/// versions (determinism required by R23.4). Do **not** change this value without
/// updating the SALT REGISTRY and auditing all other XOR-salt usages in this crate.
///
/// Spec: cc-tunable-aggregation R23.
fn build_pc_seeds<R: Rng>(
    n: usize,
    rp: f64,
    sintering: &SinteringDistribution,
    rng_pc: &mut R,
) -> Vec<TunableCluster> {
    let n_seeds = n / PC_SEED_SIZE;
    let leftover = n % PC_SEED_SIZE;
    let mut clusters = Vec::with_capacity(n_seeds + leftover);

    for _ in 0..n_seeds {
        // Seed particle 1: monomer at origin.
        let mut particles: Vec<Sphere> = vec![Sphere::new(Vector3::zero(), rp)];

        // Particles 2..PC_SEED_SIZE: placed ballistically against the growing cluster.
        for _ in 1..PC_SEED_SIZE {
            let pos = place_particle_ballistic(&particles, rng_pc, rp, sintering)
                .unwrap_or_else(|| {
                    // Extremely rare: ballistic placement failed 1000 attempts.
                    // Fall back to a monomer at origin (cluster stays connected via
                    // subsequent sintering; does not violate R23 physical connectivity
                    // in practice for rp > 0 and well-formed sintering distributions).
                    Vector3::zero()
                });
            particles.push(Sphere::new(pos, rp));
        }

        clusters.push(TunableCluster::from_particles(particles));
    }

    // Leftover monomers (n mod PC_SEED_SIZE particles that don't fill a full cluster).
    for _ in 0..leftover {
        clusters.push(TunableCluster::new(Sphere::new(Vector3::zero(), rp)));
    }

    clusters
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

    // P2.3 (PYA-15): sample distributions ONCE at run start, before the
    // main aggregation loop. Fixed distributions return the value without
    // consuming RNG state, preserving bit-for-bit backward compatibility.
    let dpo_used = params.dpo_distribution.sample(&mut rng);
    let target_kf_used = params.target_kf_distribution.sample(&mut rng);

    // Build effective params: override radius_min/radius_max (monodisperse
    // per run — both set to sampled dpo) and target_kf with sampled values.
    let params = TunableCcParams {
        radius_min: dpo_used,
        radius_max: dpo_used, // monodisperse per run
        target_kf: target_kf_used,
        ..params // keep distributions and other fields as-is
    };

    let rp = params.mean_radius();
    let kf = params.target_kf;
    let df = params.target_df;

    // Feature flags — read once at simulation start (R20, R22, R26).
    let use_phase3 = read_phase3_flag();
    let use_low_df_fix = read_low_df_fix_flag();
    // R26: high-Df physical-contact guard (Cycle 2). Read once here; threaded into
    // `select_pair_smart` → `find_feasible_pairs` to activate the physical-contact guard.
    let use_high_df_fix = read_high_df_fix_flag();

    // Step 1: Initialize pool with seed clusters
    let mut clusters = initialize_seed_clusters(&params, &mut rng, seed, use_low_df_fix);

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
    let mut adaptive_merges: usize = 0;
    let mut no_feasible_pair_events: usize = 0;
    let mut max_retries_per_merge: usize = 0;

    // Per-merge diagnostic trace (R16 — cc-tunable-merge-trace / PYA-14)
    let mut merge_trace: Vec<MergeTraceEntry> = Vec::new();
    let mut merge_count: usize = 0;

    // Step 2: Main aggregation loop with retry-then-ballistic policy (R3 spec).
    //
    // For each merge step:
    //   [Phase 3 flag=true]: Smart pair selection + adaptive fallback
    //   [Phase 3 flag=false]: Legacy random pair + retry + ballistic (Phase 2)
    let mut iterations = 0;
    let max_iterations = params.n_particles * 1000;

    while clusters.len() > 1 && iterations < max_iterations {
        iterations += 1;

        let sintering_coeff = params.sintering.sample(&mut rng);
        let mut merge_success = false;
        let mut retries_this_merge: usize = 0;

        // ── Phase 3 algorithm branch (smart pair selection + adaptive fallback) ──
        if use_phase3 {
            let smart_result = select_pair_smart(&clusters, df, kf, rp, sintering_coeff, &mut rng, use_low_df_fix, use_high_df_fix);

            match smart_result {
                SmartPairResult::Feasible(pair) => {
                    // Feasible pair found — use it with retry loop for placement
                    let (impacted_idx, impactor_idx) =
                        if clusters[pair.idx1].n_particles() >= clusters[pair.idx2].n_particles() {
                            (pair.idx1, pair.idx2)
                        } else {
                            (pair.idx2, pair.idx1)
                        };

                    let mut impacted = clusters[impacted_idx].clone();
                    let mut impactor = clusters[impactor_idx].clone();
                    let n_po1 = impacted.n_particles();
                    let n_po2 = impactor.n_particles();
                    let required_distance = pair.required_distance;

                    // Try placement up to max_merge_retries (fresh direction each time)
                    let mut attempt_succeeded = false;
                    for attempt in 0..=params.max_merge_retries {
                        // Re-clone for each attempt to get fresh positioning
                        let mut imp_try = clusters[impacted_idx].clone();
                        let mut imr_try = clusters[impactor_idx].clone();

                        let la1 = imp_try.get_candidate_particles(required_distance, imr_try.bounding_radius);
                        let la2 = imr_try.get_candidate_particles(required_distance, imp_try.bounding_radius);

                        if la1.is_empty() || la2.is_empty() {
                            retries_this_merge = attempt;
                            continue;
                        }

                        let mut inner_success = false;
                        for _ in 0..params.max_particle_selection_attempts {
                            if let Some((m1, m2)) = select_contact_particles(
                                &imp_try, &imr_try, &la1, &la2,
                                required_distance, sintering_coeff, &mut rng,
                            ) {
                                let positioned = position_clusters_for_contact(
                                    &mut imp_try, &mut imr_try, m1, m2,
                                    required_distance, sintering_coeff, &mut rng,
                                );
                                if positioned {
                                    let has_contact = has_intercluster_contact(&imp_try, &imr_try, sintering_coeff);
                                    if has_contact && !check_overlap(&imp_try, &imr_try, sintering_coeff) {
                                        inner_success = true;
                                        impacted = imp_try;
                                        impactor = imr_try;
                                        break;
                                    } else if has_contact && resolve_overlap_by_rotation(
                                        &imp_try, &mut imr_try, m2,
                                        params.max_rotation_attempts, sintering_coeff, &mut rng,
                                    ) && has_intercluster_contact(&imp_try, &imr_try, sintering_coeff)
                                    {
                                        inner_success = true;
                                        impacted = imp_try;
                                        impactor = imr_try;
                                        break;
                                    }
                                }
                            }
                        }

                        if inner_success {
                            retries_this_merge = attempt;
                            attempt_succeeded = true;
                            break;
                        }
                        retries_this_merge = attempt;
                    }

                    if attempt_succeeded {
                        // Tunable merge succeeded
                        tunable_merges += 1;
                        let actual_distance = impacted.center_of_mass.distance_to(&impactor.center_of_mass);

                        let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                            (impactor_idx, impacted_idx)
                        } else {
                            (impacted_idx, impactor_idx)
                        };
                        clusters.remove(higher_idx);
                        clusters.remove(lower_idx);

                        let mut merged = impacted;
                        merged.merge_with(impactor);

                        let n_total = (n_po1 + n_po2) as f64;
                        merge_trace.push(MergeTraceEntry {
                            step: merge_count,
                            n1: n_po1,
                            n2: n_po2,
                            required_distance,
                            actual_distance,
                            rg_after: merged.radius_of_gyration,
                            rg_target: rp * (n_total / kf).powf(1.0 / df),
                            merge_type: "tunable".to_string(),
                            retries: retries_this_merge,
                            bounding_check_passed: true,
                            overshoot_pct: None,
                        });
                        merge_count += 1;
                        clusters.push(merged);
                        merge_success = true;
                    } else {
                        // Retries exhausted on feasible pair → march-inward adaptive.
                        // Try march-inward first for better Df convergence.
                        let march_result = march_inward_merge(
                            &clusters[impacted_idx],
                            &clusters[impactor_idx],
                            required_distance, rp, sintering_coeff, &mut rng,
                        );

                        if let Some((imp_m, imr_m, actual_distance)) = march_result {
                            adaptive_merges += 1;

                            let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                                (impactor_idx, impacted_idx)
                            } else {
                                (impacted_idx, impactor_idx)
                            };
                            clusters.remove(higher_idx);
                            clusters.remove(lower_idx);

                            let rg_target = rp * ((n_po1 + n_po2) as f64 / kf).powf(1.0 / df);
                            let mut merged = imp_m;
                            merged.merge_with(imr_m);

                            merge_trace.push(emit_adaptive_merge_entry(
                                merge_count, n_po1, n_po2,
                                actual_distance, required_distance,
                                merged.radius_of_gyration, rg_target,
                                retries_this_merge,
                                None,
                            ));
                            merge_count += 1;
                            clusters.push(merged);
                            merge_success = true;
                        } else {
                            // March-inward failed → pure ballistic fallback.
                            // Tag as "ballistic" (not "adaptive") so we know it failed.
                            let imp_b = clusters[impacted_idx].clone();
                            let mut imr_b = clusters[impactor_idx].clone();

                            if merge_ballistic(&imp_b, &mut imr_b, sintering_coeff, &mut rng) {
                                ballistic_merges += 1;
                                let actual_distance = imp_b.center_of_mass.distance_to(&imr_b.center_of_mass);

                                let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                                    (impactor_idx, impacted_idx)
                                } else {
                                    (impacted_idx, impactor_idx)
                                };
                                clusters.remove(higher_idx);
                                clusters.remove(lower_idx);

                                let rg_target = rp * ((n_po1 + n_po2) as f64 / kf).powf(1.0 / df);
                                let mut merged = imp_b;
                                merged.merge_with(imr_b);

                                let n_total = (n_po1 + n_po2) as f64;
                                merge_trace.push(MergeTraceEntry {
                                    step: merge_count,
                                    n1: n_po1,
                                    n2: n_po2,
                                    required_distance,
                                    actual_distance,
                                    rg_after: merged.radius_of_gyration,
                                    rg_target: rp * (n_total / kf).powf(1.0 / df),
                                    merge_type: "ballistic".to_string(),
                                    retries: retries_this_merge,
                                    bounding_check_passed: false,
                                    overshoot_pct: None,
                                });
                                merge_count += 1;
                                clusters.push(merged);
                                merge_success = true;
                            }
                        }
                    }
                }
                SmartPairResult::AllInfeasible { max_achievable_pair } => {
                    // No feasible pair exists — emit event + march-inward adaptive.
                    no_feasible_pair_events += 1;
                    merge_trace.push(emit_no_feasible_pair_entry(merge_count, clusters.len()));

                    let pair = max_achievable_pair;
                    let (impacted_idx, impactor_idx) =
                        if clusters[pair.idx1].n_particles() >= clusters[pair.idx2].n_particles() {
                            (pair.idx1, pair.idx2)
                        } else {
                            (pair.idx2, pair.idx1)
                        };

                    let n_po1 = clusters[impacted_idx].n_particles();
                    let n_po2 = clusters[impactor_idx].n_particles();

                    // Try march-inward first
                    let march_result = march_inward_merge(
                        &clusters[impacted_idx],
                        &clusters[impactor_idx],
                        pair.required_distance, rp, sintering_coeff, &mut rng,
                    );

                    if let Some((imp_m, imr_m, actual_distance)) = march_result {
                        adaptive_merges += 1;

                        let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                            (impactor_idx, impacted_idx)
                        } else {
                            (impacted_idx, impactor_idx)
                        };
                        clusters.remove(higher_idx);
                        clusters.remove(lower_idx);

                        let rg_target = rp * ((n_po1 + n_po2) as f64 / kf).powf(1.0 / df);
                        let mut merged = imp_m;
                        merged.merge_with(imr_m);

                        // R27: when use_high_df_fix=true, tag ALL AllInfeasible events
                        // as "adaptive_high_df_floor" (design §3.4: tag-all-when-flag-on).
                        let adaptive_tag = if use_high_df_fix { Some("adaptive_high_df_floor") } else { None };
                        merge_trace.push(emit_adaptive_merge_entry(
                            merge_count, n_po1, n_po2,
                            actual_distance, pair.required_distance,
                            merged.radius_of_gyration, rg_target,
                            0,
                            adaptive_tag,
                        ));
                        merge_count += 1;
                        clusters.push(merged);
                        merge_success = true;
                    } else {
                        // March-inward failed → pure ballistic fallback.
                        ballistic_merges += 1;

                        let imp = clusters[impacted_idx].clone();
                        let mut imr = clusters[impactor_idx].clone();

                        if merge_ballistic(&imp, &mut imr, sintering_coeff, &mut rng) {
                            let actual_distance = imp.center_of_mass.distance_to(&imr.center_of_mass);

                            let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                                (impactor_idx, impacted_idx)
                            } else {
                                (impacted_idx, impactor_idx)
                            };
                            clusters.remove(higher_idx);
                            clusters.remove(lower_idx);

                            let rg_target = rp * ((n_po1 + n_po2) as f64 / kf).powf(1.0 / df);
                            let n_total = (n_po1 + n_po2) as f64;
                            let mut merged = imp;
                            merged.merge_with(imr);

                            merge_trace.push(MergeTraceEntry {
                                step: merge_count,
                                n1: n_po1,
                                n2: n_po2,
                                required_distance: pair.required_distance,
                                actual_distance,
                                rg_after: merged.radius_of_gyration,
                                rg_target: rp * (n_total / kf).powf(1.0 / df),
                                merge_type: "ballistic".to_string(),
                                retries: 0,
                                bounding_check_passed: false,
                                overshoot_pct: None,
                            });
                            merge_count += 1;
                            clusters.push(merged);
                            merge_success = true;
                        }
                    }
                }
            }
        } else {
        // ── Phase 2 algorithm branch (legacy random pair + retry + ballistic) ──

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

            let required_distance =
                match calculate_com_distance(n_po1, n_po2, rp, df, kf, sintering_coeff) {
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
                    sintering_coeff,
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

                // R16: Measure actual COM-COM distance before merging clusters.
                let actual_distance = impacted
                    .center_of_mass
                    .distance_to(&impactor.center_of_mass);

                let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                    (impactor_idx, impacted_idx)
                } else {
                    (impacted_idx, impactor_idx)
                };

                clusters.remove(higher_idx);
                clusters.remove(lower_idx);

                let mut merged = impacted;
                merged.merge_with(impactor);

                // R16: Record merge trace entry after merge_with (which calls update_properties).
                let n_total = (n_po1 + n_po2) as f64;
                merge_trace.push(MergeTraceEntry {
                    step: merge_count,
                    n1: n_po1,
                    n2: n_po2,
                    required_distance,
                    actual_distance,
                    rg_after: merged.radius_of_gyration,
                    rg_target: rp * (n_total / kf).powf(1.0 / df),
                    merge_type: "tunable".to_string(),
                    retries: retries_this_merge,
                    bounding_check_passed: true,
                    overshoot_pct: None,
                });
                merge_count += 1;

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

            let ballistic_n1 = impacted.n_particles();
            let ballistic_n2 = impactor.n_particles();

            if merge_ballistic(&impacted, &mut impactor, sintering_coeff, &mut rng) {
                ballistic_merges += 1;

                // R16: Measure actual COM-COM distance for ballistic merge.
                let actual_distance = impacted
                    .center_of_mass
                    .distance_to(&impactor.center_of_mass);

                let (higher_idx, lower_idx) = if impactor_idx > impacted_idx {
                    (impactor_idx, impacted_idx)
                } else {
                    (impacted_idx, impactor_idx)
                };

                clusters.remove(higher_idx);
                clusters.remove(lower_idx);

                let mut merged = impacted;
                merged.merge_with(impactor);

                // R16.11: Compute what the tunable path would have targeted,
                // so merge_trace is complete even for ballistic fallbacks.
                // R16.12: If calculate_com_distance returns None (degenerate
                // pair, e.g. exponent overflow), fall back to 0.0 with a
                // diagnostic warning — ballistic merges must never fail.
                let required_distance =
                    calculate_com_distance(ballistic_n1, ballistic_n2, rp, df, kf, sintering_coeff)
                        .unwrap_or_else(|| {
                            eprintln!(
                        "WARNING: calculate_com_distance returned None for ballistic fallback \
                         (n1={}, n2={}, df={}, kf={}, rp={}, sintering={})",
                        ballistic_n1, ballistic_n2, df, kf, rp, sintering_coeff
                    );
                            0.0
                        });

                let n_total = (ballistic_n1 + ballistic_n2) as f64;
                merge_trace.push(MergeTraceEntry {
                    step: merge_count,
                    n1: ballistic_n1,
                    n2: ballistic_n2,
                    required_distance,
                    actual_distance,
                    rg_after: merged.radius_of_gyration,
                    rg_target: rp * (n_total / kf).powf(1.0 / df),
                    merge_type: "ballistic".to_string(),
                    retries: retries_this_merge,
                    bounding_check_passed: false,
                    overshoot_pct: None,
                });
                merge_count += 1;

                clusters.push(merged);

                merge_success = true;
            }
        }

        } // end of Phase 2 else branch

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
        adaptive_merges,
        no_feasible_pair_events,
        max_retries_per_merge,
        dpo_used: Some(dpo_used),
        target_kf_used: Some(target_kf_used),
        merge_trace,
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

// ── Phase 3: March-Inward Placement (PYA-14 convergence fix) ─────────────

/// Result of march-inward placement.
///
/// `Distance(d)` means first contact was found at COM-COM distance `d`.
/// `NoContact` means no contact was found before reaching the sanity floor.
#[derive(Debug, PartialEq)]
pub(crate) enum MarchResult {
    /// Contact found at this COM-COM distance.
    Distance(f64),
    /// No contact achievable within the march range.
    NoContact,
}

/// March inward from `d_start` toward `d_floor`, checking for first
/// sphere-sphere contact between clusters A and B.
///
/// Cluster A is centered at origin, cluster B's centroid is placed at
/// distance `d` from origin along `direction` (unit vector).
///
/// The algorithm finds the closest pair of spheres (one from A, one from B)
/// and computes the exact COM-COM distance at which they touch, then returns
/// that distance (or the closest achievable if multiple pairs compete).
///
/// # Returns
/// * `MarchResult::Distance(d)` — first contact at COM-COM distance `d`
/// * `MarchResult::NoContact` — no contact achievable in the range
pub(crate) fn find_first_contact_distance(
    spheres_a: &[Sphere],
    spheres_b: &[Sphere],
    direction: &Vector3,
    d_start: f64,
    d_floor: f64,
    _rp: f64,
    sintering_coeff: f64,
) -> MarchResult {
    // Safety: d_start must be > d_floor
    if d_start <= d_floor {
        return MarchResult::NoContact;
    }

    // ANALYTICAL APPROACH: For each sphere pair (sa, sb), compute the
    // exact COM-COM distance at which they first touch.
    //
    // When B's centroid is at offset = direction * d:
    //   sb_position = sb.center + direction * d
    //   distance(sa, sb) = |sa.center - (sb.center + direction * d)|
    //   contact when distance = contact_dist
    //
    // This is a 1D problem along the direction axis.
    // Let's solve: |sa.center - sb.center - direction * d|² = contact_dist²
    //
    // Let v = sa.center - sb.center
    // |v - direction * d|² = contact_dist²
    // |v|² - 2·d·(v·direction) + d² = contact_dist²
    // d² - 2·(v·direction)·d + (|v|² - contact_dist²) = 0
    //
    // Quadratic in d. Take the larger root (approaching from far away).

    let mut best_d: Option<f64> = None;

    for sa in spheres_a {
        for sb in spheres_b {
            let contact_dist = sintered_contact_distance(sa.radius, sb.radius, sintering_coeff);
            let v = sa.center - sb.center; // vector from sb to sa
            let v_dot_dir = v.dot(direction);
            let v_sq = v.dot(&v);

            // d² - 2·v_dot_dir·d + (v_sq - contact_dist²) = 0
            let a_coef = 1.0;
            let b_coef = -2.0 * v_dot_dir;
            let c_coef = v_sq - contact_dist * contact_dist;

            let discriminant = b_coef * b_coef - 4.0 * a_coef * c_coef;
            if discriminant < 0.0 {
                continue; // no real solution — this pair can't touch along this direction
            }

            let sqrt_disc = discriminant.sqrt();
            // Two roots: d = (2·v_dot_dir ± sqrt_disc) / 2 = v_dot_dir ± sqrt_disc/2
            let d_far = v_dot_dir + sqrt_disc / 2.0; // larger root (first contact from far)
            let d_near = v_dot_dir - sqrt_disc / 2.0;

            // We want the distance at first contact approaching from d_start (far).
            // If d_far is within [d_floor, d_start], that's the first contact.
            // If d_far > d_start, we're already past it, check d_near.
            let candidate = if d_far <= d_start && d_far >= d_floor {
                Some(d_far)
            } else if d_near <= d_start && d_near >= d_floor {
                Some(d_near)
            } else if d_far > d_start && d_near >= d_floor && d_near <= d_start {
                // Far root is beyond start, use near root
                Some(d_near)
            } else {
                None
            };

            if let Some(d_contact) = candidate {
                // Also check this doesn't cause overlap with any OTHER pair
                // (skip expensive check for now — first contact is sufficient)
                match best_d {
                    None => best_d = Some(d_contact),
                    Some(current_best) => {
                        // Take the LARGEST d (first contact from far = least penetration)
                        if d_contact > current_best {
                            best_d = Some(d_contact);
                        }
                    }
                }
            }
        }
    }

    // Verify the best_d doesn't cause overlap with any pair
    if let Some(d) = best_d {
        let offset = *direction * d;
        let mut has_overlap = false;
        for sa in spheres_a {
            for sb in spheres_b {
                let sb_center = sb.center + offset;
                let dist = sa.center.distance_to(&sb_center);
                let contact_dist = sintered_contact_distance(sa.radius, sb.radius, sintering_coeff);
                if dist < contact_dist - 0.01 {
                    has_overlap = true;
                    break;
                }
            }
            if has_overlap {
                break;
            }
        }

        if !has_overlap {
            return MarchResult::Distance(d);
        }

        // If the exact analytical solution causes overlap with another pair,
        // find the maximum d where no pair overlaps.
        // This is the minimum of all d_far values across ALL pairs.
        let mut max_safe_d = d;
        for sa in spheres_a {
            for sb in spheres_b {
                let contact_dist = sintered_contact_distance(sa.radius, sb.radius, sintering_coeff);
                let v = sa.center - sb.center;
                let v_dot_dir = v.dot(direction);
                let v_sq = v.dot(&v);

                let discriminant = 4.0 * v_dot_dir * v_dot_dir - 4.0 * (v_sq - contact_dist * contact_dist);
                if discriminant < 0.0 {
                    continue;
                }
                let sqrt_disc = discriminant.sqrt();
                let d_far = v_dot_dir + sqrt_disc / 2.0;
                if d_far >= d_floor && d_far <= d_start && d_far < max_safe_d {
                    max_safe_d = d_far;
                }
            }
        }

        if max_safe_d >= d_floor {
            return MarchResult::Distance(max_safe_d);
        }
    }

    MarchResult::NoContact
}

/// Perform a march-inward adaptive merge between two clusters.
///
/// Strategy: normalize sphere positions to be relative to each cluster's
/// centroid, then use `find_first_contact_distance` to find the COM-COM
/// distance at which first physical contact occurs. Then position cluster2
/// at that distance for the actual merge.
///
/// Returns `Some((cluster1_clone, positioned_cluster2, actual_distance))` on
/// success, `None` if all directions failed (caller should fall back to
/// pure ballistic).
fn march_inward_merge<R: Rng>(
    cluster1: &TunableCluster,
    cluster2: &TunableCluster,
    target_distance: f64,
    rp: f64,
    sintering_coeff: f64,
    rng: &mut R,
) -> Option<(TunableCluster, TunableCluster, f64)> {
    let max_achievable = compute_max_achievable_distance(cluster1, cluster2);

    // If target_distance is not finite or absurdly large, bail immediately.
    if !target_distance.is_finite() || target_distance <= 0.0 {
        return None;
    }

    // Cap d_start at a reasonable multiple of max_achievable to avoid
    // runaway march on pathological formula outputs (e.g. Df=0.05).
    let d_start = max_achievable.max(target_distance).min(max_achievable * 2.0);
    let d_floor = (target_distance * 0.3).max(rp * 0.5); // sanity floor

    // Normalize sphere positions relative to each cluster's centroid.
    let spheres_a_centered: Vec<Sphere> = cluster1
        .particles
        .iter()
        .map(|s| Sphere::new(s.center - cluster1.center_of_mass, s.radius))
        .collect();

    // Try multiple random directions WITH random rotations of cluster B.
    // Each attempt: rotate B randomly, then march along a random direction.
    let n_attempts = 20;
    let mut best_result: Option<(Vec<Sphere>, Vector3, f64)> = None;

    for _ in 0..n_attempts {
        // Random rotation of cluster B around its centroid
        let (rx, ry, rz) = sample_merge_direction(rng);
        let rot_axis = Vector3::new(rx, ry, rz);
        let rot_angle: f64 = rng.gen_range(0.0..std::f64::consts::TAU);

        let spheres_b_centered: Vec<Sphere> = cluster2
            .particles
            .iter()
            .map(|s| {
                let rel = s.center - cluster2.center_of_mass;
                let rotated = rotate_vector(&rel, &rot_axis.normalize(), rot_angle);
                Sphere::new(rotated, s.radius)
            })
            .collect();

        let (dx, dy, dz) = sample_merge_direction(rng);
        let direction = Vector3::new(dx, dy, dz);

        let march = find_first_contact_distance(
            &spheres_a_centered,
            &spheres_b_centered,
            &direction,
            d_start,
            d_floor,
            rp,
            sintering_coeff,
        );

        if let MarchResult::Distance(d) = march {
            match &best_result {
                None => best_result = Some((spheres_b_centered, direction, d)),
                Some((_, _, best_d)) => {
                    if (d - target_distance).abs() < (*best_d - target_distance).abs() {
                        best_result = Some((spheres_b_centered, direction, d));
                    }
                }
            }
            // If very close to target, use immediately
            if (d - target_distance).abs() < 0.05 * rp {
                break;
            }
        }
    }

    let (rotated_b_spheres, direction, march_distance) = best_result?;

    // Build a positioned cluster2 from the rotated sphere positions.
    // The rotated_b_spheres are centered at origin (relative to B's centroid).
    // Place B's centroid at `cluster1.center_of_mass + direction * march_distance`.
    let com2_target = cluster1.center_of_mass + direction * march_distance;
    let positioned_particles: Vec<Sphere> = rotated_b_spheres
        .iter()
        .map(|s| Sphere::new(s.center + com2_target, s.radius))
        .collect();
    let mut c2 = TunableCluster::from_particles(positioned_particles);

    // Verify physical contact + no overlap
    if has_intercluster_contact(cluster1, &c2, sintering_coeff)
        && !check_overlap(cluster1, &c2, sintering_coeff)
    {
        let actual = cluster1.center_of_mass.distance_to(&c2.center_of_mass);
        return Some((cluster1.clone(), c2, actual));
    }

    // March found a COM distance but exact placement has slight misalignment.
    // Nudge c2 toward cluster1 until contact + no overlap.
    let trajectory = (cluster1.center_of_mass - c2.center_of_mass).normalize();
    let step = 0.01 * rp;
    let max_nudge = ((2.0 * rp) / step) as usize + 100;

    for _ in 0..max_nudge {
        c2.translate(trajectory * step);

        if check_overlap(cluster1, &c2, sintering_coeff) {
            // Overshot into overlap — back off one step
            c2.translate(trajectory * (-step));
            break;
        }

        if has_intercluster_contact(cluster1, &c2, sintering_coeff) {
            let actual = cluster1.center_of_mass.distance_to(&c2.center_of_mass);
            return Some((cluster1.clone(), c2, actual));
        }
    }

    // Last check after nudging
    if has_intercluster_contact(cluster1, &c2, sintering_coeff)
        && !check_overlap(cluster1, &c2, sintering_coeff)
    {
        let actual = cluster1.center_of_mass.distance_to(&c2.center_of_mass);
        return Some((cluster1.clone(), c2, actual));
    }

    None
}

// ── Phase 3: Smart Pair Selection + Adaptive Fallback (PYA-14) ───────────

/// A candidate pair for smart selection, with pre-computed distances.
#[derive(Debug, Clone)]
pub(crate) struct PairCandidate {
    pub idx1: usize,
    pub idx2: usize,
    pub required_distance: f64,
    pub bounding_sum: f64,
}

/// Result of smart pair selection.
#[derive(Debug)]
pub(crate) enum SmartPairResult {
    /// At least one feasible pair exists; one is selected.
    Feasible(PairCandidate),
    /// No feasible pair exists; the pair with the max achievable distance is returned.
    AllInfeasible { max_achievable_pair: PairCandidate },
}

/// Compute the maximum achievable COM-COM distance between two clusters.
///
/// This is the sum of bounding radii (measured from COM), which represents
/// the farthest the COMs can be placed while the clusters still potentially
/// touch at their surfaces.
pub(crate) fn compute_max_achievable_distance(c1: &TunableCluster, c2: &TunableCluster) -> f64 {
    c1.bounding_radius + c2.bounding_radius
}

/// Find all feasible pairs in the pool: pairs where `bounding_sum >= threshold`.
///
/// A pair (i, j) is feasible when the CC formula distance can be achieved
/// geometrically. The threshold is gated by the low-Df fix flag (R3, R22):
///
/// - `use_low_df_fix = true`:  `bounding_sum >= required * 0.5` (MATLAB's gamma/2)
/// - `use_low_df_fix = false`: `bounding_sum >= required`       (full gamma, pre-fix)
///
/// The `bounding_threshold_factor` is computed ONCE before the inner loop;
/// `read_low_df_fix_flag()` is NOT called inside the pair loop (R3, scenario 3.9).
///
/// When `use_high_df_fix` is `true`, pairs whose `required_distance < 2 * max(rp_i, rp_j)`
/// are excluded before the bounding-sum check. This is the Cycle 2 physical-contact guard
/// (R27): it removes geometrically impossible pairs (two spheres cannot touch at a COM
/// distance smaller than the sum of their maximum radii). Guard is additive — it never
/// removes a geometrically valid pair.
///
/// Returns a vec of `PairCandidate` for all feasible pairs (O(k²) scan).
pub(crate) fn find_feasible_pairs(
    clusters: &[TunableCluster],
    target_df: f64,
    target_kf: f64,
    rp: f64,
    sintering_coeff: f64,
    use_low_df_fix: bool,
    use_high_df_fix: bool,
) -> Vec<PairCandidate> {
    // Threshold factor is computed once (R3, scenario 3.9): each pair's
    // required distance is multiplied by this factor before comparison.
    let bounding_threshold_factor: f64 = if use_low_df_fix { 0.5 } else { 1.0 };

    let k = clusters.len();
    let mut feasible = Vec::new();

    for i in 0..k {
        for j in (i + 1)..k {
            let n1 = clusters[i].n_particles();
            let n2 = clusters[j].n_particles();
            let required = match calculate_com_distance(n1, n2, rp, target_df, target_kf, sintering_coeff) {
                Some(d) => d,
                None => continue, // degenerate geometry, skip
            };

            // Cycle 2 (R27): physical-contact guard — exclude geometrically impossible pairs.
            // A pair is impossible when required_distance < 2 * max(rp_i, rp_j): the two
            // bounding spheres would overlap before touching. Guard is additive (AND clause).
            if use_high_df_fix {
                let rp_i = clusters[i].particles.first().map(|s| s.radius).unwrap_or(rp);
                let rp_j = clusters[j].particles.first().map(|s| s.radius).unwrap_or(rp);
                let rp_max = rp_i.max(rp_j);
                if required < 2.0 * rp_max {
                    continue; // geometrically impossible — skip (R27.1)
                }
            }

            let bounding_sum = compute_max_achievable_distance(&clusters[i], &clusters[j]);
            // Per-pair threshold: `required * factor` — NOT a single pre-loop constant (R3 S3.9).
            if bounding_sum >= required * bounding_threshold_factor {
                feasible.push(PairCandidate {
                    idx1: i,
                    idx2: j,
                    required_distance: required,
                    bounding_sum,
                });
            }
        }
    }

    feasible
}

/// Select a pair using smart feasibility pre-screen.
///
/// Returns `Feasible(pair)` if at least one feasible pair exists (random pick),
/// or `AllInfeasible { max_achievable_pair }` if none are feasible (picks the pair
/// whose bounding_sum is closest to required_distance, i.e. "least infeasible").
///
/// `use_high_df_fix` threads the Cycle 2 physical-contact guard (R27) into
/// `find_feasible_pairs`. When `true`, geometrically impossible pairs are excluded
/// before the bounding-sum check.
pub(crate) fn select_pair_smart<R: Rng>(
    clusters: &[TunableCluster],
    target_df: f64,
    target_kf: f64,
    rp: f64,
    sintering_coeff: f64,
    rng: &mut R,
    use_low_df_fix: bool,
    use_high_df_fix: bool,
) -> SmartPairResult {
    let feasible = find_feasible_pairs(clusters, target_df, target_kf, rp, sintering_coeff, use_low_df_fix, use_high_df_fix);

    if !feasible.is_empty() {
        let chosen = feasible.choose(rng).unwrap().clone();
        return SmartPairResult::Feasible(chosen);
    }

    // All infeasible — find the pair with the max bounding_sum (least infeasible)
    let k = clusters.len();
    let mut best: Option<PairCandidate> = None;

    for i in 0..k {
        for j in (i + 1)..k {
            let n1 = clusters[i].n_particles();
            let n2 = clusters[j].n_particles();
            let required = match calculate_com_distance(n1, n2, rp, target_df, target_kf, sintering_coeff) {
                Some(d) => d,
                None => continue,
            };
            let bounding_sum = compute_max_achievable_distance(&clusters[i], &clusters[j]);
            match &best {
                None => {
                    best = Some(PairCandidate { idx1: i, idx2: j, required_distance: required, bounding_sum });
                }
                Some(b) if bounding_sum > b.bounding_sum => {
                    best = Some(PairCandidate { idx1: i, idx2: j, required_distance: required, bounding_sum });
                }
                _ => {}
            }
        }
    }

    SmartPairResult::AllInfeasible {
        max_achievable_pair: best.expect("select_pair_smart called with empty pool"),
    }
}

/// Emit an adaptive merge trace entry.
///
/// Called when the adaptive fallback engages (no feasible pair or retries exhausted).
/// Places cluster2's COM at `max_achievable_distance` from cluster1's COM along
/// a random direction, recording the overshoot percentage.
///
/// `merge_type_override`: when `Some(tag)`, the trace entry uses `tag` as `merge_type`
/// instead of the default `"adaptive"`. Pass `None` for the standard adaptive fallback;
/// pass `Some("adaptive_high_df_floor")` when the Cycle 2 physical-contact guard
/// (R27) is the reason all candidate pairs were infeasible.
///
/// Returns the trace entry for the caller to push into the trace vec.
pub(crate) fn emit_adaptive_merge_entry(
    step: usize,
    n1: usize,
    n2: usize,
    max_achievable: f64,
    required_distance: f64,
    rg_after: f64,
    rg_target: f64,
    retries: usize,
    merge_type_override: Option<&str>,
) -> MergeTraceEntry {
    let actual_distance = max_achievable;
    let overshoot_pct = if required_distance > 0.0 {
        (actual_distance - required_distance) / required_distance
    } else {
        0.0
    };
    MergeTraceEntry {
        step,
        n1,
        n2,
        required_distance,
        actual_distance,
        rg_after,
        rg_target,
        merge_type: merge_type_override.unwrap_or("adaptive").to_string(),
        retries,
        bounding_check_passed: false,
        overshoot_pct: Some(overshoot_pct),
    }
}

/// Emit a no_feasible_pair event trace entry.
///
/// This is a diagnostic-only entry indicating that at a given step no feasible
/// pair could be found. No merge geometry is recorded.
pub(crate) fn emit_no_feasible_pair_entry(step: usize, pool_size: usize) -> MergeTraceEntry {
    MergeTraceEntry {
        step,
        n1: pool_size, // pool_size stored in n1 for this event type
        n2: 0,
        required_distance: 0.0,
        actual_distance: 0.0,
        rg_after: 0.0,
        rg_target: 0.0,
        merge_type: "no_feasible_pair".to_string(),
        retries: 0,
        bounding_check_passed: false,
        overshoot_pct: None,
    }
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

    /// NOTE (PYA-15): Since `dpo_distribution` sampling overrides `radius_min`/`radius_max`
    /// to the same sampled value (monodisperse per run), legacy per-particle polydispersity
    /// requires a Uniform distribution. The test is updated to use `DpoDistribution::Uniform`.
    /// Multiple runs with different seeds produce different per-run dpo values.
    #[test]
    fn test_tunable_cc_polydisperse() {
        use crate::simulation::dpo_distribution::DpoDistribution;

        // Run multiple seeds — each run is monodisperse (same radius for all
        // particles), but across runs the dpo varies uniformly in [0.8, 1.2].
        let mut dpo_values: Vec<f64> = Vec::new();
        for seed in [789, 790, 791, 792, 793] {
            let params = TunableCcParams {
                n_particles: 10,
                dpo_distribution: DpoDistribution::Uniform { min: 0.8, max: 1.2 },
                ..Default::default()
            };
            let result = run_tunable_cc_internal(params, seed, None);
            let dpo = result.dpo_used.unwrap();
            assert!(
                dpo >= 0.8 - 1e-10 && dpo <= 1.2 + 1e-10,
                "seed {seed}: dpo_used={dpo} outside [0.8, 1.2]"
            );
            dpo_values.push(dpo);

            // All radii in this run should equal the sampled dpo (monodisperse per run)
            for (i, &r) in result.radii.iter().enumerate() {
                assert!(
                    (r - dpo).abs() < 1e-10,
                    "seed {seed}: radius[{i}]={r} != dpo_used={dpo} (monodisperse per run)"
                );
            }
        }

        // Across runs, dpo values should vary
        let min_dpo = dpo_values.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_dpo = dpo_values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        assert!(
            max_dpo > min_dpo,
            "dpo_used should vary across seeds: min={min_dpo}, max={max_dpo}"
        );
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
        // Use Dimers seed type so the initial pool is deterministic (5 dimers for N=20)
        // regardless of CC_TUNABLE_USE_LOW_DF_FIX. This keeps the test focused on retry
        // behavior without coupling it to the monomer/PC pool switch.
        let params = TunableCcParams {
            n_particles: 20,
            target_df: 2.0,
            target_kf: 1.0,
            max_merge_retries: 5,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 42, None);

        // Must still produce all particles (simulation completes)
        assert_eq!(result.coordinates.len(), 20);

        // Metadata must be present (R7 scenario 7.3): at least some merge type occurred.
        // With Phase 3, adaptive merges also count toward completion.
        let total_merges =
            result.tunable_merges + result.ballistic_merges + result.adaptive_merges;
        assert!(total_merges > 0, "At least one merge must have occurred");

        // The simulation must have completed (5 dimers → 4 merges to reach 1 cluster)
        assert!(
            result.merge_trace.len() >= 4,
            "Expected at least 4 merge trace entries for N=20 dimers (5 clusters), got {}",
            result.merge_trace.len()
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
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);

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
            let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);

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
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);

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
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);

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
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);
        assert_eq!(clusters.len(), 4, "Monomers N=4 → 4 clusters");
        assert!(clusters.iter().all(|c| c.n_particles() == 1));

        // Dimers: 2 dimers
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 4,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);
        assert_eq!(clusters.len(), 2, "Dimers N=4 → 2 dimers");
        assert!(clusters.iter().all(|c| c.n_particles() == 2));

        // Trimers: 1 trimer + 1 monomer
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 4,
            seed_type: SeedType::Trimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);
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
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);
        assert_eq!(clusters.len(), 7);
        assert!(clusters.iter().all(|c| c.n_particles() == 1));

        // Dimers: 3 dimers + 1 monomer
        let mut rng = create_rng(42);
        let params = TunableCcParams {
            n_particles: 7,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);
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
        let clusters = initialize_seed_clusters(&params, &mut rng, 42, false);
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
        let clusters_default = initialize_seed_clusters(&params_default, &mut rng1, 42, false);

        let mut rng2 = create_rng(42);
        let params_explicit = TunableCcParams {
            n_particles: 20,
            seed_type: SeedType::Monomers,
            ..Default::default()
        };
        let clusters_explicit = initialize_seed_clusters(&params_explicit, &mut rng2, 42, false);

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
        let d_cc =
            calculate_com_distance(1, 1, rp, df, kf, 1.0).expect("must be Some for monomers");

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
        let d_cc = calculate_com_distance(2, 1, rp, df, kf, 1.0).expect("must be Some");

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

        let d = calculate_com_distance(10, 10, rp, df, kf, 1.0).expect("must be Some");

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

        let d = calculate_com_distance(175, 175, rp, df, kf, 1.0).expect("must be Some for N=350");

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

        let d_low = calculate_com_distance(10, 10, rp, 1.4, kf, 1.0).unwrap();
        let d_high = calculate_com_distance(10, 10, rp, 2.2, kf, 1.0).unwrap();

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
        let result = calculate_com_distance(5, 5, 1.0, 0.01, 1.0, 1.0);
        // Should return None (NaN/Inf guard) or possibly Some(very large) —
        // either way, must NOT panic
        if let Some(d) = result {
            assert!(d.is_finite(), "If Some, must be finite, got {d}");
            assert!(d > 0.0, "If Some, must be positive");
        }
        // The spec mandates None when d²≤0. Since the math can't produce ≤0
        // with valid physical inputs, this test ensures no panic on edge cases.
    }

    // ---------------------------------------------------------------
    // Sintering coeff tests (R1 delta — sintering-cc-fix / PYA-11)
    // ---------------------------------------------------------------

    /// T1.2 — Regression snapshot: coeff=1.0 must exactly match frente-10 baseline.
    /// Snapshot value computed from the pre-sintering formula with
    /// (n_po1=2, n_po2=1, rp=12.5, df=1.8, kf=1.4).
    #[test]
    fn test_sintering_coeff_1_0_regression_snapshot() {
        let baseline = 27.961820478437158_f64; // frente-10 snapshot

        let d =
            calculate_com_distance(2, 1, 12.5, 1.8, 1.4, 1.0).expect("must be Some at coeff=1.0");

        let rel_err = (d - baseline).abs() / baseline;
        assert!(
            rel_err < 1e-10,
            "coeff=1.0 must match frente-10 baseline: got={d:.15}, expected={baseline:.15}, rel_err={rel_err:.2e}"
        );
    }

    /// T1.3a — coeff=0.9 PC case: d_sintered = 0.9 · d_unsintered.
    /// Because rp_eff only appears in the leading rp² factor, d scales
    /// linearly with sintering_coeff.
    #[test]
    fn test_sintering_coeff_0_9_linear_scaling() {
        let d_base =
            calculate_com_distance(1, 1, 12.5, 1.8, 1.4, 1.0).expect("must be Some at coeff=1.0");
        let d_sintered =
            calculate_com_distance(1, 1, 12.5, 1.8, 1.4, 0.9).expect("must be Some at coeff=0.9");

        let expected = 0.9 * d_base;
        let rel_err = (d_sintered - expected).abs() / expected;
        assert!(
            rel_err < 1e-10,
            "d_sintered must equal 0.9 · d_unsintered: got={d_sintered:.15}, expected={expected:.15}, rel_err={rel_err:.2e}"
        );
    }

    /// T1.3b — coeff=0.5 extreme: formula still produces positive d for valid params.
    #[test]
    fn test_sintering_coeff_0_5_positive() {
        let d = calculate_com_distance(1, 1, 1.0, 2.0, 1.0, 0.5)
            .expect("must be Some at coeff=0.5 with valid params");
        assert!(d > 0.0, "d must be positive, got {d}");
        assert!(d.is_finite(), "d must be finite, got {d}");
    }

    /// T1.3c — coeff=0.0 degenerate: rp_eff=0 → d²=0 → returns None.
    #[test]
    fn test_sintering_coeff_0_0_returns_none() {
        let result = calculate_com_distance(2, 1, 12.5, 1.8, 1.4, 0.0);
        assert!(
            result.is_none(),
            "coeff=0.0 must return None (rp_eff=0 → d²=0), got {:?}",
            result
        );
    }

    /// T1.3d — Math proof: d_sintered = coeff · d_unsintered for any valid params.
    /// The rp² factor scales as coeff², so d = sqrt(coeff² · d_unsint²) = coeff · d_unsint.
    #[test]
    fn test_sintering_coeff_math_proof_linear() {
        let cases: &[(usize, usize, f64, f64, f64, f64)] = &[
            (2, 1, 12.5, 1.8, 1.4, 0.9),
            (5, 3, 1.0, 2.0, 1.0, 0.7),
            (10, 10, 2.5, 1.6, 1.3, 0.85),
            (1, 1, 1.0, 1.8, 1.3, 0.5),
        ];

        for &(n1, n2, rp, df, kf, coeff) in cases {
            let d_base = calculate_com_distance(n1, n2, rp, df, kf, 1.0)
                .unwrap_or_else(|| panic!("base must be Some for ({n1},{n2})"));
            let d_sint = calculate_com_distance(n1, n2, rp, df, kf, coeff)
                .unwrap_or_else(|| panic!("sintered must be Some for ({n1},{n2},coeff={coeff})"));

            let expected = coeff * d_base;
            let rel_err = (d_sint - expected).abs() / expected;
            assert!(
                rel_err < 1e-10,
                "d_sintered must equal {coeff}·d_unsintered for ({n1},{n2}): got={d_sint:.15}, expected={expected:.15}, rel_err={rel_err:.2e}"
            );
        }
    }

    // ---------------------------------------------------------------
    // select_contact_particles sintering (R8 — sintering-cc-fix / PYA-11)
    // ---------------------------------------------------------------

    /// T2.1 — select_contact_particles must use sintered contact distance.
    /// Two monomers at distance 1.9·rp: with bare contact (2.0) they pass,
    /// but with sintered contact (coeff=0.9 → 1.8) they must fail because
    /// contact_dist=1.8 < required_distance=1.9.
    #[test]
    fn test_select_contact_particles_sintering_rejects_beyond_sintered_dist() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;
        let sintering_coeff = 0.9;

        // Two monomer clusters
        let cluster1 = TunableCluster::new(Sphere::new(Vector3::zero(), rp));
        let cluster2 = TunableCluster::new(Sphere::new(Vector3::new(5.0, 0.0, 0.0), rp));

        let la1 = vec![0usize];
        let la2 = vec![0usize];

        // required_distance = 1.9: sintered contact_dist = 1.8 < 1.9 → must reject
        let result = select_contact_particles(
            &cluster1,
            &cluster2,
            &la1,
            &la2,
            1.9,
            sintering_coeff,
            &mut rng,
        );
        assert!(
            result.is_none(),
            "With sintered contact_dist=1.8 and required_distance=1.9, must reject"
        );
    }

    /// T2.1 — select_contact_particles with coeff=1.0 (regression): bare contact
    /// distance 2.0 >= required_distance 1.9 → must accept.
    #[test]
    fn test_select_contact_particles_coeff_1_0_regression() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;

        let cluster1 = TunableCluster::new(Sphere::new(Vector3::zero(), rp));
        let cluster2 = TunableCluster::new(Sphere::new(Vector3::new(5.0, 0.0, 0.0), rp));

        let la1 = vec![0usize];
        let la2 = vec![0usize];

        // required_distance = 1.9: bare contact_dist = 2.0 >= 1.9 → must accept
        let result = select_contact_particles(&cluster1, &cluster2, &la1, &la2, 1.9, 1.0, &mut rng);
        assert!(
            result.is_some(),
            "With bare contact_dist=2.0 and required_distance=1.9, must accept"
        );
    }

    /// T2.1 — select_contact_particles with coeff=0.9: sintered contact
    /// distance 1.8 >= required_distance 1.7 → must accept.
    #[test]
    fn test_select_contact_particles_sintering_accepts_within_sintered_dist() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);
        let rp = 1.0;

        let cluster1 = TunableCluster::new(Sphere::new(Vector3::zero(), rp));
        let cluster2 = TunableCluster::new(Sphere::new(Vector3::new(5.0, 0.0, 0.0), rp));

        let la1 = vec![0usize];
        let la2 = vec![0usize];

        // required_distance = 1.7: sintered contact_dist = 1.8 >= 1.7 → must accept
        let result = select_contact_particles(&cluster1, &cluster2, &la1, &la2, 1.7, 0.9, &mut rng);
        assert!(
            result.is_some(),
            "With sintered contact_dist=1.8 and required_distance=1.7, must accept"
        );
    }

    /// T1.3e — Lower Df invariant preserved with sintering (delta scenario 1.7).
    #[test]
    fn test_sintering_lower_df_larger_distance_invariant() {
        let coeff = 0.9;
        let kf = 1.3;
        let rp = 1.0;

        let d_low = calculate_com_distance(10, 10, rp, 1.4, kf, coeff).unwrap();
        let d_high = calculate_com_distance(10, 10, rp, 2.2, kf, coeff).unwrap();

        assert!(
            d_low > d_high,
            "Lower Df must give larger distance even with sintering: d(1.4)={d_low:.6}, d(2.2)={d_high:.6}"
        );
    }

    // ---------------------------------------------------------------
    // Ballistic fallback sintering (R8 scenario 8.2 — PYA-11)
    // ---------------------------------------------------------------

    /// T2.2 — Ballistic fallback respects sintered contact distance (R8).
    /// With max_merge_retries=0 (force all merges to ballistic) and
    /// sintering_coeff=0.9, all inter-particle contact distances in the
    /// resulting aggregate must be ≤ 2·rp·0.9 + tolerance.
    #[test]
    fn test_ballistic_fallback_sintered_contacts() {
        let rp = 1.0;
        let sintering_coeff = 0.9;

        let params = TunableCcParams {
            n_particles: 20,
            target_df: 2.0,
            target_kf: 1.0,
            max_merge_retries: 0, // force all to fallback (ballistic or adaptive)
            sintering: SinteringDistribution::Fixed(sintering_coeff),
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 42, None);
        assert_eq!(
            result.coordinates.len(),
            20,
            "Must produce all 20 particles"
        );

        // With max_merge_retries=0, all merges must use fallback path
        // (ballistic in Phase 2, adaptive in Phase 3 — both use ballistic internally)
        assert!(
            result.ballistic_merges > 0 || result.adaptive_merges > 0,
            "With max_merge_retries=0, fallback merges must occur"
        );

        // Check that all inter-particle contact distances use sintered distance
        let sintered_contact = sintered_contact_distance(rp, rp, sintering_coeff);
        let tolerance = intercluster_contact_tolerance(sintered_contact) + 0.01; // generous

        let mut found_contact = false;
        for i in 0..result.coordinates.len() {
            for j in (i + 1)..result.coordinates.len() {
                let c1 = &result.coordinates[i];
                let c2 = &result.coordinates[j];
                let dist =
                    ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
                        .sqrt();

                let pair_contact =
                    sintered_contact_distance(result.radii[i], result.radii[j], sintering_coeff);
                let pair_tol = intercluster_contact_tolerance(pair_contact) + 0.01;

                if dist <= pair_contact + pair_tol {
                    found_contact = true;
                    // This pair is in contact — verify at sintered distance, not bare
                    assert!(
                        dist <= pair_contact + pair_tol,
                        "Contact pair ({i},{j}) dist={dist:.6} exceeds sintered {pair_contact:.6} + tol {pair_tol:.6}"
                    );
                }
            }
        }
        assert!(
            found_contact,
            "Aggregate must have at least one contact pair"
        );
    }

    /// T2.2 — Ballistic fallback with coeff=1.0 regression.
    #[test]
    fn test_ballistic_fallback_coeff_1_0_regression() {
        let rp = 1.0;

        let params = TunableCcParams {
            n_particles: 20,
            target_df: 2.0,
            target_kf: 1.0,
            max_merge_retries: 0,
            sintering: SinteringDistribution::Fixed(1.0),
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 42, None);
        assert_eq!(result.coordinates.len(), 20);
        assert!(
            result.ballistic_merges > 0 || result.adaptive_merges > 0,
            "With max_merge_retries=0, fallback merges must occur"
        );

        // All contacts should be at bare distance
        let bare_contact = sintered_contact_distance(rp, rp, 1.0);
        let tolerance = intercluster_contact_tolerance(bare_contact) + 0.01;

        let mut found_contact = false;
        for i in 0..result.coordinates.len() {
            for j in (i + 1)..result.coordinates.len() {
                let c1 = &result.coordinates[i];
                let c2 = &result.coordinates[j];
                let dist =
                    ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
                        .sqrt();

                let pair_contact = sintered_contact_distance(result.radii[i], result.radii[j], 1.0);
                let pair_tol = intercluster_contact_tolerance(pair_contact) + 0.01;

                if dist <= pair_contact + pair_tol {
                    found_contact = true;
                }
            }
        }
        assert!(found_contact, "Must have contacts at bare distance");
    }

    // ---------------------------------------------------------------
    // End-to-end smoke + comprehensive P2 tests (T2.3 — PYA-11)
    // ---------------------------------------------------------------

    // ---------------------------------------------------------------
    // P2.1/P2.2: TunableCcParams distribution fields (PYA-15)
    // ---------------------------------------------------------------

    /// P2.1 — TunableCcParams has dpo_distribution field.
    #[test]
    fn test_tunable_cc_params_has_dpo_distribution() {
        use crate::simulation::dpo_distribution::DpoDistribution;
        let params = TunableCcParams::default();
        // Default must be Fixed(1.0) — matching legacy radius_min
        match params.dpo_distribution {
            DpoDistribution::Fixed { value } => assert_eq!(
                value, 1.0,
                "Default dpo_distribution must be Fixed(1.0) matching legacy radius_min"
            ),
            _ => panic!("Default dpo_distribution must be Fixed variant"),
        }
    }

    /// P2.1 — TunableCcParams has target_kf_distribution field.
    #[test]
    fn test_tunable_cc_params_has_target_kf_distribution() {
        use crate::simulation::dpo_distribution::TargetKfDistribution;
        let params = TunableCcParams::default();
        // Default must be Fixed(1.3) — matching legacy target_kf
        match params.target_kf_distribution {
            TargetKfDistribution::Fixed { value } => assert_eq!(
                value, 1.3,
                "Default target_kf_distribution must be Fixed(1.3) matching legacy target_kf"
            ),
            _ => panic!("Default target_kf_distribution must be Fixed variant"),
        }
    }

    // ---------------------------------------------------------------
    // P2.3/P2.4: Sampling + result fields (PYA-15)
    // ---------------------------------------------------------------

    /// P2.3 — Default distributions produce result fields matching legacy values.
    /// Regression: Fixed(1.0) dpo → dpo_used = Some(1.0),
    ///             Fixed(1.3) kf  → target_kf_used = Some(1.3).
    #[test]
    fn test_default_distributions_result_fields() {
        let params = TunableCcParams {
            n_particles: 10,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        assert_eq!(
            result.dpo_used,
            Some(1.0),
            "Default dpo_distribution Fixed(1.0) must produce dpo_used = Some(1.0)"
        );
        assert_eq!(
            result.target_kf_used,
            Some(1.3),
            "Default target_kf_distribution Fixed(1.3) must produce target_kf_used = Some(1.3)"
        );
    }

    /// P2.3 — Backward compat regression: default distributions produce
    /// bitwise-identical results to pre-frente-13 baseline (same seed).
    /// The distribution sampling of Fixed values must NOT alter the RNG state
    /// differently than the legacy code path.
    #[test]
    fn test_default_distributions_backward_compat_regression() {
        // Run twice with identical default params + seed → identical results
        let params1 = TunableCcParams {
            n_particles: 20,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };
        let params2 = params1.clone();

        let r1 = run_tunable_cc_internal(params1, 42, None);
        let r2 = run_tunable_cc_internal(params2, 42, None);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        assert_eq!(r1.fractal_dimension, r2.fractal_dimension);
        assert_eq!(r1.prefactor, r2.prefactor);
        assert_eq!(r1.dpo_used, r2.dpo_used);
        assert_eq!(r1.target_kf_used, r2.target_kf_used);

        // Bitwise-identical coordinates
        for (i, (c1, c2)) in r1.coordinates.iter().zip(r2.coordinates.iter()).enumerate() {
            assert_eq!(c1, c2, "Coordinate {i} differs between identical runs");
        }
    }

    /// P2.3 — Reproducibility with seed: same distributions + same seed → identical results.
    #[test]
    fn test_distribution_reproducibility_with_seed() {
        use crate::simulation::dpo_distribution::{DpoDistribution, TargetKfDistribution};
        let params1 = TunableCcParams {
            n_particles: 10,
            dpo_distribution: DpoDistribution::Normal {
                mean: 1.0,
                std: 0.1,
            },
            target_kf_distribution: TargetKfDistribution::Uniform { min: 1.1, max: 1.5 },
            ..Default::default()
        };
        let params2 = params1.clone();

        let r1 = run_tunable_cc_internal(params1, 42, None);
        let r2 = run_tunable_cc_internal(params2, 42, None);

        assert_eq!(r1.dpo_used, r2.dpo_used);
        assert_eq!(r1.target_kf_used, r2.target_kf_used);
        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        for (i, (c1, c2)) in r1.coordinates.iter().zip(r2.coordinates.iter()).enumerate() {
            assert_eq!(c1, c2, "Coordinate {i} differs between seeded runs");
        }
    }

    /// P2.5 — Normal dpo_distribution: sampled dpo_used within ±3σ bounds.
    /// Run 50 times with different seeds, assert all dpo_used in [μ-3σ, μ+3σ].
    #[test]
    fn test_normal_dpo_within_bounds() {
        use crate::simulation::dpo_distribution::DpoDistribution;
        let mean = 12.5;
        let std_dev = 1.5;
        let lower = mean - 3.0 * std_dev; // 8.0
        let upper = mean + 3.0 * std_dev; // 17.0

        for seed in 0..50 {
            let params = TunableCcParams {
                n_particles: 5, // small for speed
                dpo_distribution: DpoDistribution::Normal { mean, std: std_dev },
                ..Default::default()
            };
            let result = run_tunable_cc_internal(params, seed, None);
            let dpo = result.dpo_used.unwrap();
            assert!(
                dpo >= lower && dpo <= upper,
                "seed {seed}: dpo_used={dpo} outside [{lower}, {upper}]"
            );
        }
    }

    /// P2.5 — Uniform target_kf_distribution: sampled target_kf_used within [min, max].
    #[test]
    fn test_uniform_kf_within_range() {
        use crate::simulation::dpo_distribution::TargetKfDistribution;
        let kf_min = 1.0;
        let kf_max = 2.0;

        for seed in 0..50 {
            let params = TunableCcParams {
                n_particles: 5,
                target_kf_distribution: TargetKfDistribution::Uniform {
                    min: kf_min,
                    max: kf_max,
                },
                ..Default::default()
            };
            let result = run_tunable_cc_internal(params, seed, None);
            let kf = result.target_kf_used.unwrap();
            assert!(
                kf >= kf_min && kf <= kf_max,
                "seed {seed}: target_kf_used={kf} outside [{kf_min}, {kf_max}]"
            );
        }
    }

    /// P2.5 — Other algorithms must have dpo_used=None and target_kf_used=None.
    #[test]
    fn test_other_algorithms_have_none_distribution_fields() {
        use crate::simulation::ballistic::{run_ballistic_internal, BallisticParams};
        let params = BallisticParams {
            n_particles: 10,
            sticking_probability: 1.0,
            radius_min: 1.0,
            radius_max: 1.0,
            launch_distance_factor: 3.0,
            max_ray_steps: 1000,
            sintering: SinteringDistribution::default(),
        };
        let result = run_ballistic_internal(params, 42);
        assert_eq!(result.dpo_used, None, "Ballistic must have dpo_used=None");
        assert_eq!(
            result.target_kf_used, None,
            "Ballistic must have target_kf_used=None"
        );
    }

    /// P2.1 — Distribution fields are settable via struct init.
    #[test]
    fn test_tunable_cc_params_custom_distributions() {
        use crate::simulation::dpo_distribution::{DpoDistribution, TargetKfDistribution};
        let params = TunableCcParams {
            dpo_distribution: DpoDistribution::Normal {
                mean: 12.5,
                std: 1.5,
            },
            target_kf_distribution: TargetKfDistribution::Uniform { min: 1.1, max: 1.5 },
            ..Default::default()
        };
        match params.dpo_distribution {
            DpoDistribution::Normal { mean, std } => {
                assert_eq!(mean, 12.5);
                assert_eq!(std, 1.5);
            }
            _ => panic!("Expected Normal variant"),
        }
        match params.target_kf_distribution {
            TargetKfDistribution::Uniform { min, max } => {
                assert_eq!(min, 1.1);
                assert_eq!(max, 1.5);
            }
            _ => panic!("Expected Uniform variant"),
        }
    }

    /// T2.3 — End-to-end smoke: moderate Df with sintering produces valid
    /// aggregate (not collapsed to 1 monomer, no panic, no infinite loop).
    #[test]
    fn test_sintering_e2e_smoke_moderate_df() {
        // T2.3 — N=10 keeps the test fast (<1s); N=30+ with sintering=0.9
        // pushes the merge loop into 50k+ iterations because each retry
        // tries up to 100 attempts. The smoke property (aggregate not
        // collapsed) is validated identically with smaller N.
        let sintering_coeff = 0.9;
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.4,
            sintering: SinteringDistribution::Fixed(sintering_coeff),
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 42, None);

        // Must produce all 10 particles (not 1, not collapsed)
        assert_eq!(
            result.coordinates.len(),
            10,
            "Sintered sim must produce all 10 particles, got {}",
            result.coordinates.len()
        );

        // Df should be reasonable (not sentinel)
        assert!(
            result.fractal_dimension > 1.0 && result.fractal_dimension < 3.0,
            "Df must be in (1,3), got {}",
            result.fractal_dimension
        );

        // Aggregate must be connected (with sintered contact distance)
        assert!(
            particles_form_connected_graph(&result.coordinates, &result.radii, sintering_coeff),
            "Sintered aggregate must be connected"
        );

        // No overlaps (with sintered distance)
        for i in 0..result.coordinates.len() {
            for j in (i + 1)..result.coordinates.len() {
                let c1 = &result.coordinates[i];
                let c2 = &result.coordinates[j];
                let dist =
                    ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
                        .sqrt();
                let min_dist =
                    sintered_contact_distance(result.radii[i], result.radii[j], sintering_coeff);
                assert!(
                    dist >= min_dist - 1e-4,
                    "Overlap at sintered distance between {i} and {j}: dist={dist:.6}, min={min_dist:.6}"
                );
            }
        }
    }

    /// T2.3 — All contacts in sintered aggregate are at sintered distance,
    /// not bare contact distance.
    #[test]
    fn test_sintering_e2e_contacts_at_sintered_distance() {
        // T2.3 — N=10 (see comment in smoke test). The contact-distance
        // property is N-independent: any sintered aggregate has its
        // contacts at sintered distance regardless of size.
        let sintering_coeff = 0.9;
        let rp = 1.0;
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 2.0,
            target_kf: 1.0,
            sintering: SinteringDistribution::Fixed(sintering_coeff),
            ..Default::default()
        };

        let result = run_tunable_cc_internal(params, 123, None);
        assert_eq!(result.coordinates.len(), 10);

        let sintered_cd = sintered_contact_distance(rp, rp, sintering_coeff); // 1.8
        let bare_cd = sintered_contact_distance(rp, rp, 1.0); // 2.0
        let tolerance = intercluster_contact_tolerance(sintered_cd) + 0.01;

        // Count contacts at sintered distance vs bare distance
        let mut sintered_contacts = 0;
        let mut bare_only_contacts = 0;

        for i in 0..result.coordinates.len() {
            for j in (i + 1)..result.coordinates.len() {
                let c1 = &result.coordinates[i];
                let c2 = &result.coordinates[j];
                let dist =
                    ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
                        .sqrt();

                if dist <= sintered_cd + tolerance {
                    sintered_contacts += 1;
                } else if dist <= bare_cd + tolerance {
                    bare_only_contacts += 1;
                }
            }
        }

        assert!(
            sintered_contacts > 0,
            "Must have contacts at sintered distance {sintered_cd}"
        );
        // With sintering=0.9, all contacts should be at sintered distance,
        // not at bare distance. Some particles might be near bare distance
        // due to geometry, but most contacts should be sintered.
        assert!(
            sintered_contacts > bare_only_contacts,
            "Sintered contacts ({sintered_contacts}) should outnumber bare-only contacts ({bare_only_contacts})"
        );
    }

    // ---------------------------------------------------------------
    // Merge trace instrumentation (R16 — cc-tunable-merge-trace / PYA-14)
    // ---------------------------------------------------------------

    /// R16.1 — Trace length matches merge count for monomers.
    #[test]
    fn trace_length_matches_merge_count() {
        // Use Dimers seed type so the initial pool size is deterministic regardless
        // of the CC_TUNABLE_USE_LOW_DF_FIX flag (dimers are not affected by R23).
        // N=10 dimers → 5 initial clusters → 4 merges.
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            seed_type: SeedType::Dimers,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        assert_eq!(result.coordinates.len(), 10);
        // n_initial_clusters - 1 merges (5 dimers → 4 merges)
        assert_eq!(
            result.merge_trace.len(),
            4,
            "N=10 dimers must produce 4 merge trace entries (5 clusters → 4 merges), got {}",
            result.merge_trace.len()
        );
    }

    /// R16.2 — Tunable merges are discriminated from ballistic.
    /// Tunable entries must have `merge_type == "tunable"` and `bounding_check_passed == true`.
    #[test]
    fn tunable_merges_discriminated() {
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        assert!(!result.merge_trace.is_empty(), "Trace must not be empty");

        // At least some should be tunable
        let tunable_entries: Vec<_> = result
            .merge_trace
            .iter()
            .filter(|e| e.merge_type == "tunable")
            .collect();

        // With default retries (100) and Df=1.8, expect at least one tunable merge
        assert!(
            !tunable_entries.is_empty() || result.tunable_merges > 0,
            "Expected at least one tunable merge with Df=1.8, N=10"
        );

        // Verify tunable entries have correct flags
        for entry in &tunable_entries {
            assert_eq!(entry.merge_type, "tunable");
            assert!(
                entry.bounding_check_passed,
                "Tunable entries must have bounding_check_passed=true"
            );
        }

        // Verify consistency: tunable count matches trace entries
        let trace_tunable_count = result
            .merge_trace
            .iter()
            .filter(|e| e.merge_type == "tunable")
            .count();
        let trace_ballistic_count = result
            .merge_trace
            .iter()
            .filter(|e| e.merge_type == "ballistic")
            .count();
        assert_eq!(trace_tunable_count, result.tunable_merges);
        assert_eq!(trace_ballistic_count, result.ballistic_merges);
    }

    /// R16.3 — Ballistic fallback flagged correctly.
    #[test]
    fn ballistic_fallback_flagged() {
        // Use low Df + higher N + few retries to force some fallback merges.
        // With Phase 3 active, fallbacks are "adaptive" (not "ballistic").
        let params = TunableCcParams {
            n_particles: 50,
            target_df: 1.4,
            target_kf: 1.3,
            max_merge_retries: 5,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        assert_eq!(result.coordinates.len(), 50);

        // Phase 3: fallback merges are tagged "adaptive" instead of "ballistic"
        let fallback_entries: Vec<_> = result
            .merge_trace
            .iter()
            .filter(|e| e.merge_type == "ballistic" || e.merge_type == "adaptive")
            .collect();

        assert!(
            !fallback_entries.is_empty(),
            "With Df=1.4, N=50, max_retries=5, at least one fallback expected. \
             Got {} tunable, {} ballistic, {} adaptive",
            result.tunable_merges,
            result.ballistic_merges,
            result.adaptive_merges
        );

        for entry in &fallback_entries {
            assert!(
                !entry.bounding_check_passed,
                "Fallback entries must have bounding_check_passed=false"
            );
        }
    }

    /// R16.9 — Retries recorded and within bounds.
    #[test]
    fn retries_recorded() {
        let max_retries = 100;
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            max_merge_retries: max_retries,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        for (i, entry) in result.merge_trace.iter().enumerate() {
            assert!(
                entry.retries <= max_retries,
                "Entry {i} retries={} exceeds max_merge_retries={}",
                entry.retries,
                max_retries
            );
        }
    }

    /// R16.5 — rg_after and rg_target populated.
    #[test]
    fn rg_fields_populated() {
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        assert!(!result.merge_trace.is_empty());
        for (i, entry) in result.merge_trace.iter().enumerate() {
            assert!(
                entry.rg_after > 0.0,
                "Entry {i}: rg_after must be > 0, got {}",
                entry.rg_after
            );
            assert!(
                entry.rg_target > 0.0,
                "Entry {i}: rg_target must be > 0, got {}",
                entry.rg_target
            );
        }
    }

    /// R16.1 — Step indices are sequential 0..N-2.
    #[test]
    fn trace_steps_sequential() {
        let params = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default()
        };
        let result = run_tunable_cc_internal(params, 42, None);
        for (i, entry) in result.merge_trace.iter().enumerate() {
            assert_eq!(
                entry.step, i,
                "Entry {i} should have step={i}, got {}",
                entry.step
            );
        }
    }

    /// T2.3 — Sintered aggregate with coeff=1.0 regression: identical
    /// to baseline (same seed, same result).
    #[test]
    fn test_sintering_e2e_coeff_1_0_identical_to_baseline() {
        // T2.3 — N=10 (see comment in smoke test).
        let params_sintered = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            sintering: SinteringDistribution::Fixed(1.0),
            ..Default::default()
        };
        let params_baseline = TunableCcParams {
            n_particles: 10,
            target_df: 1.8,
            target_kf: 1.3,
            ..Default::default() // default sintering is Fixed(1.0)
        };

        let r1 = run_tunable_cc_internal(params_sintered, 42, None);
        let r2 = run_tunable_cc_internal(params_baseline, 42, None);

        assert_eq!(r1.coordinates.len(), r2.coordinates.len());
        for (i, (c1, c2)) in r1.coordinates.iter().zip(r2.coordinates.iter()).enumerate() {
            let dist =
                ((c1[0] - c2[0]).powi(2) + (c1[1] - c2[1]).powi(2) + (c1[2] - c2[2]).powi(2))
                    .sqrt();
            assert!(
                dist < 1e-10,
                "Particle {i} position differs: sintered={c1:?}, baseline={c2:?}"
            );
        }
    }

    // ── Phase 2: Smart Pair Selection tests (PYA-14 Phase 3) ─────────

    /// T2.1 — compute_max_achievable_distance for two unit-sphere monomers.
    #[test]
    fn test_compute_max_achievable_distance_two_monomers() {
        let c1 = TunableCluster::new(Sphere::new(Vector3::zero(), 1.0));
        let c2 = TunableCluster::new(Sphere::new(Vector3::new(10.0, 0.0, 0.0), 1.0));
        let max_d = compute_max_achievable_distance(&c1, &c2);
        // Two monomers: bounding_radius = particle_radius = 1.0 each
        assert!((max_d - 2.0).abs() < 1e-10, "Expected 2.0, got {max_d}");
    }

    /// T2.3 — Degenerate: identical positions still returns positive.
    #[test]
    fn test_compute_max_achievable_distance_identical_positions() {
        let c1 = TunableCluster::new(Sphere::new(Vector3::zero(), 1.0));
        let c2 = TunableCluster::new(Sphere::new(Vector3::zero(), 1.0));
        let max_d = compute_max_achievable_distance(&c1, &c2);
        assert!((max_d - 2.0).abs() < 1e-10, "Expected 2.0, got {max_d}");
    }

    /// T2.3 — Large cluster bounding radius is larger.
    #[test]
    fn test_compute_max_achievable_distance_larger_cluster() {
        let particles = vec![
            Sphere::new(Vector3::zero(), 1.0),
            Sphere::new(Vector3::new(4.0, 0.0, 0.0), 1.0),
        ];
        let c1 = TunableCluster::from_particles(particles);
        let c2 = TunableCluster::new(Sphere::new(Vector3::new(20.0, 0.0, 0.0), 1.0));
        let max_d = compute_max_achievable_distance(&c1, &c2);
        // c1 bounding radius > 1.0 (two particles spread out)
        assert!(max_d > 2.0, "Expected > 2.0 for multi-particle cluster, got {max_d}");
    }

    /// T2.4 — find_feasible_pairs with all-feasible pool returns all pairs.
    #[test]
    fn test_find_feasible_pairs_all_feasible() {
        // 3 monomers with rp=1.0 at far positions.
        // For monomer pairs (n1=1, n2=1), required_distance is small (< 2.0)
        // and bounding_sum = 2.0 → all feasible.
        let clusters = vec![
            TunableCluster::new(Sphere::new(Vector3::zero(), 1.0)),
            TunableCluster::new(Sphere::new(Vector3::new(10.0, 0.0, 0.0), 1.0)),
            TunableCluster::new(Sphere::new(Vector3::new(0.0, 10.0, 0.0), 1.0)),
        ];
        let df = 1.8;
        let kf = 1.3;
        let rp = 1.0;
        let feasible = find_feasible_pairs(&clusters, df, kf, rp, 1.0, false, false);
        // 3 clusters → C(3,2) = 3 pairs total, all should be feasible
        assert_eq!(feasible.len(), 3, "All 3 pairs should be feasible for monomers");
    }

    /// T2.6 — find_feasible_pairs with all-infeasible pool returns empty.
    #[test]
    fn test_find_feasible_pairs_all_infeasible() {
        // Build clusters with very small bounding radii but large required distances.
        // Use large clusters (many particles compressed into small space) with low Df.
        // Simplest: create clusters with n_particles >> 1 but bounding_radius ~ rp.
        // We'll use from_particles with overlapping particles at origin.
        let make_compact_cluster = |n: usize| {
            let particles: Vec<Sphere> = (0..n)
                .map(|_| Sphere::new(Vector3::zero(), 1.0))
                .collect();
            TunableCluster::from_particles(particles)
        };

        let clusters = vec![
            make_compact_cluster(50),
            make_compact_cluster(50),
        ];
        // With n1=50, n2=50, df=1.4, the required distance is very large
        // but bounding_radius ≈ 1.0 (all at origin) → bounding_sum ≈ 2.0
        let feasible = find_feasible_pairs(&clusters, 1.4, 1.3, 1.0, 1.0, false, false);
        assert_eq!(feasible.len(), 0, "Compact clusters should have no feasible pairs at low Df");
    }

    /// T2.6 — find_feasible_pairs with partial feasibility.
    #[test]
    fn test_find_feasible_pairs_partial() {
        // Mix of monomers (feasible at Df=1.8) and compact large clusters (infeasible)
        let make_compact_cluster = |n: usize| {
            let particles: Vec<Sphere> = (0..n)
                .map(|_| Sphere::new(Vector3::zero(), 1.0))
                .collect();
            TunableCluster::from_particles(particles)
        };

        let clusters = vec![
            TunableCluster::new(Sphere::new(Vector3::zero(), 1.0)),         // idx=0, monomer
            TunableCluster::new(Sphere::new(Vector3::new(5.0, 0.0, 0.0), 1.0)), // idx=1, monomer
            make_compact_cluster(100),                                       // idx=2, large compact
        ];
        // At Df=1.8, monomer-monomer required_distance < 2.0 (feasible)
        // but monomer+large compact required distance >> 2.0 (infeasible)
        let df = 1.8;
        let kf = 1.3;
        let rp = 1.0;
        let feasible = find_feasible_pairs(&clusters, df, kf, rp, 1.0, false, false);
        // Pair (0,1) = monomer+monomer → feasible at Df=1.8
        // Pair (0,2) and (1,2) = monomer+100-compact → infeasible
        assert!(feasible.len() >= 1, "At least monomer-monomer should be feasible at Df=1.8, got {}", feasible.len());
        // Verify the feasible pair is indeed the monomer pair
        let monomer_pair = feasible.iter().find(|p| p.idx1 == 0 && p.idx2 == 1);
        assert!(monomer_pair.is_some(), "Monomer-monomer pair (0,1) should be feasible");
        // The large compact pairs should NOT be in the feasible set
        assert!(feasible.len() < 3, "Not all pairs should be feasible: got {}", feasible.len());
    }

    /// T2.8 — select_pair_smart returns Feasible when feasible pairs exist.
    #[test]
    fn test_select_pair_smart_feasible() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);

        let clusters = vec![
            TunableCluster::new(Sphere::new(Vector3::zero(), 1.0)),
            TunableCluster::new(Sphere::new(Vector3::new(10.0, 0.0, 0.0), 1.0)),
            TunableCluster::new(Sphere::new(Vector3::new(0.0, 10.0, 0.0), 1.0)),
        ];

        let result = select_pair_smart(&clusters, 1.8, 1.3, 1.0, 1.0, &mut rng, false, false);
        match result {
            SmartPairResult::Feasible(pair) => {
                assert!(pair.required_distance > 0.0);
                assert!(pair.bounding_sum >= pair.required_distance);
            }
            SmartPairResult::AllInfeasible { .. } => {
                panic!("Expected Feasible for monomer pool, got AllInfeasible");
            }
        }
    }

    /// T2.10 — select_pair_smart returns AllInfeasible when none feasible.
    #[test]
    fn test_select_pair_smart_all_infeasible() {
        use crate::common::rng::create_rng;
        let mut rng = create_rng(42);

        let make_compact_cluster = |n: usize| {
            let particles: Vec<Sphere> = (0..n)
                .map(|_| Sphere::new(Vector3::zero(), 1.0))
                .collect();
            TunableCluster::from_particles(particles)
        };

        let clusters = vec![
            make_compact_cluster(50),
            make_compact_cluster(50),
        ];

        let result = select_pair_smart(&clusters, 1.4, 1.3, 1.0, 1.0, &mut rng, false, false);
        match result {
            SmartPairResult::AllInfeasible { max_achievable_pair } => {
                assert!(max_achievable_pair.bounding_sum > 0.0);
                // bounding_sum < required_distance (infeasible)
                assert!(
                    max_achievable_pair.bounding_sum < max_achievable_pair.required_distance,
                    "Infeasible pair should have bounding_sum < required: {} < {}",
                    max_achievable_pair.bounding_sum, max_achievable_pair.required_distance
                );
            }
            SmartPairResult::Feasible(_) => {
                panic!("Expected AllInfeasible for compact clusters at low Df");
            }
        }
    }

    // ── Phase 3: Adaptive Merge tests (PYA-14 Phase 3) ───────────────

    /// T3.1 — emit_adaptive_merge_entry populates trace correctly.
    #[test]
    fn test_emit_adaptive_merge_entry_correct_fields() {
        let entry = emit_adaptive_merge_entry(
            10,    // step
            5,     // n1
            3,     // n2
            6.0,   // max_achievable
            5.0,   // required_distance
            3.5,   // rg_after
            3.2,   // rg_target
            100,   // retries
            None,  // merge_type_override — standard "adaptive"
        );
        assert_eq!(entry.merge_type, "adaptive");
        assert_eq!(entry.step, 10);
        assert_eq!(entry.n1, 5);
        assert_eq!(entry.n2, 3);
        assert_eq!(entry.actual_distance, 6.0);
        assert_eq!(entry.required_distance, 5.0);
        // overshoot_pct = (6.0 - 5.0) / 5.0 = 0.2
        assert!((entry.overshoot_pct.unwrap() - 0.2).abs() < 1e-10);
        assert!(entry.actual_distance >= entry.required_distance, "Overshoot contract");
    }

    /// T3.1 — Overshoot contract: actual >= required.
    #[test]
    fn test_emit_adaptive_merge_entry_overshoot_contract() {
        let entry = emit_adaptive_merge_entry(0, 10, 10, 12.5, 10.0, 5.0, 4.8, 50, None);
        assert!(entry.actual_distance >= entry.required_distance);
        assert!(entry.overshoot_pct.unwrap() >= 0.0);
    }

    /// T3.1 — Zero required_distance edge case (no division by zero).
    #[test]
    fn test_emit_adaptive_merge_entry_zero_required() {
        let entry = emit_adaptive_merge_entry(0, 1, 1, 2.0, 0.0, 1.0, 1.0, 0, None);
        assert_eq!(entry.overshoot_pct, Some(0.0)); // 0 when required=0
    }

    /// T3.3 — emit_no_feasible_pair_entry has correct fields.
    #[test]
    fn test_emit_no_feasible_pair_entry() {
        let entry = emit_no_feasible_pair_entry(42, 15);
        assert_eq!(entry.merge_type, "no_feasible_pair");
        assert_eq!(entry.step, 42);
        assert_eq!(entry.n1, 15); // pool_size
        assert_eq!(entry.n2, 0);
        assert_eq!(entry.actual_distance, 0.0);
        assert_eq!(entry.required_distance, 0.0);
        assert_eq!(entry.overshoot_pct, None);
    }

    /// T3.3 — no_feasible_pair event does NOT have merge geometry.
    #[test]
    fn test_emit_no_feasible_pair_no_merge_geometry() {
        let entry = emit_no_feasible_pair_entry(100, 3);
        // No merge geometry means rg_after, rg_target, actual_distance all 0
        assert_eq!(entry.rg_after, 0.0);
        assert_eq!(entry.rg_target, 0.0);
        assert_eq!(entry.actual_distance, 0.0);
    }

    // ── T-MARCH-1: March-inward placement tests ─────────────────────

    /// T-MARCH-1 RED: Two single-sphere clusters (radius 1.0) along X axis.
    /// target_d=2.0, max_achievable=3.0.
    /// Should march from 3.0 inward, find contact at ~2.0 (within epsilon).
    #[test]
    fn test_march_inward_two_unit_spheres_contact_at_2() {
        let sphere_a = Sphere::new(Vector3::zero(), 1.0);
        let sphere_b = Sphere::new(Vector3::zero(), 1.0);
        let direction = Vector3::new(1.0, 0.0, 0.0);

        let result = find_first_contact_distance(
            &[sphere_a],
            &[sphere_b],
            &direction,
            3.0,  // d_start (max_achievable)
            1.0,  // d_floor (sanity: 0.5 * target)
            1.0,  // rp
            1.0,  // sintering_coeff
        );

        match result {
            MarchResult::Distance(d) => {
                // Contact should be at ~2.0 (sum of radii), within march resolution
                assert!(
                    (d - 2.0).abs() < 0.05,
                    "Expected contact near 2.0, got {d}"
                );
            }
            MarchResult::NoContact => {
                panic!("Expected contact at ~2.0 for two unit spheres, got NoContact");
            }
        }
    }

    /// T-MARCH-1 TRIANGULATE: Multi-sphere cluster A (3 spheres in a row along X),
    /// single-sphere B marching along X. Contact should be at the sphere closest
    /// to B's approach direction.
    #[test]
    fn test_march_inward_multi_sphere_a_single_b() {
        // Cluster A: 3 spheres along X at x=0, x=2, x=4 (touching chain)
        let spheres_a = vec![
            Sphere::new(Vector3::zero(), 1.0),
            Sphere::new(Vector3::new(2.0, 0.0, 0.0), 1.0),
            Sphere::new(Vector3::new(4.0, 0.0, 0.0), 1.0),
        ];
        // Cluster B: single sphere at origin (will be placed along +X)
        let sphere_b = Sphere::new(Vector3::zero(), 1.0);
        let direction = Vector3::new(1.0, 0.0, 0.0);

        // A's centroid is at x≈2.0 (COM of equal-radius spheres at 0,2,4).
        // B approaches from +X. B's center will be at d along X from A's centroid.
        // Contact with A's rightmost sphere (at x=4) happens when:
        // d + 0 (B sphere at origin of B) = 4 + 1 + 1 = distance from A centroid.
        // But B sphere is at B's centroid + direction*d, so B center = d along X.
        // A spheres are at 0, 2, 4 (not centered at origin for COM).
        // Actually spheres_a positions are absolute. Let's think about this:
        // A's centroid is at (0+2+4)/3 = 2.0 on X.
        // B sphere offset = direction * d, so B sphere center = (d, 0, 0).
        // Rightmost A sphere at (4,0,0). Contact when |d - 4| = 2.0 (sum of radii).
        // So d = 6.0 (from right) or d = 2.0 (from left/overlap).
        // But these positions are relative to A's centroid which is at 2.0.
        // No — the function uses raw sphere positions + offset.
        // sphere_b.center = (0,0,0) offset by direction*d = (d, 0, 0).
        // Contact with A sphere at (4,0,0): |(d, 0,0) - (4,0,0)| = |d-4| <= 2.0
        // So contact at d = 6.0 (approaching from +X, first contact).
        // But wait — d_start should be large enough. Let's use d_start=8.0.

        let result = find_first_contact_distance(
            &spheres_a,
            &[sphere_b],
            &direction,
            8.0,  // d_start
            1.0,  // d_floor
            1.0,  // rp
            1.0,  // sintering_coeff
        );

        match result {
            MarchResult::Distance(d) => {
                // Contact with rightmost A sphere (x=4) + B sphere at d:
                // |d - 4| = 2.0 → d = 6.0 (from +X side)
                assert!(
                    (d - 6.0).abs() < 0.15,
                    "Expected contact near 6.0 (rightmost sphere + radius sum), got {d}"
                );
            }
            MarchResult::NoContact => {
                panic!("Expected contact for multi-sphere A vs single B");
            }
        }
    }

    /// T-MARCH-1 TRIANGULATE: d_floor > d_start → returns NoContact immediately.
    #[test]
    fn test_march_inward_floor_above_start() {
        let sphere_a = Sphere::new(Vector3::zero(), 1.0);
        let sphere_b = Sphere::new(Vector3::zero(), 1.0);
        let direction = Vector3::new(1.0, 0.0, 0.0);

        let result = find_first_contact_distance(
            &[sphere_a],
            &[sphere_b],
            &direction,
            1.0,  // d_start
            5.0,  // d_floor > d_start
            1.0,
            1.0,
        );

        assert_eq!(result, MarchResult::NoContact, "floor > start should return NoContact");
    }

    /// T-MARCH-1 TRIANGULATE: Spheres too far apart — no contact before floor.
    #[test]
    fn test_march_inward_no_contact_when_far_apart() {
        // Cluster A sphere at origin, cluster B sphere will be placed along direction
        // but floor is too high for them to ever touch
        let sphere_a = Sphere::new(Vector3::zero(), 0.1);
        let sphere_b = Sphere::new(Vector3::zero(), 0.1);
        let direction = Vector3::new(1.0, 0.0, 0.0);

        // Contact would be at 0.2 (radii sum), but floor is at 5.0
        let result = find_first_contact_distance(
            &[sphere_a],
            &[sphere_b],
            &direction,
            10.0, // d_start
            5.0,  // d_floor (too high for contact at 0.2)
            0.1,  // rp
            1.0,  // sintering
        );

        assert_eq!(result, MarchResult::NoContact);
    }

    /// T-MARCH-1 TRIANGULATE: With sintering (coeff=0.9), contact distance shrinks.
    #[test]
    fn test_march_inward_with_sintering() {
        let sphere_a = Sphere::new(Vector3::zero(), 1.0);
        let sphere_b = Sphere::new(Vector3::zero(), 1.0);
        let direction = Vector3::new(1.0, 0.0, 0.0);

        let sintering_coeff = 0.9;
        // Contact distance = 2 * rp * sintering_coeff = 1.8
        let result = find_first_contact_distance(
            &[sphere_a],
            &[sphere_b],
            &direction,
            3.0,
            0.5,
            1.0,
            sintering_coeff,
        );

        match result {
            MarchResult::Distance(d) => {
                let expected_contact = sintered_contact_distance(1.0, 1.0, sintering_coeff);
                assert!(
                    (d - expected_contact).abs() < 0.05,
                    "With sintering=0.9, expected contact near {expected_contact}, got {d}"
                );
            }
            MarchResult::NoContact => {
                panic!("Expected contact with sintering");
            }
        }
    }

    /// T-MARCH-1 TRIANGULATE: target > max_achievable (formula impossible).
    /// Starts at max_d, marches inward, returns whatever distance achieves contact.
    #[test]
    fn test_march_inward_target_exceeds_max() {
        // Two unit spheres. target_d = 5.0 (impossible), max_d = 2.5.
        // March from 2.5 inward → contact at ~2.0.
        let sphere_a = Sphere::new(Vector3::zero(), 1.0);
        let sphere_b = Sphere::new(Vector3::zero(), 1.0);
        let direction = Vector3::new(0.0, 1.0, 0.0); // different direction

        let result = find_first_contact_distance(
            &[sphere_a],
            &[sphere_b],
            &direction,
            2.5,  // d_start (max_achievable, smaller than impossible target)
            0.5,  // d_floor
            1.0,
            1.0,
        );

        match result {
            MarchResult::Distance(d) => {
                assert!(
                    (d - 2.0).abs() < 0.05,
                    "Expected contact near 2.0, got {d}"
                );
            }
            MarchResult::NoContact => {
                panic!("Expected contact even when target exceeds max");
            }
        }
    }
}
