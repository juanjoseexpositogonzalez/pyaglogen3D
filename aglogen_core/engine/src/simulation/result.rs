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
}

impl SimulationResult {
}
