import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BatchProjectionExportPanel } from '../BatchProjectionExportPanel'
import type { BatchProjectionExportPanelProps } from '../BatchProjectionExportPanel'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTriggerExport = vi.fn()
const mockPollProjectionsStatus = vi.fn()

vi.mock('@/lib/api', () => ({
  triggerBatchProjectionExport: (...args: unknown[]) => mockTriggerExport(...args),
  pollProjectionsStatus: (...args: unknown[]) => mockPollProjectionsStatus(...args),
  API_BASE: 'http://localhost:8000/api/v1',
}))

// Mock viewerStore (in case ProjectionControls is used internally)
vi.mock('@/stores/viewerStore', () => ({
  useViewerStore: () => ({ cameraAzimuth: 0, cameraElevation: 0 }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const completedSims = [
  { id: 'sim-1', name: 'Sim A', status: 'completed' },
  { id: 'sim-2', name: 'Sim B', status: 'completed' },
  { id: 'sim-3', name: 'Sim C', status: 'completed' },
]

function defaultProps(overrides?: Partial<BatchProjectionExportPanelProps>): BatchProjectionExportPanelProps {
  return {
    projectId: 'proj-1',
    studyId: 'study-1',
    simulations: completedSims,
    ...overrides,
  }
}

function renderPanel(overrides?: Partial<BatchProjectionExportPanelProps>) {
  return render(<BatchProjectionExportPanel {...defaultProps(overrides)} />)
}

// ---------------------------------------------------------------------------
// T5.2: Sim list with checkboxes
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — sim list with checkboxes (T5.2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a title "Export Projections"', () => {
    renderPanel()
    expect(screen.getByText('Export Projections')).toBeTruthy()
  })

  it('renders one row per simulation with its name', () => {
    renderPanel()
    for (const sim of completedSims) {
      expect(screen.getByText(sim.name)).toBeTruthy()
    }
  })

  it('renders a checkbox per simulation', () => {
    renderPanel()
    // Each sim has an aria-label "Select {name}"
    for (const sim of completedSims) {
      expect(screen.getByLabelText(`Select ${sim.name}`)).toBeTruthy()
    }
  })

  it('checkboxes are unchecked by default', () => {
    renderPanel()
    for (const sim of completedSims) {
      const cb = screen.getByLabelText(`Select ${sim.name}`) as HTMLInputElement
      expect(cb.checked).toBe(false)
    }
  })

  it('clicking a sim checkbox checks it', () => {
    renderPanel()
    const cb = screen.getByLabelText('Select Sim A') as HTMLInputElement
    fireEvent.click(cb)
    expect(cb.checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T5.3: Select all / Deselect all
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — Select all / Deselect all (T5.3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking "Select all" checks all sim checkboxes', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))
    for (const sim of completedSims) {
      const cb = screen.getByLabelText(`Select ${sim.name}`) as HTMLInputElement
      expect(cb.checked).toBe(true)
    }
  })

  it('clicking "Deselect all" unchecks all sim checkboxes', () => {
    renderPanel()
    // Select all first
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))
    // Then deselect all
    fireEvent.click(screen.getByRole('button', { name: /^deselect all$/i }))
    for (const sim of completedSims) {
      const cb = screen.getByLabelText(`Select ${sim.name}`) as HTMLInputElement
      expect(cb.checked).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// T5.4: Counter "N of M selected"
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — counter (T5.4)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows "0 of 3 selected" initially', () => {
    renderPanel()
    expect(screen.getByText(/0 of 3 selected/i)).toBeTruthy()
  })

  it('shows "3 of 3 selected" after select all', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))
    expect(screen.getByText(/3 of 3 selected/i)).toBeTruthy()
  })

  it('shows "1 of 3 selected" after clicking one sim', () => {
    renderPanel()
    const cb = screen.getByLabelText('Select Sim A') as HTMLInputElement
    fireEvent.click(cb)
    expect(screen.getByText(/1 of 3 selected/i)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// T5.5: Mode/config controls
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — mode controls (T5.5)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a sampling mode selector', () => {
    renderPanel()
    expect(screen.getByLabelText(/sampling mode/i)).toBeTruthy()
  })

  it('defaults to grid mode', () => {
    renderPanel()
    const select = screen.getByLabelText(/sampling mode/i) as HTMLSelectElement
    expect(select.value).toBe('grid')
  })
})

