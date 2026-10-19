/**
 * R-DELTA-C2 marker tests for <FraktalBatchDistributions /> (change:
 * fraktal-batch-extensions).
 *
 * R-DELTA-C2.1 — the Sim-Df reference marker renders over a normal
 * histogram: dashed vertical line at x = study_comparison.sim_df.value
 * (SINGLE source — no top-level sim_df_value key) + `Sim Df: X.XX` chip,
 * toggle ON by default, canonical histogram untouched (same traces).
 *
 * R-DELTA-C2.2 — the marker is hidden when: study_comparison null,
 * toggle OFF, Df panel "Not enough data" (n_successful < 5), or the
 * panel is in the no-data state. And it MUST NOT affect the canonical
 * bins/traces/tooltips in any state.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture layout.shapes / layout.annotations so the marker can be asserted
// without Plotly/WebGL. The trace data is exposed too, to pin that the
// canonical histogram is untouched by the marker.
const plotCalls: Array<Record<string, unknown>> = []

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
  default: (props: Record<string, unknown>) => {
    plotCalls.push(props)
    return <div data-testid="plotly" />
  },
}))

// Imports AFTER mocks.
import { FraktalBatchDistributions } from '../FraktalBatchDistributions'
import type {
  FraktalBatchImageResult,
  FraktalStudyComparison,
} from '@/lib/api'

function makeImage(
  index: number,
  overrides: Partial<FraktalBatchImageResult> = {}
): FraktalBatchImageResult {
  return {
    index,
    filename: `img_${index}.png`,
    azimuth: 0,
    elevation: 0,
    fractal_dimension: 1.7 + (index % 5) * 0.03,
    prefactor: 1.4,
    r_squared: 0.99,
    n_particles_counted: 350,
    rg_nm: 150,
    error: null,
    quality: 'converged',
    df_estimate: null,
    ...overrides,
  }
}

function makeImages(nSuccessful: number, nFailed = 0): FraktalBatchImageResult[] {
  const success = Array.from({ length: nSuccessful }, (_, i) => makeImage(i))
  const failed = Array.from({ length: nFailed }, (_, i) =>
    makeImage(nSuccessful + i, {
      error: 'Bisection failed',
      fractal_dimension: null,
      prefactor: null,
      rg_nm: null,
      n_particles_counted: null,
    })
  )
  return [...success, ...failed]
}

function makeStudyComparison(): FraktalStudyComparison {
  return {
    sim_id: '6d0b7a41-1111-4222-8333-444455556666',
    images_with_df: 30,
    images_without_df: 0,
    image_df: {
      n: 30,
      mean: 1.76,
      median: 1.76,
      min: 1.7,
      max: 1.82,
      n_converged: 30,
      n_approximate: 0,
    },
    sim_df: { value: 2.42, target_df: 2.3 },
    mean_delta: -0.66,
    deltas: Array.from({ length: 30 }, () => -0.66),
    show_sorensen_note: true,
  }
}

/** The Plotly call belonging to the Df panel (xaxis title 'Df'). */
function dfPlotCall(): Record<string, unknown> | undefined {
  // LAST matching call — re-renders (e.g. the toggle click) push new calls.
  return plotCalls.findLast((c) => {
    const layout = c.layout as { xaxis?: { title?: { text?: string } } }
    return layout?.xaxis?.title?.text === 'Df'
  })
}

beforeEach(() => {
  plotCalls.length = 0
})

describe('R-DELTA-C2.1 — marker renders over a normal histogram', () => {
  it('draws a dashed vertical line at sim_df.value with the toggle ON (default)', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={makeStudyComparison()}
      />
    )

    const dfCall = dfPlotCall()
    expect(dfCall).toBeTruthy()
    const layout = dfCall!.layout as {
      shapes?: Array<Record<string, unknown>>
    }
    expect(layout.shapes).toHaveLength(1)
    const shape = layout.shapes![0]
    expect(shape.type).toBe('line')
    expect(shape.x0).toBe(2.42)
    expect(shape.x1).toBe(2.42)
    expect((shape.line as Record<string, unknown>).dash).toBe('dash')
  })

  it('labels the marker with the `Sim Df: X.XX` chip', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={makeStudyComparison()}
      />
    )

    const layout = dfPlotCall()!.layout as {
      annotations?: Array<Record<string, unknown>>
    }
    expect(layout.annotations).toHaveLength(1)
    expect(layout.annotations![0].text).toBe('Sim Df: 2.42')
  })

  it('leaves the canonical histogram untouched (same traces as pre-change)', () => {
    // With and without the marker: the trace data must be IDENTICAL — the
    // marker is purely additive to the layout (R2/R5/R-DELTA-M untouched).
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={makeStudyComparison()}
      />
    )
    const withMarkerData = JSON.stringify(dfPlotCall()!.data)

    plotCalls.length = 0
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={null}
      />
    )
    const withoutMarkerData = JSON.stringify(dfPlotCall()!.data)

    expect(withMarkerData).toBe(withoutMarkerData)
  })

  it('shows the toggle only for the Df panel', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={makeStudyComparison()}
      />
    )

    expect(screen.getByTestId('sim-marker-toggle')).toBeTruthy()
  })
})

describe('R-DELTA-C2.2 — marker hidden', () => {
  it('is hidden when study_comparison is null', () => {
    render(
      <FraktalBatchDistributions images={makeImages(30)} studyComparison={null} />
    )

    const layout = dfPlotCall()!.layout as { shapes?: unknown[] }
    expect(layout.shapes).toBeUndefined()
  })

  it('is hidden when study_comparison is undefined (legacy server)', () => {
    render(<FraktalBatchDistributions images={makeImages(30)} />)

    const layout = dfPlotCall()!.layout as { shapes?: unknown[] }
    expect(layout.shapes).toBeUndefined()
  })

  it('is hidden when the per-batch toggle is OFF (component-local, not persisted)', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={makeStudyComparison()}
      />
    )
    expect((dfPlotCall()!.layout as { shapes?: unknown[] }).shapes).toHaveLength(1)

    fireEvent.click(screen.getByTestId('sim-marker-toggle'))
    const layout = dfPlotCall()!.layout as { shapes?: unknown[] }
    expect(layout.shapes).toBeUndefined()
    // The canonical histogram still renders with the toggle OFF.
    expect(dfPlotCall()!.data).toBeDefined()
  })

  it('is hidden in the "Not enough data" state (n_successful < 5) — no plot at all', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(3, 12)}
        studyComparison={makeStudyComparison()}
      />
    )

    expect(screen.getByTestId('distribution-df-not-enough')).toBeTruthy()
    expect(dfPlotCall()).toBeUndefined()
  })

  it('is hidden in the no-data state (all images failed) — no plot at all', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(0, 10)}
        studyComparison={makeStudyComparison()}
      />
    )

    expect(screen.getByTestId('fraktal-batch-distributions-empty')).toBeTruthy()
    expect(dfPlotCall()).toBeUndefined()
  })

  it('never draws the marker on the kf/rg/npo panels', () => {
    render(
      <FraktalBatchDistributions
        images={makeImages(30)}
        studyComparison={makeStudyComparison()}
      />
    )

    let otherPanels = 0
    for (const call of plotCalls) {
      const layout = call.layout as {
        shapes?: unknown[]
        xaxis?: { title?: { text?: string } }
      }
      const xTitle = layout.xaxis?.title?.text
      if (xTitle && xTitle !== 'Df') {
        otherPanels += 1
        expect(layout.shapes).toBeUndefined()
      }
    }
    expect(otherPanels).toBe(3)
  })
})
