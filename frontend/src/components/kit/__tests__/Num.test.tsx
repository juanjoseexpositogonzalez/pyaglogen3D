/**
 * Covers design-system-foundation R6: numbers render tabular and monospace,
 * and a unit is always a sibling element, never fused into the value.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Num, NumRange } from '../Num'

describe('Num', () => {
  it('keeps the unit in a sibling element, not inside the value', () => {
    const { container } = render(<Num value={68.4} unit="nm" digits={1} />)

    const value = container.querySelector('.num')
    const unit = container.querySelector('.num-unit')

    expect(value).not.toBeNull()
    expect(unit).not.toBeNull()
    expect(value?.textContent).toBe('68.4')
    expect(unit?.textContent).toBe('nm')
    // The value must not carry the unit: that is what breaks column alignment.
    expect(value?.textContent?.includes('nm')).toBe(false)
  })

  it('marks only the value as tabular monospace', () => {
    const { container } = render(<Num value={9.1} unit="nm" digits={1} />)
    const unit = container.querySelector('.num-unit')
    expect(unit?.classList.contains('num')).toBe(false)
  })

  it('renders uncertainty next to the value when given', () => {
    render(<Num value={2.533} sigma={0.041} digits={3} />)
    expect(screen.getByText('±0.041')).toBeTruthy()
    expect(screen.getByText('2.533')).toBeTruthy()
  })

  it('labels the uncertainty for assistive technology', () => {
    render(<Num value={2.533} sigma={0.041} digits={3} />)
    expect(screen.getByLabelText('standard deviation').textContent).toBe('±0.041')
  })

  it('renders an em dash rather than throwing on a null metric', () => {
    // Imported aggregates legitimately carry null metrics when a quantity
    // could not be computed; this must not surface as a client exception.
    render(<Num value={null} unit="nm" />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders an em dash for a non-finite value', () => {
    render(<Num value={Number.NaN} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('switches to exponential notation for very small magnitudes', () => {
    render(<Num value={0.00004} digits={2} />)
    expect(screen.getByText('4.00e-5')).toBeTruthy()
  })

  it('refuses to render a unit when there is no magnitude', () => {
    // `— nm` qualifies nothing. DetailList takes this path for every null
    // metric, so it is the common case, not an edge one.
    const { container } = render(<Num value={null} unit="nm" />)
    expect(container.querySelector('.num-unit')).toBeNull()
  })

  it('survives a digits value that toFixed would reject', () => {
    // `digits` reaches Num from column definitions that nothing validates;
    // toFixed throws a RangeError outside 0..100.
    render(<Num value={1.23456} digits={200} />)
    expect(screen.getByText(/1\.2/)).toBeTruthy()
  })

  it('renders a confidence interval through NumRange, not as a string', () => {
    // Num no longer accepts strings: that hole let a caller pass '68.4 nm'
    // and defeat the rule this primitive exists to impose.
    const { container } = render(<NumRange from={2.49} to={2.58} />)
    expect(screen.getByText('[2.49, 2.58]')).toBeTruthy()
    expect(container.querySelector('.num')).not.toBeNull()
  })

  it('omits the unit element entirely when there is no unit', () => {
    const { container } = render(<Num value={512} digits={0} />)
    expect(container.querySelector('.num-unit')).toBeNull()
  })
})
