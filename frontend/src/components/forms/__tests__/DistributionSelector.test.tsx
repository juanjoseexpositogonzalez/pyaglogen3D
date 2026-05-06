import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  DistributionSelector,
  type DistributionValue,
} from '../DistributionSelector'

// ---------------------------------------------------------------------------
// P5.2 — DistributionSelector unit tests (PYA-15 Phase 5)
// ---------------------------------------------------------------------------

describe('DistributionSelector', () => {
  // -----------------------------------------------------------------------
  // Dropdown renders 3 modes with correct labels
  // -----------------------------------------------------------------------
  it('renders dropdown with 3 distribution modes', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'fixed', value: 1.0 }}
        onChange={onChange}
      />
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = Array.from(select.options)

    expect(options).toHaveLength(3)
    expect(options[0].textContent).toBe('Determinista')
    expect(options[1].textContent).toBe('Normal (μ, σ)')
    expect(options[2].textContent).toBe('Uniforme [min, max]')
  })

  it('renders the label text', () => {
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'fixed', value: 1.0 }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('dpo')).toBeDefined()
  })

  // -----------------------------------------------------------------------
  // Fixed mode: 1 input with current value
  // -----------------------------------------------------------------------
  it('renders 1 numeric input in fixed mode with correct value', () => {
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'fixed', value: 1.5 }}
        onChange={vi.fn()}
      />
    )

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].value).toBe('1.5')
  })

  // -----------------------------------------------------------------------
  // Normal mode: 2 inputs (mean, std) with correct values
  // -----------------------------------------------------------------------
  it('renders 2 numeric inputs in normal mode with correct values', () => {
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'normal', mean: 1.0, std: 0.1 }}
        onChange={vi.fn()}
      />
    )

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].value).toBe('1')
    expect(inputs[1].value).toBe('0.1')
  })

  // -----------------------------------------------------------------------
  // Uniform mode: 2 inputs (min, max) with correct values
  // -----------------------------------------------------------------------
  it('renders 2 numeric inputs in uniform mode with correct values', () => {
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'uniform', min: 0.8, max: 1.2 }}
        onChange={vi.fn()}
      />
    )

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].value).toBe('0.8')
    expect(inputs[1].value).toBe('1.2')
  })

  // -----------------------------------------------------------------------
  // Mode change: calls onChange with appropriate new shape
  // -----------------------------------------------------------------------
  it('switching from fixed to normal calls onChange with normal shape', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'fixed', value: 1.5 }}
        onChange={onChange}
      />
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'normal' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newVal = onChange.mock.calls[0][0] as DistributionValue
    expect(newVal.mode).toBe('normal')
    // Preserves value as mean
    expect((newVal as { mean: number }).mean).toBe(1.5)
    expect((newVal as { std: number }).std).toBeCloseTo(0.15) // 10% of mean
  })

  it('switching from fixed to uniform calls onChange with uniform shape', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'fixed', value: 2.0 }}
        onChange={onChange}
      />
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'uniform' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newVal = onChange.mock.calls[0][0] as DistributionValue
    expect(newVal.mode).toBe('uniform')
    expect((newVal as { min: number }).min).toBe(2.0)
    expect((newVal as { max: number }).max).toBe(2.0)
  })

  it('switching from normal to fixed preserves mean as value', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'normal', mean: 1.3, std: 0.1 }}
        onChange={onChange}
      />
    )

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'fixed' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newVal = onChange.mock.calls[0][0] as DistributionValue
    expect(newVal.mode).toBe('fixed')
    expect((newVal as { value: number }).value).toBe(1.3)
  })

  // -----------------------------------------------------------------------
  // Input change: calls onChange with updated value
  // -----------------------------------------------------------------------
  it('changing fixed value input calls onChange with new value', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'fixed', value: 1.0 }}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '2.5' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newVal = onChange.mock.calls[0][0] as DistributionValue
    expect(newVal).toEqual({ mode: 'fixed', value: 2.5 })
  })

  it('changing normal mean input calls onChange preserving std', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'normal', mean: 1.0, std: 0.1 }}
        onChange={onChange}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '1.5' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newVal = onChange.mock.calls[0][0] as DistributionValue
    expect(newVal).toEqual({ mode: 'normal', mean: 1.5, std: 0.1 })
  })

  it('changing uniform max input calls onChange preserving min', () => {
    const onChange = vi.fn()
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'uniform', min: 0.8, max: 1.2 }}
        onChange={onChange}
      />
    )

    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[1], { target: { value: '1.5' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newVal = onChange.mock.calls[0][0] as DistributionValue
    expect(newVal).toEqual({ mode: 'uniform', min: 0.8, max: 1.5 })
  })

  // -----------------------------------------------------------------------
  // disabled prop disables all controls
  // -----------------------------------------------------------------------
  it('disabled prop disables select and inputs', () => {
    render(
      <DistributionSelector
        label="dpo"
        value={{ mode: 'normal', mean: 1.0, std: 0.1 }}
        onChange={vi.fn()}
        disabled
      />
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.disabled).toBe(true)

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    for (const input of inputs) {
      expect(input.disabled).toBe(true)
    }
  })
})
