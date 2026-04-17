//! Fractal analysis result types.

/// Internal fractal result (pure Rust, no PyO3).
#[derive(Debug, Clone)]
pub struct FractalResult {
    pub dimension: f64,
    pub r_squared: f64,
    pub std_error: f64,
    pub confidence_interval: (f64, f64),
    pub log_scales: Vec<f64>,
    pub log_values: Vec<f64>,
    pub residuals: Vec<f64>,
    pub execution_time_ms: u64,
    pub linear_region_start: usize,
}
