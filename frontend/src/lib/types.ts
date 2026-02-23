/**
 * TypeScript types for pyAgloGen3D frontend.
 */

// Enums
export type SimulationAlgorithm = 'dla' | 'cca' | 'ballistic' | 'ballistic_cc' | 'tunable' | 'tunable_cc' | 'limiting'
export type SimulationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type FractalMethod = 'box_counting' | 'sandbox' | 'correlation' | 'lacunarity' | 'multifractal' | 'fraktal_granulated_2012' | 'fraktal_voxel_2018'
export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type FraktalModel = 'granulated_2012' | 'voxel_2018'
export type FraktalSourceType = 'uploaded_image' | 'simulation_projection'
export type ColorMode = 'uniform' | 'order' | 'coordination' | 'distance' | 'depth'

// Project
export interface Project {
  id: string
  name: string
  description: string | null
  simulation_count: number
  analysis_count: number
  created_at: string
  updated_at: string
}

export interface ProjectDetail extends Project {
  recent_simulations: SimulationSummary[]
  recent_analyses: AnalysisSummary[]
}

export interface CreateProjectInput {
  name: string
  description?: string
}

// Simulation Parameter Types
export interface DlaParams {
  n_particles: number
  sticking_probability: number
  lattice_size: number
  seed_radius: number
  // Sintering parameters (optional)
  sintering_coeff?: number
  sintering_type?: SinteringDistributionType
  sintering_min?: number
  sintering_max?: number
  sintering_std?: number
}

export interface CcaParams {
  n_particles: number
  sticking_probability: number
  particle_radius: number
  box_size: number
  // Sintering parameters (optional)
  sintering_coeff?: number
  sintering_type?: SinteringDistributionType
  sintering_min?: number
  sintering_max?: number
  sintering_std?: number
}

export interface BallisticParams {
  n_particles: number
  sticking_probability: number
  particle_radius: number
  // Sintering parameters (optional)
  sintering_coeff?: number
  sintering_type?: SinteringDistributionType
  sintering_min?: number
  sintering_max?: number
  sintering_std?: number
}

export interface TunableParams {
  n_particles: number
  target_df: number
  target_kf: number
  radius_min?: number
  radius_max?: number
  // Sintering parameters (optional)
  sintering_coeff?: number
  sintering_type?: SinteringDistributionType
  sintering_min?: number
  sintering_max?: number
  sintering_std?: number
}

export interface TunableCcParams extends TunableParams {
  seed_cluster_size?: number
  max_rotation_attempts?: number
}

export type LimitingGeometryType = 'chain' | 'plane' | 'sphere'
export type ChainConfig = 'lineal' | 'cruz2d' | 'asterisco' | 'cruz3d'
export type PlaneConfig = 'plano' | 'dobleplano' | 'tripleplano'
export type SphereConfig = 'cuboctaedro'
export type PackingType = 'HC' | 'CS' | 'CCC'
export type SinteringDistributionType = 'fixed' | 'uniform' | 'normal'

// Sintering parameters
export interface SinteringParams {
  sintering_coeff: number       // 0.5-1.0, where 1.0 = no sintering
  sintering_type: SinteringDistributionType  // Distribution type
  sintering_min?: number        // Min for uniform distribution (default: 0.85)
  sintering_max?: number        // Max for uniform distribution (default: 0.95)
  sintering_std?: number        // Std dev for normal distribution (default: 0.05)
}

export interface LimitingParams {
  n_particles: number
  geometry_type: LimitingGeometryType
  configuration_type: ChainConfig | PlaneConfig | SphereConfig
  packing: PackingType
  layers?: number
  primary_particle_radius_nm?: number
  sintering_coeff?: number
}

export type SimulationParams = DlaParams | CcaParams | BallisticParams | TunableParams | TunableCcParams | LimitingParams

// Simulation
export interface SimulationSummary {
  id: string
  algorithm: SimulationAlgorithm
  status: SimulationStatus
  created_at: string
}

export interface Simulation {
  id: string
  project: string
  algorithm: SimulationAlgorithm
  status: SimulationStatus
  parameters: SimulationParams
  seed: number
  metrics: SimulationMetrics | null
  execution_time_ms: number | null
  created_at: string
  completed_at: string | null
  error_message?: string
}

