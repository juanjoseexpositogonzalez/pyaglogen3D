import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SimulationForm } from '../SimulationForm'

// ---------------------------------------------------------------------------
// P5.3 + P5.4 + P5.5 — Distribution integration in SimulationForm (PYA-15)
// ---------------------------------------------------------------------------

/**
 * Helper: renders the form and selects an algorithm.
 */
function renderWithAlgorithm(algorithm: string) {
  const onSubmit = vi.fn()
  render(<SimulationForm onSubmit={onSubmit} />)

  const algorithmSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement
  fireEvent.change(algorithmSelect, { target: { value: algorithm } })

  return { onSubmit }
}

describe('SimulationForm — dpo distribution (PYA-15 P5.3-P5.5)', () => {
  // -----------------------------------------------------------------------
  // dpo selector: always visible for tunable_cc
  // -----------------------------------------------------------------------
  it('renders dpo distribution selector for tunable_cc algorithm', () => {
    renderWithAlgorithm('tunable_cc')

    // The label "dpo" should exist somewhere in the form
    expect(screen.getByText('dpo')).toBeDefined()

    // There should be a "Determinista" option in a combobox
    const selects = screen.getAllByRole('combobox')
    const dpoSelect = selects.find((s) => {
      const el = s as HTMLSelectElement
      return Array.from(el.options).some((o) => o.textContent === 'Determinista')
    })
    expect(dpoSelect).toBeDefined()
  })

  it('does NOT render dpo distribution selector for dla algorithm', () => {
    renderWithAlgorithm('dla')

    expect(screen.queryByText('dpo')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // target_kf selector: only visible for tunable_cc
  // -----------------------------------------------------------------------
  it('renders target_kf distribution selector for tunable_cc algorithm', () => {
    renderWithAlgorithm('tunable_cc')

    expect(screen.getByText('target_kf')).toBeDefined()
  })

  it('does NOT render target_kf distribution selector for tunable (PC) algorithm', () => {
    renderWithAlgorithm('tunable')

    expect(screen.queryByText('target_kf')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Default mode is fixed (Determinista)
  // -----------------------------------------------------------------------
  it('defaults to Determinista mode for dpo in tunable_cc', () => {
    renderWithAlgorithm('tunable_cc')

    // Find the distribution selects (mode dropdowns with "Determinista")
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const distSelects = selects.filter((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Determinista')
    )

    // All distribution selects should default to "fixed"
    for (const sel of distSelects) {
      expect(sel.value).toBe('fixed')
    }
  })

  // -----------------------------------------------------------------------
  // Payload includes dpo_distribution in correct shape
  // -----------------------------------------------------------------------
  it('payload includes dpo_distribution with fixed mode', async () => {
    const { onSubmit } = renderWithAlgorithm('tunable_cc')

    const submitBtn = screen.getByRole('button', { name: /run simulation/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.parameters.dpo_distribution).toBeDefined()
    expect(payload.parameters.dpo_distribution.mode).toBe('fixed')
    expect(typeof payload.parameters.dpo_distribution.value).toBe('number')
  })

  // -----------------------------------------------------------------------
  // Payload includes scalar radius_min/max when fixed mode (backward compat)
  // -----------------------------------------------------------------------
  it('payload includes scalar radius_min when dpo mode is fixed', async () => {
    const { onSubmit } = renderWithAlgorithm('tunable_cc')

    const submitBtn = screen.getByRole('button', { name: /run simulation/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    // In fixed mode, radius_min should be set for backward compat
    expect(payload.parameters.radius_min).toBeDefined()
    expect(typeof payload.parameters.radius_min).toBe('number')
  })

  // -----------------------------------------------------------------------
  // Payload includes target_kf_distribution when tunable_cc
  // -----------------------------------------------------------------------
  it('payload includes target_kf_distribution for tunable_cc', async () => {
    const { onSubmit } = renderWithAlgorithm('tunable_cc')

    const submitBtn = screen.getByRole('button', { name: /run simulation/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.parameters.target_kf_distribution).toBeDefined()
    expect(payload.parameters.target_kf_distribution.mode).toBe('fixed')
    expect(typeof payload.parameters.target_kf_distribution.value).toBe('number')
  })

  // -----------------------------------------------------------------------
  // Payload includes scalar target_kf when fixed mode (backward compat)
  // -----------------------------------------------------------------------
  it('payload includes scalar target_kf when kf mode is fixed', async () => {
    const { onSubmit } = renderWithAlgorithm('tunable_cc')

    const submitBtn = screen.getByRole('button', { name: /run simulation/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.parameters.target_kf).toBeDefined()
    expect(typeof payload.parameters.target_kf).toBe('number')
  })

  // -----------------------------------------------------------------------
  // dpo_distribution NOT included for non-tunable_cc algorithms
  // -----------------------------------------------------------------------
  it('payload does NOT include dpo_distribution for dla', async () => {
    const { onSubmit } = renderWithAlgorithm('dla')

    const submitBtn = screen.getByRole('button', { name: /run simulation/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.parameters.dpo_distribution).toBeUndefined()
  })
})
