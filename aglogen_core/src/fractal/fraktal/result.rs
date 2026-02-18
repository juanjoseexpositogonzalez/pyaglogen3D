//! FRAKTAL analysis result types.

use pyo3::prelude::*;

/// Status of FRAKTAL analysis.
#[derive(Debug, Clone, PartialEq)]
pub enum FraktalStatus {
    /// Analysis completed successfully
    Success,
    /// Fractal dimension outside valid range (1.0-3.0)
    DfOutOfRange,
    /// Number of primary particles below minimum threshold
    NpoTooSmall,
    /// Bisection method failed to converge
    NoConvergence,
    /// Other error with message
    Error(String),
}

impl FraktalStatus {
    pub fn as_str(&self) -> &str {
        match self {
            FraktalStatus::Success => "success",
            FraktalStatus::DfOutOfRange => "df_out_of_range",
            FraktalStatus::NpoTooSmall => "npo_too_small",
            FraktalStatus::NoConvergence => "no_convergence",
            FraktalStatus::Error(_) => "error",
        }
    }

    pub fn message(&self) -> String {
        match self {
            FraktalStatus::Success => "Analysis completed successfully".to_string(),
            FraktalStatus::DfOutOfRange => "Fractal dimension outside valid range (1.0-3.0)".to_string(),
            FraktalStatus::NpoTooSmall => "Number of primary particles below minimum threshold".to_string(),
            FraktalStatus::NoConvergence => "Bisection method failed to converge".to_string(),
            FraktalStatus::Error(msg) => msg.clone(),
        }
    }
}

/// Internal FRAKTAL analysis result.
#[derive(Debug, Clone)]
pub struct FraktalResult {
    /// Radius of gyration in nm (optionally 3D corrected)
    pub rg: f64,

    /// Projected area in nm²
    pub ap: f64,

    /// Fractal dimension (1.0 - 3.0)
    pub df: f64,

    /// Number of primary particles (rounded)
    pub npo: u64,

    /// Prefactor kf from power law
    pub kf: f64,

    /// Overlap exponent zf
    pub zf: f64,

    /// Coordination index Jf (only for 2012 granulated model)
    pub jf: Option<f64>,

    /// Volume in nm³
    pub volume: f64,

    /// Mass in fg (femtograms) using soot density 1.85e-06 fg/nm³
    pub mass: f64,

    /// Surface area in nm²
    pub surface_area: f64,

    /// Analysis status
    pub status: FraktalStatus,

    /// Execution time in milliseconds
    pub execution_time_ms: u64,

    /// Model used for analysis ("granulated_2012" or "voxel_2018")
    pub model: String,
}

impl Default for FraktalResult {
    fn default() -> Self {
        Self {
            rg: 0.0,
            ap: 0.0,
            df: 0.0,
            npo: 0,
            kf: 0.0,
            zf: 0.0,
            jf: None,
            volume: 0.0,
            mass: 0.0,
            surface_area: 0.0,
            status: FraktalStatus::Error("Not initialized".to_string()),
            execution_time_ms: 0,
            model: String::new(),
        }
    }
}

/// Python-exposed FRAKTAL analysis result.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PyFraktalResult {
    /// Radius of gyration in nm
    #[pyo3(get)]
    pub rg: f64,

    /// Projected area in nm²
    #[pyo3(get)]
    pub ap: f64,

    /// Fractal dimension (1.0 - 3.0)
    #[pyo3(get)]
    pub df: f64,

    /// Number of primary particles
    #[pyo3(get)]
    pub npo: u64,

    /// Prefactor kf
    #[pyo3(get)]
    pub kf: f64,

    /// Overlap exponent zf
    #[pyo3(get)]
    pub zf: f64,

    /// Coordination index Jf (None for voxel model)
    #[pyo3(get)]
    pub jf: Option<f64>,

    /// Volume in nm³
    #[pyo3(get)]
    pub volume: f64,

    /// Mass in fg
    #[pyo3(get)]
    pub mass: f64,

    /// Surface area in nm²
    #[pyo3(get)]
    pub surface_area: f64,

    /// Status string
    #[pyo3(get)]
    pub status: String,

    /// Status message
    #[pyo3(get)]
    pub status_message: String,

    /// Execution time in milliseconds
    #[pyo3(get)]
    pub execution_time_ms: u64,

    /// Model used
    #[pyo3(get)]
    pub model: String,
}

impl From<FraktalResult> for PyFraktalResult {
    fn from(r: FraktalResult) -> Self {
        Self {
            rg: r.rg,
            ap: r.ap,
            df: r.df,
            npo: r.npo,
            kf: r.kf,
            zf: r.zf,
            jf: r.jf,
            volume: r.volume,
            mass: r.mass,
            surface_area: r.surface_area,
            status: r.status.as_str().to_string(),
            status_message: r.status.message(),
            execution_time_ms: r.execution_time_ms,
            model: r.model,
        }
    }
}
