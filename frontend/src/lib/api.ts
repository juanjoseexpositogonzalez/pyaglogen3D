/**
 * API client for pyAgloGen3D backend.
 */
import type {
  Project,
  ProjectDetail,
  CreateProjectInput,
  Simulation,
  CreateSimulationInput,
  ImageAnalysis,
  PaginatedResponse,
  GeometryData,
  NeighborGraphData,
  FraktalAnalysis,
  CreateFraktalInput,
  ParametricStudy,
  CreateParametricStudyInput,
  ParametricStudyResults,
  BoxCounting3DResult,
  AnalysisStatus,
} from './types'
import { tokenStorage } from './token-storage'
import { authApi } from './auth-api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: Record<string, string[]>
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Get authorization headers if authenticated.
 */
function getAuthHeaders(): Record<string, string> {
  const accessToken = tokenStorage.getAccessToken()
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` }
  }
  return {}
}

/**
 * Try to refresh the access token.
 */
async function tryRefreshToken(): Promise<boolean> {
  try {
    await authApi.refreshToken()
    return true
  } catch {
    return false
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  retryOnAuth = true
): Promise<T> {
  const url = `${API_BASE}${endpoint}`

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
  })

  // Handle 401 Unauthorized - try to refresh token
  if (res.status === 401 && retryOnAuth && tokenStorage.hasRefreshToken()) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      // Retry the request with new token
      return request<T>(endpoint, options, false)
    }
    // Refresh failed - redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login'
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new ApiError(
      error.message || error.detail || `Request failed: ${res.status}`,
      res.status,
      error.details
    )
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T
  }

  return res.json()
}

/**
 * Make an authenticated fetch request (for blob responses).
 */
async function authFetch(
  url: string,
  options: RequestInit = {},
  retryOnAuth = true
): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  })

  // Handle 401 Unauthorized - try to refresh token
  if (res.status === 401 && retryOnAuth && tokenStorage.hasRefreshToken()) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      return authFetch(url, options, false)
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login'
    }
  }

  return res
}

// -----------------------------------------------------------------------------
// Projections export — types + polling helper (shared by simulationsApi.exportProjections)
// -----------------------------------------------------------------------------

/**
 * Payload accepted by the ``projection/batch/`` endpoint under the new
 * mode-aware contract. ``mode`` is optional — omitting it (or passing
 * ``"legacy"``) preserves the pre-change behavior byte-for-byte (R3).
 */
export interface ExportProjectionsPayload {
  mode?: 'legacy' | 'grid' | 'fibonacci'

  // Grid mode
  n_az?: number
  n_el?: number

  // Fibonacci mode
  n?: number

  // Shared knobs (grid + fibonacci)
  img_size?: number

  // Legacy mode (all existing fields preserved — see R3)
  azimuth_start?: number
  azimuth_end?: number
  azimuth_step?: number
  elevation_start?: number
  elevation_end?: number
  elevation_step?: number
  format?: 'png' | 'svg'
}

export interface ExportProjectionsOptions {
  onProgress?: (progress: number, current: number, total: number) => void
  /** Poll interval for the async path, in ms. Default: 1000 (1 Hz). */
  pollIntervalMs?: number
  /** Total wait budget before giving up, in ms. Default: 30 * 60 * 1000. */
  maxWaitMs?: number
}

interface ProjectionsStatusProcessing {
  status: 'processing'
  progress?: number
  current?: number
  total?: number
}

interface ProjectionsStatusDone {
  status: 'done'
  download_url: string
}

interface ProjectionsStatusFailed {
  status: 'failed'
  error?: string
}

type ProjectionsStatusResponse =
  | ProjectionsStatusProcessing
  | ProjectionsStatusDone
  | ProjectionsStatusFailed

/**
 * Resolve a backend-returned download URL (e.g.
 * ``"/api/v1/projections-status/xyz/download/"``) against the API base.
 * The backend emits absolute-from-root paths, but ``API_BASE`` may be any
 * origin — strip the ``/api/v1`` prefix and re-prepend ``API_BASE`` so the
 * request targets the same host the client was talking to all along.
 */
function resolveDownloadUrl(downloadUrl: string): string {
  if (/^https?:\/\//i.test(downloadUrl)) {
    return downloadUrl
  }
  // Backend paths all start with "/api/v1/..."; API_BASE already ends with
  // "/api/v1" (or whatever the deployment maps it to). Concatenate the tail
  // after that common prefix.
  const prefix = '/api/v1'
  if (downloadUrl.startsWith(prefix)) {
    return `${API_BASE}${downloadUrl.slice(prefix.length)}`
  }
  return `${API_BASE}${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`
}

async function pollProjectionsUntilDone(
  jobId: string,
  onProgress?: (progress: number, current: number, total: number) => void,
  pollIntervalMs = 1000,
  maxWaitMs = 30 * 60 * 1000
): Promise<Blob> {
  const startedAt = Date.now()
  const statusUrl = `${API_BASE}/projections-status/${jobId}/`

  while (Date.now() - startedAt < maxWaitMs) {
    const statusRes = await authFetch(statusUrl)
    if (!statusRes.ok) {
      throw new ApiError(
        `Projection status check failed (HTTP ${statusRes.status})`,
        statusRes.status
      )
    }

    const body = (await statusRes.json().catch(() => ({}))) as
      | ProjectionsStatusResponse
      | Record<string, never>

    if (body && 'status' in body && body.status === 'done') {
      const downloadUrl = resolveDownloadUrl(body.download_url)
      const dl = await authFetch(downloadUrl)
      if (!dl.ok) {
        throw new ApiError(
          `Projection download failed (HTTP ${dl.status})`,
          dl.status
        )
      }
      return dl.blob()
    }

    if (body && 'status' in body && body.status === 'failed') {
      throw new ApiError(
        body.error || 'Projection generation failed',
        500
      )
    }

    if (body && 'status' in body && body.status === 'processing' && onProgress) {
      onProgress(
        typeof body.progress === 'number' ? body.progress : 0,
        typeof body.current === 'number' ? body.current : 0,
        typeof body.total === 'number' ? body.total : 0
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new ApiError(
    'Projection export timed out (> 30 minutes without completion)',
    408
  )
}

// Projects API
export const projectsApi = {
  list: () => request<PaginatedResponse<Project>>('/projects/'),

  get: (id: string) => request<ProjectDetail>(`/projects/${id}/`),

  create: (data: CreateProjectInput) =>
    request<Project>('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<CreateProjectInput>) =>
    request<Project>(`/projects/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/projects/${id}/`, { method: 'DELETE' }),
}

// Simulations API
export const simulationsApi = {
  list: (projectId: string, params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : ''
    return request<PaginatedResponse<Simulation>>(
      `/projects/${projectId}/simulations/${query}`
    )
  },

  get: (projectId: string, id: string) =>
    request<Simulation>(`/projects/${projectId}/simulations/${id}/`),

  create: (projectId: string, data: CreateSimulationInput) =>
    request<Simulation>(`/projects/${projectId}/simulations/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/simulations/${id}/`, {
      method: 'DELETE',
    }),

  deleteAll: (projectId: string) =>
    request<{ deleted: number; message: string }>(
      `/projects/${projectId}/simulations/delete-all/`,
      { method: 'DELETE' }
    ),

  cancel: (projectId: string, id: string) =>
    request<{ status: string; simulation_id: string }>(
      `/projects/${projectId}/simulations/${id}/cancel/`,
      { method: 'POST' }
    ),

  /**
   * Generate a 2D projection of the agglomerate.
   * Returns image blob (PNG or SVG).
   */
  getProjection: async (
    projectId: string,
    simId: string,
    params: {
      azimuth?: number
      elevation?: number
      format?: 'png' | 'svg'
    } = {}
  ): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/simulations/${simId}/projection/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          azimuth: params.azimuth ?? 0,
          elevation: params.elevation ?? 0,
          format: params.format ?? 'png',
        }),
      }
    )
    if (!res.ok) {
      throw new ApiError('Failed to generate projection', res.status)
    }
    return res.blob()
  },

  /**
   * Generate batch 2D projections as a ZIP file.
   */
  getProjectionBatch: async (
    projectId: string,
    simId: string,
    params: {
      azimuth_start?: number
      azimuth_end?: number
      azimuth_step?: number
      elevation_start?: number
      elevation_end?: number
      elevation_step?: number
      format?: 'png' | 'svg'
    } = {}
  ): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/simulations/${simId}/projection/batch/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          azimuth_start: params.azimuth_start ?? 0,
          azimuth_end: params.azimuth_end ?? 150,
          azimuth_step: params.azimuth_step ?? 30,
          elevation_start: params.elevation_start ?? 0,
          elevation_end: params.elevation_end ?? 90,
          elevation_step: params.elevation_step ?? 30,
          format: params.format ?? 'png',
        }),
      }
    )
    if (!res.ok) {
      const contentType = res.headers.get('Content-Type') || ''
      if (contentType.includes('application/json')) {
        const error = await res.json().catch(() => ({}))
        throw new ApiError(
          error.message || error.detail || 'Failed to generate projections',
          res.status,
          error.details
        )
      }

      const text = await res.text().catch(() => '')
      throw new ApiError(text || 'Failed to generate projections', res.status)
    }
    return res.blob()
  },

  /**
   * Export projections using the new mode-based endpoint (grid | fibonacci |
   * legacy). Hits the same URL as `getProjectionBatch` but with a ``mode``
   * field that the backend dispatches on.
   *
   * Sync path (N ≤ 200): backend responds ``200`` + ``application/zip``;
   * resolve with the Blob directly.
   *
   * Async path (N > 200): backend responds ``202`` + JSON ``{job_id}``;
   * poll ``/projections-status/{job_id}/`` every second until the job is
   * ``done`` (then fetch the download URL) or ``failed`` (then reject).
   *
   * ``onProgress`` is invoked on every poll tick while the job is still
   * running so the UI can drive a progress bar. It is never called on the
   * sync path.
   */
  exportProjections: async (
    projectId: string,
    simId: string,
    payload: ExportProjectionsPayload,
    options?: ExportProjectionsOptions
  ): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/simulations/${simId}/projection/batch/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    // Sync path — backend already rendered the ZIP.
    if (res.status === 200) {
      return res.blob()
    }

    // Async path — poll the status endpoint until the Celery job settles.
    if (res.status === 202) {
      const data = (await res.json().catch(() => ({}))) as {
        job_id?: string
      }
      if (!data.job_id) {
        throw new ApiError(
          'Async projection job accepted but no job_id returned',
          502
        )
      }
      return pollProjectionsUntilDone(
        data.job_id,
        options?.onProgress,
        options?.pollIntervalMs,
        options?.maxWaitMs
      )
    }

    // Any other status is an error — surface the JSON detail/message if
    // present, otherwise fall back to the raw text.
    const contentType = res.headers.get('Content-Type') || ''
    if (contentType.includes('application/json')) {
      const error = await res.json().catch(() => ({}))
      throw new ApiError(
        error.message || error.detail || 'Failed to export projections',
        res.status,
        error.details
      )
    }
    const text = await res.text().catch(() => '')
    throw new ApiError(text || 'Failed to export projections', res.status)
  },

  /**
   * Fetch geometry data as binary numpy array.
   * Returns coordinates and radii parsed from .npy format.
   */
  getGeometry: async (id: string): Promise<GeometryData> => {
    const res = await authFetch(`${API_BASE}/simulations/${id}/geometry/`)
    if (!res.ok) {
      throw new ApiError('Failed to fetch geometry', res.status)
    }
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // Parse numpy .npy header
    // Magic: \x93NUMPY (6 bytes)
    // Version: 1 byte major, 1 byte minor
    // Header length: 2 bytes (v1) or 4 bytes (v2)
    const major = bytes[6]
    let headerLen: number
    let dataOffset: number

    if (major === 1) {
      // Version 1.0: 2-byte header length (little endian)
      headerLen = bytes[8] | (bytes[9] << 8)
      dataOffset = 10 + headerLen
    } else {
      // Version 2.0+: 4-byte header length (little endian)
      headerLen = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24)
      dataOffset = 12 + headerLen
    }

    // Extract the float64 data after the header
    const dataBuffer = buffer.slice(dataOffset)
    const data = new Float64Array(dataBuffer)

    // The data is stored as (N, 4) array: x, y, z, radius
    const numParticles = data.length / 4
    const coordinates: number[][] = []
    const radii: number[] = []

    for (let i = 0; i < numParticles; i++) {
      const offset = i * 4
      coordinates.push([data[offset], data[offset + 1], data[offset + 2]])
      radii.push(data[offset + 3])
    }

    return { coordinates, radii }
  },

  /**
   * Export agglomerate data as CSV.
   * Returns CSV file with properties and per-particle data.
   */
  exportCsv: async (projectId: string, simId: string): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/simulations/${simId}/export/`
    )
    if (!res.ok) {
      throw new ApiError('Failed to export CSV', res.status)
    }
    return res.blob()
  },

  /**
   * Get particle neighbor/adjacency graph.
   * Returns nodes (particles) and edges (connections between touching particles).
   */
  getNeighborGraph: (projectId: string, simId: string) =>
    request<NeighborGraphData>(
      `/projects/${projectId}/simulations/${simId}/neighbor-graph/`
    ),

  /**
   * Run 3D box-counting fractal analysis on the agglomerate.
   * This is an on-demand analysis that may take a few seconds.
   */
  getBoxCounting: (
    projectId: string,
    simId: string,
    params?: { points_per_sphere?: number; precision?: number }
  ) =>
    request<BoxCounting3DResult>(
      `/projects/${projectId}/simulations/${simId}/box-counting/${
        params
          ? `?${new URLSearchParams(
              Object.entries(params).map(([k, v]) => [k, String(v)])
            ).toString()}`
          : ''
      }`
    ),

  /**
   * Calculate optical properties using T-Matrix or DDA method.
   */
  calculateOptical: (
    projectId: string,
    simId: string,
    params: {
      method: 'tmatrix' | 'dda'
      wavelength?: number
      refractive_index_n?: number
      refractive_index_k?: number
      medium_index?: number
      dipoles_per_wavelength?: number
    }
  ) =>
    request<{
      method: string
      wavelength: number
      refractive_index: { n: number; k: number }
      medium_index: number
      c_ext: number
      c_sca: number
      c_abs: number
      q_ext: number
      q_sca: number
      q_abs: number
      asymmetry_g: number
      single_scatter_albedo: number
    }>(`/projects/${projectId}/simulations/${simId}/optical/`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
}

