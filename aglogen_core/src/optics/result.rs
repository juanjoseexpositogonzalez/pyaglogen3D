//! Optical computation results.

use numpy::{PyArray1, PyArray2};
use pyo3::prelude::*;

/// Optical properties result from T-Matrix or DDA computation.
#[derive(Debug, Clone)]
pub struct OpticalResult {
    /// Extinction cross-section (nm²)
    pub c_ext: f64,
    /// Scattering cross-section (nm²)
    pub c_sca: f64,
    /// Absorption cross-section (nm²)
    pub c_abs: f64,
    /// Extinction efficiency (dimensionless)
    pub q_ext: f64,
    /// Scattering efficiency (dimensionless)
    pub q_sca: f64,
    /// Absorption efficiency (dimensionless)
    pub q_abs: f64,
    /// Asymmetry parameter g = <cos(θ)>
    pub asymmetry_g: f64,
    /// Single scattering albedo ω = Csca/Cext
    pub single_scatter_albedo: f64,
    /// Mueller matrix elements (4x4)
    pub mueller_matrix: [[f64; 4]; 4],
    /// Phase function P(θ) at sampled angles
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
    /// Geometric cross-section used for efficiencies (nm²)
    pub geometric_cross_section: f64,
    /// Execution time in milliseconds
    pub execution_time_ms: u64,
}

impl OpticalResult {
    /// Convert to Python-compatible result
    pub fn to_py<'py>(&self, py: Python<'py>) -> PyOpticalResult {
        let mueller_flat: Vec<f64> = self.mueller_matrix.iter().flatten().copied().collect();

        PyOpticalResult {
            c_ext: self.c_ext,
            c_sca: self.c_sca,
            c_abs: self.c_abs,
            q_ext: self.q_ext,
            q_sca: self.q_sca,
            q_abs: self.q_abs,
            asymmetry_g: self.asymmetry_g,
            single_scatter_albedo: self.single_scatter_albedo,
            mueller_matrix: PyArray2::from_vec2(
                py,
                &self
                    .mueller_matrix
                    .iter()
                    .map(|row| row.to_vec())
                    .collect::<Vec<_>>(),
            )
            .unwrap()
            .into(),
            phase_function: PyArray1::from_vec(py, self.phase_function.clone()).into(),
            scattering_angles: PyArray1::from_vec(py, self.scattering_angles.clone()).into(),
            wavelength: self.wavelength,
            refractive_index_n: self.refractive_index_n,
            refractive_index_k: self.refractive_index_k,
            medium_index: self.medium_index,
            n_particles: self.n_particles,
            geometric_cross_section: self.geometric_cross_section,
            execution_time_ms: self.execution_time_ms,
        }
    }
}

/// Python-exposed optical properties result.
#[pyclass]
#[derive(Debug)]
pub struct PyOpticalResult {
    /// Extinction cross-section (nm²)
    #[pyo3(get)]
    pub c_ext: f64,

    /// Scattering cross-section (nm²)
    #[pyo3(get)]
    pub c_sca: f64,

    /// Absorption cross-section (nm²)
    #[pyo3(get)]
    pub c_abs: f64,

    /// Extinction efficiency
    #[pyo3(get)]
    pub q_ext: f64,

    /// Scattering efficiency
    #[pyo3(get)]
    pub q_sca: f64,

    /// Absorption efficiency
    #[pyo3(get)]
    pub q_abs: f64,

    /// Asymmetry parameter g = <cos(θ)>
    #[pyo3(get)]
    pub asymmetry_g: f64,

    /// Single scattering albedo ω = Csca/Cext
    #[pyo3(get)]
    pub single_scatter_albedo: f64,

    /// Mueller matrix (4x4 numpy array)
    #[pyo3(get)]
    pub mueller_matrix: Py<PyArray2<f64>>,

    /// Phase function P(θ)
    #[pyo3(get)]
    pub phase_function: Py<PyArray1<f64>>,

    /// Scattering angles (degrees)
    #[pyo3(get)]
    pub scattering_angles: Py<PyArray1<f64>>,

    /// Wavelength (nm)
    #[pyo3(get)]
    pub wavelength: f64,

    /// Real part of refractive index
    #[pyo3(get)]
    pub refractive_index_n: f64,

    /// Imaginary part of refractive index
    #[pyo3(get)]
    pub refractive_index_k: f64,

    /// Medium refractive index
    #[pyo3(get)]
    pub medium_index: f64,

    /// Number of particles
    #[pyo3(get)]
    pub n_particles: usize,

    /// Geometric cross-section (nm²)
    #[pyo3(get)]
    pub geometric_cross_section: f64,

    /// Execution time (ms)
    #[pyo3(get)]
    pub execution_time_ms: u64,
}

#[pymethods]
impl PyOpticalResult {
    fn __repr__(&self) -> String {
        format!(
            "OpticalResult(Cext={:.4e}, Csca={:.4e}, Cabs={:.4e}, g={:.4}, ω={:.4})",
            self.c_ext, self.c_sca, self.c_abs, self.asymmetry_g, self.single_scatter_albedo
        )
    }
}
