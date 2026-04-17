//! Python bindings for aglogen-engine via PyO3.
//!
//! This crate provides the #[pymodule], #[pyfunction], #[pyclass] wrappers
//! that call into the pure Rust aglogen-engine crate.

use ndarray::Array2;
use numpy::{PyArray1, PyArray2, PyArrayMethods, PyReadonlyArray1, PyReadonlyArray2};
use pyo3::prelude::*;

// Re-export engine types
use aglogen_engine::fractal::box_counting::box_counting_internal;
use aglogen_engine::fractal::box_counting_3d::{
    box_counting_3d_morton, generate_sphere_points, BoxCountingResult3D,
};
use aglogen_engine::fractal::fraktal::result::{FraktalResult, FraktalStatus};
use aglogen_engine::fractal::fraktal::{
    analyze_granulated_2012, analyze_voxel_2018, Granulated2012Params, Voxel2018Params,
};
use aglogen_engine::fractal::result::FractalResult;
use aglogen_engine::optics::dda::compute_dda;
use aglogen_engine::optics::dda::Polarizability;

/// Convert a numpy array to an engine-compatible ndarray Array2<u8>.
/// Bridges potential ndarray version mismatch between numpy and engine crates
/// by copying through raw slice data rather than passing ArrayView2 directly.
fn numpy_to_engine_array2_u8(np_array: &PyReadonlyArray2<u8>) -> Array2<u8> {
    let arr = np_array.as_array();
    let shape = arr.shape();
    let (rows, cols) = (shape[0], shape[1]);
    let data: Vec<u8> = arr.iter().copied().collect();
    Array2::from_shape_vec((rows, cols), data).expect("Shape mismatch in numpy_to_engine_array2_u8")
}
use aglogen_engine::optics::result::OpticalResult;
use aglogen_engine::optics::tmatrix::compute_tmatrix;
use aglogen_engine::projection::{
    project_batch_internal, project_to_2d_internal, ProjectionResult,
};
use aglogen_engine::simulation::gcca::compute_structure_factor;
use aglogen_engine::simulation::result::SimulationResult;
use aglogen_engine::simulation::sintering::SinteringDistribution;

// ============================================================================
// Result wrapper types (PyO3)
// ============================================================================

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
    #[pyo3(get)]
    pub linear_region_start: usize,
    pub log_scales_data: Vec<f64>,
    pub log_values_data: Vec<f64>,
    pub residuals_data: Vec<f64>,
}

#[pymethods]
impl PyFractalResult {
    #[getter]
    fn log_scales<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.log_scales_data.clone())
    }
    #[getter]
    fn log_values<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.log_values_data.clone())
    }
    #[getter]
    fn residuals<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.residuals_data.clone())
    }
}

impl From<FractalResult> for PyFractalResult {
    fn from(r: FractalResult) -> Self {
        Self {
            dimension: r.dimension,
            r_squared: r.r_squared,
            std_error: r.std_error,
            confidence_interval: r.confidence_interval,
            execution_time_ms: r.execution_time_ms,
            linear_region_start: r.linear_region_start,
            log_scales_data: r.log_scales,
            log_values_data: r.log_values,
            residuals_data: r.residuals,
        }
    }
}

impl From<BoxCountingResult3D> for PyFractalResult {
    fn from(r: BoxCountingResult3D) -> Self {
        Self {
            dimension: r.dimension,
            r_squared: r.r_squared,
            std_error: r.std_error,
            confidence_interval: r.confidence_interval,
            execution_time_ms: r.execution_time_ms,
            linear_region_start: r.linear_region_start,
            log_scales_data: r.log_scales,
            log_values_data: r.log_counts,
            residuals_data: r.residuals,
        }
    }
}

/// Python-exposed FRAKTAL analysis result.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PyFraktalResult {
    #[pyo3(get)]
    pub rg: f64,
    #[pyo3(get)]
    pub ap: f64,
    #[pyo3(get)]
    pub df: f64,
    #[pyo3(get)]
    pub npo: u64,
    #[pyo3(get)]
    pub npo_visual: u64,
    #[pyo3(get)]
    pub kf: f64,
    #[pyo3(get)]
    pub zf: f64,
    #[pyo3(get)]
    pub jf: Option<f64>,
    #[pyo3(get)]
    pub volume: f64,
    #[pyo3(get)]
    pub mass: f64,
    #[pyo3(get)]
    pub surface_area: f64,
    #[pyo3(get)]
    pub status: String,
    #[pyo3(get)]
    pub status_message: String,
    #[pyo3(get)]
    pub execution_time_ms: u64,
    #[pyo3(get)]
    pub model: String,
    #[pyo3(get)]
    pub npo_ratio: f64,
    #[pyo3(get)]
    pub npo_aligned: bool,
    #[pyo3(get)]
    pub dpo_estimated: f64,
}

