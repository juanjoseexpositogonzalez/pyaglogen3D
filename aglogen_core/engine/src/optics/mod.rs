//! Optical properties calculation for particle aggregates.
//!
//! This module implements both T-Matrix (MSTM) and DDA methods for
//! computing optical cross-sections and scattering properties of particle
//! aggregates.

pub mod dda;
pub mod mie;
pub mod result;
pub mod tmatrix;
