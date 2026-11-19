import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCameraStore, useViewerStore } from '@/stores/viewerStore'
import { ViewerControls } from '../ViewerControls'

beforeEach(() => {
  useCameraStore.getState().resetCameraState()
  useViewerStore.getState().reset()
  localStorage.clear()
})

describe('ViewerControls camera consumers (#319)', () => {
  it('Reset restores both viewer settings and the current camera', () => {
    useViewerStore.getState().setBackground('white')
    useViewerStore.getState().toggleAutoRotate()
    useCameraStore.getState().setCameraAngles(47, 23)

    render(<ViewerControls />)
    expect(screen.getByText('47°')).toBeTruthy()
    expect(screen.getByText('23°')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /reset/i }))

    expect(useViewerStore.getState().background).toBe('dark')
    expect(useViewerStore.getState().autoRotate).toBe(false)
    expect(useCameraStore.getState().getCameraAngles()).toEqual({
      azimuth: 0,
      elevation: 0,
    })
    expect(screen.getAllByText('0°')).toHaveLength(2)
  })

  it('uses the volatile current camera in export filenames', () => {
    useCameraStore.getState().setCameraAngles(47, 23)
    render(<ViewerControls />)

    fireEvent.click(screen.getByRole('button', { name: 'PNG' }))

    expect(useViewerStore.getState().exportRequest).toBe('png')
    expect(useViewerStore.getState().exportFilename).toBe(
      'agglomerate_3d_az47_el23',
    )
  })
})
