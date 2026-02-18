//! FRAKTAL fractal analysis module.
//!
//! Implements the FRAKTAL algorithm for analyzing fractal properties of agglomerate
//! images. Based on the MATLAB FRAKTAL v2.1 program.
//!
//! Two models are supported:
//! - **Granulated 2012**: For soot/agglomerates with spherical primary particles
//! - **Voxel 2018**: Simplified voxel-based analysis without overlap considerations

pub mod params;
pub mod result;
pub mod image_processing;
pub mod bisection;
pub mod granulated_2012;
pub mod voxel_2018;

pub use params::{Granulated2012Params, Voxel2018Params};
pub use result::PyFraktalResult;
pub use granulated_2012::analyze_granulated_2012;
pub use voxel_2018::analyze_voxel_2018;
