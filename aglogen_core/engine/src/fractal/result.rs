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
    /// Inclusive indices into `log_scales` used for the reported fit.
    pub fit_window: Option<(usize, usize)>,
    /// Origin of `fit_window`: `"legacy"` for the 3D default robust path,
    /// `"r5"` for a future measured 3D selection, or `"all_levels"` when
    /// 2D box-counting fits every counted scale without selecting a window.
    pub window_source: &'static str,
}
