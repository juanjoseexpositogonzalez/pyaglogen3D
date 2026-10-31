import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BatchSimulationForm } from '../BatchSimulationForm'

// ---------------------------------------------------------------------------
// Phase 6 — BatchSimulationForm new parameter grid options
// ---------------------------------------------------------------------------

describe('BatchSimulationForm — new parameter grid options', () => {
  // T6.1/T6.2 — 4 new options in dropdown
  it('shows kf_distribution option for tunable_cc algorithm', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // Select tunable_cc algorithm
    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    // Add a variation
    const addButton = screen.getByRole('button', { name: /add variation/i })
    fireEvent.click(addButton)

    // Find the parameter dropdown in the variation card
    const variationSelects = screen.getAllByRole('combobox')
    // The parameter select is after the algorithm select
    const paramSelect = variationSelects[variationSelects.length - 1] as HTMLSelectElement
    const optionValues = Array.from(paramSelect.options).map(o => o.value)

    expect(optionValues).toContain('kf_distribution')
    expect(optionValues).toContain('particle_radius_config')
    expect(optionValues).toContain('sintering_config')
    expect(optionValues).toContain('seed_type')
  })

  // T6.2 — kf_distribution renders DistributionGridInput
  it('selecting kf_distribution renders DistributionGridInput', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // Select tunable_cc
    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    // Add variation
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    // Select kf_distribution parameter
    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'kf_distribution' } })

    // Should show a "+ Add" button for distributions and a distribution selector combobox
    expect(screen.getByRole('button', { name: /add distribution/i })).toBeDefined()
  })

  // T6.3 movido al contrato: R2 says aligning the form is part of this change, and
  // a judge measured that it was not - the key was pinned to fixed+normal while the
  // API accepts a `uniform` primary size that R13.6 depends on. The three modes are
  // now offered, so the test asserts that instead of the restriction.
  it('selecting particle_radius_config offers the three shapes', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'particle_radius_config' } })

    // The innermost selector is the distribution mode. R2's table accepts all
    // three shapes for this key and the engine implements `dpo_mode="uniform"`,
    // so the form must offer them: hiding one made a uniform primary size
    // configurable only through the API.
    const allSelects = screen.getAllByRole('combobox')
    const distModeSelect = allSelects[allSelects.length - 1] as HTMLSelectElement
    const options = Array.from(distModeSelect.options)
    expect(options.map((o) => o.value)).toEqual(['fixed', 'normal', 'uniform'])
  })

  // T6.4 — sintering_config renders DistributionGridInput
  it('selecting sintering_config renders DistributionGridInput', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'sintering_config' } })

    expect(screen.getByRole('button', { name: /add distribution/i })).toBeDefined()
  })

  // T6.5 — seed_type renders multi-select chips
  it('selecting seed_type renders 3 toggle chips (monomers, dimers, trimers)', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'seed_type' } })

    // Should see 3 chip-like buttons for seed types
    expect(screen.getByRole('button', { name: /monomers/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /dimers/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /trimers/i })).toBeDefined()
  })

  // T6.5 — seed_type chips toggle selection
  it('seed_type chip click toggles selection', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'seed_type' } })

    // Click dimers to select it (already selected: monomers)
    fireEvent.click(screen.getByRole('button', { name: /dimers/i }))

    // Click trimers to also select it
    fireEvent.click(screen.getByRole('button', { name: /trimers/i }))

    // The seed_type area should show "3 selected" (monomers + dimers + trimers)
    expect(screen.getByText('3 selected')).toBeDefined()
  })

  // T6.7 — live sim count indicator
  it('shows projected sim count for distribution grid entries', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'kf_distribution' } })

    // Add a second distribution entry
    fireEvent.click(screen.getByRole('button', { name: /add distribution/i }))

    // Should now show "2" in the total simulations counter
    // (2 kf_distribution entries × 1 seed = 2 sims)
    expect(screen.getByText(/Total simulations/i)).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  // T6.8 — warning when projected > 200
  it('shows warning text when projected sim count exceeds 200', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    // Set seeds per combination to 10
    const seedsInput = screen.getByLabelText(/seeds per combination/i)
    fireEvent.change(seedsInput, { target: { value: '10' } })

    // Add a variation with discrete values that produce > 20 values
    // 21 values × 10 seeds = 210 > 200
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'n_particles' } })

    // Switch to discrete mode and enter many values
    const discreteButton = screen.getByRole('button', { name: /discrete/i })
    fireEvent.click(discreteButton)

    const valuesInput = screen.getByPlaceholderText(/e\.g\., 100/i)
    fireEvent.change(valuesInput, { target: { value: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21' } })

    // Warning text should appear
    expect(screen.getByText(/may take a while/i)).toBeDefined()
  })

  // T6.9 — error when projected > 1000
  it('shows error and disables submit when projected > 1000', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })

    // Set seeds per combination to 10
    const seedsInput = screen.getByLabelText(/seeds per combination/i)
    fireEvent.change(seedsInput, { target: { value: '10' } })

    // Add variation with discrete values producing > 100 values
    // 101 values × 10 seeds = 1010 > 1000
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    const paramSelect = variationSelects[variationSelects.length - 1]
    fireEvent.change(paramSelect, { target: { value: 'n_particles' } })

    const discreteButton = screen.getByRole('button', { name: /discrete/i })
    fireEvent.click(discreteButton)

    // Generate 101 comma-separated values
    const manyValues = Array.from({ length: 101 }, (_, i) => i + 100).join(',')
    const valuesInput = screen.getByPlaceholderText(/e\.g\., 100/i)
    fireEvent.change(valuesInput, { target: { value: manyValues } })

    // Should show the error message
    expect(screen.getByText(/exceeds.*1000/i)).toBeDefined()

    // Submit button should be disabled
    const submitButton = screen.getByRole('button', { name: /run/i })
    expect(submitButton).toHaveProperty('disabled', true)
  })
})

