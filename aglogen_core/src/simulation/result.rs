//! Simulation result types.

use numpy::{PyArray1, PyArray2};
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

    // Internal storage for arrays
    pub(crate) coordinates_data: Vec<f64>,
    pub(crate) radii_data: Vec<f64>,
    pub(crate) rg_evolution_data: Vec<f64>,
}

#[pymethods]
impl PySimulationResult {
    /// Get particle coordinates as numpy array (N, 3).
    #[getter]
    fn coordinates<'py>(&self, py: Python<'py>) -> &'py PyArray2<f64> {
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
    fn radii<'py>(&self, py: Python<'py>) -> &'py PyArray1<f64> {
        PyArray1::from_vec(py, self.radii_data.clone())
    }

    /// Get radius of gyration evolution as numpy array (N,).
    #[getter]
    fn rg_evolution<'py>(&self, py: Python<'py>) -> &'py PyArray1<f64> {
        PyArray1::from_vec(py, self.rg_evolution_data.clone())
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
}

impl SimulationResult {
    /// Convert to Python result.
    pub fn to_py(self) -> PySimulationResult {
        let n = self.coordinates.len();
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
            coordinates_data: self.coordinates.iter().flat_map(|c| c.iter()).copied().collect(),
            radii_data: self.radii,
            rg_evolution_data: self.rg_evolution,
        }
    }
}
