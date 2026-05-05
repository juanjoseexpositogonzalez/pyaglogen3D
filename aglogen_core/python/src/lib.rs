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
use aglogen_engine::fractal::fraktal::batch::{
    analyze_batch_broadcast as engine_analyze_batch_broadcast, AutocalibrateSource, BatchAlgorithm,
    BatchInput, ImageInputVariant,
};
// Re-export for per-image-scale binding (T3.2)
// analyze_batch is used directly in analyze_fraktal_batch_per_image_scale
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
use aglogen_engine::projection::directions::{
    generate_fibonacci as engine_generate_fibonacci, generate_grid as engine_generate_grid,
    Direction,
};
use aglogen_engine::projection::{
    project_batch_internal, project_directions_internal, project_to_2d_internal, ProjectionResult,
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

/// Generate a rectangular Az × El grid of viewing directions with exact
/// pole dedup. Returns a list of `(azimuth_deg, elevation_deg)` tuples.
///
/// Output count is exactly `n_az * (n_el - 2) + 2` (see projection-export
/// contract R1). Poles appear once each at the first and last positions.
#[pyfunction]
fn generate_direction_grid(n_az: usize, n_el: usize) -> PyResult<Vec<(f64, f64)>> {
    if n_az == 0 {
        return Err(pyo3::exceptions::PyValueError::new_err("n_az must be >= 1"));
    }
    if n_el < 2 {
        return Err(pyo3::exceptions::PyValueError::new_err("n_el must be >= 2"));
    }
    let dirs = engine_generate_grid(n_az, n_el);
    Ok(dirs
        .into_iter()
        .map(|d| (d.azimuth_deg, d.elevation_deg))
        .collect())
}

/// Generate `n` directions on the unit sphere via a golden-angle Fibonacci
/// spiral lattice. Returns a list of `(azimuth_deg, elevation_deg)` tuples.
///
/// Output count is exactly `n` (see projection-export contract R2).
#[pyfunction]
fn generate_direction_fibonacci(n: usize) -> PyResult<Vec<(f64, f64)>> {
    if n == 0 {
        return Err(pyo3::exceptions::PyValueError::new_err("n must be >= 1"));
    }
    let dirs = engine_generate_fibonacci(n);
    Ok(dirs
        .into_iter()
        .map(|d| (d.azimuth_deg, d.elevation_deg))
        .collect())
}

/// Project an aggregate under an arbitrary list of `(azimuth, elevation)`
/// directions, returning one [`PyProjectionResult`] per direction in input
/// order. Mirrors the return shape of `project_batch`.
#[pyfunction]
fn project_directions(
    py: Python<'_>,
    coordinates: PyReadonlyArray2<f64>,
    radii: PyReadonlyArray1<f64>,
    directions: Vec<(f64, f64)>,
) -> PyResult<Vec<PyProjectionResult>> {
    let coords = coordinates.as_array();
    let coords_shape = coords.shape();
    if coords_shape.len() != 2 || coords_shape[1] != 3 {
        return Err(pyo3::exceptions::PyValueError::new_err(format!(
            "coordinates must have shape (N, 3), got {:?}",
            coords_shape
        )));
    }
    let n = coords_shape[0];
    let radii_arr = radii.as_array();
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
    let dirs: Vec<Direction> = directions
        .into_iter()
        .map(|(az, el)| Direction {
            azimuth_deg: az,
            elevation_deg: el,
        })
        .collect();

    let results = py.allow_threads(|| project_directions_internal(&coords_vec, &radii_vec, &dirs));
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

/// Parse a Python string into the engine `SeedType` enum.
///
/// Accepts "monomers" (default / None), "dimers", "trimers".
/// Returns `Err(String)` for unrecognized values.
fn parse_seed_type(
    value: Option<&str>,
) -> Result<aglogen_engine::simulation::tunable_cc::SeedType, String> {
    use aglogen_engine::simulation::tunable_cc::SeedType;
    match value {
        None | Some("monomers") => Ok(SeedType::Monomers),
        Some("dimers") => Ok(SeedType::Dimers),
        Some("trimers") => Ok(SeedType::Trimers),
        Some(other) => Err(format!(
            "invalid seed_type: '{}'. Must be one of: monomers, dimers, trimers",
            other
        )),
    }
}

// Tunable CC
#[pyfunction]
#[pyo3(signature = (n_particles, target_df=1.8, target_kf=1.3, radius_min=1.0, radius_max=None, seed_cluster_size=None, max_rotation_attempts=50, sintering_coeff=1.0, sintering_type="fixed", sintering_min=0.85, sintering_max=0.95, sintering_std=0.05, seed=None, seed_type=None))]
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
    seed_type: Option<&str>,
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

    // Parse seed_type string → SeedType enum. The new `seed_type` parameter
    // is the canonical way to control the initial particle pool. The legacy
    // `seed_cluster_size → SeedStrategy::TunablePc` path is preserved for
    // backward compatibility: callers that omit `seed_type` (or pass None)
    // default to Monomers, matching existing behavior.
    let seed_type_enum =
        parse_seed_type(seed_type).map_err(pyo3::exceptions::PyValueError::new_err)?;

    #[allow(deprecated)]
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
        seed_type: seed_type_enum,
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

// ============================================================================
// Helper: parse ImageInputVariant from string
// ============================================================================

/// Parse a string into [`ImageInputVariant`]. Case-insensitive.
///
/// Valid values: `"presentation"`, `"scientific"`.
fn parse_image_input_variant(s: &str) -> Result<ImageInputVariant, String> {
    match s.to_lowercase().as_str() {
        "presentation" => Ok(ImageInputVariant::Presentation),
        "scientific" => Ok(ImageInputVariant::Scientific),
        other => Err(format!(
            "Invalid input_variant '{}'. Use 'presentation' or 'scientific'.",
            other
        )),
    }
}

// ============================================================================
// FRAKTAL batch analysis binding
// ============================================================================

/// Run FRAKTAL analysis on a batch of pre-decoded grayscale images.
///
/// `images` is a list of 2-D uint8 numpy arrays (H×W, grayscale — the
/// caller is responsible for decoding PNG/TIFF bytes with Pillow before
/// calling this). `pixels_per_100nm` is the scale shared by every image.
///
/// When `autocalibrate_dpo` is True, the one-shot policy from R3 applies:
/// dpo is estimated on `image[0]`; on failure it is retried on
/// `image[N/2]`; on a second failure this function raises `ValueError`.
/// When False, `dpo_hint` is used as the dpo for every image.
///
/// Returns a dict with keys:
///   - `results`: list of per-image dicts `{index, fractal_dimension,
///     prefactor, r_squared, n_particles_counted, dpo_used, error}`
///   - `dpo_used`: float — the dpo value actually used
///   - `autocalibrate_source`: one of `"manual" | "image0" |
///     "image_n_half"`
///   - `autocalibrate_image_index`: int | None — which image provided
///     the dpo (None when `autocalibrate_source == "manual"`)
#[pyfunction]
#[pyo3(signature = (images, pixels_per_100nm, autocalibrate_dpo, dpo_hint, algorithm))]
fn analyze_fraktal_batch<'py>(
    py: Python<'py>,
    images: Vec<PyReadonlyArray2<'py, u8>>,
    pixels_per_100nm: f64,
    autocalibrate_dpo: bool,
    dpo_hint: f64,
    algorithm: &str,
) -> PyResult<Bound<'py, pyo3::types::PyDict>> {
    let algo = match algorithm.to_lowercase().as_str() {
        "granulated_2012" | "granulated" => BatchAlgorithm::Granulated2012,
        "voxel_2018" | "voxel" => BatchAlgorithm::Voxel2018,
        other => {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "Unknown algorithm: {}. Use 'granulated_2012' or 'voxel_2018'.",
                other
            )))
        }
    };

    // Copy each numpy array into an owned Array2<u8> so the engine can
    // operate without borrowing from Python (required to drop the GIL).
    let engine_images: Vec<Array2<u8>> = images.iter().map(numpy_to_engine_array2_u8).collect();

    let output = py
        .allow_threads(|| {
            engine_analyze_batch_broadcast(
                engine_images,
                pixels_per_100nm,
                autocalibrate_dpo,
                dpo_hint,
                algo,
            )
        })
        .map_err(pyo3::exceptions::PyValueError::new_err)?;

    let n = output.results.len();
    let dict = pyo3::types::PyDict::new(py);

    let results_list = pyo3::types::PyList::empty(py);
    for r in output.results.iter() {
        let item = pyo3::types::PyDict::new(py);
        item.set_item("index", r.index)?;
        item.set_item("fractal_dimension", r.fractal_dimension)?;
        item.set_item("prefactor", r.prefactor)?;
        item.set_item("r_squared", r.r_squared)?;
        item.set_item("n_particles_counted", r.n_particles_counted)?;
        item.set_item("dpo_used", r.dpo_used)?;
        item.set_item("rg_nm", r.rg_nm)?;
        item.set_item("error", r.error.clone())?;
        // PYA-13: bisection diagnostic fields
        item.set_item("bisection_iterations", r.bisection_iterations)?;
        item.set_item("bisection_residual", r.bisection_residual)?;
        item.set_item("failure_reason", r.failure_reason.clone())?;
        item.set_item("df_estimate", r.df_estimate)?;
        item.set_item("quality", r.quality.clone())?;
        results_list.append(item)?;
    }
    dict.set_item("results", results_list)?;
    dict.set_item("dpo_used", output.dpo_used)?;
    dict.set_item("autocalibrate_source", output.autocalibrate_source.as_str())?;
    let image_idx: Option<usize> = match output.autocalibrate_source {
        AutocalibrateSource::Manual => None,
        _ => output.autocalibrate_source.image_index(n),
    };
    dict.set_item("autocalibrate_image_index", image_idx)?;

    Ok(dict)
}

