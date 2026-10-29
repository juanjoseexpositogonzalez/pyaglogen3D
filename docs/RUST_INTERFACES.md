# Rust Core Interfaces - aglogen_core

## Crate Structure

```
aglogen_core/
├── Cargo.toml
├── pyproject.toml
└── src/
    ├── lib.rs                    # PyO3 module exports
    ├── error.rs                  # Error types
    ├── simulation/
    │   ├── mod.rs
    │   ├── engine.rs             # SimulationEngine trait
    │   ├── result.rs             # SimulationResult
    │   ├── dla.rs                # DLA implementation
    │   ├── cca.rs                # CCA implementation
    │   ├── ballistic.rs          # Ballistic implementation
    │   ├── collision.rs          # Collision detection
    │   └── metrics.rs            # Metrics calculations
    ├── fractal/
    │   ├── mod.rs
    │   ├── analyzer.rs           # FractalAnalyzer trait
    │   ├── result.rs             # FractalResult
    │   ├── box_counting.rs
    │   ├── sandbox.rs
    │   ├── correlation.rs
    │   ├── lacunarity.rs
    │   └── multifractal.rs
    └── common/
        ├── mod.rs
        ├── geometry.rs           # Vector3, Sphere, AABB
        ├── rng.rs                # Deterministic RNG
        └── spatial.rs            # Octree, SpatialHash
```

---

## Core Traits

### SimulationEngine

```rust
// src/simulation/engine.rs

use crate::error::SimulationError;
use crate::simulation::result::SimulationResult;

/// Trait for all simulation engines.
/// Implementors must be Send + Sync for thread safety.
pub trait SimulationEngine: Send + Sync {
    /// Algorithm-specific parameters type
    type Params: Clone + Send;

    /// Execute the simulation with given parameters and seed
    fn run(&self, params: Self::Params, seed: u64) -> Result<SimulationResult, SimulationError>;

    /// Return the algorithm name for identification
    fn algorithm_name(&self) -> &'static str;

    /// Return the engine version for reproducibility tracking
    fn version(&self) -> &'static str;

    /// Estimate memory usage for given parameters (bytes)
    fn estimate_memory(&self, params: &Self::Params) -> usize;

    /// Validate parameters before execution
    fn validate_params(&self, params: &Self::Params) -> Result<(), SimulationError>;
}
```

### FractalAnalyzer

```rust
// src/fractal/analyzer.rs

use crate::error::FractalError;
use crate::fractal::result::FractalResult;
use ndarray::Array2;

/// Trait for all fractal analysis methods.
pub trait FractalAnalyzer: Send + Sync {
    /// Method-specific parameters type
    type Params: Clone + Send;

    /// Analyze a binary image and return fractal metrics
    fn analyze(
        &self,
        image: &Array2<bool>,
        params: Self::Params,
    ) -> Result<FractalResult, FractalError>;

    /// Return the method name
    fn method_name(&self) -> &'static str;

    /// Return the analyzer version
    fn version(&self) -> &'static str;
}
```

---

## Data Structures

### SimulationResult

```rust
// src/simulation/result.rs

use ndarray::{Array1, Array2};

/// Complete result of a simulation run.
#[derive(Debug, Clone)]
pub struct SimulationResult {
    /// Particle coordinates (N x 3)
    pub coordinates: Array2<f64>,

    /// Particle radii (N,)
    pub radii: Array1<f64>,

    /// Evolution of radius of gyration during growth (N,)
    pub rg_evolution: Array1<f64>,

    /// Computed metrics
    pub metrics: SimulationMetrics,

    /// Execution time in milliseconds
    pub execution_time_ms: u64,
}

/// Computed metrics for a simulation.
#[derive(Debug, Clone)]
pub struct SimulationMetrics {
    /// Fractal dimension from Rg vs N log-log fit
    pub fractal_dimension: f64,

    /// Standard error of Df fit
    pub fractal_dimension_std: f64,

    /// Prefactor kf from power law
    pub prefactor: f64,

    /// Final radius of gyration
    pub radius_of_gyration: f64,

    /// Porosity (1 - volume_fraction)
    pub porosity: f64,

    /// Coordination number statistics
    pub coordination: CoordinationStats,

    /// Radial distribution function
    pub rdf: RadialDistribution,
}

#[derive(Debug, Clone)]
pub struct CoordinationStats {
    pub mean: f64,
    pub std: f64,
    pub histogram: Vec<u32>,  // Counts for 0, 1, 2, ... contacts
}

#[derive(Debug, Clone)]
pub struct RadialDistribution {
    pub r: Vec<f64>,      // Distance values
    pub g_r: Vec<f64>,    // g(r) values
}
```

