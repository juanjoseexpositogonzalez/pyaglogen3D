import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BatchSimulationForm } from '../BatchSimulationForm'

// ---------------------------------------------------------------------------
// T6 — R10.4, R10.5 and R10.6
//
// The backend learned in T4 which algorithms consume sintering and rejects the
// rest with 400. A form that keeps offering the option for `fracval` invites a
// request the server now refuses, and the batch page has no `onError`, so that
// refusal reads as a submit that did nothing.
// ---------------------------------------------------------------------------

/** The algorithm select is the first combobox; the parameter one is the last. */
function selectAlgorithm(value: string) {
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value } })
}

function addVariation() {
  fireEvent.click(screen.getByRole('button', { name: /add variation/i }))
}

/** The submit button is labelled with the projected count, and it is disabled
 * while that count is zero, so a variation must exist before submitting. */
function submit() {
  fireEvent.click(screen.getByRole('button', { name: /run \d+ simulation/i }))
}

function parameterOptions(): string[] {
  const selects = screen.getAllByRole('combobox')
  const paramSelect = selects[selects.length - 1] as HTMLSelectElement
  return Array.from(paramSelect.options).map((o) => o.value)
}

describe('R10.4 — the sintering option is offered only where the engine reads it', () => {
  it.each(['fracval', 'gcca', 'box_rfa'])(
    'does not offer it for %s',
    (algorithm) => {
      render(<BatchSimulationForm onSubmit={vi.fn()} />)
      selectAlgorithm(algorithm)
      addVariation()

      expect(parameterOptions()).not.toContain('sintering_config')
    },
  )

  it.each(['dla', 'cca', 'ballistic', 'ballistic_cc', 'tunable', 'tunable_cc'])(
    'offers it for %s',
    (algorithm) => {
      render(<BatchSimulationForm onSubmit={vi.fn()} />)
      selectAlgorithm(algorithm)
      addVariation()

      expect(parameterOptions()).toContain('sintering_config')
    },
  )
})

describe('R10.5 — the payload uses the shape R3 speaks', () => {
  it('submits distribution_type, never the selector mode key', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)
    selectAlgorithm('ballistic')
    addVariation()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'sintering_config' },
    })

    submit()

    expect(onSubmit).toHaveBeenCalled()
    const payload = onSubmit.mock.calls[0][0]
    const entries = payload.parameter_grid?.sintering_config
    expect(entries, 'the variation reached the payload').toBeTruthy()
    expect(entries[0]).toHaveProperty('distribution_type')
    expect(entries[0]).not.toHaveProperty('mode')
  })
})

describe('R10.6 — nothing submittable turns into NaN, null, or a rejected study', () => {
  it('omits the limiting base coefficient when the field is emptied', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)
    selectAlgorithm('limiting')
    addVariation()
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'sintering_coeff' },
    })

    const field = screen.getByLabelText(/base sintering coeff/i)
    fireEvent.change(field, { target: { value: '' } })

    submit()

    expect(onSubmit).toHaveBeenCalled()
    const base = onSubmit.mock.calls[0][0].base_parameters
    if ('sintering_coeff' in base) {
      expect(Number.isFinite(base.sintering_coeff)).toBe(true)
    }
  })

  it('does not carry a sintering variation into an algorithm that rejects it', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)
    selectAlgorithm('ballistic')
    addVariation()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'sintering_config' },
    })

    selectAlgorithm('fracval')
    submit()

    expect(onSubmit).toHaveBeenCalled()
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.parameter_grid?.sintering_config).toBeUndefined()
  })
})

describe('R10.6 — clearing a variation is not the same as hiding it', () => {
  it('tells the user which variation the new algorithm dropped', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)
    selectAlgorithm('ballistic')
    addVariation()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'sintering_config' },
    })

    selectAlgorithm('fracval')

    // R10.6 says cleared **or flagged**, "so the form cannot submit a payload
    // R11 rejects without telling the user why". Dropping it silently would
    // satisfy the payload half and fail the sentence.
    // Matching /fracval/i alone also hits the algorithm <option>; the notice
    // is the sentence, so that is what is asserted.
    expect(
      screen.getByText(/sintering_config was removed because fracval/i),
    ).toBeDefined()
  })

  it('says nothing when the switch drops nothing', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)
    selectAlgorithm('ballistic')
    addVariation()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'n_particles' },
    })

    selectAlgorithm('tunable_cc')

    expect(screen.queryByText(/no longer applies/i)).toBeNull()
  })
})

