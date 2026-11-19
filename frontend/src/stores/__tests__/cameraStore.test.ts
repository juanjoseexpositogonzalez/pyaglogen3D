import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAMERA_SCOPE,
  useCameraStore,
  useViewerStore,
} from '../viewerStore'

beforeEach(() => {
  useCameraStore.getState().resetCameraState()
  useViewerStore.getState().reset()
  localStorage.clear()
})

describe('volatile camera state (#319)', () => {
  it('does not write localStorage while the camera moves', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')

    for (const angle of [10, 11, 12, 13]) {
      useCameraStore.getState().setCameraAngles(angle, 15)
    }

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('keeps scopes isolated and mirrors the single scope for legacy consumers', () => {
    const camera = useCameraStore.getState()

    camera.setCameraAngles(25, 10)
    camera.setCameraAngles(80, 35, 'compare/session-a')

    expect(useCameraStore.getState().getCameraAngles(DEFAULT_CAMERA_SCOPE)).toEqual({
      azimuth: 25,
      elevation: 10,
    })
    expect(useCameraStore.getState().getCameraAngles('compare/session-a')).toEqual({
      azimuth: 80,
      elevation: 35,
    })
    expect(useCameraStore.getState().cameraAzimuth).toBe(25)
    expect(useCameraStore.getState().cameraElevation).toBe(10)
  })

  it('does not restore camera angles after the viewer settings rehydrate', () => {
    useCameraStore.getState().setCameraAngles(90, 45)
    useViewerStore.getState().setBackground('white')

    useCameraStore.getState().resetCameraState()
    useViewerStore.persist.rehydrate()

    expect(useCameraStore.getState().getCameraAngles()).toEqual({
      azimuth: 0,
      elevation: 0,
    })
    expect(useViewerStore.getState().background).toBe('white')
  })
})
