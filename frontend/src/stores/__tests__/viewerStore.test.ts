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
import { describe, it, expect, beforeEach, vi } from 'vitest'
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

/**
 * #312 — the viewer wrote to the store, and so to `localStorage`, on every frame.
 *
 * `CameraTracker` calls `setCameraAngles` from `useFrame`, sixty times a second,
 * and the setter rebuilt the state object every call, so `persist` serialized the
 * whole store and called `setItem` each time — whether or not the rounded angle
 * had moved. Two halves make that stop, and both are pinned here: an unchanged
 * angle is a no-op, and the camera is not persisted at all.
 */
describe('viewerStore — no write without a change (#312)', () => {
  it('does not notify subscribers when the rounded angles are unchanged', () => {
    const { setCameraAngles } = useViewerStore.getState()
    let notifications = 0
    const unsubscribe = useViewerStore.subscribe(() => {
      notifications += 1
    })

    setCameraAngles(45, 30) // a real change
    setCameraAngles(45, 30) // the next frame, same rounded angle
    setCameraAngles(45, 30)
    unsubscribe()

    // One notification for the change; the repeats are not changes, and a
    // subscriber that re-renders a heavy panel notices the difference.
    expect(notifications).toBe(1)
  })

  it('does not touch localStorage when the rounded angles are unchanged', () => {
    const { setCameraAngles } = useViewerStore.getState()
    // On the instance: `src/test/setup.ts` replaces `window.localStorage` with its
    // own implementation, so a `Storage` prototype spy never fires.
    const setItem = vi.spyOn(window.localStorage, 'setItem')

    setCameraAngles(45, 30)
    const writesAfterChange = setItem.mock.calls.length
    for (let frame = 0; frame < 10; frame += 1) setCameraAngles(45, 30)
    const writesAfterRepeats = setItem.mock.calls.length
    setItem.mockRestore()

    expect(writesAfterChange).toBeGreaterThan(0)
    expect(writesAfterRepeats).toBe(writesAfterChange)
  })

  it('keeps the camera out of the persisted state', () => {
    const { setCameraAngles } = useViewerStore.getState()
    setCameraAngles(45, 30)

    const raw = window.localStorage.getItem('viewer-settings')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw as string)

    // A camera angle is where the reader was looking, not a preference that should
    // survive a reload. This assertion is about the payload, not about the write:
    // zustand calls `setItem` on every `set()` regardless of `partialize`, so the
    // write is stopped by the guard above, not by this.
    expect(persisted.state.cameraScopes).toBeUndefined()
    expect(persisted.state.cameraAzimuth).toBeUndefined()
    expect(persisted.state.cameraElevation).toBeUndefined()
    // A real preference still persists, so the store did not stop persisting.
    expect(persisted.state.background).toBeDefined()
  })

  it('writes nothing for a repeated angle on a non-default scope either', () => {
    const { setCameraAngles } = useViewerStore.getState()
    setCameraAngles(45, 30, 'compare/session-a')

    let notifications = 0
    const unsubscribe = useViewerStore.subscribe(() => {
      notifications += 1
    })
    setCameraAngles(45, 30, 'compare/session-a')
    setCameraAngles(45, 30, 'compare/session-a')
    unsubscribe()

    // The guard is per scope: a compare cell repeating its own angle is the same
    // no-op as the single viewer's, and a fresh scope still writes once.
    expect(notifications).toBe(0)
  })

  it('still writes when the camera actually moves', () => {
    const { setCameraAngles } = useViewerStore.getState()
    const setItem = vi.spyOn(window.localStorage, 'setItem')

    // Documented, not wished away: the guard closes the *idle* camera. A reader who
    // orbits — or leaves auto-rotation on, which moves the camera every frame —
    // still pays one write per degree, because `persist` has no per-change filter.
    for (const angle of [10, 20, 30, 40]) setCameraAngles(angle, 15)
    const writes = setItem.mock.calls.length
    setItem.mockRestore()

    expect(writes).toBeGreaterThanOrEqual(4)
  })

  it('drops the camera and a pending export from a stored payload it reads', () => {
    // A payload written before #312: it carried the camera, and it could carry an
    // export request that the export handler replays on mount.
    window.localStorage.setItem(
      'viewer-settings',
      JSON.stringify({
        state: {
          background: 'white',
          cameraScopes: { single: { azimuth: 90, elevation: 45 } },
          cameraAzimuth: 90,
          cameraElevation: 45,
          exportRequest: 'png',
        },
        version: 1,
      }),
    )
    useViewerStore.persist.rehydrate()

    const state = useViewerStore.getState()
    // The preference survives; the camera and the pending download do not, so a
    // reload cannot replay an export the reader asked for on another screen.
    expect(state.background).toBe('white')
    expect(state.exportRequest).toBeNull()
    expect(state.cameraScopes[DEFAULT_CAMERA_SCOPE]).toBeDefined()
    expect(state.cameraAzimuth).toBe(0)
  })
})
