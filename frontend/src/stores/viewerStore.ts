/**
 * Zustand store for 3D viewer settings.
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
  autoRotate: boolean
  rotateSpeed: number
  cameraAzimuth: number    // Current camera azimuth angle (degrees)
  cameraElevation: number  // Current camera elevation angle (degrees)

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
  toggleAutoRotate: () => void
  setRotateSpeed: (speed: number) => void
  setCameraAngles: (azimuth: number, elevation: number) => void
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
  autoRotate: false,
  rotateSpeed: 1,
  cameraAzimuth: 0,
  cameraElevation: 0,
  exportRequest: null as ExportFormat,
  exportFilename: 'agglomerate_3d',
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set) => ({
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
      toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
      setRotateSpeed: (speed) => set({ rotateSpeed: speed }),
      setCameraAngles: (azimuth, elevation) => set({ cameraAzimuth: azimuth, cameraElevation: elevation }),
      requestExport: (format, filename) => set({ exportRequest: format, exportFilename: filename }),
      clearExportRequest: () => set({ exportRequest: null }),
      reset: () => set(initialState),
    }),
    {
      name: 'viewer-settings',
    }
  )
)