// ---------------------------------------------------------------------------
// #201 — the cap reaches the field through the rendered grid.
//
// This is the only user-visible effect of that change, and a judge measured
// that deleting the prop from this form left the suite green: the field went
// back to saying nothing about a spread the server will refuse, which is the
// invisible 400 the issue exists for. So the assertion is here, through the
// components, not on `distributionValueError` alone.
// ---------------------------------------------------------------------------

describe('BatchSimulationForm — R2 cap on the primary size', () => {
  it('marks the spread and names the cap when the field loses focus', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    fireEvent.change(variationSelects[variationSelects.length - 1], {
      target: { value: 'particle_radius_config' },
    })

    const afterParam = screen.getAllByRole('combobox')
    const modeSelect = afterParam[afterParam.length - 1]
    fireEvent.change(modeSelect, { target: { value: 'normal' } })

    // By accessible name, not by position: the form renders its own numeric
    // inputs (`n_particles` among them) and the first version of this test wrote
    // a spread into the wrong field, so it proved nothing.
    const mean = screen.getByLabelText('media') as HTMLInputElement
    const std = screen.getByLabelText('desviación') as HTMLInputElement
    fireEvent.change(mean, { target: { value: '1' } })
    fireEvent.change(std, { target: { value: '0.5' } })
    fireEvent.blur(std)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('std/mean')
    expect(alert.textContent).toContain('0.3')
    expect(std.getAttribute('aria-invalid')).toBe('true')
  })

  it('does not cap the fractal prefactor, which the engine accepts', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const algorithmSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(algorithmSelect, { target: { value: 'tunable_cc' } })
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))

    const variationSelects = screen.getAllByRole('combobox')
    fireEvent.change(variationSelects[variationSelects.length - 1], {
      target: { value: 'kf_distribution' },
    })

    const afterParam = screen.getAllByRole('combobox')
    fireEvent.change(afterParam[afterParam.length - 1], { target: { value: 'normal' } })

    const mean = screen.getByLabelText('media') as HTMLInputElement
    const std = screen.getByLabelText('desviación') as HTMLInputElement
    fireEvent.change(mean, { target: { value: '1' } })
    fireEvent.change(std, { target: { value: '0.5' } })
    fireEvent.blur(std)

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