impl From<FraktalResult> for PyFraktalResult {
    fn from(r: FraktalResult) -> Self {
        Self {
            rg: r.rg,
            ap: r.ap,
            df: r.df,
            npo: r.npo,
            npo_visual: r.npo_visual,
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
            npo_ratio: r.npo_ratio,
            npo_aligned: r.npo_aligned,
            dpo_estimated: r.dpo_estimated,
        }
    }
}

/// Python-exposed optical properties result.
#[pyclass]
#[derive(Debug)]
pub struct PyOpticalResult {
    #[pyo3(get)]
    pub c_ext: f64,
    #[pyo3(get)]
    pub c_sca: f64,
    #[pyo3(get)]
    pub c_abs: f64,
    #[pyo3(get)]
    pub q_ext: f64,
    #[pyo3(get)]
    pub q_sca: f64,
    #[pyo3(get)]
    pub q_abs: f64,
    #[pyo3(get)]
    pub asymmetry_g: f64,
    #[pyo3(get)]
    pub single_scatter_albedo: f64,
    #[pyo3(get)]
    pub mueller_matrix: Py<PyArray2<f64>>,
    #[pyo3(get)]
    pub phase_function: Py<PyArray1<f64>>,
    #[pyo3(get)]
    pub scattering_angles: Py<PyArray1<f64>>,
    #[pyo3(get)]
    pub wavelength: f64,
    #[pyo3(get)]
    pub refractive_index_n: f64,
    #[pyo3(get)]
    pub refractive_index_k: f64,
    #[pyo3(get)]
    pub medium_index: f64,
    #[pyo3(get)]
    pub n_particles: usize,
    #[pyo3(get)]
    pub geometric_cross_section: f64,
    #[pyo3(get)]
    pub execution_time_ms: u64,
}

#[pymethods]
impl PyOpticalResult {
    fn __repr__(&self) -> String {
        format!(
            "OpticalResult(Cext={:.4e}, Csca={:.4e}, Cabs={:.4e}, g={:.4}, w={:.4})",
            self.c_ext, self.c_sca, self.c_abs, self.asymmetry_g, self.single_scatter_albedo
        )
    }
}

fn optical_result_to_py<'py>(result: &OpticalResult, py: Python<'py>) -> PyOpticalResult {
    PyOpticalResult {
        c_ext: result.c_ext,
        c_sca: result.c_sca,
        c_abs: result.c_abs,
        q_ext: result.q_ext,
        q_sca: result.q_sca,
        q_abs: result.q_abs,
        asymmetry_g: result.asymmetry_g,
        single_scatter_albedo: result.single_scatter_albedo,
        mueller_matrix: PyArray2::from_vec2(
            py,
            &result
                .mueller_matrix
                .iter()
                .map(|row| row.to_vec())
                .collect::<Vec<_>>(),
        )
        .unwrap()
        .into(),
        phase_function: PyArray1::from_vec(py, result.phase_function.clone()).into(),
        scattering_angles: PyArray1::from_vec(py, result.scattering_angles.clone()).into(),
        wavelength: result.wavelength,
        refractive_index_n: result.refractive_index_n,
        refractive_index_k: result.refractive_index_k,
        medium_index: result.medium_index,
        n_particles: result.n_particles,
        geometric_cross_section: result.geometric_cross_section,
        execution_time_ms: result.execution_time_ms,
    }
}

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
    #[pyo3(get)]
    pub anisotropy: f64,
    #[pyo3(get)]
    pub asphericity: f64,
    #[pyo3(get)]
    pub acylindricity: f64,
    pub coordinates_data: Vec<f64>,
    pub radii_data: Vec<f64>,
    pub rg_evolution_data: Vec<f64>,
    pub principal_moments_data: [f64; 3],
    pub principal_axes_data: [[f64; 3]; 3],
}

#[pymethods]
impl PySimulationResult {
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
    #[getter]
    fn radii<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.radii_data.clone())
    }
    #[getter]
    fn rg_evolution<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.rg_evolution_data.clone())
    }
    #[getter]
    fn principal_moments<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.principal_moments_data.to_vec())
    }
    #[getter]
    fn principal_axes<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray2<f64>> {
        let arr: Vec<Vec<f64>> = self
            .principal_axes_data
            .iter()
            .map(|a| a.to_vec())
            .collect();
        PyArray2::from_vec2(py, &arr).unwrap()
    }
}

