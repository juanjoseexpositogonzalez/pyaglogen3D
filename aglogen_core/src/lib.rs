//! aglogen_core - High-performance 3D agglomerate simulation and fractal analysis
//!
//! This crate provides Rust implementations of particle aggregation algorithms
//! (DLA, CCA, Ballistic) and fractal analysis methods (Box-Counting, Sandbox, etc.)
//! with Python bindings via PyO3.

use pyo3::prelude::*;

mod common;
mod fractal;
mod projection;
mod simulation;

use fractal::box_counting::box_counting;
use fractal::box_counting_3d::{box_counting_3d, box_counting_agglomerate};
use fractal::fraktal::{Granulated2012Params, Voxel2018Params, PyFraktalResult};
use fractal::result::PyFractalResult as PyBoxCountingResult;
use projection::{project_batch, project_to_2d, PyProjectionResult};
use simulation::ballistic::run_ballistic;
use simulation::ballistic_cc::run_ballistic_cc;
use simulation::cca::run_cca;
use simulation::dla::run_dla;
use simulation::tunable::run_tunable;
use simulation::tunable_cc::run_tunable_cc;
use simulation::result::PySimulationResult;

use numpy::PyReadonlyArray2;

/// Run FRAKTAL analysis using the 2012 granulated particle model.
///
/// # Arguments
/// * `image` - Grayscale image as 2D numpy array (uint8)
/// * `npix` - Pixels per 100nm in the scale bar
/// * `dpo` - Mean primary particle diameter (nm)
/// * `delta` - Filling factor (1.0-1.5)
/// * `correction_3d` - Apply 3D correction to Rg
/// * `pixel_min` - Min pixel value for segmentation (default: 10)
/// * `pixel_max` - Max pixel value for segmentation (default: 240)
/// * `npo_limit` - Minimum particle count (default: 5)
/// * `escala` - Scale reference in nm (default: 100)
/// * `auto_threshold` - Enable automatic threshold detection using Otsu's method (default: true)
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
        npix, dpo, delta, correction_3d, pixel_min, pixel_max, npo_limit, escala, auto_threshold
    );
    let result = fractal::fraktal::analyze_granulated_2012(image.as_array(), &params);
    Ok(result.into())
}

/// Run FRAKTAL analysis using the 2018 voxel model.
///
/// # Arguments
/// * `image` - Grayscale image as 2D numpy array (uint8)
/// * `npix` - Pixels per 100nm in the scale bar
/// * `escala` - Scale reference in nm (default: 100)
/// * `correction_3d` - Apply 3D correction to Rg
/// * `pixel_min` - Min pixel value for segmentation (default: 10)
/// * `pixel_max` - Max pixel value for segmentation (default: 240)
/// * `m_exponent` - m exponent for zp calculation (default: 1.0)
/// * `auto_threshold` - Enable automatic threshold detection using Otsu's method (default: true)
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
        npix, escala, correction_3d, pixel_min, pixel_max, m_exponent, auto_threshold
    );
    let result = fractal::fraktal::analyze_voxel_2018(image.as_array(), &params);
    Ok(result.into())
}

/// Python module for aglogen_core
#[pymodule]
fn aglogen_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Simulation functions
    m.add_function(wrap_pyfunction!(run_dla, m)?)?;
    m.add_function(wrap_pyfunction!(run_cca, m)?)?;
    m.add_function(wrap_pyfunction!(run_ballistic, m)?)?;
    m.add_function(wrap_pyfunction!(run_ballistic_cc, m)?)?;
    m.add_function(wrap_pyfunction!(run_tunable, m)?)?;
    m.add_function(wrap_pyfunction!(run_tunable_cc, m)?)?;

    // Fractal analysis functions
    m.add_function(wrap_pyfunction!(box_counting, m)?)?;
    m.add_function(wrap_pyfunction!(box_counting_3d, m)?)?;
    m.add_function(wrap_pyfunction!(box_counting_agglomerate, m)?)?;
    m.add_function(wrap_pyfunction!(fraktal_granulated_2012, m)?)?;
    m.add_function(wrap_pyfunction!(fraktal_voxel_2018, m)?)?;

    // Projection functions
    m.add_function(wrap_pyfunction!(project_to_2d, m)?)?;
    m.add_function(wrap_pyfunction!(project_batch, m)?)?;

    // Utility functions
    m.add_function(wrap_pyfunction!(version, m)?)?;

    // Result classes
    m.add_class::<PySimulationResult>()?;
    m.add_class::<PyBoxCountingResult>()?;
    m.add_class::<PyProjectionResult>()?;
    m.add_class::<PyFraktalResult>()?;
    m.add_class::<Granulated2012Params>()?;
    m.add_class::<Voxel2018Params>()?;

    Ok(())
}

/// Get version string
#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