### FractalResult

```rust
// src/fractal/result.rs

/// Result of fractal analysis.
#[derive(Debug, Clone)]
pub struct FractalResult {
    /// Primary fractal dimension
    pub dimension: f64,

    /// R-squared of the fit
    pub r_squared: f64,

    /// Standard error
    pub std_error: f64,

    /// 95% confidence interval
    pub confidence_interval: (f64, f64),

    /// Log of box sizes / radii
    pub log_scales: Vec<f64>,

    /// Log of counts / mass
    pub log_values: Vec<f64>,

    /// Residuals from fit
    pub residuals: Vec<f64>,

    /// Method-specific additional data
    pub extra: FractalExtra,

    /// Execution time in milliseconds
    pub execution_time_ms: u64,
}

/// Method-specific extra data.
#[derive(Debug, Clone)]
pub enum FractalExtra {
    BoxCounting,
    Sandbox,
    Correlation,
    Lacunarity {
        lacunarity_values: Vec<f64>,
    },
    Multifractal {
        q_values: Vec<f64>,
        dq_spectrum: Vec<f64>,
        tau_q: Vec<f64>,
        alpha: Vec<f64>,
        f_alpha: Vec<f64>,
        spectrum_width: f64,
        asymmetry: f64,
    },
}
```

### Geometry Types

```rust
// src/common/geometry.rs

/// 3D vector with basic operations.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vector3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vector3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self;
    pub fn zero() -> Self;
    pub fn length(&self) -> f64;
    pub fn length_squared(&self) -> f64;
    pub fn normalize(&self) -> Self;
    pub fn dot(&self, other: &Self) -> f64;
    pub fn cross(&self, other: &Self) -> Self;
    pub fn distance_to(&self, other: &Self) -> f64;
}

impl std::ops::Add for Vector3 { ... }
impl std::ops::Sub for Vector3 { ... }
impl std::ops::Mul<f64> for Vector3 { ... }

/// Sphere representation.
#[derive(Debug, Clone, Copy)]
pub struct Sphere {
    pub center: Vector3,
    pub radius: f64,
}

impl Sphere {
    pub fn new(center: Vector3, radius: f64) -> Self;
    pub fn intersects(&self, other: &Sphere) -> bool;
    pub fn touches(&self, other: &Sphere, tolerance: f64) -> bool;
    pub fn contains_point(&self, point: &Vector3) -> bool;
}

/// Axis-aligned bounding box.
#[derive(Debug, Clone, Copy)]
pub struct AABB {
    pub min: Vector3,
    pub max: Vector3,
}

impl AABB {
    pub fn new(min: Vector3, max: Vector3) -> Self;
    pub fn from_spheres(spheres: &[Sphere]) -> Self;
    pub fn contains(&self, point: &Vector3) -> bool;
    pub fn intersects(&self, other: &AABB) -> bool;
    pub fn expand(&mut self, point: &Vector3);
}
```

---

## Algorithm Parameters

### DLA Parameters

```rust
// src/simulation/dla.rs

#[derive(Debug, Clone)]
pub struct DlaParams {
    /// Number of particles to generate
    pub n_particles: usize,

    /// Probability of sticking on contact [0.0, 1.0]
    pub sticking_probability: f64,

    /// Size of the simulation lattice
    pub lattice_size: usize,

    /// Radius of the seed particle
    pub seed_radius: f64,

    /// Maximum random walk steps before particle is discarded
    pub max_walk_steps: usize,

    /// Launching distance multiplier (relative to cluster radius)
    pub launch_distance_factor: f64,

    /// Kill distance multiplier (relative to launch distance)
    pub kill_distance_factor: f64,
}

impl Default for DlaParams {
    fn default() -> Self {
        Self {
            n_particles: 1000,
            sticking_probability: 1.0,
            lattice_size: 200,
            seed_radius: 1.0,
            max_walk_steps: 1_000_000,
            launch_distance_factor: 2.0,
            kill_distance_factor: 3.0,
        }
    }
}
```

