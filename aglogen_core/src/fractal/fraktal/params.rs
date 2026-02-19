//! FRAKTAL analysis parameters.

use pyo3::prelude::*;

/// Parameters for the 2012 granulated particle model.
///
/// This model is designed for soot/agglomerates with spherical primary particles.
/// It accounts for inter-particle overlap and compaction.
#[pyclass]
#[derive(Debug, Clone)]
pub struct Granulated2012Params {
    /// Pixels per 100nm in the image scale bar
    #[pyo3(get, set)]
    pub npix: f64,

    /// Mean primary particle diameter in nm
    #[pyo3(get, set)]
    pub dpo: f64,

    /// Filling factor / overlap coefficient (1.0 = touching spheres, typical range 1.0-1.5)
    #[pyo3(get, set)]
    pub delta: f64,

    /// Apply 3D correction to radius of gyration
    #[pyo3(get, set)]
    pub correction_3d: bool,

    /// Minimum pixel value for color segmentation (default: 10)
    #[pyo3(get, set)]
    pub pixel_min: u8,

    /// Maximum pixel value for color segmentation (default: 240)
    #[pyo3(get, set)]
    pub pixel_max: u8,

    /// Minimum number of primary particles (below this, result is rejected)
    #[pyo3(get, set)]
    pub npo_limit: usize,

    /// Scale reference in nm (default: 100)
    #[pyo3(get, set)]
    pub escala: f64,

    /// Enable automatic threshold detection using Otsu's method (default: true)
    /// When enabled, automatically detects if image has dark or light particles
    /// and adjusts segmentation accordingly.
    #[pyo3(get, set)]
    pub auto_threshold: bool,
}

#[pymethods]
impl Granulated2012Params {
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
        Self {
            npix,
            dpo,
            delta,
            correction_3d,
            pixel_min,
            pixel_max,
            npo_limit,
            escala,
            auto_threshold,
        }
    }
}

impl Default for Granulated2012Params {
    fn default() -> Self {
        Self {
            npix: 100.0,
            dpo: 25.0,
            delta: 1.1,
            correction_3d: false,
            pixel_min: 10,
            pixel_max: 240,
            npo_limit: 5,
            escala: 100.0,
            auto_threshold: true, // Enable by default
        }
    }
}

/// Parameters for the 2018 voxel-based model.
///
/// Simplified analysis without particle overlap considerations.
/// Uses discrete voxel representation of structures.
#[pyclass]
#[derive(Debug, Clone)]
pub struct Voxel2018Params {
    /// Pixels per 100nm in the image scale bar
    #[pyo3(get, set)]
    pub npix: f64,

    /// Scale reference in nm (default: 100)
    #[pyo3(get, set)]
    pub escala: f64,

    /// Apply 3D correction to radius of gyration
    #[pyo3(get, set)]
    pub correction_3d: bool,

    /// Minimum pixel value for color segmentation (default: 10)
    #[pyo3(get, set)]
    pub pixel_min: u8,

    /// Maximum pixel value for color segmentation (default: 240)
    #[pyo3(get, set)]
    pub pixel_max: u8,

    /// m exponent for zp calculation (default: 1.0 for voxels)
    #[pyo3(get, set)]
    pub m_exponent: f64,

    /// Enable automatic threshold detection using Otsu's method (default: true)
    #[pyo3(get, set)]
    pub auto_threshold: bool,
}

#[pymethods]
impl Voxel2018Params {
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
        Self {
            npix,
            escala,
            correction_3d,
            pixel_min,
            pixel_max,
            m_exponent,
            auto_threshold,
        }
    }
}

impl Default for Voxel2018Params {
    fn default() -> Self {
        Self {
            npix: 100.0,
            escala: 100.0,
            correction_3d: false,
            pixel_min: 10,
            pixel_max: 240,
            m_exponent: 1.0,
            auto_threshold: true,
        }
    }
}
