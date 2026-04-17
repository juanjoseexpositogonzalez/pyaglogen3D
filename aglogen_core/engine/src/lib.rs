//! aglogen-engine - Pure Rust engine for 3D agglomerate simulation and fractal analysis
//!
//! This crate provides Rust implementations of particle aggregation algorithms
//! (DLA, CCA, Ballistic, Tunable, FracVAL, GCCA, Box-RFA) and fractal analysis methods
//! (Box-Counting 2D/3D, FRAKTAL) with NO Python dependencies.

pub mod common;
pub mod fractal;
pub mod optics;
pub mod projection;
pub mod simulation;
