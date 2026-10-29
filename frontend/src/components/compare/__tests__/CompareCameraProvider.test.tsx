/**
 * Unit tests for `<CompareCameraProvider>` (T9, change: visualize-multiple).
 *
 * The provider's observable contract — the only thing grids and overlays
 * actually depend on — is:
 *
 *   1. `useCompareCamera()` throws when called outside the provider.
 *   2. `sessionId` is stable across re-renders (useMemo with no deps).
 *   3. `scopeFor(simId)`:
 *        - synchronised=true  → same key for all sims
 *        - synchronised=false → `${sessionKey}/${simId}` per sim
 *   4. `toggleSync()` flips the `synchronised` flag and, as a
 *      consequence, flips `scopeFor(simId)` between the two forms.
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import {
  CompareCameraProvider,
  useCompareCamera,
} from '../CompareCameraProvider'

function wrap(children: React.ReactNode) {
  return <CompareCameraProvider>{children}</CompareCameraProvider>
}

describe('<CompareCameraProvider />', () => {
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

  it('scopeFor returns the same scope for every sim when synchronised', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })
    expect(result.current.synchronised).toBe(true)

    const scopeA = result.current.scopeFor('sim-a')
    const scopeB = result.current.scopeFor('sim-b')
    const scopeC = result.current.scopeFor('sim-c')

    expect(scopeA).toBe(scopeB)
    expect(scopeB).toBe(scopeC)
    // And it uses the session id (not a bare "compare/").
    expect(scopeA).toContain(result.current.sessionId)
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

  it('toggleSync flips synchronised and the scopeFor shape', () => {
    const { result } = renderHook(() => useCompareCamera(), {
      wrapper: CompareCameraProvider,
    })

    // Initial: synced → all sims share one scope.
    expect(result.current.synchronised).toBe(true)
    const sharedBefore = result.current.scopeFor('sim-a')
    expect(result.current.scopeFor('sim-b')).toBe(sharedBefore)

    act(() => result.current.toggleSync())

    expect(result.current.synchronised).toBe(false)
    const perSimA = result.current.scopeFor('sim-a')
    const perSimB = result.current.scopeFor('sim-b')
    expect(perSimA).not.toBe(perSimB)

    act(() => result.current.toggleSync())
    expect(result.current.synchronised).toBe(true)
    // Back to shared, and sessionId unchanged → same shared key as before.
    expect(result.current.scopeFor('sim-a')).toBe(sharedBefore)
  })
})
