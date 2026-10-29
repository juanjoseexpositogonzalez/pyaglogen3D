/**
 * Unit tests for <QualityBadge /> (T5.1, fraktal-bisection-ux P5).
 *
 * Tests verify that each quality state renders the correct label text.
 * CSS class assertions are intentionally avoided (implementation detail).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QualityBadge } from '../QualityBadge'

describe('<QualityBadge />', () => {
  it('renders "Converged" label for quality=converged', () => {
    render(<QualityBadge quality="converged" />)
    expect(screen.getByText('Converged')).toBeTruthy()
  })

  it('renders "Approximate" label for quality=approximate', () => {
    render(<QualityBadge quality="approximate" />)
    expect(screen.getByText('Approximate')).toBeTruthy()
  })

  it('renders "Excluded" label for quality=excluded', () => {
    render(<QualityBadge quality="excluded" />)
    expect(screen.getByText('Excluded')).toBeTruthy()
  })

  it('renders "Failed" label for quality=failed', () => {
    render(<QualityBadge quality="failed" />)
    expect(screen.getByText('Failed')).toBeTruthy()
  })
})
