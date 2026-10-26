/**
 * The in-app warning for batch studies that ran before sintering reached the
 * engine (#131).
 *
 * The point of this component is that the numbers beside it do not describe
 * the configuration beside them. So it has to say which study, say what the
 * difference is, and offer the relaunch only where a relaunch can actually
 * succeed.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SinteringWarning } from '../SinteringWarning'

const affected = {
  created_at: '2026-10-20T10:00:00Z',
  base_algorithm: 'tunable_cc' as const,
  sintering_config: { distribution_type: 'normal', mean: 0.8, std: 0.05 },
  total_simulations: 12,
}

describe('SinteringWarning', () => {
  it('says nothing when the study is unaffected', () => {
    const { container } = render(
      <SinteringWarning
        study={{ ...affected, created_at: '2026-11-01T00:00:00Z' }}
        onRelaunch={vi.fn()}
      />,
    )

    expect(container.textContent).toBe('')
  })

  it('warns that the saved results measured something else', () => {
    render(<SinteringWarning study={affected} onRelaunch={vi.fn()} />)

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText(/ran without sintering/i)).toBeTruthy()
  })

  it('offers the relaunch, saying how much work it starts', () => {
    const onRelaunch = vi.fn()
    render(<SinteringWarning study={affected} onRelaunch={onRelaunch} />)

    // Compute costs real time, so the count belongs on the control rather
    // than in a surprise afterwards.
    const button = screen.getByRole('button', { name: /relaunch 12 simulations/i })
    fireEvent.click(button)

    expect(onRelaunch).toHaveBeenCalledWith({
      distribution_type: 'normal',
      mean: 0.8,
      std: 0.05,
    })
  })

  it('withholds the relaunch when the stored config cannot be sent', () => {
    // Old rows can omit `std`, because nothing read it. The API rejects that,
    // and this page has no error handling: the button would die in silence.
    render(
      <SinteringWarning
        study={{ ...affected, sintering_config: { type: 'normal', mean: 0.8 } }}
        onRelaunch={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /relaunch/i })).toBeNull()
    expect(screen.getByText(/cannot be relaunched automatically/i)).toBeTruthy()
  })

  it('says something different when the algorithm never consumed sintering', () => {
    render(
      <SinteringWarning
        study={{ ...affected, base_algorithm: 'gcca' }}
        onRelaunch={vi.fn()}
      />,
    )

    // Not a corrected defect: this one never applied, so relaunching changes
    // nothing and offering it would mislead.
    expect(screen.getByText(/never applies sintering/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /relaunch/i })).toBeNull()
  })

  it('trusts the children over the date when they are loaded', () => {
    // A study created after the cutoff whose children still carry the key is
    // affected: the key is a fact, the date an inference.
    render(
      <SinteringWarning
        study={{ ...affected, created_at: '2026-11-01T00:00:00Z' }}
        childResults={[{ parameters: { sintering_mean: 0.8 } }]}
        onRelaunch={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toBeTruthy()
  })
})
