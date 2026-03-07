//! Optical properties calculation for particle aggregates.
//!
//! This module implements the Superposition T-Matrix (MSTM) method for
//! computing optical cross-sections and scattering properties of particle
//! aggregates.

pub mod mie;
pub mod result;
pub mod tmatrix;

pub use result::PyOpticalResult;
pub use tmatrix::run_tmatrix;
