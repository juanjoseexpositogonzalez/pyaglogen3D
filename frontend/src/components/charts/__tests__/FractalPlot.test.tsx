/**
 * The fractal scaling plot, and the one thing #275 is about: where its N axis
 * comes from.
 *
 * Before #275 nothing rendered this component in a test — the page replaces it
 * with a mock that only records props — so restoring the fabricated axis
 * (`(i + 1) * step`) left the whole suite green. These tests read the data the
 * plot hands Plotly, which is the axis a reader sees.
 *
 * The harness is the one `RgEvolutionChart.test.tsx` already uses: `next/dynamic`
 * passes through synchronously and `react-plotly.js` echoes its props into the
 * DOM, because Plotly pulls in WebGL and does not boot under jsdom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
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
  default: (props: Record<string, unknown>) => {
    const data = (props.data as unknown[]) || []
    return React.createElement('div', {
      'data-testid': 'plotly',
      'data-trace-count': String(data.length),
      'data-traces': JSON.stringify(data),
      'data-layout': JSON.stringify(props.layout ?? {}),
    })
  },
}))

import { FractalPlot } from '../FractalPlot'

type SentTrace = {
  name?: string
  /** N is the y axis of this plot (`hovertemplate: 'N = %{y}'`). */
  y?: number[]
}

const tracesSent = (): SentTrace[] =>
  JSON.parse(screen.getByTestId('plotly').getAttribute('data-traces') ?? '[]') as SentTrace[]

/**
 * Three points whose exact fit is Df = 2: Rg/rp = 2, 10, 100 with N = Rg².
 *
 * Exact powers on purpose: the fit's slope is 2 with no rounding noise, so the
 * assertion can name the number a reader would read off the legend.
 */
const EXACT_DF2 = { rgEvolution: [2, 10, 100], counts: [4, 100, 10000] }

const renderPlot = (props: Partial<React.ComponentProps<typeof FractalPlot>> = {}) =>
  render(
    <FractalPlot
      rgEvolution={EXACT_DF2.rgEvolution}
      fractalDimension={2}
      prefactor={1}
      {...props}
    />,
  )

describe('<FractalPlot /> — the N axis (#275)', () => {
  it('draws the counts the record carries, and fits them as the header says', () => {
    renderPlot({ rgEvolutionN: EXACT_DF2.counts })

    const data = tracesSent().find((t) => t.name?.startsWith('Data'))
    expect(data?.y).toEqual(EXACT_DF2.counts)

    // The fit over those counts is the record's Df, so no disagreement is claimed
    // and no rebuilt-axis warning is needed.
    const fit = tracesSent().find((t) => t.name?.startsWith('Fit'))
    expect(fit?.name).toContain('Df = 2.000')
    expect(screen.queryByText(/does not carry the particle count|carries no particle count/i)).toBeNull()
    expect(screen.queryByText(/differs from fitted Df/i)).toBeNull()
  })

  it('rebuilds the axis and says so when the record carries no counts', () => {
    // 12 particles over 3 samples is a stride of 4: arithmetic, not a measurement.
    renderPlot({ totalParticles: 12 })

    const data = tracesSent().find((t) => t.name?.startsWith('Data'))
    expect(data?.y).toEqual([4, 8, 12])
    expect(
      screen.getByText(/carries no particle count per point, so the N axis is rebuilt/i),
    ).toBeTruthy()
  })

  it('treats a mismatched counts array as absent instead of zipping what it has', () => {
    // A record whose counts do not cover every point cannot be trusted for the
    // others: half a measured axis is worse than a labelled rebuilt one.
    renderPlot({ rgEvolutionN: [4, 100], totalParticles: 12 })

    const data = tracesSent().find((t) => t.name?.startsWith('Data'))
    expect(data?.y).toEqual([4, 8, 12])
    expect(
      screen.getByText(/carries no particle count per point, so the N axis is rebuilt/i),
    ).toBeTruthy()
  })
})
