/**
 * Unit tests for `<RgEvolutionChart>` (T15/T19, change: visualize-multiple).
 *
 * The component calls into `next/dynamic` → `react-plotly.js`, which
 * pulls in WebGL and doesn't boot under jsdom. We mock both layers:
 *
 *   - `next/dynamic` returns the passed component synchronously (so the
 *     lazy Plot is exercised immediately).
 *   - `react-plotly.js` renders a stub that stringifies its `data` and
 *     `layout` props into `data-traces` / `data-layout` — tests assert
 *     against those to verify trace count, series colours, trace names and
 *     the theme the chart was actually drawn in.
 */
import { act, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useThemeStore } from '@/stores/useThemeStore'

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
        data-layout={JSON.stringify(props.layout ?? {})}
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

/** The layout Plotly was handed, as the component built it. */
type SentLayout = {
  paper_bgcolor?: string
  plot_bgcolor?: string
  font?: { color?: string }
  xaxis?: { gridcolor?: string; title?: { text?: string } }
  yaxis?: { gridcolor?: string; title?: { text?: string } }
}

type SentTrace = {
  name?: string
  mode?: string
  line: { color: string; dash?: string }
  marker: { color: string; symbol?: string; size?: number | number[] }
}

const layoutSent = (): SentLayout =>
  JSON.parse(screen.getByTestId('plotly').getAttribute('data-layout') ?? '{}') as SentLayout

const tracesSent = (): SentTrace[] =>
  JSON.parse(screen.getByTestId('plotly').getAttribute('data-traces') ?? '[]') as SentTrace[]

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

  it('separates series with dash and marker as well as colour', () => {
    // Colour alone is unreadable in greyscale, which is how these plots end up
    // in a paper: the kit's triple encoding puts a dash pattern and a marker
    // glyph on each series, indexed by its position.
    const series: RgSeries[] = [
      { label: 'Sim A', color: '#4E79A7', rgEvolution: [1, 2, 4] },
      { label: 'Sim B', color: '#F28E2B', rgEvolution: [1, 1.5, 3] },
    ]
    render(<RgEvolutionChart series={series} />)

    return flushMicrotasks().then(() => {
      const traces = tracesSent()
      expect(traces[0].line.dash).toBeTruthy()
      expect(traces[1].line.dash).toBeTruthy()
      expect(traces[0].line.dash).not.toBe(traces[1].line.dash)
      expect(traces[0].marker.symbol).toBeTruthy()
      expect(traces[0].marker.symbol).not.toBe(traces[1].marker.symbol)
    })
  })
})

/**
 * The theme witness for this screen (issue #175, slice 2).
 *
 * `lib/chart-theme.ts` exists so a chart draws with the tokens in force; until
 * this witness existed nothing proved a chart used it, and a chart hand-painted
 * in dark hex passed every test while sitting on light paper.
 *
 * What is asserted is what the plot **receives** — the `layout` handed to
 * Plotly and the colours of its traces — never the classes on the frame around
 * it: a themed wrapper over an unthemed plot is exactly the failure this test
 * is here to catch.
 *
 * jsdom loads no stylesheet, so the tokens are injected. The values are the
 * ones `src/app/globals.css` declares for each theme; they are written here
 * rather than hard-coded in the component, which is the whole point.
 */
const LIGHT_TOKENS: Record<string, string> = {
  '--ink': '#112c3d',
  '--ink-muted': '#536a73',
  '--visual-grid': '#d7e8ec',
  '--series-1': '#1d858c',
}

const DARK_TOKENS: Record<string, string> = {
  '--ink': '#e9f4f4',
  '--ink-muted': '#a7c0c1',
  '--visual-grid': '#1d3b47',
  '--series-1': '#58c5c0',
}

function injectTokens(tokens: Record<string, string>): void {
  Object.keys(tokens).forEach((name) => {
    document.documentElement.style.setProperty(name, tokens[name])
  })
}

function clearTokens(): void {
  Object.keys(LIGHT_TOKENS).forEach((name) => {
    document.documentElement.style.removeProperty(name)
  })
  delete document.documentElement.dataset.theme
}

const seriesA: RgSeries = { label: 'Sim A', color: '#4E79A7', rgEvolution: [1, 2, 4] }

beforeEach(() => {
  useThemeStore.setState({ resolved: 'light' })
  injectTokens(LIGHT_TOKENS)
})

afterEach(clearTokens)