### CCA Parameters

```rust
// src/simulation/cca.rs

#[derive(Debug, Clone)]
pub struct CcaParams {
    /// Total number of primary particles
    pub n_particles: usize,

    /// Initial number of clusters (each with n_particles/initial_clusters particles)
    pub initial_clusters: usize,

    /// Interaction radius for cluster-cluster contact
    pub interaction_radius: f64,

    /// Concentration (affects diffusion speed)
    pub concentration: f64,

    /// Maximum simulation steps
    pub max_steps: usize,
}
```

### Ballistic Parameters

```rust
// src/simulation/ballistic.rs

#[derive(Debug, Clone)]
pub struct BallisticParams {
    /// Number of particles to generate
    pub n_particles: usize,

    /// Particle velocity (normalized)
    pub velocity: f64,

    /// Incidence angle distribution
    pub incidence_distribution: IncidenceDistribution,

    /// Particle size distribution
    pub size_distribution: SizeDistribution,
}

#[derive(Debug, Clone)]
pub enum IncidenceDistribution {
    /// Uniform from all directions
    Uniform,
    /// Preferential from top (z+)
    TopBiased { bias: f64 },
    /// Collimated beam from specific direction
    Collimated { direction: Vector3, spread: f64 },
}

#[derive(Debug, Clone)]
pub enum SizeDistribution {
    /// All particles same size
    Monodisperse { radius: f64 },
    /// Log-normal distribution
    LogNormal { mean: f64, sigma: f64 },
    /// Gaussian distribution
    Gaussian { mean: f64, std: f64 },
}
```

### Box Counting Parameters

```rust
// src/fractal/box_counting.rs

#[derive(Debug, Clone)]
pub struct BoxCountingParams {
    /// Minimum box size (pixels)
    pub min_box_size: usize,

    /// Maximum box size (pixels)
    pub max_box_size: usize,

    /// Number of scales to sample
    pub num_scales: usize,

    /// Use logarithmic spacing for scales
    pub log_spacing: bool,
}

impl Default for BoxCountingParams {
    fn default() -> Self {
        Self {
            min_box_size: 2,
            max_box_size: 512,
            num_scales: 20,
            log_spacing: true,
        }
    }
}
```

### Sandbox Parameters

```rust
// src/fractal/sandbox.rs

#[derive(Debug, Clone)]
pub struct SandboxParams {
    /// Number of seed points to sample
    pub num_seeds: usize,

    /// How to select seed points
    pub seed_selection: SeedSelection,

    /// Minimum radius for circles
    pub min_radius: usize,

    /// Maximum radius for circles
    pub max_radius: usize,

    /// Number of radius values to sample
    pub num_scales: usize,
}

#[derive(Debug, Clone)]
pub enum SeedSelection {
    /// Random points on the object
    Random,
    /// Center of mass
    CenterOfMass,
    /// Grid sampling
    Grid { spacing: usize },
}
```

### Multifractal Parameters

```rust
// src/fractal/multifractal.rs

#[derive(Debug, Clone)]
pub struct MultifractalParams {
    /// q values for generalized dimensions
    pub q_values: Vec<f64>,

    /// Minimum box size
    pub min_box_size: usize,

    /// Maximum box size
    pub max_box_size: usize,

    /// Number of scales
    pub num_scales: usize,
}

impl Default for MultifractalParams {
    fn default() -> Self {
        Self {
            q_values: (-5..=5).map(|q| q as f64).collect(),
            min_box_size: 2,
            max_box_size: 256,
            num_scales: 15,
        }
    }
}
```

---

## Spatial Data Structures

### SpatialHash