impl From<SimulationResult> for PySimulationResult {
    fn from(r: SimulationResult) -> Self {
        let rg = if !r.rg_evolution.is_empty() {
            *r.rg_evolution.last().unwrap()
        } else {
            0.0
        };
        Self {
            fractal_dimension: r.fractal_dimension,
            fractal_dimension_std: r.fractal_dimension_std,
            prefactor: r.prefactor,
            radius_of_gyration: rg,
            porosity: r.porosity,
            coordination_mean: r.coordination_mean,
            coordination_std: r.coordination_std,
            execution_time_ms: r.execution_time_ms,
            seed: r.seed,
            anisotropy: r.anisotropy,
            asphericity: r.asphericity,
            acylindricity: r.acylindricity,
            coordinates_data: r
                .coordinates
                .iter()
                .flat_map(|c| c.iter())
                .copied()
                .collect(),
            radii_data: r.radii,
            rg_evolution_data: r.rg_evolution,
            principal_moments_data: r.principal_moments,
            principal_axes_data: r.principal_axes,
        }
    }
}

/// Result of a 2D projection operation.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PyProjectionResult {
    #[pyo3(get)]
    pub x: Vec<f64>,
    #[pyo3(get)]
    pub y: Vec<f64>,
    #[pyo3(get)]
    pub radii: Vec<f64>,
    #[pyo3(get)]
    pub azimuth: f64,
    #[pyo3(get)]
    pub elevation: f64,
    #[pyo3(get)]
    pub bounds: [f64; 4],
}

#[pymethods]
impl PyProjectionResult {
    fn coordinates_2d<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray2<f64>> {
        let coords: Vec<Vec<f64>> = self
            .x
            .iter()
            .zip(self.y.iter())
            .map(|(&x, &y)| vec![x, y])
            .collect();
        PyArray2::from_vec2(py, &coords).unwrap()
    }
    fn radii_array<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<f64>> {
        PyArray1::from_vec(py, self.radii.clone())
    }
}

impl From<ProjectionResult> for PyProjectionResult {
    fn from(r: ProjectionResult) -> Self {
        Self {
            x: r.x,
            y: r.y,
            radii: r.radii,
            azimuth: r.azimuth,
            elevation: r.elevation,
            bounds: r.bounds,
        }
    }
}

/// Sintering parameters for Python.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PySinteringParams {
    #[pyo3(get, set)]
    pub distribution_type: String,
    #[pyo3(get, set)]
    pub coefficient: f64,
    #[pyo3(get, set)]
    pub min_coefficient: f64,
    #[pyo3(get, set)]
    pub max_coefficient: f64,
    #[pyo3(get, set)]
    pub mean_coefficient: f64,
    #[pyo3(get, set)]
    pub std_coefficient: f64,
}

#[pymethods]
impl PySinteringParams {
    #[new]
    #[pyo3(signature = (distribution_type="fixed", coefficient=1.0, min_coefficient=0.85, max_coefficient=0.95, mean_coefficient=0.9, std_coefficient=0.05))]
    pub fn new(
        distribution_type: &str,
        coefficient: f64,
        min_coefficient: f64,
        max_coefficient: f64,
        mean_coefficient: f64,
        std_coefficient: f64,
    ) -> Self {
        Self {
            distribution_type: distribution_type.to_lowercase(),
            coefficient,
            min_coefficient,
            max_coefficient,
            mean_coefficient,
            std_coefficient,
        }
    }
    #[staticmethod]
    pub fn fixed(coefficient: f64) -> Self {
        Self::new("fixed", coefficient, 0.85, 0.95, 0.9, 0.05)
    }
    #[staticmethod]
    pub fn uniform(min: f64, max: f64) -> Self {
        Self::new("uniform", 1.0, min, max, 0.9, 0.05)
    }
    #[staticmethod]
    pub fn normal(mean: f64, std: f64) -> Self {
        Self::new("normal", 1.0, 0.85, 0.95, mean, std)
    }
}

/// Param classes re-exported from engine (as PyO3 wrappers)
#[pyclass]
#[derive(Debug, Clone)]
pub struct PyGranulated2012Params(Granulated2012Params);

#[pymethods]
impl PyGranulated2012Params {
    #[new]
    #[pyo3(signature = (npix, dpo, delta=1.1, correction_3d=false, pixel_min=10, pixel_max=240, npo_limit=5, escala=100.0, auto_threshold=true))]
    pub fn new(
        npix: f64,
        dpo: f64,
        delta: f64,
        correction_3d: bool,
        pixel_min: u8,
        pixel_max: u8,
        npo_limit: usize,
        escala: f64,
        auto_threshold: bool,
    ) -> Self {
        Self(Granulated2012Params::new(
            npix,
            dpo,
            delta,
            correction_3d,
            pixel_min,
            pixel_max,
            npo_limit,
            escala,
            auto_threshold,
        ))
    }
}

#[pyclass]
#[derive(Debug, Clone)]
pub struct PyVoxel2018Params(Voxel2018Params);

