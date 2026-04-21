/**
 * Unit tests for `<Particles>` focused on the `uniformColor` prop
 * introduced by T1 of the `visualize-multiple` change.
 *
 * jsdom has no WebGL, so mounting a real R3F `<Canvas>` is not viable.
 * Instead we stub the R3F intrinsic JSX elements to plain DOM tags and
 * spy on `THREE.Color` mutators. The component's color-selection logic
 * lives inside a synchronous `useMemo` that runs on first render, so the
 * spies capture the exact color calls we care about.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

// --- Mocks --------------------------------------------------------------

/** Capture the `setHex` / `set` calls performed by the component. */
const setHexCalls: number[] = []
const setCalls: Array<string | number> = []
const setHSLCalls: Array<[number, number, number]> = []

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  class FakeColor {
    setHex(hex: number) {
      setHexCalls.push(hex)
      return this
    }
    set(value: string | number) {
      setCalls.push(value)
      return this
    }
    setHSL(h: number, s: number, l: number) {
      setHSLCalls.push([h, s, l])
      return this
    }
  }
  return {
    ...actual,
    Color: FakeColor as unknown as typeof actual.Color,
    // Keep Matrix4 / Vector3 / Quaternion real — the component reads from
    // them synchronously during matrix composition.
  }
})

// The component renders R3F intrinsics (<instancedMesh>, <sphereGeometry>,
// <meshPhongMaterial>) which React 18 mounts as plain custom DOM elements
// in jsdom. The component's `useEffect` then calls setMatrixAt /
// setColorAt on the ref — those don't exist on HTMLElement. We stub them
// as no-ops on HTMLElement.prototype so the effect runs without throwing.
// This does NOT affect the assertions, which only care about the colors
// computed inside the `useMemo` BEFORE the effect runs.
if (!('setMatrixAt' in HTMLElement.prototype)) {
  Object.defineProperties(HTMLElement.prototype, {
    setMatrixAt: { value: () => {}, configurable: true },
    setColorAt: { value: () => {}, configurable: true },
    instanceMatrix: {
      value: { needsUpdate: false },
      configurable: true,
      writable: true,
    },
    instanceColor: {
      value: { needsUpdate: false },
      configurable: true,
      writable: true,
    },
  })
}

// --- Tests --------------------------------------------------------------

import { Particles } from '../Particles'

const coords: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]
const radii = [0.5, 0.5, 0.5]

beforeEach(() => {
  setHexCalls.length = 0
  setCalls.length = 0
  setHSLCalls.length = 0
})

describe('<Particles /> uniformColor prop', () => {
  it('preserves the historical default color (0x4488ff) when uniformColor is absent', () => {
    render(
      <Particles coordinates={coords} radii={radii} colorMode="uniform" />
    )
    // Every particle took the `default` branch → each called setHex once.
    expect(setHexCalls.length).toBe(coords.length)
    expect(setHexCalls.every((h) => h === 0x4488ff)).toBe(true)
    expect(setCalls.length).toBe(0)
  })

  it('applies a hex-string uniformColor via THREE.Color#set', () => {
    render(
      <Particles
        coordinates={coords}
        radii={radii}
        colorMode="uniform"
        uniformColor="#ff0000"
      />
    )
    expect(setCalls.length).toBe(coords.length)
    expect(setCalls.every((v) => v === '#ff0000')).toBe(true)
    // The default branch must NOT have been reached.
    expect(setHexCalls.length).toBe(0)
  })

  it('applies a numeric uniformColor via THREE.Color#set', () => {
    render(
      <Particles
        coordinates={coords}
        radii={radii}
        colorMode="uniform"
        uniformColor={0xff0000}
      />
    )
    expect(setCalls.length).toBe(coords.length)
    expect(setCalls.every((v) => v === 0xff0000)).toBe(true)
    expect(setHexCalls.length).toBe(0)
  })

  it('does not affect non-uniform color modes when uniformColor is provided', () => {
    render(
      <Particles
        coordinates={coords}
        radii={radii}
        colorMode="order"
        uniformColor="#ff0000"
      />
    )
    // `order` colors everything via setHSL, not set/setHex.
    expect(setHSLCalls.length).toBe(coords.length)
    expect(setCalls.length).toBe(0)
    expect(setHexCalls.length).toBe(0)
  })
})
