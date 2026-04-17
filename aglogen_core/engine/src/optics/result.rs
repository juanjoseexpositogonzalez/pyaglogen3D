//! Optical computation results (pure Rust, no PyO3).

/// Optical properties result from T-Matrix or DDA computation.
#[derive(Debug, Clone)]
pub struct OpticalResult {
    /// Extinction cross-section (nm squared)
    pub c_ext: f64,
    /// Scattering cross-section (nm squared)
    pub c_sca: f64,
    /// Absorption cross-section (nm squared)
    pub c_abs: f64,
    /// Extinction efficiency (dimensionless)
    pub q_ext: f64,
    /// Scattering efficiency (dimensionless)
    pub q_sca: f64,
    /// Absorption efficiency (dimensionless)
    pub q_abs: f64,
    /// Asymmetry parameter g = <cos(theta)>
    pub asymmetry_g: f64,
    /// Single scattering albedo omega = Csca/Cext
    pub single_scatter_albedo: f64,
    /// Mueller matrix elements (4x4)
    pub mueller_matrix: [[f64; 4]; 4],
    /// Phase function P(theta) at sampled angles
    pub phase_function: Vec<f64>,
    /// Scattering angles (degrees)
    pub scattering_angles: Vec<f64>,
    /// Wavelength used (nm)
    pub wavelength: f64,
    /// Complex refractive index (n + ik)
    pub refractive_index_n: f64,
    pub refractive_index_k: f64,
    /// Medium refractive index
    pub medium_index: f64,
    /// Number of particles in aggregate
    pub n_particles: usize,
    /// Geometric cross-section used for efficiencies (nm squared)
    pub geometric_cross_section: f64,
    /// Execution time in milliseconds
    pub execution_time_ms: u64,
}
