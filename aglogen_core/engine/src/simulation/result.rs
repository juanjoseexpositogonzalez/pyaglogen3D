//! Simulation result types.

/// Python wrapper for simulation results.
#[derive(Clone)]

/// Internal simulation result (before conversion to Python).
pub struct SimulationResult {
    pub coordinates: Vec<[f64; 3]>,
    pub radii: Vec<f64>,
    pub rg_evolution: Vec<f64>,
    pub fractal_dimension: f64,
    pub fractal_dimension_std: f64,
    pub prefactor: f64,
    pub porosity: f64,
    pub coordination_mean: f64,
    pub coordination_std: f64,
    pub execution_time_ms: u64,
    pub seed: u64,
    // Inertia tensor results
    pub anisotropy: f64,
    pub asphericity: f64,
    pub acylindricity: f64,
    pub principal_moments: [f64; 3],
    pub principal_axes: [[f64; 3]; 3],
    // CC-tunable diagnostic metadata (R7 spec)
    /// Count of merge steps completed via tunable geometry.
    pub tunable_merges: usize,
    /// Count of merge steps that fell back to ballistic.
    pub ballistic_merges: usize,
    /// Highest retry count observed across all merge steps.
    pub max_retries_per_merge: usize,
    // Parametric distribution results (R14 — parametric-values-dpo-and-kf / PYA-15)
    /// Effective primary particle diameter used in this run.
    /// `Some(v)` for CC-tunable (sampled from `dpo_distribution`);
    /// `None` for algorithms that don't use distribution sampling.
    pub dpo_used: Option<f64>,
    /// Effective fractal prefactor used in this run.
    /// `Some(v)` for CC-tunable (sampled from `target_kf_distribution`);
    /// `None` for algorithms without kf distribution support.
    pub target_kf_used: Option<f64>,
}

impl SimulationResult {}
