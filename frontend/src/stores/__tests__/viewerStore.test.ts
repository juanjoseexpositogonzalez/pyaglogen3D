/**
 * Unit tests for the scoped camera state introduced by T2 of the
 * `visualize-multiple` change (R-DELTA-1). The store must:
 *
 *   - Default to the `"single"` scope when no scope argument is passed
 *     (backwards compatibility with the single-sim detail page).
 *   - Keep writes to different scopes isolated (no cross-contamination).
 *   - Keep the legacy root `cameraAzimuth` / `cameraElevation` fields in
 *     sync with the `"single"` scope so existing consumers
 *     (ViewerControls, ProjectionControls) don't regress.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useViewerStore,
  useViewerCamera,
  DEFAULT_CAMERA_SCOPE,
} from '../viewerStore'
import { renderHook, act } from '@testing-library/react'

beforeEach(() => {
  // Reset to a clean baseline; `reset()` re-applies the initial state which
  // includes a `cameraScopes: { single: { azimuth: 0, elevation: 0 } }` map.
  useViewerStore.getState().reset()
  localStorage.clear()
})

describe('viewerStore camera scoping (R-DELTA-1)', () => {
  it('defaults the scope to "single" when setCameraAngles is called without a scope', () => {
    const { setCameraAngles, getCameraAngles } = useViewerStore.getState()
    setCameraAngles(45, 30)
    expect(getCameraAngles(DEFAULT_CAMERA_SCOPE)).toEqual({
      azimuth: 45,
      elevation: 30,
    })
    // No-argument getCameraAngles also returns the default scope.
    expect(getCameraAngles()).toEqual({ azimuth: 45, elevation: 30 })
  })

  it('isolates writes between "single" and a compare scope', () => {
    const { setCameraAngles, getCameraAngles } = useViewerStore.getState()
    setCameraAngles(10, 5) // default → single
    setCameraAngles(90, 45, 'compare/session-a')

    expect(getCameraAngles('single')).toEqual({ azimuth: 10, elevation: 5 })
    expect(getCameraAngles('compare/session-a')).toEqual({
      azimuth: 90,
      elevation: 45,
    })
    // Mutating one does not touch the other.
    setCameraAngles(180, 60, 'compare/session-a')
    expect(getCameraAngles('single')).toEqual({ azimuth: 10, elevation: 5 })
    expect(getCameraAngles('compare/session-a')).toEqual({
      azimuth: 180,
      elevation: 60,
    })
  })

  it('keeps two independent compare scopes isolated from each other', () => {
    const { setCameraAngles, getCameraAngles } = useViewerStore.getState()
    setCameraAngles(30, 15, 'compare/a')
    setCameraAngles(120, 45, 'compare/b')

    expect(getCameraAngles('compare/a')).toEqual({ azimuth: 30, elevation: 15 })
    expect(getCameraAngles('compare/b')).toEqual({ azimuth: 120, elevation: 45 })

    setCameraAngles(0, 0, 'compare/a')
    expect(getCameraAngles('compare/b')).toEqual({ azimuth: 120, elevation: 45 })
  })

  it('mirrors the "single" scope into the legacy root cameraAzimuth/Elevation fields', () => {
    // Backwards-compat sanity: ViewerControls + ProjectionControls read
    // these root fields directly. Writes through the default scope must
    // keep them in sync.
    useViewerStore.getState().setCameraAngles(75, 40)
    expect(useViewerStore.getState().cameraAzimuth).toBe(75)
    expect(useViewerStore.getState().cameraElevation).toBe(40)
  })

  it('does not leak non-default scope writes into the root fields', () => {
    useViewerStore.getState().setCameraAngles(42, 42, 'compare/xyz')
    // Root fields stay at their initial values.
    expect(useViewerStore.getState().cameraAzimuth).toBe(0)
    expect(useViewerStore.getState().cameraElevation).toBe(0)
  })

  it('useViewerCamera() without args reads/writes the default "single" scope', () => {
    const { result } = renderHook(() => useViewerCamera())
    expect(result.current.azimuth).toBe(0)
    expect(result.current.elevation).toBe(0)
    act(() => result.current.setCameraAngles(33, 22))
    // React re-renders the hook, so after the act() the returned snapshot
    // reflects the new value.
    expect(result.current.azimuth).toBe(33)
    expect(result.current.elevation).toBe(22)
    // And the root mirror is updated too (backwards-compat).
    expect(useViewerStore.getState().cameraAzimuth).toBe(33)
  })

  it('useViewerCamera(scope) reads/writes an isolated scope', () => {
    const { result: single } = renderHook(() => useViewerCamera())
    const { result: compareA } = renderHook(() =>
      useViewerCamera('compare/a')
    )

    act(() => single.current.setCameraAngles(10, 10))
    act(() => compareA.current.setCameraAngles(99, 99))

    expect(single.current.azimuth).toBe(10)
    expect(compareA.current.azimuth).toBe(99)
    // Writing to compare scope must not leak into the single scope.
    expect(useViewerStore.getState().cameraAzimuth).toBe(10)
    expect(useViewerStore.getState().cameraElevation).toBe(10)
  })
})
