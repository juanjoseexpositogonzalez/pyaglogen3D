import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DistributionSelector } from '../DistributionSelector'

// ---------------------------------------------------------------------------
// R8.4 — "a red border and error message appear on that field" on blur.
//
// Measured before writing these: the component already accepted an `error`
// prop and painted it, but nobody passed one - no caller validates a
// distribution value - and the input had no border state at all. A study with
// `mean: -1` showed nothing until the submit came back 400, and the batch page
// does not display submit errors.
// ---------------------------------------------------------------------------

function selector(value: Record<string, unknown>) {
  return (
    <DistributionSelector
      label="#1"
      value={value as never}
      onChange={vi.fn()}
    />
  )
}

function inputs(): HTMLInputElement[] {
  return screen.getAllByRole('spinbutton') as HTMLInputElement[]
}

describe('R8.4 — an invalid value shows itself when the field loses focus', () => {
  it('marks the offending input and shows a message for a negative mean', () => {
    render(selector({ mode: 'normal', mean: -1, std: 0.1 }))

    fireEvent.blur(inputs()[0])

    const message = screen.getByRole('alert')
    expect(message.textContent).toMatch(/mean/i)
    const mean = inputs()[0]
    expect(mean.getAttribute('aria-invalid')).toBe('true')
    expect(mean.className).toMatch(/destructive/)
  })

  it('marks an inverted uniform on the bound that breaks the rule', () => {
    render(selector({ mode: 'uniform', min: 2, max: 1 }))

    fireEvent.blur(inputs()[1])

    expect(screen.getByRole('alert').textContent).toMatch(/min/i)
    expect(inputs()[1].getAttribute('aria-invalid')).toBe('true')
  })

  it('marks a non-positive deterministic value', () => {
    render(selector({ mode: 'fixed', value: 0 }))

    fireEvent.blur(inputs()[0])

    expect(screen.getByRole('alert').textContent).toMatch(/greater than 0/i)
    expect(inputs()[0].getAttribute('aria-invalid')).toBe('true')
  })

  it('says nothing when the value is valid', () => {
    render(selector({ mode: 'normal', mean: 1.3, std: 0.1 }))

    fireEvent.blur(inputs()[0])

    expect(screen.queryByRole('alert')).toBeNull()
    expect(inputs()[0].getAttribute('aria-invalid')).toBeNull()
  })

  it('clears the error as soon as the value is corrected', () => {
    const { rerender } = render(selector({ mode: 'normal', mean: -1, std: 0.1 }))
    fireEvent.blur(inputs()[0])
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(selector({ mode: 'normal', mean: 1.2, std: 0.1 }))

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
