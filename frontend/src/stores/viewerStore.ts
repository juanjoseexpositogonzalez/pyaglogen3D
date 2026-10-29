/**
 * Zustand store for 3D viewer settings.
 *
 * Camera state scoping (R-DELTA-1, visualize-multiple change):
 *   Camera azimuth/elevation is tracked per scope key (e.g. `"single"` for
 *   the single-sim detail page, `"compare/{sessionId}"` for a compare
 *   session). The default/legacy scope is `"single"`, so existing callers
 *   that read `cameraAzimuth` / `cameraElevation` at the root of the store
 *   continue to work unchanged — those fields always mirror the `"single"`
 *   scope.
 *
 *   New multi-viewer callers should pass a scope argument to
 *   `setCameraAngles(az, el, scope)` and read via `getCameraAngles(scope)`
 *   or `useViewerCamera(scope)` so that concurrent viewers don't overwrite
 *   each other's camera state.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '@/lib/types'

export type BackgroundPreset = 'dark' | 'white' | 'black' | 'light'
export type BackgroundOption = BackgroundPreset  // Alias for compatibility

export const backgroundColors: Record<BackgroundPreset, string> = {
  dark: '#0f172a',   // Default dark blue
  white: '#ffffff',  // White
  black: '#000000',  // Black
  light: '#f1f5f9',  // Light gray (slate-100)
}

export type ExportFormat = 'png' | 'svg' | null

/** Default scope used when no explicit scope is provided. */
export const DEFAULT_CAMERA_SCOPE = 'single' as const

export interface CameraAngles {
  azimuth: number
  elevation: number
}

interface ViewerState {
  // Display settings
  colorMode: ColorMode
  showAxes: boolean
  showGrid: boolean
  showBoundingSphere: boolean
  showPrincipalAxes: boolean
  particleOpacity: number
  background: BackgroundPreset

  // Clipping
  showClipping: boolean
  clippingPosition: [number, number, number]
  clippingNormal: [number, number, number]

  // Camera
  useOrthographic: boolean  // true = orthographic (no perspective), false = perspective
  autoRotate: boolean
  rotateSpeed: number
  /**
   * Per-scope camera angles. The `"single"` entry is mirrored by the
   * top-level `cameraAzimuth` / `cameraElevation` fields for backwards
   * compatibility with existing callers.
   */
  cameraScopes: Record<string, CameraAngles>
  /** Mirror of `cameraScopes["single"].azimuth` — kept in sync automatically. */
  cameraAzimuth: number
  /** Mirror of `cameraScopes["single"].elevation` — kept in sync automatically. */
  cameraElevation: number

  // Export
  exportRequest: ExportFormat
  exportFilename: string

  // Actions
  setColorMode: (mode: ColorMode) => void
  toggleAxes: () => void
  toggleGrid: () => void
  toggleBoundingSphere: () => void
  togglePrincipalAxes: () => void
  setParticleOpacity: (opacity: number) => void
  setBackground: (bg: BackgroundPreset) => void
  toggleClipping: () => void
  setClippingPosition: (pos: [number, number, number]) => void
  setClippingNormal: (normal: [number, number, number]) => void
  toggleOrthographic: () => void
  toggleAutoRotate: () => void
  setRotateSpeed: (speed: number) => void
  /**
   * Set camera angles for a given scope (defaults to `"single"`).
   * Writes to one scope never mutate another scope's state.
   */
  setCameraAngles: (azimuth: number, elevation: number, scope?: string) => void
  /** Read camera angles for a given scope (defaults to `"single"`). */
  getCameraAngles: (scope?: string) => CameraAngles
  requestExport: (format: 'png' | 'svg', filename: string) => void
  clearExportRequest: () => void
  reset: () => void
}