// ============================================================================
// 2D bounding box binding
// ============================================================================

/// Compute the 2D bounding box from 3D positions projected at a given
/// viewing direction (azimuth/elevation).
///
/// Returns `(bbox_width, bbox_height, projected_2d_positions, radii)`.
/// `projected_2d_positions` is a list of `(x, y)` tuples in engine units.
///
/// This is the Python-facing wrapper around `engine::projection::compute_2d_bbox`.
/// It is the single source of truth for 2D bbox dimensions used by both render
/// modes and per-image scale calculation.
#[pyfunction]
#[pyo3(text_signature = "(coordinates, radii, az_deg, el_deg)")]
fn compute_2d_bbox(
    coordinates: Vec<(f64, f64, f64)>,
    radii: Vec<f64>,
    az_deg: f64,
    el_deg: f64,
) -> PyResult<(f64, f64, Vec<(f64, f64)>)> {
    if coordinates.len() != radii.len() {
        return Err(pyo3::exceptions::PyValueError::new_err(format!(
            "coordinates length ({}) must match radii length ({})",
            coordinates.len(),
            radii.len()
        )));
    }
    let coords: Vec<[f64; 3]> = coordinates.iter().map(|&(x, y, z)| [x, y, z]).collect();

    let result = aglogen_engine::projection::compute_2d_bbox(&coords, &radii, az_deg, el_deg);

    Ok((result.bbox_width, result.bbox_height, result.positions))
}