```rust
// src/common/spatial.rs

use crate::common::geometry::{Sphere, Vector3, AABB};

/// Spatial hash grid for efficient collision detection.
pub struct SpatialHash {
    cell_size: f64,
    cells: HashMap<(i32, i32, i32), Vec<usize>>,
    bounds: AABB,
}

impl SpatialHash {
    /// Create new spatial hash with given cell size
    pub fn new(cell_size: f64) -> Self;

    /// Insert a sphere into the hash
    pub fn insert(&mut self, index: usize, sphere: &Sphere);

    /// Remove a sphere from the hash
    pub fn remove(&mut self, index: usize, sphere: &Sphere);

    /// Find all sphere indices that might intersect with given sphere
    pub fn query_potential_collisions(&self, sphere: &Sphere) -> Vec<usize>;

    /// Find the nearest neighbor to a point
    pub fn nearest_neighbor(&self, point: &Vector3, spheres: &[Sphere]) -> Option<usize>;

    /// Clear all entries
    pub fn clear(&mut self);

    /// Rebuild hash with new cell size
    pub fn rebuild(&mut self, spheres: &[Sphere], cell_size: f64);
}
```

### Octree (for larger simulations)

```rust
// src/common/spatial.rs

/// Octree for efficient spatial queries on large particle sets.
pub struct Octree {
    root: Option<Box<OctreeNode>>,
    bounds: AABB,
    max_depth: usize,
    max_items_per_node: usize,
}

struct OctreeNode {
    bounds: AABB,
    children: Option<[Box<OctreeNode>; 8]>,
    items: Vec<usize>,
}

impl Octree {
    pub fn new(bounds: AABB, max_depth: usize, max_items_per_node: usize) -> Self;

    pub fn insert(&mut self, index: usize, sphere: &Sphere);

    pub fn query_sphere(&self, sphere: &Sphere) -> Vec<usize>;

    pub fn query_range(&self, range: &AABB) -> Vec<usize>;

    pub fn nearest_neighbors(&self, point: &Vector3, k: usize, spheres: &[Sphere]) -> Vec<usize>;
}
```

---

## Error Types

```rust
// src/error.rs

use thiserror::Error;

#[derive(Error, Debug)]
pub enum SimulationError {
    #[error("Invalid parameters: {0}")]
    InvalidParams(String),

    #[error("Memory allocation failed: required {required} bytes, available {available}")]
    OutOfMemory { required: usize, available: usize },

    #[error("Simulation did not converge after {steps} steps")]
    NoConvergence { steps: usize },

    #[error("Timeout after {elapsed_ms}ms (limit: {limit_ms}ms)")]
    Timeout { elapsed_ms: u64, limit_ms: u64 },

    #[error("Internal error: {0}")]
    Internal(String),
}

#[derive(Error, Debug)]
pub enum FractalError {
    #[error("Invalid image: {0}")]
    InvalidImage(String),

    #[error("Invalid parameters: {0}")]
    InvalidParams(String),

    #[error("No object found in image after thresholding")]
    EmptyImage,

    #[error("Image too small for analysis: {width}x{height}, minimum required: {min_size}")]
    ImageTooSmall { width: usize, height: usize, min_size: usize },

    #[error("Fit failed: {0}")]
    FitFailed(String),

    #[error("Internal error: {0}")]
    Internal(String),
}
```

---

## PyO3 Exports

