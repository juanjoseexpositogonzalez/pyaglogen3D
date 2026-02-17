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
use fractal::result::PyFractalResult;
use projection::{project_batch, project_to_2d, PyProjectionResult};
use simulation::ballistic::run_ballistic;
use simulation::cca::run_cca;
use simulation::dla::run_dla;
use simulation::tunable::run_tunable;
use simulation::result::PySimulationResult;

/// Python module for aglogen_core
#[pymodule]
fn aglogen_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    // Simulation functions
    m.add_function(wrap_pyfunction!(run_dla, m)?)?;
    m.add_function(wrap_pyfunction!(run_cca, m)?)?;
    m.add_function(wrap_pyfunction!(run_ballistic, m)?)?;
    m.add_function(wrap_pyfunction!(run_tunable, m)?)?;

    // Fractal analysis functions
    m.add_function(wrap_pyfunction!(box_counting, m)?)?;

    // Projection functions
    m.add_function(wrap_pyfunction!(project_to_2d, m)?)?;
    m.add_function(wrap_pyfunction!(project_batch, m)?)?;

    // Utility functions
    m.add_function(wrap_pyfunction!(version, m)?)?;

    // Result classes
    m.add_class::<PySimulationResult>()?;
    m.add_class::<PyFractalResult>()?;
    m.add_class::<PyProjectionResult>()?;

    Ok(())
}

/// Get version string
#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