// ============================================================================
// FRAKTAL batch per-image scale binding
// ============================================================================

/// Run FRAKTAL batch analysis with per-image scale values.
///
/// `pixels_per_100nm` is a list of per-image scale values (one per image).
/// Unlike `analyze_fraktal_batch` which broadcasts a single float,
/// this function accepts a distinct scale for each image.
///
/// Returns a dict with the same shape as `analyze_fraktal_batch`,
/// plus `pixels_per_100nm_used` per image in each result entry.
#[pyfunction]
#[pyo3(signature = (images, pixels_per_100nm, autocalibrate_dpo, dpo_hint, algorithm, input_variants=None))]
fn analyze_fraktal_batch_per_image_scale<'py>(
    py: Python<'py>,
    images: Vec<PyReadonlyArray2<'py, u8>>,
    pixels_per_100nm: Vec<f64>,
    autocalibrate_dpo: bool,
    dpo_hint: f64,
    algorithm: &str,
    input_variants: Option<Vec<String>>,
) -> PyResult<Bound<'py, pyo3::types::PyDict>> {
    let algo = match algorithm.to_lowercase().as_str() {
        "granulated_2012" | "granulated" => BatchAlgorithm::Granulated2012,
        "voxel_2018" | "voxel" => BatchAlgorithm::Voxel2018,
        other => {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "Unknown algorithm: {}. Use 'granulated_2012' or 'voxel_2018'.",
                other
            )))
        }
    };

    let engine_images: Vec<Array2<u8>> = images.iter().map(numpy_to_engine_array2_u8).collect();

    // Parse input_variants: None → empty (default to Presentation),
    // Some → validate length and parse each string.
    let variants = match input_variants {
        None => vec![],
        Some(ref strs) => {
            if strs.len() != engine_images.len() {
                return Err(pyo3::exceptions::PyValueError::new_err(format!(
                    "input_variants length ({}) must match images length ({})",
                    strs.len(),
                    engine_images.len()
                )));
            }
            strs.iter()
                .map(|s| {
                    parse_image_input_variant(s).map_err(pyo3::exceptions::PyValueError::new_err)
                })
                .collect::<PyResult<Vec<_>>>()?
        }
    };

    let input = BatchInput {
        images: engine_images,
        pixels_per_100nm,
        input_variants: variants,
        autocalibrate_dpo,
        dpo_hint,
        algorithm: algo,
    };

    let output = py
        .allow_threads(|| aglogen_engine::fractal::fraktal::batch::analyze_batch(input))
        .map_err(pyo3::exceptions::PyValueError::new_err)?;

    let n = output.results.len();
    let dict = pyo3::types::PyDict::new(py);

    let results_list = pyo3::types::PyList::empty(py);
    for r in output.results.iter() {
        let item = pyo3::types::PyDict::new(py);
        item.set_item("index", r.index)?;
        item.set_item("fractal_dimension", r.fractal_dimension)?;
        item.set_item("prefactor", r.prefactor)?;
        item.set_item("r_squared", r.r_squared)?;
        item.set_item("n_particles_counted", r.n_particles_counted)?;
        item.set_item("dpo_used", r.dpo_used)?;
        item.set_item("pixels_per_100nm_used", r.pixels_per_100nm_used)?;
        item.set_item("rg_nm", r.rg_nm)?;
        item.set_item("error", r.error.clone())?;
        // PYA-13: bisection diagnostic fields
        item.set_item("bisection_iterations", r.bisection_iterations)?;
        item.set_item("bisection_residual", r.bisection_residual)?;
        item.set_item("failure_reason", r.failure_reason.clone())?;
        item.set_item("df_estimate", r.df_estimate)?;
        item.set_item("quality", r.quality.clone())?;
        results_list.append(item)?;
    }
    dict.set_item("results", results_list)?;
    dict.set_item("dpo_used", output.dpo_used)?;
    dict.set_item("autocalibrate_source", output.autocalibrate_source.as_str())?;
    let image_idx: Option<usize> = match output.autocalibrate_source {
        AutocalibrateSource::Manual => None,
        _ => output.autocalibrate_source.image_index(n),
    };
    dict.set_item("autocalibrate_image_index", image_idx)?;

    Ok(dict)
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
    m.add_function(wrap_pyfunction!(analyze_fraktal_batch, m)?)?;
    m.add_function(wrap_pyfunction!(analyze_fraktal_batch_per_image_scale, m)?)?;

    // Projection functions
    m.add_function(wrap_pyfunction!(project_to_2d, m)?)?;
    m.add_function(wrap_pyfunction!(project_batch, m)?)?;
    m.add_function(wrap_pyfunction!(generate_direction_grid, m)?)?;
    m.add_function(wrap_pyfunction!(generate_direction_fibonacci, m)?)?;
    m.add_function(wrap_pyfunction!(project_directions, m)?)?;
    m.add_function(wrap_pyfunction!(compute_2d_bbox, m)?)?;

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

