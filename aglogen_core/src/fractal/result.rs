//! Fractal analysis result types.

use numpy::PyArray1;
use pyo3::prelude::*;

/// Python wrapper for fractal analysis results.
#[pyclass]
#[derive(Clone)]
pub struct PyFractalResult {
    #[pyo3(get)]
    pub dimension: f64,
    #[pyo3(get)]
    pub r_squared: f64,
    #[pyo3(get)]
    pub std_error: f64,
    #[pyo3(get)]
    pub confidence_interval: (f64, f64),
    #[pyo3(get)]
    pub execution_time_ms: u64,
    /// Start index of linear region (0 = all points used).
    #[pyo3(get)]
    pub linear_region_start: usize,

    // Internal storage
    pub(crate) log_scales_data: Vec<f64>,
    pub(crate) log_values_data: Vec<f64>,
    pub(crate) residuals_data: Vec<f64>,
}

#[pymethods]
impl PyFractalResult {
    /// Get log of scales/sizes as numpy array.
    #[getter]
    fn log_scales<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.log_scales_data.clone())
    }

    /// Get log of counts/values as numpy array.
    #[getter]
    fn log_values<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.log_values_data.clone())
    }

    /// Get fit residuals as numpy array.
    #[getter]
    fn residuals<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.residuals_data.clone())
    }
}

/// Internal fractal result.
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

impl FractalResult {
    pub fn to_py(self) -> PyFractalResult {
        PyFractalResult {
            dimension: self.dimension,
            r_squared: self.r_squared,
            std_error: self.std_error,
            confidence_interval: self.confidence_interval,
            execution_time_ms: self.execution_time_ms,
            linear_region_start: self.linear_region_start,
            log_scales_data: self.log_scales,
            log_values_data: self.log_values,
            residuals_data: self.residuals,
        }
    }
}