// Image Analyses API
export const analysesApi = {
  list: (projectId: string) =>
    request<PaginatedResponse<ImageAnalysis>>(
      `/projects/${projectId}/analyses/`
    ),

  get: (projectId: string, id: string) =>
    request<ImageAnalysis>(`/projects/${projectId}/analyses/${id}/`),

  create: (projectId: string, data: {
    image: string  // base64 encoded
    image_content_type: string
    preprocessing_params: Record<string, unknown>
    method: string
    method_params: Record<string, unknown>
  }) =>
    request<ImageAnalysis>(`/projects/${projectId}/analyses/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/analyses/${id}/`, {
      method: 'DELETE',
    }),
}

// Comparison Sets API
export const comparisonApi = {
  list: (projectId: string) =>
    request<PaginatedResponse<unknown>>(`/projects/${projectId}/comparisons/`),

  create: (projectId: string, data: {
    name: string
    description?: string
    simulations?: string[]
    analyses?: string[]
  }) =>
    request<unknown>(`/projects/${projectId}/comparisons/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// FRAKTAL Analysis API
// -----------------------------------------------------------------------------
// FRAKTAL batch analysis — types + polling helper
// (mirrors the ``simulationsApi.exportProjections`` 200/202 + polling pattern)
// -----------------------------------------------------------------------------

// Quality classification types (fraktal-bisection-ux, P5)
export type AnalysisQuality = 'converged' | 'approximate' | 'excluded' | 'failed'
export type FailureReason = 'no_sign_change' | 'kf_negative' | 'iteration_limit' | null

export type FraktalBatchAlgorithm = 'granulated_2012' | 'voxel_2018'

export interface FraktalBatchRequest {
  file: File
  pixels_per_100nm?: number
  autocalibrate_dpo?: boolean
  dpo_hint?: number
  algorithm?: FraktalBatchAlgorithm
  sim_id?: string
  /** Batch origin: "simulation" (from sim results) or "external" (user upload). */
  origin?: 'simulation' | 'external'
  /** DPO from simulation parameters — required when origin="simulation". */
  sim_dpo_nm?: number
}

export interface FraktalBatchImageResult {
  index: number
  filename: string | null
  azimuth: number | null
  elevation: number | null
  fractal_dimension: number | null
  prefactor: number | null
  r_squared: number | null
  n_particles_counted: number | null
  /** Radius of gyration in nm. Frente 9: surfaced from engine FraktalResult.
   *  Optional for backward compat with legacy server responses. */
  rg_nm?: number | null
  error: string | null
  /** Quality classification (fraktal-bisection-ux P5). Optional for backward compat. */
  quality?: AnalysisQuality
  /** Bisection diagnostic fields (fraktal-bisection-ux P5). Optional for backward compat. */
  bisection_iterations?: number | null
  bisection_residual?: number | null
  failure_reason?: FailureReason
  df_estimate?: number | null
}

/** Aggregate stats for a single metric across a batch (excludes failed images). */
export interface FraktalMetricStats {
  mean: number | null
  std: number | null
  median: number | null
  min: number | null
  max: number | null
}

export interface FraktalBatchStats {
  n_images: number
  n_successful: number
  // Legacy Df-only block (preserved for backward compat).
  mean_df: number | null
  std_df: number | null
  median_df: number | null
  q1_df: number | null
  q3_df: number | null
  min_df: number | null
  max_df: number | null
  // Frente 9: per-metric stats block (additive). May be missing on
  // responses from servers that haven't been deployed yet.
  df?: FraktalMetricStats
  kf?: FraktalMetricStats
  rg?: FraktalMetricStats
  npo?: FraktalMetricStats
  // Quality counters (fraktal-bisection-ux P5). Optional for backward compat.
  n_converged?: number
  n_approximate?: number
  n_excluded?: number
  n_failed?: number
  mean_df_inclusive?: number | null
}

export interface FraktalBatchHistogram {
  bin_edges: number[]
  counts: number[]
  rule_used: 'freedman_diaconis' | 'sturges' | 'sqrt'
}

export interface FraktalBatchComparison {
  sim_id: string | null
  sim_name: string | null
  sim_target_df: number | null
  sim_box_counting_df: number | null
  batch_mean_df: number | null
  batch_std_df: number | null
  sorensen_note: string
}

export interface FraktalBatchCalibration {
  source: 'manual' | 'metadata' | 'autocalibrate'
  pixels_per_100nm: number
  dpo_used: number
  autocalibrate_image: number | null
}

export interface FraktalBatchResult {
  /** Batch ID from DB persistence (added by T3.4 polling shape). */
  batch_id?: string
  images: FraktalBatchImageResult[]
  stats: FraktalBatchStats
  histogram: FraktalBatchHistogram | null
  comparison: FraktalBatchComparison | null
  calibration: FraktalBatchCalibration
}

export interface FraktalBatchListItem {
  id: string
  status: AnalysisStatus
  created_at: string
  completed_at: string | null
  algorithm: string
  calibration_source: string
  dpo_used: number
  autocalibrate_source: string | null
  n_images: number
  n_successful: number
  mean_df: number | null
  std_df: number | null
  median_df: number | null
  min_df: number | null
  max_df: number | null
  original_zip_filename: string
}

export interface FraktalBatchProgress {
  progress: number // 0..1
  current: number
  total: number
  stage: 'autocalibrate' | 'analyzing' | 'aggregating'
}

export interface FraktalBatchOptions {
  onProgress?: (progress: FraktalBatchProgress) => void
  /** Poll interval for the async path, in ms. Default: 1000 (1 Hz). */
  pollIntervalMs?: number
  /** Total wait budget before giving up, in ms. Default: 30 * 60 * 1000. */
  maxWaitMs?: number
  /** Project ID for the project-scoped batch endpoint. */
  projectId?: string
}

/** Shape returned by GET /batches/{id}/images/{index}/ (drill-down detail). */
export interface FraktalBatchImageDetail {
  batch_id: string
  index: number
  filename: string
  azimuth: number | null
  elevation: number | null
  fractal_dimension: number | null
  prefactor: number | null
  r_squared: number | null
  n_particles_counted: number | null
  error: string | null
  dpo_used: number
  pixels_per_100nm: number
  autocalibrate_source: string | null
  prev_index: number | null
  next_index: number | null
  sim_target_df: number | null
  sim_box_counting_df: number | null
  sorensen_note: string
  /** Whether a scientific PNG variant exists for this image (P5 backend). */
  has_scientific_png: boolean
  /** Which input variant was actually fed to the analyzer. */
  analysis_input_variant?: 'presentation' | 'scientific'
  /** Batch origin: "simulation" (from sim results) or "external" (user upload). */
  batch_origin?: 'simulation' | 'external'
  /** Quality classification (fraktal-bisection-ux P5). Optional for backward compat. */
  quality?: AnalysisQuality
  /** Bisection diagnostic fields (fraktal-bisection-ux P5). Optional for backward compat. */
  bisection_iterations?: number | null
  bisection_residual?: number | null
  failure_reason?: FailureReason
  df_estimate?: number | null
}

interface FraktalBatchStatusProcessing {
  status: 'processing'
  progress?: number
  current?: number
  total?: number
  stage?: FraktalBatchProgress['stage']
}

interface FraktalBatchStatusDone {
  status: 'done'
  results_url?: string
}

interface FraktalBatchStatusFailed {
  status: 'failed'
  error?: string
}

type FraktalBatchStatusResponse =
  | FraktalBatchStatusProcessing
  | FraktalBatchStatusDone
  | FraktalBatchStatusFailed

async function pollFraktalBatchUntilDone(
  jobId: string,
  onProgress?: (progress: FraktalBatchProgress) => void,
  pollIntervalMs = 1000,
  maxWaitMs = 30 * 60 * 1000
): Promise<FraktalBatchResult> {
  const startedAt = Date.now()
  const statusUrl = `${API_BASE}/fraktal-status/${jobId}/`
  const resultsUrl = `${API_BASE}/fraktal-status/${jobId}/results/`

  while (Date.now() - startedAt < maxWaitMs) {
    const statusRes = await authFetch(statusUrl)
    if (!statusRes.ok) {
      throw new ApiError(
        `Fraktal batch status check failed (HTTP ${statusRes.status})`,
        statusRes.status
      )
    }

    const body = (await statusRes.json().catch(() => ({}))) as
      | FraktalBatchStatusResponse
      | Record<string, never>

    if (body && 'status' in body && body.status === 'done') {
      const dl = await authFetch(resultsUrl)
      if (!dl.ok) {
        throw new ApiError(
          `Fraktal batch results download failed (HTTP ${dl.status})`,
          dl.status
        )
      }
      return (await dl.json()) as FraktalBatchResult
    }

    if (body && 'status' in body && body.status === 'failed') {
      throw new ApiError(body.error || 'Fraktal batch analysis failed', 500)
    }

    if (
      body &&
      'status' in body &&
      body.status === 'processing' &&
      onProgress
    ) {
      onProgress({
        progress: typeof body.progress === 'number' ? body.progress : 0,
        current: typeof body.current === 'number' ? body.current : 0,
        total: typeof body.total === 'number' ? body.total : 0,
        stage: body.stage ?? 'analyzing',
      })
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new ApiError(
    'Fraktal batch analysis timed out (> 30 minutes without completion)',
    408
  )
}

export const fraktalApi = {
  /**
   * List all FRAKTAL analyses for a project.
   */
  list: (projectId: string) =>
    request<PaginatedResponse<FraktalAnalysis>>(`/projects/${projectId}/fraktal/`),

  /**
   * List all FRAKTAL batches for a project (paginated, newest first).
   */
  listBatches: (projectId: string) =>
    request<PaginatedResponse<FraktalBatchListItem>>(
      `/projects/${projectId}/fraktal/batches/`
    ),

  /**
   * Get a single FRAKTAL analysis.
   */
  get: (projectId: string, id: string) =>
    request<FraktalAnalysis>(`/projects/${projectId}/fraktal/${id}/`),

  /**
   * Create a new FRAKTAL analysis.
   * Supports both uploaded images and simulation projections.
   */
  create: (projectId: string, data: CreateFraktalInput) =>
    request<FraktalAnalysis>(`/projects/${projectId}/fraktal/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Delete a FRAKTAL analysis.
   */
  delete: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/fraktal/${id}/`, {
      method: 'DELETE',
    }),

  /**
   * Delete all FRAKTAL analyses in a project.
   */
  deleteAll: (projectId: string) =>
    request<{ deleted: number; message: string }>(
      `/projects/${projectId}/fraktal/delete-all/`,
      { method: 'DELETE' }
    ),

  /**
   * Re-run a failed or completed FRAKTAL analysis.
   */
  rerun: (projectId: string, id: string) =>
    request<{ message: string; id: string }>(
      `/projects/${projectId}/fraktal/${id}/rerun/`,
      { method: 'POST' }
    ),

  /**
   * Download the original image (only for uploaded_image source).
   */
  getOriginalImage: async (projectId: string, id: string): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/fraktal/${id}/original_image/`
    )
    if (!res.ok) {
      throw new ApiError('Failed to download original image', res.status)
    }
    return res.blob()
  },

  /**
   * Run FRAKTAL batch analysis on a ZIP of projection images.
   *
   * Sync path (N ≤ 30): backend responds ``200`` with the full result payload
   * inline and this resolves with the parsed ``FraktalBatchResult`` directly.
   *
   * Async path (N > 30): backend responds ``202`` + JSON ``{job_id}``;
   * poll ``/fraktal-status/{job_id}/`` every second until the job is
   * ``done`` (then fetch ``/fraktal-status/{job_id}/results/``) or
   * ``failed`` (then reject).
   *
   * ``onProgress`` is invoked on every poll tick while the job is still
   * running so the UI can drive a progress bar. It is never called on the
   * sync path.
   */
  analyzeBatch: async (
    request: FraktalBatchRequest,
    options?: FraktalBatchOptions
  ): Promise<FraktalBatchResult> => {
    const formData = new FormData()
    formData.append('file', request.file)
    if (request.pixels_per_100nm !== undefined) {
      formData.append('pixels_per_100nm', String(request.pixels_per_100nm))
    }
    if (request.autocalibrate_dpo !== undefined) {
      formData.append('autocalibrate_dpo', String(request.autocalibrate_dpo))
    }
    if (request.dpo_hint !== undefined) {
      formData.append('dpo_hint', String(request.dpo_hint))
    }
    if (request.algorithm) {
      formData.append('algorithm', request.algorithm)
    }
    if (request.sim_id) {
      formData.append('sim_id', request.sim_id)
    }
    if (request.origin) {
      formData.append('origin', request.origin)
    }
    if (request.sim_dpo_nm !== undefined) {
      formData.append('sim_dpo_nm', String(request.sim_dpo_nm))
    }

    const batchUrl = options?.projectId
      ? `${API_BASE}/projects/${options.projectId}/fraktal/analyze-batch/`
      : `${API_BASE}/fraktal/analyze-batch/`

    const res = await authFetch(batchUrl, {
      method: 'POST',
      body: formData,
    })

    // Sync path — backend already produced the full result payload.
    if (res.status === 200) {
      return (await res.json()) as FraktalBatchResult
    }

    // Async path — poll the status endpoint until the Celery job settles.
    if (res.status === 202) {
      const data = (await res.json().catch(() => ({}))) as { job_id?: string }
      if (!data.job_id) {
        throw new ApiError(
          'Async fraktal batch job accepted but no job_id returned',
          502
        )
      }
      return pollFraktalBatchUntilDone(
        data.job_id,
        options?.onProgress,
        options?.pollIntervalMs,
        options?.maxWaitMs
      )
    }

    // Any other status is an error — surface the JSON detail/message if
    // present, otherwise fall back to the raw text.
    const contentType = res.headers.get('Content-Type') || ''
    if (contentType.includes('application/json')) {
      const error = await res.json().catch(() => ({}))
      throw new ApiError(
        error.message || error.detail || 'Batch analysis failed',
        res.status,
        error.details
      )
    }
    const text = await res.text().catch(() => '')
    throw new ApiError(text || 'Batch analysis failed', res.status)
  },

  // ---------------------------------------------------------------------------
  // Drill-down + CSV methods (Phase 5: fraktal-drilldown-and-csv)
  // ---------------------------------------------------------------------------

  /**
   * Get batch detail (images list, stats, histogram, comparison, calibration).
   */
  getBatch: (projectId: string, batchId: string) =>
    request<FraktalBatchResult>(
      `/projects/${projectId}/fraktal/batches/${batchId}/`
    ),

  /**
   * Get a single image from a batch (drill-down detail with prev/next).
   */
  getBatchImage: (projectId: string, batchId: string, index: number) =>
    request<FraktalBatchImageDetail>(
      `/projects/${projectId}/fraktal/batches/${batchId}/images/${index}/`
    ),

  /**
   * Build the URL for the PNG image endpoint (for use in ``<img src>``).
   * Does NOT fetch — returns the URL string so the browser handles caching.
   *
   * NOTE: This endpoint requires JWT auth. Raw ``<img src>`` will NOT send
   * the ``Authorization`` header → use ``fetchBatchImagePng`` instead for
   * authenticated display. Kept for consumers that only need the URL string
   * (e.g. download links that go through an ``<a>`` tag or copy-to-clipboard).
   *
   * @param variant — 'presentation' (default, omitted from URL) or 'scientific'
   *   (appends ``?variant=scientific``). Omitting the param preserves backward
   *   compatibility — existing callers without the arg still get the same URL.
   */
  getBatchImagePngUrl: (
    projectId: string,
    batchId: string,
    index: number,
    variant: 'presentation' | 'scientific' = 'presentation'
  ): string => {
    const base = `${API_BASE}/projects/${projectId}/fraktal/batches/${batchId}/images/${index}/png/`
    return variant === 'scientific' ? `${base}?variant=scientific` : base
  },

  /**
   * Fetch the PNG image with authentication (Bearer token via ``authFetch``).
   *
   * Returns the image as a ``Blob`` on 2xx, throws ``ApiError`` on non-2xx.
   * Use ``URL.createObjectURL(blob)`` on the result to display in ``<img>``.
   *
   * @param variant — 'presentation' (default) or 'scientific'. Delegates URL
   *   construction to ``getBatchImagePngUrl`` to keep the variant query param
   *   logic in one place.
   */
  fetchBatchImagePng: async (
    projectId: string,
    batchId: string,
    index: number,
    variant: 'presentation' | 'scientific' = 'presentation'
  ): Promise<Blob> => {
    const url = fraktalApi.getBatchImagePngUrl(projectId, batchId, index, variant)
    const res = await authFetch(url)
    if (!res.ok) {
      throw new ApiError('Failed to load image', res.status)
    }
    return res.blob()
  },

  /**
   * Re-analyze a batch image: POST creates a new FraktalAnalysis from the
   * cached PNG + inherited dpo. Returns { id, status } per backend contract
   * (frente 6 batch_image_reanalyze_view).
   */
  reanalyzeBatchImage: (
    projectId: string,
    batchId: string,
    index: number
  ) =>
    request<{ id: string; status: string }>(
      `/projects/${projectId}/fraktal/batches/${batchId}/images/${index}/reanalyze/`,
      { method: 'POST' }
    ),

  /**
   * Delete a batch and all its images (cascade).
   */
  deleteBatch: (projectId: string, batchId: string) =>
    request<void>(
      `/projects/${projectId}/fraktal/batches/${batchId}/`,
      { method: 'DELETE' }
    ),

  /**
   * Download batch CSV (blob). Triggers browser download via Blob + anchor.
   */
  downloadBatchCsv: async (
    projectId: string,
    batchId: string
  ): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/fraktal/batches/${batchId}/csv/`
    )
    if (!res.ok) {
      throw new ApiError('Failed to download batch CSV', res.status)
    }
    return res.blob()
  },

  /**
   * Download single-image CSV (blob). Triggers browser download via Blob + anchor.
   */
  downloadSingleCsv: async (
    projectId: string,
    analysisId: string
  ): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/fraktal/${analysisId}/csv/`
    )
    if (!res.ok) {
      throw new ApiError('Failed to download single CSV', res.status)
    }
    return res.blob()
  },
}