export interface SimulationMetrics {
  fractal_dimension: number
  fractal_dimension_std: number
  prefactor: number
  radius_of_gyration: number
  porosity: number
  coordination: {
    mean: number
    std: number
  }
  rg_evolution: number[]
  // Inertia tensor analysis
  anisotropy: number
  asphericity: number
  acylindricity: number
  principal_moments: [number, number, number]
  principal_axes: [[number, number, number], [number, number, number], [number, number, number]]
}

export interface CreateSimulationInput {
  name?: string
  algorithm: SimulationAlgorithm
  parameters: SimulationParams
  seed?: number
}

// Image Analysis
export interface AnalysisSummary {
  id: string
  method: FractalMethod
  status: AnalysisStatus
  created_at: string
}

export interface ImageAnalysis {
  id: string
  project: string
  original_image_path: string
  processed_image_path: string | null
  method: FractalMethod
  status: AnalysisStatus
  preprocessing_params: PreprocessingParams
  method_params: BoxCountingParams | MultifractalParams
  results: BoxCountingResults | MultifractalResults | null
  execution_time_ms: number | null
  created_at: string
  completed_at: string | null
  error_message?: string
}

export interface PreprocessingParams {
  threshold_method: 'otsu' | 'manual' | 'adaptive'
  threshold_value?: number
  invert: boolean
  remove_small_objects: number
  fill_holes: boolean
  gaussian_blur_sigma: number
}

export interface BoxCountingParams {
  min_box_size: number
  max_box_size: number
  num_scales: number
}

export interface MultifractalParams {
  q_values: number[]
  min_box_size: number
  max_box_size: number
  num_scales: number
}

export interface BoxCountingResults {
  fractal_dimension: number
  r_squared: number
  std_error: number
  confidence_interval_95: [number, number]
  log_sizes: number[]
  log_counts: number[]
  residuals: number[]
}

export interface MultifractalResults {
  q_values: number[]
  dq_spectrum: number[]
  tau_q: number[]
  alpha: number[]
  f_alpha: number[]
  spectrum_width: number
  asymmetry: number
}

// Pagination
export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

// Geometry data for 3D viewer
export interface GeometryData {
  coordinates: number[][]  // [x, y, z][]
  radii: number[]
}

// Neighbor graph data for topology visualization
export interface NeighborGraphNode {
  id: number  // 1-based particle ID (depositional order)
  x: number
  y: number
  z: number
  radius: number
  coordination: number
  distance_from_cdg: number
}

export interface NeighborGraphEdge {
  source: number  // 1-based particle ID
  target: number  // 1-based particle ID
}

export interface NeighborGraphStats {
  n_particles: number
  n_edges: number
  avg_coordination: number
  max_coordination: number
  min_coordination: number
  is_connected: boolean
}

export interface NeighborGraphData {
  nodes: NeighborGraphNode[]
  edges: NeighborGraphEdge[]
  stats: NeighborGraphStats
}

// Parametric Study (Batch Simulations)
export interface ParametricStudy {
  id: string
  project: string
  name: string
  description: string
  base_algorithm: SimulationAlgorithm
  base_parameters: Record<string, unknown>
  parameter_grid: Record<string, unknown[]>
  seeds_per_combination: number
  status: SimulationStatus
  total_simulations: number
  completed_simulations: number
  created_at: string
  completed_at: string | null
}

export interface BoxCountingParams {
  points_per_sphere?: number
  precision?: number
}

export interface CreateParametricStudyInput {
  name: string
  description?: string
  base_algorithm: SimulationAlgorithm
  base_parameters: Record<string, unknown>
  parameter_grid: Record<string, unknown[]>
  seeds_per_combination?: number
  include_box_counting?: boolean
  box_counting_params?: BoxCountingParams
}

export interface BoxCountingResult {
  dimension: number
  r_squared: number
  std_error: number
  confidence_interval?: [number, number]
  log_scales?: number[]
  log_values?: number[]
  execution_time_ms?: number
}

export interface ParametricStudyResult {
  simulation_id: string
  status: SimulationStatus
  parameters: Record<string, unknown>
  seed: number
  execution_time_ms: number | null
  fractal_dimension?: number
  fractal_dimension_std?: number
  prefactor?: number
  radius_of_gyration?: number
  porosity?: number
  coordination_mean?: number
  coordination_std?: number
  anisotropy?: number
  asphericity?: number
  acylindricity?: number
  box_counting?: BoxCountingResult
}

