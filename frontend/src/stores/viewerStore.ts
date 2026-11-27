import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '@/lib/types'

export type BackgroundPreset = 'dark' | 'white' | 'black' | 'light'
export type BackgroundOption = BackgroundPreset

export const backgroundColors: Record<BackgroundPreset, string> = {
  dark: '#0f172a',
  white: '#ffffff',
  black: '#000000',
  light: '#f1f5f9',
}

export type ExportFormat = 'png' | 'svg' | null

/** Default scope used when no explicit scope is provided. */
export const DEFAULT_CAMERA_SCOPE = 'single' as const

export interface CameraAngles {
  azimuth: number
  elevation: number
}

interface CameraState {
  /** Volatile camera positions keyed by viewer scope. */
  cameraScopes: Record<string, CameraAngles>
  /** Mirror of the default scope for legacy angle consumers. */
  cameraAzimuth: number
  /** Mirror of the default scope for legacy angle consumers. */
  cameraElevation: number
  setCameraAngles: (azimuth: number, elevation: number, scope?: string) => void
  getCameraAngles: (scope?: string) => CameraAngles
  clearCameraScope: (scope: string) => void
  clearCameraScopes: (prefix: string) => void
  resetCameraState: () => void
}

const initialCameraState = {
  cameraScopes: {
    [DEFAULT_CAMERA_SCOPE]: { azimuth: 0, elevation: 0 },
  } as Record<string, CameraAngles>,
  cameraAzimuth: 0,
  cameraElevation: 0,
}

/**
 * Camera positions are intentionally kept outside the persisted viewer settings.
 * Moving a camera may update this store every frame, but it never writes storage.
 */
export const useCameraStore = create<CameraState>()((set, get) => ({
  ...initialCameraState,
  setCameraAngles: (azimuth, elevation, scope = DEFAULT_CAMERA_SCOPE) => {
    const current = get().cameraScopes[scope]
    if (
      current !== undefined &&
      current.azimuth === azimuth &&
      current.elevation === elevation
    ) {
      return
    }

    set((state) => {
      const cameraScopes = {
        ...state.cameraScopes,
        [scope]: { azimuth, elevation },
      }
      if (scope === DEFAULT_CAMERA_SCOPE) {
        return {
          cameraScopes,
          cameraAzimuth: azimuth,
          cameraElevation: elevation,
        }
      }
      return { cameraScopes }
    })
  },
  getCameraAngles: (scope = DEFAULT_CAMERA_SCOPE) =>
    get().cameraScopes[scope] ?? { azimuth: 0, elevation: 0 },
  clearCameraScope: (scope) => {
    set((state) => {
      if (scope === DEFAULT_CAMERA_SCOPE) {
        return {
          cameraScopes: {
            ...state.cameraScopes,
            [DEFAULT_CAMERA_SCOPE]: { azimuth: 0, elevation: 0 },
          },
          cameraAzimuth: 0,
          cameraElevation: 0,
        }
      }
      if (!(scope in state.cameraScopes)) return state
      const cameraScopes = { ...state.cameraScopes }
      delete cameraScopes[scope]
      return { cameraScopes }
    })
  },
  clearCameraScopes: (prefix) => {
    set((state) => {
      const cameraScopes = Object.fromEntries(
        Object.entries(state.cameraScopes).filter(
          ([scope]) => scope !== prefix && !scope.startsWith(`${prefix}/`),
        ),
      )
      const single = cameraScopes[DEFAULT_CAMERA_SCOPE] ?? {
        azimuth: 0,
        elevation: 0,
      }
      cameraScopes[DEFAULT_CAMERA_SCOPE] = single
      return {
        cameraScopes,
        cameraAzimuth: single.azimuth,
        cameraElevation: single.elevation,
      }
    })
  },
  resetCameraState: () => set(initialCameraState),
}))

interface ViewerState {
  colorMode: ColorMode
  showAxes: boolean
  showGrid: boolean
  showBoundingSphere: boolean
  showPrincipalAxes: boolean
  particleOpacity: number
  background: BackgroundPreset

  showClipping: boolean
  clippingPosition: [number, number, number]
  clippingNormal: [number, number, number]

  useOrthographic: boolean
  /** Session state: never restored from persisted settings. */
  autoRotate: boolean
  rotateSpeed: number

  exportRequest: ExportFormat
  exportFilename: string

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
  exportRequest: null as ExportFormat,
  exportFilename: 'agglomerate_3d',
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set) => ({
      ...initialState,
      setColorMode: (mode) => set({ colorMode: mode }),
      toggleAxes: () => set((state) => ({ showAxes: !state.showAxes })),
      toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
      toggleBoundingSphere: () =>
        set((state) => ({ showBoundingSphere: !state.showBoundingSphere })),
      togglePrincipalAxes: () =>
        set((state) => ({ showPrincipalAxes: !state.showPrincipalAxes })),
      setParticleOpacity: (opacity) => set({ particleOpacity: opacity }),
      setBackground: (background) => set({ background }),
      toggleClipping: () =>
        set((state) => ({ showClipping: !state.showClipping })),
      setClippingPosition: (clippingPosition) => set({ clippingPosition }),
      setClippingNormal: (clippingNormal) => set({ clippingNormal }),
      toggleOrthographic: () =>
        set((state) => ({ useOrthographic: !state.useOrthographic })),
      toggleAutoRotate: () =>
        set((state) => ({ autoRotate: !state.autoRotate })),
      setRotateSpeed: (rotateSpeed) => set({ rotateSpeed }),
      requestExport: (exportRequest, exportFilename) =>
        set({ exportRequest, exportFilename }),
      clearExportRequest: () => set({ exportRequest: null }),
      reset: () => set(initialState),
    }),
    {
      name: 'viewer-settings',
      partialize: (state) => {
        const {
          autoRotate,
          exportRequest,
          exportFilename,
          ...persisted
        } = state
        return persisted
      },
      version: 3,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState
        }
        const {
          cameraScopes,
          cameraAzimuth,
          cameraElevation,
          autoRotate,
          exportRequest,
          exportFilename,
          ...persisted
        } = persistedState as Record<string, unknown>
        void cameraScopes
        void cameraAzimuth
        void cameraElevation
        void autoRotate
        void exportRequest
        void exportFilename
        return persisted
      },
    },
  ),
)

/** Read and update volatile camera angles for one viewer scope. */
export function useViewerCamera(scope: string = DEFAULT_CAMERA_SCOPE): {
  azimuth: number
  elevation: number
  setCameraAngles: (azimuth: number, elevation: number) => void
} {
  const angles = useCameraStore(
    (state) => state.cameraScopes[scope] ?? { azimuth: 0, elevation: 0 },
  )
  const setCameraAngles = useCameraStore((state) => state.setCameraAngles)
  return {
    azimuth: angles.azimuth,
    elevation: angles.elevation,
    setCameraAngles: (azimuth, elevation) =>
      setCameraAngles(azimuth, elevation, scope),
  }
}