#[pymethods]
impl PyVoxel2018Params {
    #[new]
    #[pyo3(signature = (npix, escala=100.0, correction_3d=false, pixel_min=10, pixel_max=240, m_exponent=1.0, auto_threshold=true))]
    pub fn new(
        npix: f64,
        escala: f64,
        correction_3d: bool,
        pixel_min: u8,
        pixel_max: u8,
        m_exponent: f64,
        auto_threshold: bool,
    ) -> Self {
        Self(Voxel2018Params::new(
            npix,
            escala,
            correction_3d,
            pixel_min,
            pixel_max,
            m_exponent,
            auto_threshold,
        ))
    }
}

// ============================================================================
// Helper: parse sintering params from function args
// ============================================================================
fn parse_sintering(
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
) -> SinteringDistribution {
    match sintering_type.to_lowercase().as_str() {
        "uniform" => SinteringDistribution::uniform(sintering_min, sintering_max),
        "normal" => SinteringDistribution::normal(sintering_coeff, sintering_std),
        _ => SinteringDistribution::fixed(sintering_coeff),
    }
}

// ============================================================================
// Fractal analysis functions
// ============================================================================

#[pyfunction]
#[pyo3(signature = (binary_image, min_box_size=2, max_box_size=512, num_scales=20))]
fn box_counting(
    py: Python<'_>,
    binary_image: PyReadonlyArray2<'_, bool>,
    min_box_size: usize,
    max_box_size: usize,
    num_scales: usize,
) -> PyResult<PyFractalResult> {
    let image = binary_image.as_array();
    let (height, width) = (image.shape()[0], image.shape()[1]);
    let image_data: Vec<Vec<bool>> = (0..height)
        .map(|i| (0..width).map(|j| image[[i, j]]).collect())
        .collect();
    let result = py.allow_threads(|| {
        box_counting_internal(&image_data, min_box_size, max_box_size, num_scales)
    });
    Ok(result.into())
}

#[pyfunction]
#[pyo3(signature = (coordinates, precision=18))]
fn box_counting_3d(
    py: Python<'_>,
    coordinates: PyReadonlyArray2<'_, f64>,
    precision: u32,
) -> PyResult<PyFractalResult> {
    let coords = coordinates.as_array();
    let n = coords.shape()[0];
    if coords.shape()[1] != 3 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Coordinates must be Nx3 array",
        ));
    }
    let points: Vec<[f64; 3]> = (0..n)
        .map(|i| [coords[[i, 0]], coords[[i, 1]], coords[[i, 2]]])
        .collect();
    let result = py.allow_threads(|| box_counting_3d_morton(&points, precision));
    Ok(result.into())
}

#[pyfunction]
#[pyo3(signature = (centers, radii, points_per_sphere=100, precision=18))]
fn box_counting_agglomerate(
    py: Python<'_>,
    centers: PyReadonlyArray2<'_, f64>,
    radii: &Bound<'_, PyArray1<f64>>,
    points_per_sphere: usize,
    precision: u32,
) -> PyResult<PyFractalResult> {
    let centers_arr = centers.as_array();
    let radii_arr = radii.try_readonly()?;
    let radii_slice = radii_arr.as_slice()?;
    let n_spheres = centers_arr.shape()[0];
    if centers_arr.shape()[1] != 3 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Centers must be Nx3 array",
        ));
    }
    if radii_slice.len() != n_spheres {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Radii length must match number of centers",
        ));
    }
    let points: Vec<[f64; 3]> = (0..n_spheres)
        .flat_map(|i| {
            generate_sphere_points(
                centers_arr[[i, 0]],
                centers_arr[[i, 1]],
                centers_arr[[i, 2]],
                radii_slice[i],
                points_per_sphere,
            )
        })
        .collect();
    let result = py.allow_threads(|| box_counting_3d_morton(&points, precision));
    Ok(result.into())
}

#[pyfunction]
#[pyo3(signature = (image, npix, dpo, delta=1.1, correction_3d=false, pixel_min=10, pixel_max=240, npo_limit=5, escala=100.0, auto_threshold=true))]
fn fraktal_granulated_2012(
    _py: Python<'_>,
    image: PyReadonlyArray2<u8>,
    npix: f64,
    dpo: f64,
    delta: f64,
    correction_3d: bool,
    pixel_min: u8,
    pixel_max: u8,
    npo_limit: usize,
    escala: f64,
    auto_threshold: bool,
) -> PyResult<PyFraktalResult> {
    let params = Granulated2012Params::new(
        npix,
        dpo,
        delta,
        correction_3d,
        pixel_min,
        pixel_max,
        npo_limit,
        escala,
        auto_threshold,
    );
    let engine_image = numpy_to_engine_array2_u8(&image);
    let result = analyze_granulated_2012(engine_image.view(), &params);
    Ok(result.into())
}