// ============================================================================
// Tests for binding conversion logic (no Python interpreter needed)
// ============================================================================
#[cfg(test)]
mod tests {
    use super::parse_image_input_variant;
    use aglogen_engine::fractal::fraktal::batch::{
        analyze_batch, analyze_batch_broadcast, BatchAlgorithm, BatchInput, ImageInputVariant,
    };
    use aglogen_engine::projection::compute_2d_bbox;
    use ndarray::Array2;

    // ── T2.5: string→enum conversion tests ────────────────────────
    #[test]
    fn test_parse_image_input_variant_presentation() {
        assert_eq!(
            parse_image_input_variant("presentation").unwrap(),
            ImageInputVariant::Presentation
        );
        assert_eq!(
            parse_image_input_variant("Presentation").unwrap(),
            ImageInputVariant::Presentation
        );
        assert_eq!(
            parse_image_input_variant("PRESENTATION").unwrap(),
            ImageInputVariant::Presentation
        );
    }

    #[test]
    fn test_parse_image_input_variant_scientific() {
        assert_eq!(
            parse_image_input_variant("scientific").unwrap(),
            ImageInputVariant::Scientific
        );
        assert_eq!(
            parse_image_input_variant("Scientific").unwrap(),
            ImageInputVariant::Scientific
        );
    }

