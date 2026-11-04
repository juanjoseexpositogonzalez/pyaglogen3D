/**
 * Unit tests for <FraktalBatchResultsView /> (T4.7, change:
 * fraktal-batch-analysis).
 *
 * The component renders an optional Plotly histogram via `next/dynamic`
 * → `react-plotly.js`, neither of which boots under jsdom. We mock both
 * layers using the same pattern as RgEvolutionChart's tests: the dynamic
 * loader returns the mocked plot module synchronously, and the plot
 * itself renders a `data-testid="plot"` stub so we can assert presence /
 * absence without needing WebGL.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Hoist mocks for API methods
const { mockDownloadBatchCsv, mockDeleteBatch } = vi.hoisted(() => ({
  mockDownloadBatchCsv: vi.fn(),
  mockDeleteBatch: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      downloadBatchCsv: mockDownloadBatchCsv,
      deleteBatch: mockDeleteBatch,
    },
  }
})

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('next/dynamic', () => ({
  default: (
    loader: () => Promise<{ default: React.ComponentType<unknown> }>
  ) => {
    let Comp: React.ComponentType<unknown> | null = null
    loader().then((mod) => {
      Comp = mod.default
    })
    return function DynamicStub(props: Record<string, unknown>) {
      if (!Comp) return null
      return React.createElement(Comp, props)
    }
  },
}))

vi.mock('react-plotly.js', () => ({
  default: () => <div data-testid="plot" />,
}))

import { FraktalBatchResultsView } from '../FraktalBatchResultsView'
import type { FraktalBatchResult } from '@/lib/api'

function makeResult(
  overrides: Partial<FraktalBatchResult> = {}
): FraktalBatchResult {
  return {
    images: [
      {
        index: 0,
        filename: 'proj_000.png',
        azimuth: 0,
        elevation: -90,
        fractal_dimension: 1.7,
        prefactor: 1.3,
        r_squared: null,
        n_particles_counted: 50,
        error: null,
      },
      {
        index: 1,
        filename: 'proj_001.png',
        azimuth: 90,
        elevation: 0,
        fractal_dimension: 1.8,
        prefactor: 1.3,
        r_squared: null,
        n_particles_counted: 48,
        error: null,
      },
      {
        index: 2,
        filename: 'proj_002.png',
        azimuth: 180,
        elevation: 90,
        fractal_dimension: 1.75,
        prefactor: 1.3,
        r_squared: null,
        n_particles_counted: 52,
        error: null,
      },
    ],
    stats: {
      n_images: 3,
      n_successful: 3,
      mean_df: 1.75,
      std_df: 0.05,
      median_df: 1.75,
      q1_df: 1.72,
      q3_df: 1.78,
      min_df: 1.7,
      max_df: 1.8,
    },
    histogram: null,
    comparison: null,
    calibration: {
      source: 'metadata',
      pixels_per_100nm: 500,
      dpo_used: 25,
      autocalibrate_image: null,
    },
    ...overrides,
  }
}

// next/dynamic resolves asynchronously; yield the microtask queue so the
// mocked plot is ready before we query the DOM.
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

const PROJECT_ID = 'proj-1'
const BATCH_ID = 'batch-abc'

function renderView(overrides: Partial<FraktalBatchResult> = {}) {
  return render(
    <FraktalBatchResultsView
      result={makeResult(overrides)}
      projectId={PROJECT_ID}
      batchId={BATCH_ID}
    />
  )
}

describe('<FraktalBatchResultsView />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the stats summary card with n_successful / n_images and mean Df', () => {
    renderView()
    expect(screen.getByText(/Batch Summary/i)).toBeTruthy()
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(screen.getAllByText('1.750').length).toBeGreaterThan(0)
  })

  it('includes the calibration summary line with source and px/100nm', () => {
    renderView()
    expect(screen.getByText(/metadata/)).toBeTruthy()
    // The scale is a reading: `Num` prints the value and its unit as
    // siblings, never as one string.
    expect(screen.getByText('500.0')).toBeTruthy()
    expect(screen.getByText('px/100nm')).toBeTruthy()
  })

  it('hides the histogram when n_successful < 5 and shows the N<5 notice', () => {
    renderView()
    expect(screen.queryByTestId('plot')).toBeNull()
    expect(
      screen.getByText(/Histogram not shown \(fewer than 5 successful/i)
    ).toBeTruthy()
  })

  it('renders the histogram plot when result.histogram is present', async () => {
    renderView({
      histogram: {
        bin_edges: [1.6, 1.7, 1.8, 1.9],
        counts: [1, 5, 2],
        rule_used: 'sturges',
      },
    })
    await flushMicrotasks()
    expect(await screen.findByTestId('plot')).toBeTruthy()
    expect(screen.getByText(/Df Distribution \(sturges\)/i)).toBeTruthy()
  })

  it('sorts the per-image table by Df ascending then descending when the Df header control is clicked', () => {
    renderView()

    // A header cell is not focusable and carries no role, so the sort lives
    // on a control inside it (issue #176 slice 3B).
    const dfSort = screen.getByRole('button', { name: /sort by df/i })

    fireEvent.click(dfSort)
    const rowsAsc = document.querySelectorAll('tbody tr')
    expect(rowsAsc[0].textContent).toContain('1.700')
    expect(rowsAsc[rowsAsc.length - 1].textContent).toContain('1.800')

    fireEvent.click(dfSort)
    const rowsDesc = document.querySelectorAll('tbody tr')
    expect(rowsDesc[0].textContent).toContain('1.800')
    expect(rowsDesc[rowsDesc.length - 1].textContent).toContain('1.700')
  })

  it('does not render the comparison card when comparison is null', () => {
    renderView()
    expect(screen.queryByText(/Df Comparison/i)).toBeNull()
  })

  // T6.1 — Clickable rows: each row wraps in a Link to drill-down route
  describe('clickable rows (T6.1)', () => {
    it('renders each row as a link to the drill-down route', () => {
      renderView()
      const links = screen.getAllByRole('link')
      const rowLinks = links.filter((a) =>
        a.getAttribute('href')?.includes('/fraktal/batch/')
      )
      // 3 images × 8 columns per row = 24 links (each cell is a Link)
      expect(rowLinks.length).toBeGreaterThanOrEqual(3)

      // Collect unique hrefs to verify all 3 image routes are present
      const uniqueHrefs = Array.from(
        new Set(rowLinks.map((a) => a.getAttribute('href')))
      )
      expect(uniqueHrefs).toContain(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}/image/0`
      )
      expect(uniqueHrefs).toContain(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}/image/1`
      )
      expect(uniqueHrefs).toContain(
        `/projects/${PROJECT_ID}/fraktal/batch/${BATCH_ID}/image/2`
      )
    })
  })

  // T6.2 — Download CSV button
  describe('batch CSV download (T6.2)', () => {
    it('renders a Download CSV button', () => {
      renderView()
      expect(
        screen.getByRole('button', { name: /download csv/i })
      ).toBeTruthy()
    })

    it('calls downloadBatchCsv with correct projectId and batchId on click', async () => {
      mockDownloadBatchCsv.mockResolvedValue(new Blob(['csv data']))
      // Mock URL.createObjectURL and click
      const mockCreateObjectURL = vi.fn(() => 'blob:test')
      const mockRevokeObjectURL = vi.fn()
      globalThis.URL.createObjectURL = mockCreateObjectURL
      globalThis.URL.revokeObjectURL = mockRevokeObjectURL

      renderView()
      const btn = screen.getByRole('button', { name: /download csv/i })
      fireEvent.click(btn)

      await waitFor(() => {
        expect(mockDownloadBatchCsv).toHaveBeenCalledWith(PROJECT_ID, BATCH_ID)
      })
    })
  })

  // T6.3 — Delete batch button
  describe('delete batch (T6.3)', () => {
    it('renders a Delete batch button', () => {
      renderView()
      expect(
        screen.getByRole('button', { name: /delete batch/i })
      ).toBeTruthy()
    })

    it('calls deleteBatch after confirmation and invokes onDeleted callback', async () => {
      mockDeleteBatch.mockResolvedValue(undefined)
      const onDeleted = vi.fn()
      render(
        <FraktalBatchResultsView
          result={makeResult()}
          projectId={PROJECT_ID}
          batchId={BATCH_ID}
          onDeleted={onDeleted}
        />
      )
      const btn = screen.getByRole('button', { name: /delete batch/i })
      fireEvent.click(btn)

      // A confirm dialog should appear
      const confirmBtn = await screen.findByRole('button', {
        name: /confirm delete/i,
      })
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(mockDeleteBatch).toHaveBeenCalledWith(PROJECT_ID, BATCH_ID)
      })
      await waitFor(() => {
        expect(onDeleted).toHaveBeenCalled()
      })
    })
  })

  // T5.3 (fraktal-bisection-ux P5): Quality column in results table
  describe('Quality column (T5.3)', () => {
    it('renders the "Quality" header in the table', () => {
      const result = makeResult()
      result.images[0].quality = 'converged'
      result.images[1].quality = 'approximate'
      result.images[2].quality = 'excluded'
      renderView({ images: result.images })
      // Header text "Quality" must be visible
      expect(screen.getByText('Quality')).toBeTruthy()
    })

    it('renders QualityBadge per row matching image quality', () => {
      const result = makeResult()
      result.images[0].quality = 'converged'
      result.images[1].quality = 'approximate'
      result.images[2].quality = 'failed'
      renderView({ images: result.images })
      expect(screen.getByText('Converged')).toBeTruthy()
      expect(screen.getByText('Approximate')).toBeTruthy()
      // The kit's chip says "Unusable" for `failed`: in a FRAKTAL row a status
      // chip may also say "Failed", and the two must not read as one thing.
      expect(screen.getByText('Unusable')).toBeTruthy()
    })

    it('sorts by quality column when the Quality header control is clicked', () => {
      const result = makeResult()
      result.images[0].quality = 'failed'
      result.images[1].quality = 'approximate'
      result.images[2].quality = 'converged'
      renderView({ images: result.images })

      fireEvent.click(screen.getByRole('button', { name: /sort by quality/i }))
      const rows = document.querySelectorAll('tbody tr')
      // ascending alphabetical: approximate → converged → failed
      expect(rows[0].textContent).toContain('Approximate')
      expect(rows[1].textContent).toContain('Converged')
      expect(rows[2].textContent).toContain('Unusable')
    })
  })

  // Frente 9 P4: Rg column shown in the results table.
  describe('Rg column', () => {
    it('renders the "Rg (nm)" header in the table', () => {
      render(
        <FraktalBatchResultsView
          result={makeResult()}
          projectId={PROJECT_ID}
          batchId={BATCH_ID}
        />
      )
      // Header text contains "Rg (nm)" — must be visible
      expect(screen.getByText(/Rg \(nm\)/i)).toBeTruthy()
    })

    it('renders Rg values when present, "—" when null', () => {
      const result = makeResult()
      // Add rg_nm to a couple of images, leave one null
      result.images[0].rg_nm = 152.3
      result.images[1].rg_nm = 148.7
      result.images[2].rg_nm = null
      render(
        <FraktalBatchResultsView
          result={result}
          projectId={PROJECT_ID}
          batchId={BATCH_ID}
        />
      )
      // Formatted values present (1 decimal place per fmt)
      expect(screen.getByText('152.3')).toBeTruthy()
      expect(screen.getByText('148.7')).toBeTruthy()
      // Null Rg shows "—" — note: there can be other "—" cells in the row
      // (e.g., R² is null in the fixture). At least one is the Rg cell.
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThan(0)
    })
  })

  // --- Issue #176 slice 3B: the summary on the kit --------------------------
  describe('batch summary on the kit (issue #176 3B)', () => {
    it('states the mean Df together with the batch spread it was measured with', () => {
      renderView()
      // A fractal dimension without its dispersion is a number without a
      // claim: the flat "Std Df" cell became the mean's own sigma.
      expect(screen.getByText('±0.050')).toBeTruthy()
    })

    it('renders the headline statistics as cards that carry their own claim', () => {
      renderView()

      // Not "there are two <article> elements": that is true of any card. A
      // `MetricCard` holds one labelled reading together with what qualifies it
      // — the mean's sigma and the sentence saying which estimator produced it.
      const mean = screen.getByText('Mean Df').closest('article')
      expect(mean).toBeTruthy()
      expect(mean?.textContent).toContain('±0.050')
      expect(mean?.textContent).toContain('mean of the per-image dimensions')

      const median = screen.getByText('Median Df').closest('article')
      expect(median).toBeTruthy()
      expect(median?.textContent).toContain('1.750')
      expect(median).not.toBe(mean)
    })

    it('sorts through a named header control that says the direction', () => {
      renderView()
      const control = screen.getByRole('button', { name: /sort by df/i })
      expect(control.getAttribute('aria-label')).toMatch(/ascending/i)

      fireEvent.click(control)
      const rowsAsc = document.querySelectorAll('tbody tr')
      expect(rowsAsc[0].textContent).toContain('1.700')
      expect(
        screen.getByRole('button', { name: /sort by df/i }).getAttribute('aria-label')
      ).toMatch(/descending/i)

      fireEvent.click(screen.getByRole('button', { name: /sort by df/i }))
      const rowsDesc = document.querySelectorAll('tbody tr')
      expect(rowsDesc[0].textContent).toContain('1.800')
    })

    it('reports the failed-image notice as a callout, not a bare alert', () => {
      const result = makeResult()
      result.images[0].error = 'Bisection failed'
      renderView({ images: result.images })

      const notice = screen
        .getByText(/Some images failed to analyze/i)
        .closest('[role="note"]')
      expect(notice).toBeTruthy()
    })
  })

  // --- R7 (design-system-foundation): the values behind the histogram -------
  describe('Show values on the Df histogram (R7)', () => {
    const HISTOGRAM = {
      bin_edges: [1.6, 1.7, 1.8, 1.9],
      counts: [1, 5, 2],
      rule_used: 'sturges' as const,
    }

    it('offers the control in the histogram panel header', async () => {
      renderView({ histogram: HISTOGRAM })
      await flushMicrotasks()

      const toggle = screen.getByRole('button', { name: /show values/i })
      expect(toggle.getAttribute('aria-pressed')).toBe('false')
      // In the header of the panel that holds the chart, beside its title.
      expect(toggle.closest('section')?.querySelector('h2')?.textContent).toBe(
        'Df Distribution (sturges)',
      )
    })

    it('replaces the chart with its bins and counts in the same panel', async () => {
      renderView({ histogram: HISTOGRAM })
      await flushMicrotasks()
      expect(screen.getByTestId('plot')).toBeTruthy()

      const panel = screen.getByRole('button', { name: /show values/i }).closest('section')
      expect(panel).toBeTruthy()
      if (!panel) return
      fireEvent.click(screen.getByRole('button', { name: /show values/i }))

      // The chart is gone, the panel frame stayed, a table took its place.
      expect(screen.queryByTestId('plot')).toBeNull()
      expect(panel.querySelector('table')).toBeTruthy()

      const headers = Array.from(panel.querySelectorAll('thead th')).map((th) => th.textContent)
      expect(headers).toEqual(['From', 'To', 'Count'])
      const rows = Array.from(panel.querySelectorAll('tbody tr')).map((row) =>
        Array.from(row.querySelectorAll('td')).map((td) => td.textContent),
      )
      // The bins the backend returned, to the precision the chart plots.
      expect(rows).toEqual([
        ['1.600', '1.700', '1'],
        ['1.700', '1.800', '5'],
        ['1.800', '1.900', '2'],
      ])
      expect(screen.getByRole('button', { name: /show chart/i })).toBeTruthy()
    })

    it('offers no control when the backend produced no histogram', () => {
      renderView()
      expect(screen.queryAllByRole('button', { name: /show values/i })).toHaveLength(0)
    })
  })

  // --- Every table has a name ---------------------------------------------
  describe('table names (issue #176 3B)', () => {
    it('gives the per-image table an accessible name', () => {
      renderView()
      // `DataTable` takes its accessible name from the caption, and this page
      // renders more than one table: position is not a name.
      const table = screen.getByRole('table', {
        name: /every image the batch carried/i,
      })
      expect(table).toBeTruthy()
    })
  })

  // --- The quality chip's reason is the state's, not the payload's silence --
  describe('quality chip reason', () => {
    it('explains an approximate image whose payload carries no error', () => {
      const result = makeResult()
      result.images[1].quality = 'approximate'
      result.images[1].error = null
      renderView({ images: result.images })

      // The reason exists; it simply does not travel in the payload. Saying it
      // is "not recorded" is a false statement read aloud by a screen reader.
      expect(screen.queryByText(/No failure reason recorded/i)).toBeNull()
      expect(screen.getByText(/the bisection settled between bounds/i)).toBeTruthy()
    })
  })
})