// Parametric Studies (Batch Simulations) API
export const studiesApi = {
  /**
   * List all parametric studies for a project.
   */
  list: (projectId: string) =>
    request<PaginatedResponse<ParametricStudy>>(`/projects/${projectId}/studies/`),

  /**
   * Get a single parametric study.
   */
  get: (projectId: string, id: string) =>
    request<ParametricStudy>(`/projects/${projectId}/studies/${id}/`),

  /**
   * Create a new parametric study (batch simulations).
   */
  create: (projectId: string, data: CreateParametricStudyInput) =>
    request<ParametricStudy>(`/projects/${projectId}/studies/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Delete a parametric study.
   */
  delete: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/studies/${id}/`, {
      method: 'DELETE',
    }),

  /**
   * Get results for a parametric study.
   */
  getResults: (projectId: string, id: string) =>
    request<ParametricStudyResults>(`/projects/${projectId}/studies/${id}/results/`),

  /**
   * Export study results as CSV.
   */
  exportCsv: async (projectId: string, id: string): Promise<Blob> => {
    const res = await authFetch(
      `${API_BASE}/projects/${projectId}/studies/${id}/export/`
    )
    if (!res.ok) {
      throw new ApiError('Failed to export CSV', res.status)
    }
    return res.blob()
  },

  /**
   * Run box-counting analysis on all completed simulations in the study.
   */
  runBoxCounting: (
    projectId: string,
    id: string,
    params?: { points_per_sphere?: number; precision?: number }
  ) =>
    request<{
      status: string
      message: string
      results: {
        total: number
        processed: number
        skipped: number
        failed: number
        errors: Array<{ simulation_id: string; error: string }>
      }
    }>(`/projects/${projectId}/studies/${id}/run-box-counting/`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }),
}