const initialState = {
  colorMode: 'uniform' as ColorMode,
  showAxes: true,
  showGrid: false,
  showBoundingSphere: false,
  showPrincipalAxes: false,
  particleOpacity: 1.0,
  background: 'dark' as BackgroundPreset,
  showClipping: false,
  clippingPosition: [0, 0, 0] as [number, number, number],
  clippingNormal: [1, 0, 0] as [number, number, number],
  useOrthographic: false,
  autoRotate: false,
  rotateSpeed: 1,
  cameraScopes: { [DEFAULT_CAMERA_SCOPE]: { azimuth: 0, elevation: 0 } } as Record<string, CameraAngles>,
  cameraAzimuth: 0,
  cameraElevation: 0,
  exportRequest: null as ExportFormat,
  exportFilename: 'agglomerate_3d',
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setColorMode: (mode) => set({ colorMode: mode }),
      toggleAxes: () => set((s) => ({ showAxes: !s.showAxes })),
      toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
      toggleBoundingSphere: () => set((s) => ({ showBoundingSphere: !s.showBoundingSphere })),
      togglePrincipalAxes: () => set((s) => ({ showPrincipalAxes: !s.showPrincipalAxes })),
      setParticleOpacity: (opacity) => set({ particleOpacity: opacity }),
      setBackground: (bg) => set({ background: bg }),
      toggleClipping: () => set((s) => ({ showClipping: !s.showClipping })),
      setClippingPosition: (pos) => set({ clippingPosition: pos }),
      setClippingNormal: (normal) => set({ clippingNormal: normal }),
      toggleOrthographic: () => set((s) => ({ useOrthographic: !s.useOrthographic })),
      toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
      setRotateSpeed: (speed) => set({ rotateSpeed: speed }),
      setCameraAngles: (azimuth, elevation, scope = DEFAULT_CAMERA_SCOPE) =>
        set((state) => {
          const nextScopes = {
            ...state.cameraScopes,
            [scope]: { azimuth, elevation },
          }
          // Mirror only the default scope into the legacy root fields so
          // existing consumers (ViewerControls, ProjectionControls, etc.)
          // keep reading the correct values.
          if (scope === DEFAULT_CAMERA_SCOPE) {
            return {
              cameraScopes: nextScopes,
              cameraAzimuth: azimuth,
              cameraElevation: elevation,
            }
          }
          return { cameraScopes: nextScopes }
        }),
      getCameraAngles: (scope = DEFAULT_CAMERA_SCOPE) => {
        const scoped = get().cameraScopes[scope]
        if (scoped) return scoped
        if (scope === DEFAULT_CAMERA_SCOPE) {
          // Fall back to legacy root fields in case the scopes map was
          // stripped by an older persisted state.
          return { azimuth: get().cameraAzimuth, elevation: get().cameraElevation }
        }
        return { azimuth: 0, elevation: 0 }
      },
      requestExport: (format, filename) => set({ exportRequest: format, exportFilename: filename }),
      clearExportRequest: () => set({ exportRequest: null }),
      reset: () => set(initialState),
    }),
    {
      name: 'viewer-settings',
      // Migrate older persisted states that predate `cameraScopes`.
      version: 1,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState
        const s = persistedState as Partial<ViewerState> & {
          cameraAzimuth?: number
          cameraElevation?: number
        }
        if (version < 1 || !s.cameraScopes) {
          return {
            ...s,
            cameraScopes: {
              [DEFAULT_CAMERA_SCOPE]: {
                azimuth: s.cameraAzimuth ?? 0,
                elevation: s.cameraElevation ?? 0,
              },
            },
          }
        }
        return s
      },
    }
  )
)

/**
 * Hook for reading/writing camera angles for a specific scope. Components
 * that don't care about scoping can keep using `useViewerStore` directly.
 */
export function useViewerCamera(scope: string = DEFAULT_CAMERA_SCOPE): {
  azimuth: number
  elevation: number
  setCameraAngles: (azimuth: number, elevation: number) => void
} {
  const angles = useViewerStore((s) =>
    s.cameraScopes[scope] ??
    (scope === DEFAULT_CAMERA_SCOPE
      ? { azimuth: s.cameraAzimuth, elevation: s.cameraElevation }
      : { azimuth: 0, elevation: 0 })
  )
  const setCameraAngles = useViewerStore((s) => s.setCameraAngles)
  return {
    azimuth: angles.azimuth,
    elevation: angles.elevation,
    setCameraAngles: (az, el) => setCameraAngles(az, el, scope),
  }
}
