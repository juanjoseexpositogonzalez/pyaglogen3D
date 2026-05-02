/**
 * Tests for the FraktalBatchPage route — Frente 9 P5.
 *
 * Specifically verifies the sim-origin entry point:
 *   - When `?origin=simulation&sim_id=X` is present, fetch the sim and
 *     pass `origin="simulation"` + `simulation` props to the upload form.
 *   - When fetch fails (sim 404), fall back gracefully to external mode
 *     with a warning banner (does NOT block the user).
 *   - When no query params, default to external mode.
 *
 * Mocks Next.js navigation hooks and `simulationsApi.get` so the tests
 * run under jsdom without a real router.
 */
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mocks (must be before component import) ----

const mockSearchParams = new Map<string, string>()

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) ?? null,
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('a', props, children),
}))

const mockSimGet = vi.fn()
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    simulationsApi: {
      ...actual.simulationsApi,
      get: (...args: unknown[]) => mockSimGet(...args),
    },
  }
})

// Stub the upload component — we just need to verify props.
vi.mock('@/components/fraktal/FraktalBatchUpload', () => ({
  FraktalBatchUpload: (props: Record<string, unknown>) => (
    <div
      data-testid="batch-upload-stub"
      data-origin={String(props.origin ?? 'external')}
      data-sim-id={
        props.simulation
          ? (props.simulation as { id: string }).id
          : ''
      }
      data-sim-dpo={
        props.simulation
          ? String((props.simulation as { parameters: { dpo_nm: number } }).parameters.dpo_nm)
          : ''
      }
    />
  ),
}))

// Header is unrelated noise for these tests.
vi.mock('@/components/layout/Header', () => ({
  Header: () => null,
}))

// ---- Imports AFTER mocks ----

import FraktalBatchPage from '../page'

// ---- Fixtures ----

function makeSim(dpo_nm: number = 25) {
  return {
    id: 'sim-abc-123',
    name: 'Test sim',
    status: 'completed',
    parameters: {
      // v1 schema field path (radius)
      primary_particle_radius_nm: dpo_nm / 2,
    },
  }
}

// ---- Tests ----

describe('FraktalBatchPage — frente 9 P5 sim-origin entry', () => {
  beforeEach(() => {
    mockSearchParams.clear()
    mockSimGet.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders upload in external mode when no query params', async () => {
    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    const stub = await screen.findByTestId('batch-upload-stub')
    expect(stub.getAttribute('data-origin')).toBe('external')
    expect(stub.getAttribute('data-sim-id')).toBe('')
    expect(mockSimGet).not.toHaveBeenCalled()
  })

  it('fetches sim and passes simulation prop when origin=simulation+sim_id', async () => {
    mockSearchParams.set('origin', 'simulation')
    mockSearchParams.set('sim_id', 'sim-abc-123')
    mockSimGet.mockResolvedValue(makeSim(25))

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    await waitFor(() => {
      expect(mockSimGet).toHaveBeenCalledWith('proj-1', 'sim-abc-123')
    })

    const stub = await screen.findByTestId('batch-upload-stub')
    expect(stub.getAttribute('data-origin')).toBe('simulation')
    expect(stub.getAttribute('data-sim-id')).toBe('sim-abc-123')
    // 25 nm radius → 50 nm diameter via getPrimaryParticleDiameterNm
    expect(stub.getAttribute('data-sim-dpo')).toBe('25')
  })

  it('falls back to external mode when sim fetch rejects (404)', async () => {
    mockSearchParams.set('origin', 'simulation')
    mockSearchParams.set('sim_id', 'sim-missing')
    mockSimGet.mockRejectedValue(new Error('Not found'))

    // Suppress the expected console.warn from the page.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    await screen.findByTestId('sim-fetch-warning')
    const stub = screen.getByTestId('batch-upload-stub')
    expect(stub.getAttribute('data-origin')).toBe('external')
    expect(stub.getAttribute('data-sim-id')).toBe('')

    warnSpy.mockRestore()
  })

  it('ignores origin=simulation with no sim_id', async () => {
    mockSearchParams.set('origin', 'simulation')
    // sim_id omitted

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    const stub = await screen.findByTestId('batch-upload-stub')
    expect(stub.getAttribute('data-origin')).toBe('external')
    expect(mockSimGet).not.toHaveBeenCalled()
  })

  it('ignores origin=external with sim_id present', async () => {
    mockSearchParams.set('origin', 'external')
    mockSearchParams.set('sim_id', 'sim-abc-123')

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    const stub = await screen.findByTestId('batch-upload-stub')
    expect(stub.getAttribute('data-origin')).toBe('external')
    expect(mockSimGet).not.toHaveBeenCalled()
  })
})