#[pyfunction]
#[pyo3(signature = (image, npix, escala=100.0, correction_3d=false, pixel_min=10, pixel_max=240, m_exponent=1.0, auto_threshold=true))]
fn fraktal_voxel_2018(
    _py: Python<'_>,
    image: PyReadonlyArray2<u8>,
    npix: f64,
    escala: f64,
    correction_3d: bool,
    pixel_min: u8,
    pixel_max: u8,
    m_exponent: f64,
    auto_threshold: bool,
) -> PyResult<PyFraktalResult> {
    let params = Voxel2018Params::new(
        npix,
        escala,
        correction_3d,
        pixel_min,
        pixel_max,
        m_exponent,
        auto_threshold,
    );
    let engine_image = numpy_to_engine_array2_u8(&image);
    let result = analyze_voxel_2018(engine_image.view(), &params);
    Ok(result.into())
}

// ============================================================================
// Projection functions
// ============================================================================

#[pyfunction]
#[pyo3(signature = (coordinates, radii, azimuth=0.0, elevation=0.0))]
fn project_to_2d(
    _py: Python<'_>,
    coordinates: PyReadonlyArray2<f64>,
    radii: PyReadonlyArray1<f64>,
    azimuth: f64,
    elevation: f64,
) -> PyResult<PyProjectionResult> {
    let coords = coordinates.as_array();
    let radii_arr = radii.as_array();
    let n = coords.shape()[0];
    if coords.shape().len() < 2 || coords.shape()[1] < 3 {
        return Err(pyo3::exceptions::PyValueError::new_err(format!(
            "coordinates must have shape (N, 3), got {:?}",
            coords.shape()
        )));
    }
    if radii_arr.len() != n {
        return Err(pyo3::exceptions::PyValueError::new_err(format!(
            "radii length ({}) must match coordinates ({})",
            radii_arr.len(),
            n
        )));
    }
    let coords_vec: Vec<[f64; 3]> = (0..n)
        .map(|i| [coords[[i, 0]], coords[[i, 1]], coords[[i, 2]]])
        .collect();
    let radii_vec: Vec<f64> = radii_arr.iter().copied().collect();
    let result = project_to_2d_internal(&coords_vec, &radii_vec, azimuth, elevation);
    Ok(result.into())
}

#[pyfunction]
#[pyo3(signature = (coordinates, radii, azimuth_start=0.0, azimuth_end=150.0, azimuth_step=30.0, elevation_start=0.0, elevation_end=150.0, elevation_step=30.0))]
fn project_batch(
    _py: Python<'_>,
    coordinates: PyReadonlyArray2<f64>,
    radii: PyReadonlyArray1<f64>,
    azimuth_start: f64,
    azimuth_end: f64,
    azimuth_step: f64,
    elevation_start: f64,
    elevation_end: f64,
    elevation_step: f64,
) -> PyResult<Vec<PyProjectionResult>> {
    let coords = coordinates.as_array();
    let radii_arr = radii.as_array();
    let n = coords.shape()[0];
    let coords_vec: Vec<[f64; 3]> = (0..n)
        .map(|i| [coords[[i, 0]], coords[[i, 1]], coords[[i, 2]]])
        .collect();
    let radii_vec: Vec<f64> = radii_arr.iter().copied().collect();
    let results = project_batch_internal(
        &coords_vec,
        &radii_vec,
        azimuth_start,
        azimuth_end,
        azimuth_step,
        elevation_start,
        elevation_end,
        elevation_step,
    );
    Ok(results.into_iter().map(|r| r.into()).collect())
}

// ============================================================================
// Optics functions
// ============================================================================

#[pyfunction]
#[pyo3(signature = (coordinates, radii, wavelength=550.0, refractive_index_n=1.95, refractive_index_k=0.79, medium_index=1.0, dipoles_per_wavelength=10.0, polarizability="ldr", solver_tolerance=1e-5, max_iterations=1000))]
fn run_dda(
    py: Python<'_>,
    coordinates: PyReadonlyArray1<f64>,
    radii: PyReadonlyArray1<f64>,
    wavelength: f64,
    refractive_index_n: f64,
    refractive_index_k: f64,
    medium_index: f64,
    dipoles_per_wavelength: f64,
    polarizability: &str,
    solver_tolerance: f64,
    max_iterations: usize,
) -> PyResult<PyOpticalResult> {
    let coords_flat: Vec<f64> = coordinates.as_slice()?.to_vec();
    let radii_vec: Vec<f64> = radii.as_slice()?.to_vec();
    if coords_flat.len() % 3 != 0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "coordinates must have length divisible by 3",
        ));
    }
    if coords_flat.len() / 3 != radii_vec.len() {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "coordinates and radii must have consistent sizes",
        ));
    }
    let coords: Vec<[f64; 3]> = coords_flat.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
    let pol_type = Polarizability::from_str(polarizability);
    let result = compute_dda(
        &coords,
        &radii_vec,
        wavelength,
        refractive_index_n,
        refractive_index_k,
        medium_index,
        dipoles_per_wavelength,
        pol_type,
        solver_tolerance,
        max_iterations,
    );
    Ok(optical_result_to_py(&result, py))
}

