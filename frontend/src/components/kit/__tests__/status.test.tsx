/**
 * Covers design-system-foundation R8: state is never carried by colour alone.
 * Every chip names its state in words, every dot carries a label, and the
 * shimmer is suppressed under prefers-reduced-motion by the stylesheet rather
 * than by each component.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Callout } from '../Callout'
import { QualityBadge } from '../QualityBadge'
import type { AnalysisQuality } from '@/lib/api'
import type { SimulationStatus } from '@/lib/types'

import { StatusChip } from '../StatusChip'
import type { Status } from '../StatusChip'
import { StatusDot } from '../StatusDot'

describe('StatusChip', () => {
  // One expected label per state. The previous version of this test asserted
  // that `getByText(/\w/)` found text of length > 0, which is a tautology:
  // it would have passed with every state mapped to the same word, or to an
  // internal name. R8-S1 asks for a label that NAMES the state.
  const CASES: Array<[Status, string]> = [
    ['completed', 'Completed'],
    ['running', 'Running'],
    ['queued', 'Queued'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
  ]

  it.each(CASES)('names %s as "%s"', (status, expected) => {
    render(<StatusChip status={status} />)
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('gives every state a distinct word, as rendered', () => {
    // Asserting that the CASES array has no duplicates would check a literal
    // written three lines above. This renders each chip and collects what the
    // component actually produced.
    const rendered = CASES.map(([status]) => {
      const { container, unmount } = render(<StatusChip status={status} />)
      const text = container.textContent?.trim() ?? ''
      unmount()
      return text
    })
    expect(new Set(rendered).size).toBe(CASES.length)
  })

  it('renders a label for every status the backend can return', () => {
    // Comparing two literal arrays declared in this file would prove nothing:
    // the component has to be the one producing the label. Exhaustiveness of
    // the union itself is enforced by Record<Status, string> at compile time,
    // so this guards the rendering, not the typing.
    const backendStates: SimulationStatus[] = [
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]
    backendStates.forEach((state) => {
      const { container, unmount } = render(<StatusChip status={state} />)
      expect(container.textContent?.trim(), `${state} rendered no label`).toBeTruthy()
      unmount()
    })
  })

  it('marks a running job with the shimmer, which the stylesheet disables under reduced motion', () => {
    const { container } = render(<StatusChip status="running" />)
    expect(container.querySelector('.shimmer')).not.toBeNull()
  })

  it('leaves a finished job unanimated', () => {
    const { container } = render(<StatusChip status="completed" />)
    expect(container.querySelector('.shimmer')).toBeNull()
  })

  it('accepts an explicit label but is never wordless', () => {
    render(<StatusChip status="running" label="Analysing" />)
    expect(screen.getByText('Analysing')).toBeTruthy()
  })
})

describe('QualityBadge', () => {
  it('states the quality in words', () => {
    render(<QualityBadge quality="approximate" reason="segmentation touched the border" />)
    expect(screen.getByText('Approximate')).toBeTruthy()
  })

  it('exposes the reason to assistive technology, not just as a tooltip', () => {
    render(<QualityBadge quality="excluded" reason="object touches the image border" />)
    expect(screen.getByText(': object touches the image border')).toBeTruthy()
  })

  it('uses the vocabulary the backend actually returns', () => {
    // An earlier version said `good`; AnalysisQuality says `converged`, so no
    // FRAKTAL consumer could have passed its own value without a cast.
    const fromBackend: AnalysisQuality = 'converged'
    render(<QualityBadge quality={fromBackend} />)
    expect(screen.getByText('Converged')).toBeTruthy()
  })

  it('does not say "Failed" for both a dead job and an unusable number', () => {
    // Both unions contain `failed` and both badges share a FRAKTAL row.
    const { unmount } = render(<StatusChip status="failed" />)
    expect(screen.getByText('Failed')).toBeTruthy()
    unmount()
    render(<QualityBadge quality="failed" reason="no sign change" />)
    expect(screen.getByText('Unusable')).toBeTruthy()
  })

  it('distinguishes a usable result from a finished job', () => {
    // A FRAKTAL analysis can complete and still be unusable; the two concepts
    // live in different components on purpose.
    render(<QualityBadge quality="converged" />)
    expect(screen.getByText('Converged')).toBeTruthy()
  })
})

describe('StatusDot', () => {
  it('carries its meaning as text for assistive technology', () => {
    render(<StatusDot tone="positive" label="Engine online" />)
    expect(screen.getByText('Engine online')).toBeTruthy()
  })

  it('exposes the same meaning on hover', () => {
    const { container } = render(<StatusDot tone="negative" label="Worker unreachable" />)
    expect(container.firstElementChild?.getAttribute('title')).toBe('Worker unreachable')
  })
})

describe('Callout', () => {
  it('pairs its tone with a title, so the state survives greyscale', () => {
    render(
      <Callout tone="warning" title="Small-N bias">
        For N = 100 the estimator under-reports Df.
      </Callout>,
    )
    expect(screen.getByText('Small-N bias')).toBeTruthy()
    expect(screen.getByText(/under-reports/)).toBeTruthy()
  })

  it('announces a danger callout as an alert', () => {
    render(<Callout tone="danger" title="Analysis failed" />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('does not announce an informational callout as an alert', () => {
    render(<Callout tone="info" title="Lengths in nm" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