```rust
// src/lib.rs

use pyo3::prelude::*;
use numpy::{PyArray1, PyArray2, PyReadonlyArray2};

/// Python module for aglogen_core
#[pymodule]
fn aglogen_core(_py: Python, m: &PyModule) -> PyResult<()> {
    // Simulation functions
    m.add_function(wrap_pyfunction!(run_dla, m)?)?;
    m.add_function(wrap_pyfunction!(run_cca, m)?)?;
    m.add_function(wrap_pyfunction!(run_ballistic, m)?)?;

    // Fractal analysis functions
    m.add_function(wrap_pyfunction!(box_counting, m)?)?;
    m.add_function(wrap_pyfunction!(sandbox, m)?)?;
    m.add_function(wrap_pyfunction!(correlation_dimension, m)?)?;
    m.add_function(wrap_pyfunction!(lacunarity, m)?)?;
    m.add_function(wrap_pyfunction!(multifractal, m)?)?;

    // Utility functions
    m.add_function(wrap_pyfunction!(calculate_metrics, m)?)?;
    m.add_function(wrap_pyfunction!(version, m)?)?;

    // Result classes
    m.add_class::<PySimulationResult>()?;
    m.add_class::<PyFractalResult>()?;

    Ok(())
}

/// Run DLA simulation
#[pyfunction]
#[pyo3(signature = (n_particles, sticking_probability=1.0, lattice_size=200, seed_radius=1.0, seed=None))]
fn run_dla(
    py: Python<'_>,
    n_particles: usize,
    sticking_probability: f64,
    lattice_size: usize,
    seed_radius: f64,
    seed: Option<u64>,
) -> PyResult<PySimulationResult> {
    let seed = seed.unwrap_or_else(|| rand::random());

    py.allow_threads(|| {
        let engine = DlaEngine::new();
        let params = DlaParams {
            n_particles,
            sticking_probability,
            lattice_size,
            seed_radius,
            ..Default::default()
        };

        engine
            .run(params, seed)
            .map(|r| PySimulationResult::from(r))
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    })
}

/// Run box-counting fractal analysis
#[pyfunction]
#[pyo3(signature = (binary_image, min_box_size=2, max_box_size=512, num_scales=20))]
fn box_counting(
    py: Python<'_>,
    binary_image: PyReadonlyArray2<'_, bool>,
    min_box_size: usize,
    max_box_size: usize,
    num_scales: usize,
) -> PyResult<PyFractalResult> {
    let image = binary_image.as_array().to_owned();

    py.allow_threads(|| {
        let analyzer = BoxCountingAnalyzer::new();
        let params = BoxCountingParams {
            min_box_size,
            max_box_size,
            num_scales,
            log_spacing: true,
        };

        analyzer
            .analyze(&image, params)
            .map(|r| PyFractalResult::from(r))
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    })
}

/// Python wrapper for SimulationResult
#[pyclass]
pub struct PySimulationResult {
    #[pyo3(get)]
    pub coordinates: Py<PyArray2<f64>>,
    #[pyo3(get)]
    pub radii: Py<PyArray1<f64>>,
    #[pyo3(get)]
    pub rg_evolution: Py<PyArray1<f64>>,
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
}

/// Python wrapper for FractalResult
#[pyclass]
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
    pub log_scales: Py<PyArray1<f64>>,
    #[pyo3(get)]
    pub log_values: Py<PyArray1<f64>>,
    #[pyo3(get)]
    pub residuals: Py<PyArray1<f64>>,
    #[pyo3(get)]
    pub execution_time_ms: u64,
}

/// Get version string
#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
```

---

## Cargo.toml

```toml
[package]
name = "aglogen_core"
version = "0.1.0"
edition = "2021"
license = "MIT"
description = "High-performance 3D agglomerate simulation and fractal analysis"

[lib]
name = "aglogen_core"
crate-type = ["cdylib"]

[dependencies]
pyo3 = { version = "0.20", features = ["extension-module"] }
numpy = "0.20"
ndarray = { version = "0.15", features = ["rayon"] }
rand = "0.8"
rand_pcg = "0.3"
rayon = "1.8"
nalgebra = "0.32"
thiserror = "1.0"
hashbrown = "0.14"
parking_lot = "0.12"

[dev-dependencies]
criterion = "0.5"
approx = "0.5"

[[bench]]
name = "dla_benchmark"
harness = false

[profile.release]
lto = true
codegen-units = 1
opt-level = 3
```

---

## pyproject.toml (maturin)

```toml
[build-system]
requires = ["maturin>=1.4,<2.0"]
build-backend = "maturin"

[project]
name = "aglogen_core"
version = "0.1.0"
description = "High-performance 3D agglomerate simulation and fractal analysis"
readme = "README.md"
requires-python = ">=3.10"
license = {text = "MIT"}
keywords = ["simulation", "fractal", "aggregation", "particles", "scientific"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Science/Research",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Programming Language :: Rust",
    "Topic :: Scientific/Engineering :: Physics",
]
dependencies = [
    "numpy>=1.24",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-benchmark>=4.0",
]

[tool.maturin]
python-source = "python"
features = ["pyo3/extension-module"]
strip = true
```