#[pyfunction]
#[pyo3(signature = (coordinates, radii, wavelength=550.0, refractive_index_n=1.95, refractive_index_k=0.79, medium_index=1.0, n_max=None, orientation_averaging=false, n_angles=181))]
fn run_tmatrix(
    py: Python<'_>,
    coordinates: PyReadonlyArray1<f64>,
    radii: PyReadonlyArray1<f64>,
    wavelength: f64,
    refractive_index_n: f64,
    refractive_index_k: f64,
    medium_index: f64,
    n_max: Option<usize>,
    orientation_averaging: bool,
    n_angles: usize,
) -> PyResult<PyOpticalResult> {
    let coords_flat: Vec<f64> = coordinates.as_slice()?.to_vec();
    let radii_vec: Vec<f64> = radii.as_slice()?.to_vec();
    if coords_flat.len() % 3 != 0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "coordinates must have length divisible by 3",
        ));
    }
    if coords_flat.len() / 3 != radii_vec.len() {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "coordinates and radii must have consistent sizes",
        ));
    }
    let coords: Vec<[f64; 3]> = coords_flat.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
    let result = compute_tmatrix(
        &coords,
        &radii_vec,
        wavelength,
        refractive_index_n,
        refractive_index_k,
        medium_index,
        n_max,
        orientation_averaging,
        n_angles,
    );
    Ok(optical_result_to_py(&result, py))
}

// ============================================================================
// Simulation functions - macro to reduce boilerplate
// ============================================================================

macro_rules! sim_function {
    ($name:ident, $internal:path, $params_type:path, { $($field:ident : $fty:ty = $default:expr),* $(,)? }, $build_params:expr) => {
        #[pyfunction]
        #[pyo3(signature = ($($field = $default),*))]
        fn $name(py: Python<'_>, $($field: $fty),*) -> PyResult<PySimulationResult> {
            let seed_val = seed.unwrap_or_else(rand::random);
            let radius_max_val = radius_max.unwrap_or(radius_min);
            let sintering = parse_sintering(sintering_coeff, sintering_type, sintering_min, sintering_max, sintering_std);
            let params = $build_params(seed_val, radius_max_val, sintering);
            let result = py.allow_threads(|| $internal(params, seed_val));
            Ok(result.into())
        }
    };
}

// DLA
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, lattice_size=200, radius_min=1.0, radius_max=None, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
fn run_dla(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    lattice_size: usize,
    radius_min: f64,
    radius_max: Option<f64>,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);
    let sintering = parse_sintering(
        sintering_coeff,
        sintering_type,
        sintering_min,
        sintering_max,
        sintering_std,
    );
    let params = aglogen_engine::simulation::dla::DlaParams {
        n_particles,
        sticking_probability,
        lattice_size,
        radius_min,
        radius_max,
        sintering,
        ..Default::default()
    };
    let result =
        py.allow_threads(|| aglogen_engine::simulation::dla::run_dla_internal(params, seed));
    Ok(result.into())
}

// CCA
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, radius_min=1.0, radius_max=None, box_size=100.0, single_agglomerate=true, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
fn run_cca(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    box_size: f64,
    single_agglomerate: bool,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);
    let sintering = parse_sintering(
        sintering_coeff,
        sintering_type,
        sintering_min,
        sintering_max,
        sintering_std,
    );
    let params = aglogen_engine::simulation::cca::CcaParams {
        n_particles,
        sticking_probability,
        radius_min,
        radius_max,
        box_size,
        single_agglomerate,
        sintering,
        ..Default::default()
    };
    let result =
        py.allow_threads(|| aglogen_engine::simulation::cca::run_cca_internal(params, seed));
    Ok(result.into())
}

// Ballistic
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, radius_min=1.0, radius_max=None, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
fn run_ballistic(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);
    let sintering = parse_sintering(
        sintering_coeff,
        sintering_type,
        sintering_min,
        sintering_max,
        sintering_std,
    );
    let params = aglogen_engine::simulation::ballistic::BallisticParams {
        n_particles,
        sticking_probability,
        radius_min,
        radius_max,
        sintering,
        ..Default::default()
    };
    let result = py.allow_threads(|| {
        aglogen_engine::simulation::ballistic::run_ballistic_internal(params, seed)
    });
    Ok(result.into())
}

// Ballistic CC
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, radius_min=1.0, radius_max=None, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
fn run_ballistic_cc(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);
    let sintering = parse_sintering(
        sintering_coeff,
        sintering_type,
        sintering_min,
        sintering_max,
        sintering_std,
    );
    let params = aglogen_engine::simulation::ballistic_cc::BallisticCcParams {
        n_particles,
        sticking_probability,
        radius_min,
        radius_max,
        sintering,
        ..Default::default()
    };
    let result = py.allow_threads(|| {
        aglogen_engine::simulation::ballistic_cc::run_ballistic_cc_internal(params, seed)
    });
    Ok(result.into())
}

