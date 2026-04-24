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
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

describe('<FraktalBatchResultsView />', () => {
  it('renders the stats summary card with n_successful / n_images and mean Df', () => {
    render(<FraktalBatchResultsView result={makeResult()} />)
    expect(screen.getByText(/Batch Summary/i)).toBeTruthy()
    expect(screen.getByText('3 / 3')).toBeTruthy()
    // mean_df formatted to 3 digits — appears twice (mean and median), so
    // use getAllByText and assert at least one match.
    expect(screen.getAllByText('1.750').length).toBeGreaterThan(0)
  })

  it('includes the calibration summary line with source and px/100nm', () => {
    render(<FraktalBatchResultsView result={makeResult()} />)
    expect(screen.getByText(/metadata/)).toBeTruthy()
    expect(screen.getByText(/500\.0 px\/100nm/)).toBeTruthy()
  })

  it('hides the histogram when n_successful < 5 and shows the N<5 notice', () => {
    render(<FraktalBatchResultsView result={makeResult()} />)
    expect(screen.queryByTestId('plot')).toBeNull()
    expect(
      screen.getByText(/Histogram not shown \(fewer than 5 successful/i)
    ).toBeTruthy()
  })

  it('renders the histogram plot when result.histogram is present', async () => {
    const result = makeResult({
      histogram: {
        bin_edges: [1.6, 1.7, 1.8, 1.9],
        counts: [1, 5, 2],
        rule_used: 'sturges',
      },
    })
    render(<FraktalBatchResultsView result={result} />)
    await flushMicrotasks()
    expect(await screen.findByTestId('plot')).toBeTruthy()
    expect(screen.getByText(/Df Distribution \(sturges\)/i)).toBeTruthy()
  })

  it('sorts the per-image table by Df ascending then descending when the Df header is clicked', () => {
    render(<FraktalBatchResultsView result={makeResult()} />)
    // Header "Df" includes the sort icon but the text node is just "Df".
    const headers = screen.getAllByRole('columnheader')
    const dfHeader = headers.find(
      (h) => (h.textContent ?? '').trim().startsWith('Df')
    )
    expect(dfHeader).toBeTruthy()
    if (!dfHeader) return

    fireEvent.click(dfHeader)
    // After ascending click: first row should be the 1.700 fractal_dimension.
    const rowsAsc = document.querySelectorAll('tbody tr')
    expect(rowsAsc[0].textContent).toContain('1.700')
    expect(rowsAsc[rowsAsc.length - 1].textContent).toContain('1.800')

    // Click again to flip to descending.
    fireEvent.click(dfHeader)
    const rowsDesc = document.querySelectorAll('tbody tr')
    expect(rowsDesc[0].textContent).toContain('1.800')
    expect(rowsDesc[rowsDesc.length - 1].textContent).toContain('1.700')
  })

  it('does not render the comparison card when comparison is null', () => {
    render(<FraktalBatchResultsView result={makeResult()} />)
    expect(screen.queryByText(/Df Comparison/i)).toBeNull()
  })
})