describe('<RgEvolutionChart /> — the theme the plot is drawn in', () => {
  it('draws its ink and plot grid from the tokens, on the panel\u2019s own paper', async () => {
    render(<RgEvolutionChart series={[seriesA]} />)
    await flushMicrotasks()

    const layout = layoutSent()
    expect(layout.font?.color).toBe(LIGHT_TOKENS['--ink'])
    expect(layout.xaxis?.gridcolor).toBe(LIGHT_TOKENS['--visual-grid'])
    expect(layout.yaxis?.gridcolor).toBe(LIGHT_TOKENS['--visual-grid'])
    // No background of its own: the surface behind the chart is the panel the
    // reader already sees, in whichever theme is active.
    expect(layout.paper_bgcolor).toBe('transparent')
    expect(layout.plot_bgcolor).toBe('transparent')
  })

  it('repaints grid and ink when the theme flips under the mounted chart', async () => {
    render(<RgEvolutionChart series={[seriesA]} />)
    await flushMicrotasks()

    const before = layoutSent()

    act(() => {
      document.documentElement.dataset.theme = 'dark'
      injectTokens(DARK_TOKENS)
      useThemeStore.setState({ resolved: 'dark' })
    })

    const after = layoutSent()
    expect(after.font?.color).toBe(DARK_TOKENS['--ink'])
    expect(after.xaxis?.gridcolor).toBe(DARK_TOKENS['--visual-grid'])
    // The point of the flip: the same mounted chart, other values. A chart that
    // only re-rendered its frame would leave these identical.
    expect(after.font?.color).not.toBe(before.font?.color)
    expect(after.xaxis?.gridcolor).not.toBe(before.xaxis?.gridcolor)
  })

  it('labels the axes the way the capability contract fixes them', async () => {
    render(<RgEvolutionChart series={[seriesA]} />)
    await flushMicrotasks()

    const layout = layoutSent()
    expect(layout.xaxis?.title?.text).toBe('log10(N)')
    // `log10(Rg/nm)`, not `log10 Rg (nm)`: the plotted quantity is a ratio and
    // therefore dimensionless. Spec `multi-aggregate-comparison` S6.4 fixes the
    // label and `docs/unit-convention.md` records that resting it on `log10(Rg)`
    // was a fixed mistake, so a free hand here is how it comes back.
    expect(layout.yaxis?.title?.text).toBe('log10(Rg/nm)')
  })

  it('thins the markers on a long series instead of smearing them', async () => {
    const long = Array.from({ length: 200 }, (_, i) => 1 + i * 0.01)
    render(
      <RgEvolutionChart
        series={[{ label: 'Long', color: '#4E79A7', rgEvolution: long }]}
      />,
    )
    await flushMicrotasks()

    // A 7px glyph on all two hundred samples paints a band, not a curve. The
    // kit thins by position (`markEvery`), so the trace carries a per-point
    // size and most points get none.
    const size = tracesSent()[0].marker.size
    expect(Array.isArray(size)).toBe(true)
    const sizes = size as number[]
    expect(sizes).toHaveLength(200)
    const marked = sizes.filter((s) => s > 0).length
    expect(marked).toBeGreaterThan(0)
    expect(marked).toBeLessThan(60)
  })

  it('keeps a marker on every point of a short series', async () => {
    render(<RgEvolutionChart series={[seriesA]} />)
    await flushMicrotasks()

    const sizes = tracesSent()[0].marker.size as number[]
    // Three samples are already a legible scatter: thinning them would hide
    // data rather than declutter it.
    expect(sizes).toHaveLength(3)
    expect(sizes.filter((s) => s > 0)).toHaveLength(3)
  })

  it('repaints when the theme attribute moves without the store', async () => {
    // `chart-theme` refreshes its in-memory ramp from a MutationObserver of
    // `data-theme`, but that refresh does not wake a mounted plot. A theme
    // changed from another tab — or by anything that does not go through the
    // store — would leave this chart drawn in the previous theme while the ramp
    // already returns the new one.
    render(<RgEvolutionChart series={[seriesA]} />)
    await flushMicrotasks()

    const before = layoutSent()

    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
      injectTokens(DARK_TOKENS)
    })

    const after = layoutSent()
    expect(after.font?.color).toBe(DARK_TOKENS['--ink'])
    expect(after.xaxis?.gridcolor).toBe(DARK_TOKENS['--visual-grid'])
    expect(after.font?.color).not.toBe(before.font?.color)
  })

  it('draws a lone series in the ramp in force, and follows it across the theme', async () => {
    render(<RgEvolutionChart rgEvolution={[1, 2, 4]} parameters={{}} />)
    await flushMicrotasks()

    expect(tracesSent()[0].line.color).toBe(LIGHT_TOKENS['--series-1'])

    act(() => {
      document.documentElement.dataset.theme = 'dark'
      injectTokens(DARK_TOKENS)
      useThemeStore.setState({ resolved: 'dark' })
    })

    expect(tracesSent()[0].line.color).toBe(DARK_TOKENS['--series-1'])
  })
})