// Tunable PC
#[pyfunction]
#[pyo3(signature = (n_particles, target_df=1.8, target_kf=1.3, radius_min=1.0, radius_max=None, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
fn run_tunable(
    py: Python<'_>,
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);
    let sintering = parse_sintering(
        sintering_coeff,
        sintering_type,
        sintering_min,
        sintering_max,
        sintering_std,
    );
    let params = aglogen_engine::simulation::tunable::TunableParams {
        n_particles,
        target_df,
        target_kf,
        radius_min,
        radius_max,
        sintering,
        ..Default::default()
    };
    let result = py
        .allow_threads(|| aglogen_engine::simulation::tunable::run_tunable_internal(params, seed));
    Ok(result.into())
}

// Tunable CC
#[pyfunction]
#[pyo3(signature = (n_particles, target_df=1.8, target_kf=1.3, radius_min=1.0, radius_max=None, seed_cluster_size=None, max_rotation_attempts=50, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None))]
fn run_tunable_cc(
    py: Python<'_>,
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    radius_min: f64,
    radius_max: Option<f64>,
    seed_cluster_size: Option<usize>,
    max_rotation_attempts: usize,
    sintering_coeff: f64,
    sintering_type: &str,
    sintering_min: f64,
    sintering_max: f64,
    sintering_std: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let radius_max = radius_max.unwrap_or(radius_min);
    let sintering = parse_sintering(
        sintering_coeff,
        sintering_type,
        sintering_min,
        sintering_max,
        sintering_std,
    );
    let seed_strategy = match seed_cluster_size {
        Some(size) if size > 1 => {
            aglogen_engine::simulation::tunable_cc::SeedStrategy::TunablePc { cluster_size: size }
        }
        _ => aglogen_engine::simulation::tunable_cc::SeedStrategy::Monomers,
    };
    let params = aglogen_engine::simulation::tunable_cc::TunableCcParams {
        n_particles,
        target_df,
        target_kf,
        radius_min,
        radius_max,
        seed_strategy,
        max_rotation_attempts,
        sintering,
        ..Default::default()
    };
    let result = py.allow_threads(|| {
        aglogen_engine::simulation::tunable_cc::run_tunable_cc_internal(params, seed, None)
    });
    Ok(result.into())
}

// FracVAL
#[pyfunction]
#[pyo3(signature = (n_particles=100, target_df=1.8, target_kf=1.3, geometric_mean=1.0, geometric_std=1.0, max_placement_attempts=1000, seed=None))]
fn run_fracval(
    _py: Python<'_>,
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    geometric_mean: f64,
    geometric_std: f64,
    max_placement_attempts: usize,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    if n_particles < 2 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "n_particles must be >= 2",
        ));
    }
    if target_df < 1.0 || target_df > 3.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "target_df must be in range [1.0, 3.0]",
        ));
    }
    if target_kf < 0.1 || target_kf > 2.7 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "target_kf must be in range [0.1, 2.7]",
        ));
    }
    if geometric_std < 1.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "geometric_std must be >= 1.0",
        ));
    }
    let seed = seed.unwrap_or_else(rand::random);
    let result = aglogen_engine::simulation::fracval::run_fracval_internal(
        n_particles,
        target_df,
        target_kf,
        geometric_mean,
        geometric_std,
        max_placement_attempts,
        seed,
    );
    Ok(result.into())
}

// GCCA
#[pyfunction]
#[pyo3(signature = (n_particles=100, target_df=1.8, target_kf=1.3, radius_min=1.0, radius_max=1.0, split_strategy="symmetric", stochastic_mean_ratio=0.5, stochastic_std_ratio=0.1, max_placement_attempts=1000, seed=None))]
fn run_gcca(
    _py: Python<'_>,
    n_particles: usize,
    target_df: f64,
    target_kf: f64,
    radius_min: f64,
    radius_max: f64,
    split_strategy: &str,
    stochastic_mean_ratio: f64,
    stochastic_std_ratio: f64,
    max_placement_attempts: usize,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    if n_particles < 2 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "n_particles must be >= 2",
        ));
    }
    if target_df < 1.0 || target_df > 3.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "target_df must be in range [1.0, 3.0]",
        ));
    }
    if target_kf < 0.1 || target_kf > 2.7 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "target_kf must be in range [0.1, 2.7]",
        ));
    }
    let strategy = match split_strategy.to_lowercase().as_str() {
        "symmetric" => aglogen_engine::simulation::gcca::SplitStrategy::Symmetric,
        "particle_cluster" | "pc" => {
            aglogen_engine::simulation::gcca::SplitStrategy::ParticleCluster
        }
        "stochastic" => aglogen_engine::simulation::gcca::SplitStrategy::Stochastic {
            mean_ratio: stochastic_mean_ratio,
            std_ratio: stochastic_std_ratio,
        },
        _ => {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "split_strategy must be 'symmetric', 'particle_cluster', or 'stochastic'",
            ))
        }
    };
    let seed = seed.unwrap_or_else(rand::random);
    let result = aglogen_engine::simulation::gcca::run_gcca_internal(
        n_particles,
        target_df,
        target_kf,
        radius_min,
        radius_max,
        strategy,
        max_placement_attempts,
        seed,
    );
    Ok(result.into())
}

