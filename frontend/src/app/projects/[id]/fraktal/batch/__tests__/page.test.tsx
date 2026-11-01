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

// Stub the summary so the sibling `[batchId]` route can be asserted on its own
// frame, without the fetch, the results view or a query client.
vi.mock('@/components/fraktal/FraktalBatchSummaryPage', () => ({
  FraktalBatchSummaryPage: (props: { projectId: string; batchId: string }) => (
    <div
      data-testid="batch-summary-stub"
      data-project={props.projectId}
      data-batch={props.batchId}
    />
  ),
}))

// ---- Imports AFTER mocks ----

import FraktalBatchPage from '../page'
import FraktalBatchDetailPage from '../[batchId]/page'

// ---- Fixtures ----

// Both describes below share one cleanup. `restoreAllMocks` and not only
// `clearAllMocks`: a `console.warn` spy left installed by a failing test
// outlives that test and silences the warning for every test after it in this
// file. A leaked stub is exactly what makes an intermittent pair look random.
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

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

    // Suppress the expected console.warn from the page. The file-level
    // `afterEach` restores it, so a failure here cannot leave the stub
    // installed for every test that follows.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    await screen.findByTestId('sim-fetch-warning')
    const stub = screen.getByTestId('batch-upload-stub')
    expect(stub.getAttribute('data-origin')).toBe('external')
    expect(stub.getAttribute('data-sim-id')).toBe('')
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

// ---- Issue #176, slice 3A: the page on the design-system kit ----
//
// The migration does not change what the researcher uploads or what happens
// to it. These tests pin the two things it does change: the page names itself
// with `PageHeader` (eyebrow, one `h1`) and stops drawing the document frame
// the shell already draws, and every notice keeps its exact wording.

describe('FraktalBatchPage — design-system kit presentation', () => {
  beforeEach(() => {
    mockSearchParams.clear()
    mockSimGet.mockReset()
  })

  it('names the page in a PageHeader with a FRAKTAL eyebrow', async () => {
    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)
    await screen.findByTestId('batch-upload-stub')

    expect(screen.getByText('FRAKTAL')).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 1, name: /batch fraktal analysis/i }),
    ).toBeTruthy()
  })

  it('leaves the document frame to the shell: no main of its own', async () => {
    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)
    await screen.findByTestId('batch-upload-stub')

    // The shell renders the only <main>. A page that mounts its own nests one
    // landmark inside another and every screen reader hears two.
    expect(document.querySelector('main')).toBeNull()
  })

  it('keeps the breadcrumb back to single-image FRAKTAL', async () => {
    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)
    await screen.findByTestId('batch-upload-stub')

    const link = screen.getByRole('link', {
      name: /back to single-image fraktal/i,
    })
    expect(link.getAttribute('href')).toBe('/projects/proj-1/fraktal/new')
  })

  it('states the sim-fetch fallback with the same sentence, as a note not an alert', async () => {
    mockSearchParams.set('origin', 'simulation')
    mockSearchParams.set('sim_id', 'sim-missing')
    mockSimGet.mockRejectedValue(new Error('Not found'))

    // Restored by the file-level `afterEach`, so a failure here cannot leave
    // the stub installed for the tests that follow.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    const warning = await screen.findByTestId('sim-fetch-warning')
    expect(warning.textContent).toContain(
      'Simulation context unavailable — proceeding with manual upload.',
    )
    // The upload still works, so this is a recoverable fallback: it informs and
    // must not shout. Only an unrecoverable failure gets role="alert".
    expect(warning.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps the loading sentence while the simulation context resolves, without a full-screen loader', () => {
    mockSearchParams.set('origin', 'simulation')
    mockSearchParams.set('sim_id', 'sim-abc-123')
    mockSimGet.mockReturnValue(new Promise(() => {}))

    render(<FraktalBatchPage params={{ id: 'proj-1' }} />)

    const line = screen.getByText(/loading simulation context/i)
    expect(line.tagName).toBe('P')
    // The context usually resolves in a tick. `LoadingScreen` reserves 400px and
    // centres a spinner, which makes the page jump twice for a state the user
    // barely sees — and it is still on the pre-kit `text-muted-foreground`.
    expect(document.querySelector('.animate-spin')).toBeNull()
  })
})

// ---- Issue #176, slice 3A: the `[batchId]` route ----
//
// That route has no test of its own, so the frame it must not rebuild is pinned
// here, next to the route that shares its folder. It renders the summary and
// nothing else: the shell owns the frame, and the deprecated `Header` it used to
// mount was its only chrome on the sessions the shell leaves chromeless
// (`showChrome` is false while `AuthContext` initialises, and for a live cookie
// with a dead token).

describe('FraktalBatchDetailPage — batch summary route frame', () => {
  beforeEach(() => {
    mockSearchParams.clear()
  })

  it('renders the summary as its only element, with both ids', () => {
    const { container } = render(
      <FraktalBatchDetailPage params={{ id: 'proj-1', batchId: 'batch-9' }} />,
    )

    const summary = screen.getByTestId('batch-summary-stub')
    expect(summary.getAttribute('data-project')).toBe('proj-1')
    expect(summary.getAttribute('data-batch')).toBe('batch-9')
    // No `min-h-screen` wrapper and no second chrome: a wrapper here would
    // re-introduce the extra full-height box the shell already provides.
    expect(container.firstElementChild).toBe(summary)
    expect(document.querySelector('header')).toBeNull()
  })
})