    #[test]
    fn test_parse_image_input_variant_invalid() {
        let err = parse_image_input_variant("unknown").unwrap_err();
        assert!(err.contains("unknown"));
    }

    // ── T3.1: compute_2d_bbox binding conversion logic ────────────
    #[test]
    fn compute_2d_bbox_binding_conversion_single_particle() {
        // Mirrors the binding's conversion: Vec<(f64,f64,f64)> → Vec<[f64;3]>
        let positions: Vec<(f64, f64, f64)> = vec![(0.0, 0.0, 0.0)];
        let radii: Vec<f64> = vec![1.5];
        let coords: Vec<[f64; 3]> = positions.iter().map(|&(x, y, z)| [x, y, z]).collect();

        let result = compute_2d_bbox(&coords, &radii, 0.0, 0.0);
        // Single particle at origin with radius 1.5: bbox = 2*r = 3.0
        assert!(
            (result.bbox_width - 3.0).abs() < 1e-10,
            "bbox_width should be 3.0, got {}",
            result.bbox_width
        );
        assert!(
            (result.bbox_height - 3.0).abs() < 1e-10,
            "bbox_height should be 3.0, got {}",
            result.bbox_height
        );
        assert_eq!(result.positions.len(), 1);
    }

    #[test]
    fn compute_2d_bbox_binding_conversion_multi_particle() {
        // Three particles forming a triangle in the XY plane, viewed from above
        let positions: Vec<(f64, f64, f64)> =
            vec![(0.0, 0.0, 0.0), (4.0, 0.0, 0.0), (0.0, 4.0, 0.0)];
        let radii: Vec<f64> = vec![1.0, 1.0, 1.0];
        let coords: Vec<[f64; 3]> = positions.iter().map(|&(x, y, z)| [x, y, z]).collect();

        let result = compute_2d_bbox(&coords, &radii, 0.0, 90.0);
        // From top (el=90°): X-Y plane is visible
        // Width and height depend on projection; must be > 0
        assert!(result.bbox_width > 0.0, "width must be positive");
        assert!(result.bbox_height > 0.0, "height must be positive");
        assert_eq!(result.positions.len(), 3);
    }

    #[test]
    fn compute_2d_bbox_binding_empty_input() {
        let coords: Vec<[f64; 3]> = vec![];
        let radii: Vec<f64> = vec![];
        let result = compute_2d_bbox(&coords, &radii, 45.0, 30.0);
        assert!((result.bbox_width).abs() < 1e-10);
        assert!((result.bbox_height).abs() < 1e-10);
        assert!(result.positions.is_empty());
    }

    // ── T3.2: per-image scale batch analysis ──────────────────────
    fn make_particle_image(size: usize, centers: &[(usize, usize)], radius: f64) -> Array2<u8> {
        let mut img = Array2::<u8>::from_elem((size, size), 220);
        for (cy, cx) in centers {
            for i in 0..size {
                for j in 0..size {
                    let dy = i as f64 - *cy as f64;
                    let dx = j as f64 - *cx as f64;
                    let d = (dy * dy + dx * dx).sqrt();
                    if d <= radius {
                        img[[i, j]] = 30;
                    }
                }
            }
        }
        img
    }

