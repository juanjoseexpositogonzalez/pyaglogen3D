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
import { StatusChip } from '../StatusChip'
import { StatusDot } from '../StatusDot'

describe('StatusChip', () => {
  it('names every state in words', () => {
    const states = ['ready', 'running', 'queued', 'attention', 'error', 'cancelled'] as const
    states.forEach((state) => {
      const { unmount } = render(<StatusChip status={state} />)
      expect(screen.getByText(/\w/).textContent?.trim().length).toBeGreaterThan(0)
      unmount()
    })
  })

  it('uses words a researcher reads, not internal state names', () => {
    render(<StatusChip status="ready" />)
    expect(screen.getByText('Completed')).toBeTruthy()
  })

  it('marks a running job with the shimmer, which the stylesheet disables under reduced motion', () => {
    const { container } = render(<StatusChip status="running" />)
    expect(container.querySelector('.shimmer')).not.toBeNull()
  })

  it('leaves a finished job unanimated', () => {
    const { container } = render(<StatusChip status="ready" />)
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

  it('distinguishes a usable result from a finished job', () => {
    // A FRAKTAL analysis can complete and still be unusable; the two concepts
    // live in different components on purpose.
    render(<QualityBadge quality="good" />)
    expect(screen.getByText('Good')).toBeTruthy()
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
