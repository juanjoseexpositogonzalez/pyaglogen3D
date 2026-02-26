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
} from './types'
import { tokenStorage } from './token-storage'
import { authApi } from './auth-api'

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

// Export ApiError for error handling
export { ApiError }