// ---------------------------------------------------------------------------
// T5.6: Generate button disabled when 0 selected
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — Generate button (T5.6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is disabled when no simulations are selected', () => {
    renderPanel()
    const btn = screen.getByRole('button', { name: /generate & export/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('is enabled when at least one sim is selected', () => {
    renderPanel()
    fireEvent.click(screen.getByLabelText('Select Sim A'))
    const btn = screen.getByRole('button', { name: /generate & export/i })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T5.7: POSTs correct body shape
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — POST body (T5.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 2 })
    mockPollProjectionsStatus.mockResolvedValue({
      status: 'done',
      download_url: '/api/v1/projections-status/job-1/download/',
    })
  })

  it('POSTs with selected sim ids and grid mode config', async () => {
    renderPanel()
    // Select first two sims
    fireEvent.click(screen.getByLabelText('Select Sim A'))
    fireEvent.click(screen.getByLabelText('Select Sim B'))

    const btn = screen.getByRole('button', { name: /generate & export/i })
    await act(async () => {
      fireEvent.click(btn)
    })

    await waitFor(() => {
      expect(mockTriggerExport).toHaveBeenCalledTimes(1)
    })

    const [projectId, studyId, body] = mockTriggerExport.mock.calls[0]
    expect(projectId).toBe('proj-1')
    expect(studyId).toBe('study-1')
    expect(body.simulation_ids).toContain('sim-1')
    expect(body.simulation_ids).toContain('sim-2')
    expect(body.simulation_ids.length).toBe(2)
    expect(body.mode).toBe('grid')
    expect(body.config).toBeTruthy()
    expect(body.config.az_step).toBeGreaterThan(0)
    expect(body.config.el_step).toBeGreaterThan(0)
  })

  it('POSTs fibonacci config when fibonacci mode is selected', async () => {
    renderPanel()
    // Switch mode
    const modeSelect = screen.getByLabelText(/sampling mode/i) as HTMLSelectElement
    fireEvent.change(modeSelect, { target: { value: 'fibonacci' } })

    // Select a sim
    fireEvent.click(screen.getByLabelText('Select Sim A'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      expect(mockTriggerExport).toHaveBeenCalledTimes(1)
    })

    const [, , body] = mockTriggerExport.mock.calls[0]
    expect(body.mode).toBe('fibonacci')
    expect(body.config.n).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// T5.8: Polling progress "Processing sim X of Y"
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — polling progress (T5.8)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows progress text during polling', async () => {
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 3 })

    // Create a deferred promise so we can observe intermediate state
    let resolvePolling!: (v: unknown) => void
    mockPollProjectionsStatus.mockImplementation(
      (_jobId: string, onProgress?: (p: number, c: number, t: number) => void) => {
        // Fire progress callback synchronously so React state updates
        onProgress?.(0.33, 1, 3)
        // Return a promise that stays pending until we resolve it
        return new Promise((resolve) => {
          resolvePolling = resolve
        })
      }
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))

    // Don't await the full flow — we want to observe intermediate state
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    // Wait for the progress text to appear while polling is still pending
    await waitFor(() => {
      expect(screen.getByText(/processing simulation 1 of 3/i)).toBeTruthy()
    })

    // Clean up — resolve the pending poll so the component settles
    await act(async () => {
      resolvePolling({ status: 'done', download_url: '/dl/' })
    })
  })

  it('progress bar shows correct percentage', async () => {
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 2 })

    let resolvePolling!: (v: unknown) => void
    mockPollProjectionsStatus.mockImplementation(
      (_jobId: string, onProgress?: (p: number, c: number, t: number) => void) => {
        onProgress?.(0.5, 1, 2)
        return new Promise((resolve) => {
          resolvePolling = resolve
        })
      }
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      const progressSection = screen.getByTestId('batch-export-progress')
      expect(progressSection).toBeTruthy()
      expect(screen.getByText(/processing simulation 1 of 2/i)).toBeTruthy()
    })

    await act(async () => {
      resolvePolling({ status: 'done', download_url: '/dl/' })
    })
  })
})

// ---------------------------------------------------------------------------
// T5.9: Auto-download on completion
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — auto-download (T5.9)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a download anchor on completion', async () => {
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 1 })
    mockPollProjectionsStatus.mockResolvedValue({
      status: 'done',
      download_url: '/api/v1/projections-status/job-1/download/',
    })

    const mockClick = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const anchor = originalCreateElement('a') as HTMLAnchorElement
        anchor.click = mockClick
        return anchor
      }
      return originalCreateElement(tag)
    })

    renderPanel()
    fireEvent.click(screen.getByLabelText('Select Sim A'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      expect(mockClick).toHaveBeenCalled()
    })

    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// T5.10: Partial failure warning
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — partial failure warning (T5.10)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows warning when some sims failed', async () => {
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 3 })
    mockPollProjectionsStatus.mockResolvedValue({
      status: 'done',
      download_url: '/dl/',
      failed_sims: [{ sim_id: 'sim-2', error: 'no geometry' }],
      successful_sims: 2,
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/1 sim.*failed.*2 succeeded/i)).toBeTruthy()
    })
  })

  it('does NOT show warning when all sims succeeded', async () => {
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 3 })
    mockPollProjectionsStatus.mockResolvedValue({
      status: 'done',
      download_url: '/dl/',
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      expect(mockPollProjectionsStatus).toHaveBeenCalled()
    })

    expect(screen.queryByText(/failed.*succeeded/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T5.11: Full failure error toast
// ---------------------------------------------------------------------------
describe('BatchProjectionExportPanel — full failure error (T5.11)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows error message when export completely fails', async () => {
    mockTriggerExport.mockResolvedValue({ job_id: 'job-1', status: 'queued', total_sims: 3 })
    mockPollProjectionsStatus.mockRejectedValue(new Error('Projection generation failed'))

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /^select all$/i }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/projection generation failed/i)).toBeTruthy()
    })
  })

  it('shows error when trigger itself fails', async () => {
    mockTriggerExport.mockRejectedValue(new Error('Network error'))

    renderPanel()
    fireEvent.click(screen.getByLabelText('Select Sim A'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate & export/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeTruthy()
    })
  })
})