    #[test]
    fn per_image_scale_batch_returns_used_scales() {
        // T3.2: pass 3 images with 3 different scales, verify each result
        // has the correct pixels_per_100nm_used value.
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let img = make_particle_image(64, &centers, 3.0);

        let scales = vec![30.0, 50.0, 70.0];
        let input = BatchInput {
            images: vec![img.clone(), img.clone(), img],
            pixels_per_100nm: scales.clone(),
            input_variants: vec![],
            autocalibrate_dpo: false,
            dpo_hint: 25.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let output = analyze_batch(input).expect("per-image scale batch must succeed");
        assert_eq!(output.results.len(), 3);
        assert_eq!(output.results[0].pixels_per_100nm_used, 30.0);
        assert_eq!(output.results[1].pixels_per_100nm_used, 50.0);
        assert_eq!(output.results[2].pixels_per_100nm_used, 70.0);
    }

    #[test]
    fn per_image_scale_batch_length_mismatch_rejected() {
        // T3.2: 3 images with 2 scales → error
        let img = Array2::<u8>::from_elem((40, 40), 200);
        let input = BatchInput {
            images: vec![img.clone(), img.clone(), img],
            pixels_per_100nm: vec![30.0, 50.0],
            input_variants: vec![],
            autocalibrate_dpo: false,
            dpo_hint: 25.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let err = analyze_batch(input).unwrap_err();
        assert!(err.contains("mismatch"));
    }

    // ── P1-T1.3: rg_nm exposed in batch result ─────────────────────

    #[test]
    fn batch_result_includes_rg_nm_some_on_success() {
        // T1.3: verify the engine batch result carries rg_nm for the
        // binding to forward into the Python dict.
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let img = make_particle_image(64, &centers, 3.0);

        let output =
            analyze_batch_broadcast(vec![img], 50.0, false, 25.0, BatchAlgorithm::Granulated2012)
                .expect("batch must succeed");

        assert_eq!(output.results.len(), 1);
        let rg = output.results[0].rg_nm;
        assert!(rg.is_some(), "successful image must have rg_nm = Some(_)");
        assert!(rg.unwrap() > 0.0, "rg_nm must be positive");
    }

    #[test]
    fn batch_result_includes_rg_nm_none_on_failure() {
        // T1.3: verify failed images carry rg_nm = None (binding will
        // forward as Python None).
        let blank = Array2::<u8>::from_elem((64, 64), 255);
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let good = make_particle_image(64, &centers, 3.0);

        let output = analyze_batch_broadcast(
            vec![good, blank],
            50.0,
            false,
            25.0,
            BatchAlgorithm::Granulated2012,
        )
        .expect("batch must succeed");

        assert_eq!(output.results.len(), 2);
        assert!(output.results[0].rg_nm.is_some(), "good → Some");
        assert!(output.results[1].rg_nm.is_none(), "blank → None");
    }

    // ── T4.3: parse_seed_type string→enum conversion ─────────────
    #[test]
    fn test_parse_seed_type_none_returns_monomers() {
        use aglogen_engine::simulation::tunable_cc::SeedType;
        let result = super::parse_seed_type(None).unwrap();
        assert_eq!(result, SeedType::Monomers);
    }

    #[test]
    fn test_parse_seed_type_monomers() {
        use aglogen_engine::simulation::tunable_cc::SeedType;
        let result = super::parse_seed_type(Some("monomers")).unwrap();
        assert_eq!(result, SeedType::Monomers);
    }

    #[test]
    fn test_parse_seed_type_dimers() {
        use aglogen_engine::simulation::tunable_cc::SeedType;
        let result = super::parse_seed_type(Some("dimers")).unwrap();
        assert_eq!(result, SeedType::Dimers);
    }

    #[test]
    fn test_parse_seed_type_trimers() {
        use aglogen_engine::simulation::tunable_cc::SeedType;
        let result = super::parse_seed_type(Some("trimers")).unwrap();
        assert_eq!(result, SeedType::Trimers);
    }

    #[test]
    fn test_parse_seed_type_invalid_returns_error() {
        let result = super::parse_seed_type(Some("quadrimers"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid seed_type"));
    }

    // ── T3.3: legacy broadcast backward compat ────────────────────
    #[test]
    fn legacy_broadcast_still_works() {
        // T3.3: single float broadcast → all images get the same scale
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let img = make_particle_image(64, &centers, 3.0);

        let output = analyze_batch_broadcast(
            vec![img.clone(), img.clone(), img],
            42.5,
            false,
            25.0,
            BatchAlgorithm::Granulated2012,
        )
        .expect("broadcast batch must succeed");

        assert_eq!(output.results.len(), 3);
        for r in &output.results {
            assert_eq!(
                r.pixels_per_100nm_used, 42.5,
                "all images must use broadcast scale"
            );
        }
    }

    // ── PYA-13 T2.4: diagnostic fields in batch results ───────────

    #[test]
    fn test_failure_reason_as_str() {
        use aglogen_engine::fractal::fraktal::result::FailureReason;
        assert_eq!(FailureReason::NoSignChange.as_str(), "no_sign_change");
        assert_eq!(FailureReason::KfNegative.as_str(), "kf_negative");
        assert_eq!(FailureReason::IterationLimit.as_str(), "iteration_limit");
    }

    #[test]
    fn test_analysis_quality_as_str() {
        use aglogen_engine::fractal::fraktal::result::AnalysisQuality;
        assert_eq!(AnalysisQuality::Converged.as_str(), "converged");
        assert_eq!(AnalysisQuality::Approximate.as_str(), "approximate");
        assert_eq!(AnalysisQuality::Excluded.as_str(), "excluded");
        assert_eq!(AnalysisQuality::Failed.as_str(), "failed");
    }

    #[test]
    fn batch_result_has_quality_field() {
        // Successful images must have quality = Some("converged"|"approximate"|...).
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let img = make_particle_image(64, &centers, 3.0);

        let output =
            analyze_batch_broadcast(vec![img], 50.0, false, 25.0, BatchAlgorithm::Granulated2012)
                .expect("batch must succeed");

        assert_eq!(output.results.len(), 1);
        let r = &output.results[0];
        assert!(
            r.quality.is_some(),
            "quality must be populated for every result"
        );
        let q = r.quality.as_deref().unwrap();
        assert!(
            ["converged", "approximate", "excluded", "failed"].contains(&q),
            "quality must be one of the 4 valid values, got '{}'",
            q
        );
    }

    #[test]
    fn batch_result_has_bisection_diagnostic_fields() {
        // T2.4: verify BatchImageResult carries all 5 diagnostic fields
        // so the binding can surface them.
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let img = make_particle_image(64, &centers, 3.0);

        let output =
            analyze_batch_broadcast(vec![img], 50.0, false, 25.0, BatchAlgorithm::Granulated2012)
                .expect("batch must succeed");

        let r = &output.results[0];
        // quality is always populated
        assert!(r.quality.is_some());
        // On a successful analysis, df_estimate should be Some
        // bisection_iterations and bisection_residual may be Some or None
        // depending on algorithm path — we just verify they're accessible
        let _iters = r.bisection_iterations;
        let _residual = r.bisection_residual;
        let _failure = &r.failure_reason;
        let _df_est = r.df_estimate;
    }

    #[test]
    fn batch_failed_image_still_has_quality() {
        // A blank image errors before bisection, so quality is default
        // "converged" (the Default impl). The key assertion is that
        // quality is always Some — never missing — even on error images.
        let blank = Array2::<u8>::from_elem((64, 64), 255);

        let output = analyze_batch_broadcast(
            vec![blank],
            50.0,
            false,
            25.0,
            BatchAlgorithm::Granulated2012,
        )
        .expect("batch must succeed even with failed images");

        assert_eq!(output.results.len(), 1);
        let r = &output.results[0];
        assert!(r.error.is_some(), "blank image should produce an error");
        assert!(
            r.quality.is_some(),
            "quality must be populated even for error images"
        );
    }

    #[test]
    fn per_image_scale_batch_has_diagnostic_fields() {
        // T2.4: verify per-image-scale batch results also carry diagnostic fields
        let centers: Vec<(usize, usize)> = (0..6)
            .flat_map(|r| (0..6).map(move |c| (8 + r * 8, 8 + c * 8)))
            .collect();
        let img = make_particle_image(64, &centers, 3.0);

        let input = BatchInput {
            images: vec![img.clone(), img],
            pixels_per_100nm: vec![40.0, 60.0],
            input_variants: vec![],
            autocalibrate_dpo: false,
            dpo_hint: 25.0,
            algorithm: BatchAlgorithm::Granulated2012,
        };
        let output = analyze_batch(input).expect("per-image scale batch must succeed");

        for r in &output.results {
            assert!(
                r.quality.is_some(),
                "quality must be populated for image {}",
                r.index
            );
            let q = r.quality.as_deref().unwrap();
            assert!(
                ["converged", "approximate", "excluded", "failed"].contains(&q),
                "quality must be valid, got '{}' for image {}",
                q,
                r.index
            );
        }
    }
}
