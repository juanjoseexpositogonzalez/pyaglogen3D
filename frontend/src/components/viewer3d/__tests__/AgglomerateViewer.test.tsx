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
import { render, screen } from '@testing-library/react'

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
    camera: { position: { x: 1, y: 1, z: 1 } },
  }),
}))

// `<OrbitControls>` exposes the target through its ref; the rest render to
// nothing because these tests only exercise camera tracking and particle props.
vi.mock('@react-three/drei', () => ({
  OrbitControls: React.forwardRef(function OrbitControls(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      target: { x: 0, y: 0, z: 0 },
    }))
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
