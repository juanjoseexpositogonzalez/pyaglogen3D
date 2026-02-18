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
  FraktalAnalysis,
  CreateFraktalInput,
} from './types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: Record<string, string[]>
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

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
    const res = await fetch(
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
    const res = await fetch(
      `${API_BASE}/projects/${projectId}/simulations/${simId}/projection/batch/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          azimuth_start: params.azimuth_start ?? 0,
          azimuth_end: params.azimuth_end ?? 150,
          azimuth_step: params.azimuth_step ?? 30,
          elevation_start: params.elevation_start ?? 0,
          elevation_end: params.elevation_end ?? 150,
          elevation_step: params.elevation_step ?? 30,
          format: params.format ?? 'png',
        }),
      }
    )
    if (!res.ok) {
      throw new ApiError('Failed to generate projections', res.status)
    }
    return res.blob()
  },

  /**
   * Fetch geometry data as binary numpy array.
   * Returns coordinates and radii parsed from .npy format.
   */
  getGeometry: async (id: string): Promise<GeometryData> => {
    const res = await fetch(`${API_BASE}/simulations/${id}/geometry/`)
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
export const fraktalApi = {
  /**
   * List all FRAKTAL analyses for a project.
   */
  list: (projectId: string) =>
    request<PaginatedResponse<FraktalAnalysis>>(`/projects/${projectId}/fraktal/`),

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
    const res = await fetch(
      `${API_BASE}/projects/${projectId}/fraktal/${id}/original_image/`
    )
    if (!res.ok) {
      throw new ApiError('Failed to download original image', res.status)
    }
    return res.blob()
  },
}

// Export ApiError for error handling
export { ApiError }
