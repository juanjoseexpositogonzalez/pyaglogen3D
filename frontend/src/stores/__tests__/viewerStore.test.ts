import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAMERA_SCOPE,
  useCameraStore,
  useViewerCamera,
  useViewerStore,
} from '../viewerStore'

beforeEach(() => {
  useCameraStore.getState().resetCameraState()
  useViewerStore.getState().reset()
  localStorage.clear()
})

describe('volatile camera scoping (R-DELTA-1)', () => {
  it('defaults to the single scope', () => {
    const { setCameraAngles, getCameraAngles } = useCameraStore.getState()
    setCameraAngles(45, 30)

    expect(getCameraAngles(DEFAULT_CAMERA_SCOPE)).toEqual({
      azimuth: 45,
      elevation: 30,
    })
    expect(getCameraAngles()).toEqual({ azimuth: 45, elevation: 30 })
  })

  it('isolates the single scope and compare scopes', () => {
    const { setCameraAngles, getCameraAngles } = useCameraStore.getState()
    setCameraAngles(10, 5)
    setCameraAngles(90, 45, 'compare/session-a')
    setCameraAngles(120, 60, 'compare/session-b')

    expect(getCameraAngles('single')).toEqual({ azimuth: 10, elevation: 5 })
    expect(getCameraAngles('compare/session-a')).toEqual({
      azimuth: 90,
      elevation: 45,
    })
    expect(getCameraAngles('compare/session-b')).toEqual({
      azimuth: 120,
      elevation: 60,
    })
  })

  it('mirrors the single scope for legacy angle consumers only', () => {
    useCameraStore.getState().setCameraAngles(75, 40)
    useCameraStore.getState().setCameraAngles(42, 42, 'compare/xyz')

    expect(useCameraStore.getState().cameraAzimuth).toBe(75)
    expect(useCameraStore.getState().cameraElevation).toBe(40)
  })

  it('useViewerCamera() reads and writes the default scope', () => {
    const { result } = renderHook(() => useViewerCamera())

    act(() => result.current.setCameraAngles(33, 22))

    expect(result.current.azimuth).toBe(33)
    expect(result.current.elevation).toBe(22)
    expect(useCameraStore.getState().cameraAzimuth).toBe(33)
  })

  it('useViewerCamera(scope) reads and writes an isolated scope', () => {
    const { result: single } = renderHook(() => useViewerCamera())
    const { result: compare } = renderHook(() =>
      useViewerCamera('compare/a'),
    )

    act(() => single.current.setCameraAngles(10, 10))
    act(() => compare.current.setCameraAngles(99, 99))

    expect(single.current.azimuth).toBe(10)
    expect(compare.current.azimuth).toBe(99)
    expect(useCameraStore.getState().cameraAzimuth).toBe(10)
  })
})

describe('camera updates do not persist (#312, #319)', () => {
  it('does not notify subscribers when rounded angles are unchanged', () => {
    const { setCameraAngles } = useCameraStore.getState()
    let notifications = 0
    const unsubscribe = useCameraStore.subscribe(() => {
      notifications += 1
    })

    setCameraAngles(45, 30)
    setCameraAngles(45, 30)
    setCameraAngles(45, 30)
    unsubscribe()

    expect(notifications).toBe(1)
  })

  it('does not touch localStorage for unchanged or moving cameras', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')

    for (const angle of [10, 10, 20, 30, 40]) {
      useCameraStore.getState().setCameraAngles(angle, 15)
    }

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('keeps camera and pending exports out of persisted viewer settings', () => {
    useCameraStore.getState().setCameraAngles(45, 30)
    useViewerStore.getState().requestExport('png', 'pending')
    useViewerStore.getState().setBackground('white')

    const raw = window.localStorage.getItem('viewer-settings')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw as string)

    expect(persisted.state.cameraScopes).toBeUndefined()
    expect(persisted.state.cameraAzimuth).toBeUndefined()
    expect(persisted.state.cameraElevation).toBeUndefined()
    expect(persisted.state.exportRequest).toBeUndefined()
    expect(persisted.state.exportFilename).toBeUndefined()
    expect(persisted.state.background).toBe('white')
  })

  it('drops legacy camera, autoRotate, and export fields during migration', () => {
    window.localStorage.setItem(
      'viewer-settings',
      JSON.stringify({
        state: {
          background: 'white',
          cameraScopes: { single: { azimuth: 90, elevation: 45 } },
          cameraAzimuth: 90,
          cameraElevation: 45,
          autoRotate: true,
          exportRequest: 'png',
          exportFilename: 'stale',
        },
        version: 2,
      }),
    )

    useViewerStore.persist.rehydrate()

    expect(useViewerStore.getState().background).toBe('white')
    expect(useViewerStore.getState().autoRotate).toBe(false)
    expect(useViewerStore.getState().exportRequest).toBeNull()
    expect(useCameraStore.getState().getCameraAngles()).toEqual({
      azimuth: 0,
      elevation: 0,
    })
  })
})