// Project Sharing API
import type {
  ProjectSharingData,
  ProjectShare,
  ShareInvitation,
  SharePermission,
} from './types'

export const sharingApi = {
  /**
   * Get collaborators and pending invitations for a project.
   */
  get: (projectId: string) =>
    request<ProjectSharingData>(`/projects/${projectId}/sharing/`),

  /**
   * Invite a user to collaborate on a project.
   */
  invite: (projectId: string, email: string, permission: SharePermission) =>
    request<ProjectShare | ShareInvitation>(`/projects/${projectId}/sharing/invite/`, {
      method: 'POST',
      body: JSON.stringify({ email, permission }),
    }),

  /**
   * Update a collaborator's permission level.
   */
  updatePermission: (projectId: string, shareId: string, permission: SharePermission) =>
    request<ProjectShare>(`/projects/${projectId}/sharing/update/${shareId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ permission }),
    }),

  /**
   * Remove a collaborator or cancel a pending invitation.
   */
  remove: (projectId: string, shareId: string) =>
    request<void>(`/projects/${projectId}/sharing/remove/${shareId}/`, {
      method: 'DELETE',
    }),

  /**
   * Accept a share invitation via token.
   */
  acceptInvitation: (token: string) =>
    request<{ message: string; project_id: string; project_name: string }>(
      `/projects/invitations/${token}/accept/`,
      { method: 'POST' }
    ),
}

// Admin API
export interface AdminUser {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  email_verified: boolean
  is_staff: boolean
  is_active: boolean
  has_ai_access: boolean
  oauth_provider: string | null
  created_at: string
  last_login: string | null
  project_count: number
  simulation_count: number
  projects: Array<{
    id: string
    name: string
    description: string
    simulation_count: number
    study_count: number
    created_at: string
  }>
}

export interface AdminDashboardData {
  summary: {
    total_users: number
    total_projects: number
    total_simulations: number
  }
  users: AdminUser[]
}

export const adminApi = {
  /**
   * Get admin dashboard data (all users with their projects).
   * Requires staff/superuser permission.
   */
  getDashboard: () => request<AdminDashboardData>('/auth/admin/dashboard/'),

  /**
   * Update a user's details.
   * Requires staff/superuser permission.
   */
  updateUser: (userId: string, data: {
    first_name?: string
    last_name?: string
    is_staff?: boolean
    is_active?: boolean
    has_ai_access?: boolean
  }) => request<AdminUser>(`/auth/admin/users/${userId}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),

  /**
   * Delete a user and all their data.
   * Requires staff/superuser permission.
   */
   deleteUser: (userId: string) =>
    request<{ message: string }>(`/auth/admin/users/${userId}/`, {
      method: 'DELETE',
    }),
}

