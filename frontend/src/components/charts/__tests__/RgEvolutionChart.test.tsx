/**
 * Unit tests for `<RgEvolutionChart>` (T15/T19, change: visualize-multiple).
 *
 * The component calls into `next/dynamic` → `react-plotly.js`, which
 * pulls in WebGL and doesn't boot under jsdom. We mock both layers:
 *
 *   - `next/dynamic` returns the passed component synchronously (so the
 *     lazy Plot is exercised immediately).
 *   - `react-plotly.js` renders a stub that stringifies its `data` prop
 *     into `data-traces` — tests assert against this to verify trace
 *     count, series colors, and trace names.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

// next/dynamic — synchronous passthrough so the Plot stub mounts
// immediately in jsdom.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    // Jump through the loader's promise to get the mocked react-plotly.js
    // default export. vi.mock hoists, so the real loader resolves to our
    // stub below.
    let Comp: React.ComponentType<unknown> | null = null
    loader().then((mod) => {
      Comp = mod.default
    })
    // Synchronous wrapper — on first render, kick a microtask and return
    // a placeholder; but vi hoists mocks so by the time tests run the
    // promise has already resolved. Use a simple render that reads Comp
    // at call time.
    return function DynamicStub(props: Record<string, unknown>) {
      if (!Comp) {
        // Fallback for the extreme race — should not happen in tests
        // because the mocked loader resolves synchronously via
        // Promise.resolve inside vi.mock below.
        return null
      }
      return React.createElement(Comp, props)
    }
  },
}))

// react-plotly.js stub — echoes the data into the DOM for assertions.
vi.mock('react-plotly.js', () => ({
  default: (props: Record<string, unknown>) => {
    const data = (props.data as unknown[]) || []
    return (
      <div
        data-testid="plotly"
        data-trace-count={String(data.length)}
        data-traces={JSON.stringify(data)}
      />
    )
  },
}))

// Imports AFTER mocks.
import { RgEvolutionChart, type RgSeries } from '../RgEvolutionChart'

/**
 * Await a microtask tick so `next/dynamic`'s mocked loader promise can
 * resolve before we query the DOM. One tick is enough because the mocks
 * above resolve synchronously.
 */
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('<RgEvolutionChart /> — single-series (legacy API)', () => {
  it('renders an empty-state message for an empty rgEvolution array', () => {
    render(<RgEvolutionChart rgEvolution={[]} />)
    expect(screen.getByText(/no evolution data available/i)).toBeTruthy()
  })

  it('renders a single trace for a non-empty rgEvolution array', async () => {
    render(<RgEvolutionChart rgEvolution={[1, 2, 4]} parameters={{}} />)
    await flushMicrotasks()
    const plot = await screen.findByTestId('plotly')
    expect(plot.getAttribute('data-trace-count')).toBe('1')
  })
})

describe('<RgEvolutionChart /> — multi-series (T15)', () => {
  it('renders one trace per non-empty series with the given color and label', async () => {
    const series: RgSeries[] = [
      {
        label: 'Sim A',
        color: '#4E79A7',
        rgEvolution: [1, 2, 4],
        parameters: { primary_particle_diameter_nm: 20 },
      },
      {
        label: 'Sim B',
        color: '#F28E2B',
        rgEvolution: [1, 1.5, 3],
        parameters: { primary_particle_diameter_nm: 10 },
      },
    ]
    render(<RgEvolutionChart series={series} />)
    await flushMicrotasks()

    const plot = await screen.findByTestId('plotly')
    expect(plot.getAttribute('data-trace-count')).toBe('2')

    const traces = JSON.parse(plot.getAttribute('data-traces') ?? '[]') as Array<{
      name: string
      line: { color: string }
      marker: { color: string }
    }>
    expect(traces[0].name).toBe('Sim A')
    expect(traces[0].line.color).toBe('#4E79A7')
    expect(traces[0].marker.color).toBe('#4E79A7')
    expect(traces[1].name).toBe('Sim B')
    expect(traces[1].line.color).toBe('#F28E2B')
  })

  it('omits series with empty rgEvolution and lists them under the plot', async () => {
    const series: RgSeries[] = [
      { label: 'Sim A', color: '#4E79A7', rgEvolution: [1, 2, 4] },
      { label: 'Sim B (imported)', color: '#F28E2B', rgEvolution: [] },
    ]
    render(<RgEvolutionChart series={series} />)
    await flushMicrotasks()

    const plot = await screen.findByTestId('plotly')
    expect(plot.getAttribute('data-trace-count')).toBe('1')

    const missing = await screen.findByTestId('rg-chart-missing-list')
    expect(missing.textContent).toContain('Sim B (imported)')
  })

  it('renders empty state when every series is empty', () => {
    const series: RgSeries[] = [
      { label: 'Sim A', color: '#4E79A7', rgEvolution: [] },
      { label: 'Sim B', color: '#F28E2B', rgEvolution: [] },
    ]
    render(<RgEvolutionChart series={series} />)

    const empty = screen.getByTestId('rg-chart-empty')
    expect(empty).toBeTruthy()
    // The empty-state header sits inside `rg-chart-empty` as a <p>.
    // Scope the text assertion so it doesn't match the <li> entries
    // beneath (which also contain "no evolution data available").
    const heading = empty.querySelector('p')
    expect(heading?.textContent).toMatch(/no evolution data available/i)
    const missing = screen.getByTestId('rg-chart-missing-list')
    expect(missing.textContent).toContain('Sim A')
    expect(missing.textContent).toContain('Sim B')
  })

  it('renders empty state for an empty series array', () => {
    render(<RgEvolutionChart series={[]} />)
    expect(screen.getByTestId('rg-chart-empty')).toBeTruthy()
  })
})