// Box RFA
#[pyfunction]
#[pyo3(signature = (target_df=1.8, n_levels=6, particle_radius=1.0, connectivity_method="random_walk", target_n_particles=None, single_aggregate=true, seed=None))]
fn run_box_rfa(
    _py: Python<'_>,
    target_df: f64,
    n_levels: usize,
    particle_radius: f64,
    connectivity_method: &str,
    target_n_particles: Option<usize>,
    single_aggregate: bool,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(rand::random);
    let conn_method = match connectivity_method.to_lowercase().as_str() {
        "nearest_neighbor" | "nearest" => {
            aglogen_engine::simulation::box_rfa::ConnectivityMethod::NearestNeighbor
        }
        _ => aglogen_engine::simulation::box_rfa::ConnectivityMethod::RandomWalk,
    };
    let params = aglogen_engine::simulation::box_rfa::BoxRfaParams {
        target_df,
        n_levels,
        particle_radius,
        connectivity_method: conn_method,
        target_n_particles,
        single_aggregate,
    };
    let result = aglogen_engine::simulation::box_rfa::run_box_rfa_internal(params, seed);
    Ok(result.into())
}

// Structure factor
#[pyfunction]
#[pyo3(signature = (coordinates, q_min=0.01, q_max=10.0, n_q=50))]
fn structure_factor(
    _py: Python<'_>,
    coordinates: Vec<f64>,
    q_min: f64,
    q_max: f64,
    n_q: usize,
) -> PyResult<(Vec<f64>, Vec<f64>)> {
    if coordinates.len() % 3 != 0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "coordinates must have length divisible by 3",
        ));
    }
    let coords: Vec<[f64; 3]> = coordinates.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
    let log_q_min = q_min.ln();
    let log_q_max = q_max.ln();
    let q_values: Vec<f64> = (0..n_q)
        .map(|i| (log_q_min + (log_q_max - log_q_min) * i as f64 / (n_q - 1) as f64).exp())
        .collect();
    let s_values = compute_structure_factor(&coords, &q_values);
    Ok((q_values, s_values))
}

#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ============================================================================
// Module registration
// ============================================================================

#[pymodule]
fn aglogen_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Simulation functions
    m.add_function(wrap_pyfunction!(run_dla, m)?)?;
    m.add_function(wrap_pyfunction!(run_cca, m)?)?;
    m.add_function(wrap_pyfunction!(run_ballistic, m)?)?;
    m.add_function(wrap_pyfunction!(run_ballistic_cc, m)?)?;
    m.add_function(wrap_pyfunction!(run_tunable, m)?)?;
    m.add_function(wrap_pyfunction!(run_tunable_cc, m)?)?;
    m.add_function(wrap_pyfunction!(run_fracval, m)?)?;
    m.add_function(wrap_pyfunction!(run_gcca, m)?)?;
    m.add_function(wrap_pyfunction!(run_box_rfa, m)?)?;
    m.add_function(wrap_pyfunction!(structure_factor, m)?)?;

    // Fractal analysis functions
    m.add_function(wrap_pyfunction!(box_counting, m)?)?;
    m.add_function(wrap_pyfunction!(box_counting_3d, m)?)?;
    m.add_function(wrap_pyfunction!(box_counting_agglomerate, m)?)?;
    m.add_function(wrap_pyfunction!(fraktal_granulated_2012, m)?)?;
    m.add_function(wrap_pyfunction!(fraktal_voxel_2018, m)?)?;

    // Projection functions
    m.add_function(wrap_pyfunction!(project_to_2d, m)?)?;
    m.add_function(wrap_pyfunction!(project_batch, m)?)?;

    // Optical properties functions
    m.add_function(wrap_pyfunction!(run_tmatrix, m)?)?;
    m.add_function(wrap_pyfunction!(run_dda, m)?)?;

    // Utility functions
    m.add_function(wrap_pyfunction!(version, m)?)?;

    // Result classes
    m.add_class::<PySimulationResult>()?;
    m.add_class::<PyFractalResult>()?;
    m.add_class::<PyProjectionResult>()?;
    m.add_class::<PyFraktalResult>()?;
    m.add_class::<PyGranulated2012Params>()?;
    m.add_class::<PyVoxel2018Params>()?;
    m.add_class::<PySinteringParams>()?;
    m.add_class::<PyOpticalResult>()?;

    Ok(())
}