// ---------------------------------------------------------------------------
// Batch Projection Export — multi-sim study export (batch-projection-export)
// ---------------------------------------------------------------------------

export interface BatchProjectionExportRequest {
  simulation_ids: string[]
  mode: 'grid' | 'fibonacci' | 'legacy'
  config: Record<string, number>
}

export interface BatchProjectionExportResponse {
  job_id: string
  status: string
  total_sims: number
}

/**
 * Trigger a batch projection export across multiple simulations in a study.
 * Returns 202 with job_id for polling.
 */
export async function triggerBatchProjectionExport(
  projectId: string,
  studyId: string,
  body: BatchProjectionExportRequest
): Promise<BatchProjectionExportResponse> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/studies/${studyId}/export-projections/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new ApiError(
      error.detail || error.message || 'Batch projection export failed',
      res.status,
      error.details
    )
  }

  return res.json()
}

export interface BatchProjectionsResult {
  status: string
  download_url?: string
  download_filename?: string
  successful_sims?: number
  failed_sims?: Array<{ sim_id: string; error: string }>
}

/**
 * Poll projections-status/{job_id}/ until done or failed.
 * Calls onProgress on each tick.
 */
export async function pollProjectionsStatus(
  jobId: string,
  onProgress?: (progress: number, current: number, total: number) => void,
  pollIntervalMs = 2000,
  maxWaitMs = 30 * 60 * 1000
): Promise<BatchProjectionsResult> {
  const startedAt = Date.now()
  const statusUrl = `${API_BASE}/projections-status/${jobId}/`

  while (Date.now() - startedAt < maxWaitMs) {
    const statusRes = await authFetch(statusUrl)
    if (!statusRes.ok) {
      throw new ApiError(
        `Projection status check failed (HTTP ${statusRes.status})`,
        statusRes.status
      )
    }

    const body = await statusRes.json().catch(() => ({}))

    if (body.status === 'done') {
      return body as BatchProjectionsResult
    }

    if (body.status === 'failed') {
      throw new ApiError(
        body.error || 'Projection generation failed',
        500
      )
    }

    if (body.status === 'processing' && onProgress) {
      onProgress(
        typeof body.progress === 'number' ? body.progress : 0,
        typeof body.current === 'number' ? body.current : 0,
        typeof body.total === 'number' ? body.total : 0
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new ApiError(
    'Batch projection export timed out (> 30 minutes)',
    408
  )
}

