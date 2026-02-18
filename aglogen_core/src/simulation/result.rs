//! Simulation result types.

use numpy::{PyArray1, PyArray2, PyArrayMethods};
use pyo3::prelude::*;

/// Python wrapper for simulation results.
#[pyclass]
#[derive(Clone)]
pub struct PySimulationResult {
    #[pyo3(get)]
    pub fractal_dimension: f64,
    #[pyo3(get)]
    pub fractal_dimension_std: f64,
    #[pyo3(get)]
    pub prefactor: f64,
    #[pyo3(get)]
    pub radius_of_gyration: f64,
    #[pyo3(get)]
    pub porosity: f64,
    #[pyo3(get)]
    pub coordination_mean: f64,
    #[pyo3(get)]
    pub coordination_std: f64,
    #[pyo3(get)]
    pub execution_time_ms: u64,
    #[pyo3(get)]
    pub seed: u64,

    // Inertia tensor results
    #[pyo3(get)]
    pub anisotropy: f64,
    #[pyo3(get)]
    pub asphericity: f64,
    #[pyo3(get)]
    pub acylindricity: f64,

    // Internal storage for arrays
    pub(crate) coordinates_data: Vec<f64>,
    pub(crate) radii_data: Vec<f64>,
    pub(crate) rg_evolution_data: Vec<f64>,
    pub(crate) principal_moments_data: [f64; 3],
    pub(crate) principal_axes_data: [[f64; 3]; 3],
}

#[pymethods]
impl PySimulationResult {
    /// Get particle coordinates as numpy array (N, 3).
    #[getter]
    fn coordinates<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray2<f64>> {
        let n = self.radii_data.len();
        let arr: Vec<Vec<f64>> = (0..n)
            .map(|i| {
                vec![
                    self.coordinates_data[i * 3],
                    self.coordinates_data[i * 3 + 1],
                    self.coordinates_data[i * 3 + 2],
                ]
            })
            .collect();
        PyArray2::from_vec2(py, &arr).unwrap()
    }

    /// Get particle radii as numpy array (N,).
    #[getter]
    fn radii<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.radii_data.clone())
    }

    /// Get radius of gyration evolution as numpy array (N,).
    #[getter]
    fn rg_evolution<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.rg_evolution_data.clone())
    }

    /// Get principal moments of inertia as numpy array (3,).
    /// Sorted: I1 <= I2 <= I3
    #[getter]
    fn principal_moments<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.principal_moments_data.to_vec())
    }

    /// Get principal axes as numpy array (3, 3).
    /// Each row is a principal axis (eigenvector).
    #[getter]
    fn principal_axes<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray2<f64>> {
        let arr: Vec<Vec<f64>> = self.principal_axes_data
            .iter()
            .map(|axis| axis.to_vec())
            .collect();
        PyArray2::from_vec2(py, &arr).unwrap()
    }
}

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
    /// Convert to Python result.
    pub fn to_py(self) -> PySimulationResult {
        let rg = if !self.rg_evolution.is_empty() {
            *self.rg_evolution.last().unwrap()
        } else {
            0.0
        };

        PySimulationResult {
            fractal_dimension: self.fractal_dimension,
            fractal_dimension_std: self.fractal_dimension_std,
            prefactor: self.prefactor,
            radius_of_gyration: rg,
            porosity: self.porosity,
            coordination_mean: self.coordination_mean,
            coordination_std: self.coordination_std,
            execution_time_ms: self.execution_time_ms,
            seed: self.seed,
            anisotropy: self.anisotropy,
            asphericity: self.asphericity,
            acylindricity: self.acylindricity,
            coordinates_data: self.coordinates.iter().flat_map(|c| c.iter()).copied().collect(),
            radii_data: self.radii,
            rg_evolution_data: self.rg_evolution,
            principal_moments_data: self.principal_moments,
            principal_axes_data: self.principal_axes,
        }
    }
}
