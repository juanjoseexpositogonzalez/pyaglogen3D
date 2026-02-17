/**
 * TypeScript types for pyAgloGen3D frontend.
 */

// Enums
export type SimulationAlgorithm = 'dla' | 'cca' | 'ballistic' | 'tunable'
export type SimulationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type FractalMethod = 'box_counting' | 'sandbox' | 'correlation' | 'lacunarity' | 'multifractal'
export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
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
}

export interface CcaParams {
  n_particles: number
  sticking_probability: number
  particle_radius: number
  box_size: number
}

export interface BallisticParams {
  n_particles: number
  sticking_probability: number
  particle_radius: number
}

export type SimulationParams = DlaParams | CcaParams | BallisticParams

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
}

export interface CreateSimulationInput {
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
