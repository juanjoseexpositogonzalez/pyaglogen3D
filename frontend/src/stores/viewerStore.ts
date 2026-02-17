/**
 * Zustand store for 3D viewer settings.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorMode } from '@/lib/types'

export type BackgroundPreset = 'dark' | 'white' | 'black'

export const backgroundColors: Record<BackgroundPreset, string> = {
  dark: '#0f172a',   // Default dark blue
  white: '#ffffff',  // White
  black: '#000000',  // Black
}

interface ViewerState {
  // Display settings
  colorMode: ColorMode
  showAxes: boolean
  showGrid: boolean
  particleOpacity: number
  background: BackgroundPreset

  // Clipping
  showClipping: boolean
  clippingPosition: [number, number, number]
  clippingNormal: [number, number, number]

  // Camera
  autoRotate: boolean
  rotateSpeed: number

  // Actions
  setColorMode: (mode: ColorMode) => void
  toggleAxes: () => void
  toggleGrid: () => void
  setParticleOpacity: (opacity: number) => void
  setBackground: (bg: BackgroundPreset) => void
  toggleClipping: () => void
  setClippingPosition: (pos: [number, number, number]) => void
  setClippingNormal: (normal: [number, number, number]) => void
  toggleAutoRotate: () => void
  setRotateSpeed: (speed: number) => void
  reset: () => void
}

const initialState = {
  colorMode: 'uniform' as ColorMode,
  showAxes: true,
  showGrid: false,
  particleOpacity: 1.0,
  background: 'dark' as BackgroundPreset,
  showClipping: false,
  clippingPosition: [0, 0, 0] as [number, number, number],
  clippingNormal: [1, 0, 0] as [number, number, number],
  autoRotate: false,
  rotateSpeed: 1,
}

export const useViewerStore = create<ViewerState>()(
  persist(
    (set) => ({
      ...initialState,

      setColorMode: (mode) => set({ colorMode: mode }),
      toggleAxes: () => set((s) => ({ showAxes: !s.showAxes })),
      toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
      setParticleOpacity: (opacity) => set({ particleOpacity: opacity }),
      setBackground: (bg) => set({ background: bg }),
      toggleClipping: () => set((s) => ({ showClipping: !s.showClipping })),
      setClippingPosition: (pos) => set({ clippingPosition: pos }),
      setClippingNormal: (normal) => set({ clippingNormal: normal }),
      toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
      setRotateSpeed: (speed) => set({ rotateSpeed: speed }),
      reset: () => set(initialState),
    }),
    {
      name: 'viewer-settings',
    }
  )
)
