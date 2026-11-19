/**
 * Unit tests for `<AgglomerateViewer>` focused on the two new props
 * introduced by T3 of the `visualize-multiple` change:
 *
 *   - `colorOverride` → forwarded to <Particles uniformColor={...} />.
 *   - `cameraSource` → threads a scope key through <CameraTracker>, so the
 *     viewer writes to `cameraScopes[scope]` instead of the default
 *     `"single"` slot.
 *
 * jsdom cannot run an actual R3F `<Canvas>` (no WebGL), so we mock
 * `@react-three/fiber` + `@react-three/drei` + the `<Particles>` child to
 * inert stubs that surface the props they receive. The tests then assert
 * on those stubs.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const mockViewer = vi.hoisted(() => ({
  camera: {
    position: { x: 1, y: 1, z: 1 },
    zoom: 1,
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
  },
  controls: {
    target: { x: 0, y: 0, z: 0 },
    update: vi.fn(),
  },
  orbitProps: [] as Array<Record<string, unknown>>,
}))

// --- Capture props handed to <Particles> through the stub -------------
const particlesProps: Array<Record<string, unknown>> = []
const frameCallbacks: Array<() => void> = []

vi.mock('../Particles', () => ({
  Particles: (props: Record<string, unknown>) => {
    particlesProps.push(props)
    return (
      <div
        data-testid="particles-stub"
        data-uniform-color={
          props.uniformColor === undefined
            ? 'undefined'
            : String(props.uniformColor)
        }
      />
    )
  },
}))

// --- Minimal R3F mock ---------------------------------------------------
// `<Canvas>` just wraps its children so the component tree mounts; we
// don't need any WebGL. The nested `<Suspense>` + `<color>` etc. all
// render through to harmless div/text children.
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="canvas-stub">{children}</div>
  ),
  useFrame: (callback: () => void) => {
    frameCallbacks.push(callback)
  },
  useThree: () => ({
    gl: { render: () => {}, domElement: { toDataURL: () => '' } },
    scene: {},
    camera: mockViewer.camera,
  }),
}))

// `<OrbitControls>` exposes the target through its ref; the rest render to
// nothing because these tests only exercise camera tracking and particle props.
vi.mock('@react-three/drei', () => ({
  OrbitControls: React.forwardRef(function OrbitControls(props, ref) {
    mockViewer.orbitProps.push(props as Record<string, unknown>)
    React.useImperativeHandle(ref, () => mockViewer.controls)
    return null
  }),
  Grid: () => null,
  GizmoHelper: () => null,
  GizmoViewport: () => null,
  Line: () => null,
}))

// --- Target component ---------------------------------------------------
import { AgglomerateViewer } from '../AgglomerateViewer'
import {
  DEFAULT_CAMERA_SCOPE,
  useCameraStore,
  useViewerStore,
} from '../../../stores/viewerStore'

const coords: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]
const radii = [0.5, 0.5, 0.5]

beforeEach(() => {
  particlesProps.length = 0
  frameCallbacks.length = 0
  mockViewer.orbitProps.length = 0
  mockViewer.camera.position.x = 1
  mockViewer.camera.position.y = 1
  mockViewer.camera.position.z = 1
  mockViewer.camera.zoom = 1
  mockViewer.controls.target.x = 0
  mockViewer.controls.target.y = 0
  mockViewer.controls.target.z = 0
  mockViewer.camera.lookAt.mockClear()
  mockViewer.camera.updateProjectionMatrix.mockClear()
  mockViewer.controls.update.mockClear()
  useViewerStore.getState().reset()
  useCameraStore.getState().resetCameraState()
})

describe('<AgglomerateViewer /> new props (T3)', () => {
  it('preserves existing behavior when colorOverride and cameraSource are absent', () => {
    render(<AgglomerateViewer coordinates={coords} radii={radii} />)
    expect(particlesProps.length).toBe(1)
    // Historical behavior: no uniformColor passed through → Particles
    // falls back to the hardcoded default internally.
    expect(particlesProps[0].uniformColor).toBeUndefined()
    // The stub reflected "undefined" in the data attribute.
    const stub = screen.getByTestId('particles-stub')
    expect(stub.getAttribute('data-uniform-color')).toBe('undefined')
  })

  it('forwards colorOverride to <Particles uniformColor>', () => {
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        colorOverride="#ff0000"
      />
    )
    expect(particlesProps[0].uniformColor).toBe('#ff0000')
    expect(
      screen.getByTestId('particles-stub').getAttribute('data-uniform-color')
    ).toBe('#ff0000')
  })

  it('forwards a numeric colorOverride without coercion', () => {
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        colorOverride={0x00ff00}
      />
    )
    expect(particlesProps[0].uniformColor).toBe(0x00ff00)
  })

  it('tracks camera angles in the default "single" scope', () => {
    render(<AgglomerateViewer coordinates={coords} radii={radii} />)

    expect(frameCallbacks).toHaveLength(1)
    frameCallbacks[0]()

    expect(useCameraStore.getState().getCameraAngles(DEFAULT_CAMERA_SCOPE))
      .toEqual({ azimuth: 45, elevation: 35 })
  })

  it('publishes the tracked writer pose through cameraSource', () => {
    const onCameraChange = vi.fn()
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        cameraSource={{
          scope: 'compare/session/writer',
          canWrite: true,
          onCameraChange,
        }}
      />
    )

    frameCallbacks[0]()

    expect(onCameraChange).toHaveBeenCalledWith({
      azimuth: 45,
      elevation: 35,
      distance: Math.sqrt(3),
      target: [0, 0, 0],
      zoom: 1,
    })
  })

  it('does not let a passive compare viewer overwrite the shared camera', () => {
    const scope = 'compare/session/passive'
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        cameraSource={{ scope, canWrite: false } as never}
      />
    )

    frameCallbacks[0]()

    expect(useCameraStore.getState().getCameraAngles(scope)).toEqual({
      azimuth: 0,
      elevation: 0,
    })
  })

  it('forwards interaction ownership callbacks to OrbitControls', () => {
    const onStart = vi.fn()
    const onEnd = vi.fn()
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        cameraSource={{ scope: 'compare/session/writer', onStart, onEnd }}
      />
    )

    const orbitProps = mockViewer.orbitProps.at(-1) as {
      onStart?: () => void
      onEnd?: () => void
    }
    act(() => orbitProps.onStart?.())
    act(() => orbitProps.onEnd?.())

    expect(onStart).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('applies an exact shared pose to a passive compare viewer', () => {
    const scope = 'compare/session/passive'
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        cameraSource={{
          scope,
          canWrite: false,
          pose: {
            azimuth: 37,
            elevation: 12,
            distance: 8,
            target: [3, 4, 5],
            zoom: 1.5,
          },
        } as never}
      />
    )

    expect(useCameraStore.getState().getCameraAngles(scope)).toEqual({
      azimuth: 37,
      elevation: 12,
    })
    expect(mockViewer.controls.target).toEqual({ x: 3, y: 4, z: 5 })
    expect(mockViewer.camera.position.x).toBeCloseTo(7.71, 2)
    expect(mockViewer.camera.position.y).toBeCloseTo(5.66, 2)
    expect(mockViewer.camera.position.z).toBeCloseTo(11.25, 2)
    expect(mockViewer.camera.zoom).toBe(1.5)
    expect(mockViewer.camera.updateProjectionMatrix).toHaveBeenCalledOnce()
    expect(mockViewer.camera.lookAt).toHaveBeenCalledWith(
      mockViewer.controls.target,
    )
    expect(mockViewer.controls.update).toHaveBeenCalledOnce()
  })

  it('scopes camera-state writes when cameraSource is provided', () => {
    const scope = 'compare/session-xyz'
    render(
      <AgglomerateViewer
        coordinates={coords}
        radii={radii}
        cameraSource={{ scope }}
      />
    )
    expect(frameCallbacks).toHaveLength(1)
    frameCallbacks[0]()

    expect(useCameraStore.getState().getCameraAngles(scope)).toEqual({
      azimuth: 45,
      elevation: 35,
    })
    // Single-sim slot is untouched.
    expect(useCameraStore.getState().getCameraAngles('single')).toEqual({
      azimuth: 0,
      elevation: 0,
    })
    // And the legacy root mirrors also stay at zero.
    expect(useCameraStore.getState().cameraAzimuth).toBe(0)
    expect(useCameraStore.getState().cameraElevation).toBe(0)
  })
})