export interface ParametricStudyResults {
  study_id: string
  name: string
  description: string
  base_algorithm: SimulationAlgorithm
  base_parameters: Record<string, unknown>
  parameter_grid: Record<string, unknown[]>
  status: string
  progress: {
    total: number
    completed: number
    failed: number
    running: number
  }
  results: ParametricStudyResult[]
}

// FRAKTAL Analysis Types
export interface FraktalAnalysisSummary {
  id: string
  model: FraktalModel
  source_type: FraktalSourceType
  status: AnalysisStatus
  created_at: string
}

export interface FraktalAnalysis {
  id: string
  project: string
  source_type: FraktalSourceType
  original_filename: string
  original_content_type: string
  simulation_id: string | null
  projection_params: ProjectionParams | null
  model: FraktalModel
  npix: number
  dpo: number | null
  delta: number
  correction_3d: boolean
  pixel_min: number
  pixel_max: number
  npo_limit: number
  escala: number
  m_exponent: number
  auto_calibrate: boolean
  results: FraktalResults | null
  status: AnalysisStatus
  execution_time_ms: number | null
  engine_version: string
  error_message: string
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface ProjectionParams {
  azimuth: number
  elevation: number
  resolution: number
}

export interface CalibrationAttempt {
  dpo: number
  npo: number
  npo_ratio: number
  npo_aligned: boolean
}

export interface FraktalResults {
  rg: number               // Radius of gyration (nm)
  ap: number               // Projected area (nm²)
  df: number               // Fractal dimension
  npo: number              // Number of primary particles (calculated)
  npo_visual: number       // Number of primary particles (estimated from image)
  kf: number               // Prefactor
  zf: number               // Overlap exponent
  jf: number | null        // Coordination index (granulated_2012 only)
  volume: number           // Volume (nm³)
  mass: number             // Mass (fg)
  surface_area: number     // Surface area (nm²)
  status: string           // Analysis status message
  model: string            // Model used
  npo_ratio: number        // Ratio of calculated/visual npo (1.0 = match)
  npo_aligned: boolean     // Whether npo values are aligned (within 2x)
  dpo_estimated: number    // Estimated dpo from visual analysis (nm)
  // Auto-calibration results
  calibration_attempts?: CalibrationAttempt[]  // Array of tried dpo values
  best_dpo?: number        // Optimal dpo found by auto-calibration
}

export interface Granulated2012Params {
  npix: number
  dpo: number
  delta: number
  correction_3d: boolean
  pixel_min: number
  pixel_max: number
  npo_limit: number
  escala: number
}

export interface Voxel2018Params {
  npix: number
  escala: number
  correction_3d: boolean
  pixel_min: number
  pixel_max: number
  m_exponent: number
}

export interface CreateFraktalFromImageInput {
  name?: string
  source_type: 'uploaded_image'
  image: string  // base64 encoded
  original_filename: string
  original_content_type: string
  model: FraktalModel
  npix: number
  dpo?: number
  delta?: number
  correction_3d?: boolean
  pixel_min?: number
  pixel_max?: number
  npo_limit?: number
  escala?: number
  m_exponent?: number
  auto_calibrate?: boolean
}

export interface CreateFraktalFromSimulationInput {
  name?: string
  source_type: 'simulation_projection'
  simulation_id: string
  projection_params: ProjectionParams
  model: FraktalModel
  npix: number
  dpo?: number
  delta?: number
  correction_3d?: boolean
  pixel_min?: number
  pixel_max?: number
  npo_limit?: number
  escala?: number
  m_exponent?: number
  auto_calibrate?: boolean
}

export type CreateFraktalInput = CreateFraktalFromImageInput | CreateFraktalFromSimulationInput

// 3D Box-Counting Analysis Results
export interface BoxCounting3DResult {
  dimension: number
  r_squared: number
  std_error: number
  confidence_interval: [number, number]
  log_scales: number[]
  log_values: number[]
  residuals: number[]
  /** Start index of linear region (points before this are excluded as outliers) */
  linear_region_start: number
  execution_time_ms: number
}
