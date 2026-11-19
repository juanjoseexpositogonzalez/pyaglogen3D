/**
 * Unit tests for `<CompareCameraProvider>` (T9, change: visualize-multiple).
 *
 * The provider's observable contract — the only thing grids and overlays
 * actually depend on — is:
 *
 *   1. `useCompareCamera()` throws when called outside the provider.
 *   2. `sessionId` is stable across re-renders (useMemo with no deps).
 *   3. `scopeFor(simId)` always gives each viewer an isolated volatile scope.
 *   4. `toggleSync()` changes broadcast behavior without merging scopes.
 *   5. Only the temporary active writer can publish while it owns the channel.
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCameraStore } from '@/stores/viewerStore'

import {
  CompareCameraProvider,
  useCompareCamera,
} from '../CompareCameraProvider'

function wrap(children: React.ReactNode) {
  return <CompareCameraProvider>{children}</CompareCameraProvider>
}

describe('<CompareCameraProvider />', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useCameraStore.getState().resetCameraState()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders children under the provider', () => {
    render(wrap(<span data-testid="child">hi</span>))
    expect(screen.getByTestId('child').textContent).toBe('hi')
  })

  it('throws when useCompareCamera is called outside the provider', () => {
    // renderHook in a hostile environment — no wrapper. The hook should
    // throw immediately.
    expect(() => renderHook(() => useCompareCamera())).toThrow(
      /useCompareCamera must be used inside a <CompareCameraProvider>/,
    )
  })

  it('keeps sessionId stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })
    const first = result.current.sessionId
    expect(first).toMatch(/^compare-/)
    rerender()
    rerender()
    rerender()
    expect(result.current.sessionId).toBe(first)
  })

  it('scopeFor always returns isolated per-sim volatile scopes', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })

    const scopeA = result.current.scopeFor('sim-a')
    const scopeB = result.current.scopeFor('sim-b')

    expect(scopeA).not.toBe(scopeB)
    expect(scopeA).toBe(`compare/${result.current.sessionId}/sim-a`)
    expect(scopeB).toBe(`compare/${result.current.sessionId}/sim-b`)
  })

  it('scopeFor returns per-sim scopes when synchronised is off', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <CompareCameraProvider initialSynchronised={false}>
          {children}
        </CompareCameraProvider>
      ),
    })

    expect(result.current.synchronised).toBe(false)

    const scopeA = result.current.scopeFor('sim-a')
    const scopeB = result.current.scopeFor('sim-b')

    expect(scopeA).not.toBe(scopeB)
    expect(scopeA.endsWith('/sim-a')).toBe(true)
    expect(scopeB.endsWith('/sim-b')).toBe(true)
  })

  it('toggleSync changes synchronisation without merging camera scopes', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })
    const scopeBefore = result.current.scopeFor('sim-a')

    act(() => result.current.toggleSync())

    expect(result.current.synchronised).toBe(false)
    expect(result.current.scopeFor('sim-a')).toBe(scopeBefore)
  })

  it('accepts camera broadcasts only from the temporary active writer', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })
    const pose = {
      azimuth: 37,
      elevation: 12,
      distance: 8,
      target: [1, 2, 3] as [number, number, number],
      zoom: 1.5,
    }

    act(() => result.current.beginCameraWrite('sim-b'))
    expect(result.current.activeWriterId).toBe('sim-b')

    act(() => {
      result.current.publishCamera('sim-a', pose)
      vi.advanceTimersByTime(16)
    })
    expect(result.current.cameraState).toBeNull()

    act(() => {
      result.current.publishCamera('sim-b', pose)
      vi.advanceTimersByTime(16)
    })
    expect(result.current.cameraState).toEqual(pose)

    act(() => result.current.endCameraWrite('sim-b'))
    expect(result.current.activeWriterId).toBeNull()
  })

  it('publishes during a continuous high-refresh camera stream', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })

    act(() => result.current.beginCameraWrite('sim-a'))
    act(() => {
      for (let frame = 0; frame < 6; frame += 1) {
        result.current.publishCamera('sim-a', {
          azimuth: 31 + frame,
          elevation: 10 + frame,
          distance: 8,
          target: [frame, 0, 0],
          zoom: 1 + frame / 10,
        })
        vi.advanceTimersByTime(8)
      }
    })

    expect(result.current.cameraState).toEqual({
      azimuth: 36,
      elevation: 15,
      distance: 8,
      target: [5, 0, 0],
      zoom: 1.5,
    })
  })

  it('drops a queued pose when its writer loses ownership before it flushes', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })
    const pose = {
      azimuth: 37,
      elevation: 12,
      distance: 8,
      target: [1, 2, 3] as [number, number, number],
      zoom: 1.5,
    }

    act(() => {
      result.current.beginCameraWrite('sim-b')
      result.current.publishCamera('sim-b', pose)
      result.current.beginCameraWrite('sim-a')
      vi.advanceTimersByTime(16)
    })

    expect(result.current.cameraState).toBeNull()
  })

  it('removes its root and per-cell camera scopes on unmount', () => {
    const { result, unmount } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })
    const prefix = `compare/${result.current.sessionId}`

    act(() => {
      const camera = useCameraStore.getState()
      camera.setCameraAngles(10, 20, prefix)
      camera.setCameraAngles(30, 40, result.current.scopeFor('sim-a'))
      camera.setCameraAngles(50, 60, result.current.scopeFor('sim-b'))
      camera.setCameraAngles(70, 80, 'compare/other-session/sim-c')
    })

    unmount()

    const scopes = useCameraStore.getState().cameraScopes
    expect(scopes[prefix]).toBeUndefined()
    expect(scopes[`${prefix}/sim-a`]).toBeUndefined()
    expect(scopes[`${prefix}/sim-b`]).toBeUndefined()
    expect(scopes['compare/other-session/sim-c']).toEqual({
      azimuth: 70,
      elevation: 80,
    })
    expect(scopes.single).toEqual({ azimuth: 0, elevation: 0 })
  })
})
