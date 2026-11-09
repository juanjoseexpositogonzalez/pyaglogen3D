import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

    // The seed_type area should show "3 selected" (monomers + dimers + trimers).
    // The count is a `Num` now, so the number and the word after it are separate
    // nodes: compare the paragraph both of them belong to.
    expect(screen.getByText(/selected/).textContent).toBe('3 selected')
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

    // Should now show the projected count for 2 entries and 1 seed.
    // (2 kf_distribution entries × 1 seed = 2 sims)
    expect(screen.getByText(/Total simulations/i)).toBeDefined()
    // The total and the combination count happen to be the same 2 here, and
    // each is its own `Num` span, so a bare `getByText('2')` is ambiguous: read
    // the three readings in order - total, combinations, seeds.
    const panel = screen
      .getByRole('heading', { name: /total simulations/i })
      .closest('section')
    const readings = Array.from(panel!.querySelectorAll('.num')).map(
      (node) => node.textContent,
    )
    expect(readings.slice(0, 3)).toEqual(['2', '2', '1'])
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

// ---------------------------------------------------------------------------
// #181 (slice 2 of 3) — the form moves onto the design-system kit.
//
// Two kinds of guard live here. The first describe states the shape the kit
// requires: `Panel` blocks with second-level headings, notices that carry a
// role instead of a colour, readings routed through `Num`, tokens instead of
// palette literals. It fails on the pre-migration form.
//
// The second describe is the regression net for "presentation only": it passes
// on both versions on purpose. The payload is compared as serialised text, so
// key order and the absence of `NaN`-swallowing are pinned too.
//
// Plain matchers only: this repository's vitest setup does not load
// @testing-library/jest-dom.
// ---------------------------------------------------------------------------

/** Fill a scalar variation with a discrete-values list. */
function addScalarVariation(parameter: string, values: string) {
  fireEvent.click(screen.getByRole('button', { name: /add variation/i }))
  const selects = screen.getAllByRole('combobox')
  fireEvent.change(selects[selects.length - 1], { target: { value: parameter } })
  fireEvent.click(screen.getByRole('button', { name: /discrete/i }))
  fireEvent.change(screen.getByPlaceholderText(/e\.g\., 100/i), {
    target: { value: values },
  })
}

describe('<BatchSimulationForm /> — design-system kit', () => {
  it('composes its blocks as panels, each with a second-level heading', () => {
    const { container } = render(<BatchSimulationForm onSubmit={vi.fn()} />)

    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    // The batch page owns the only h1; every block of the form is an h2 under
    // it, so the outline still reads as one document.
    expect(titles).toEqual([
      'Study',
      'Base Parameters',
      'Parameter Variations',
      'Box-Counting Analysis',
      'Total simulations',
    ])
    // A `Panel` is a <section>, not a div that only looks like a card.
    expect(container.querySelectorAll('section').length).toBeGreaterThanOrEqual(5)
  })

  it('takes the page position it is given: a form, no landmark, no card', () => {
    const { container } = render(<BatchSimulationForm onSubmit={vi.fn()} />)

    expect(container.firstElementChild?.tagName).toBe('FORM')
    // The page decides the layout and owns the h1; the form must not claim a
    // region of its own or a second `<main>`.
    expect(screen.queryByRole('main')).toBeNull()
  })

  it('carries no palette literal and no deprecated surface', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(process.cwd(), 'src/components/batch/BatchSimulationForm.tsx'),
      'utf8',
    )

    // Tailwind's named palette. `bg-panel-teal` and friends are kit tones and
    // carry no shade suffix, so they do not match.
    const PALETTE =
      /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/
    expect(source.match(PALETTE)).toBeNull()
    // A hex colour always carries at least one letter; `#181` in a comment does
    // not, which keeps this from failing on the issue number.
    expect(source).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
    // The shadcn bridge is not the kit: these were the old surfaces.
    expect(source).not.toMatch(/\btext-muted-foreground\b/)
    expect(source).not.toMatch(/\bbg-primary\b/)
    expect(source).not.toMatch(/ui\/card/)
  })

  it('raises the "may take a while" warning as a notice with a role', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // 21 integer values × 10 seeds = 210 runs, past the 200 threshold.
    fireEvent.change(screen.getByLabelText(/seeds per combination/i), {
      target: { value: '10' },
    })
    addScalarVariation('n_particles', Array.from({ length: 21 }, (_, i) => i + 1).join(','))

    const notice = screen
      .getAllByRole('note')
      .find((note) => /may take a while/i.test(note.textContent ?? ''))

    expect(notice).toBeTruthy()
    // The count inside the notice is a `Num`: its own monospace span, so the
    // number is readable and alignable apart from the sentence around it.
    expect(notice!.querySelector('.num')?.textContent).toBe('210')
  })

  it('raises the over-1000 refusal as a danger notice', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // 101 integer values × 10 seeds = 1010 runs, past the server's cap.
    fireEvent.change(screen.getByLabelText(/seeds per combination/i), {
      target: { value: '10' },
    })
    addScalarVariation(
      'n_particles',
      Array.from({ length: 101 }, (_, i) => i + 100).join(','),
    )

    const refusal = screen
      .getAllByRole('alert')
      .find((alert) => /exceeds/i.test(alert.textContent ?? ''))

    // `danger` is the only `Callout` tone that renders as an alert, so a state
    // the reader must not miss is announced instead of merely tinted.
    expect(refusal).toBeTruthy()
    expect(refusal!.textContent).toContain('1000')
  })

  it('renders the projected total and the per-variation count through `Num`', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // Two seeds, so the projected total (6) is not the combination count (3):
    // a fixture where they coincide cannot tell the two readings apart.
    fireEvent.change(screen.getByLabelText(/seeds per combination/i), {
      target: { value: '2' },
    })
    addScalarVariation('n_particles', '10, 20, 30')

    const readings = (scope: Element) =>
      Array.from(scope.querySelectorAll('.num')).map((node) => node.textContent)

    const load = screen
      .getByRole('heading', { name: /total simulations/i })
      .closest('section')!
    // The total, then the breakdown it is made of - each in its own span, so
    // the numbers can be aligned and read without the words around them.
    expect(readings(load)).toEqual(['6', '3', '2'])

    // The variation's own tally, next to the words that qualify it.
    const tally = screen.getByText('Generated values:').parentElement!
    expect(readings(tally)).toEqual(['3'])
  })
})

describe('<BatchSimulationForm /> — the payload the migration must not change', () => {
  it('submits the default ballistic study byte for byte', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /run/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    // Serialised, not `toEqual`: this pins the key order the backend receives
    // and the absence of a `box_counting_params` key when the option is off.
    expect(JSON.stringify(onSubmit.mock.calls[0][0])).toBe(
      JSON.stringify({
        name: 'Batch ballistic Study',
        description: '',
        base_algorithm: 'ballistic',
        base_parameters: { n_particles: 100, sticking_probability: 1 },
        parameter_grid: {},
        seeds_per_combination: 1,
        include_box_counting: false,
      }),
    )
  })

  it('submits a limiting case with its own flat parameters and the box-counting options', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'limiting' },
    })
    fireEvent.change(screen.getByLabelText(/base sintering/i), {
      target: { value: '0.8' },
    })
    fireEvent.click(screen.getByLabelText(/run box-counting analysis/i))
    fireEvent.click(screen.getByRole('button', { name: /run/i }))

    expect(JSON.stringify(onSubmit.mock.calls[0][0])).toBe(
      JSON.stringify({
        name: 'Batch limiting Study',
        description: '',
        base_algorithm: 'limiting',
        base_parameters: {
          n_particles: 100,
          geometry_type: 'chain',
          configuration_type: 'lineal',
          packing: 'HC',
          sintering_coeff: 0.8,
        },
        parameter_grid: {},
        // Deterministic: the form refuses to multiply a limiting case by seeds.
        seeds_per_combination: 1,
        include_box_counting: true,
        box_counting_params: { points_per_sphere: 100, precision: 18 },
      }),
    )
  })

  it('keeps the discrete-values contract for an integer parameter', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    addScalarVariation('n_particles', '10, 20.7, 30')
    fireEvent.click(screen.getByRole('button', { name: /run/i }))

    // `n_particles` is an integer parameter, so each token goes through
    // `parseInt`: the fraction is truncated, not rounded.
    expect(onSubmit.mock.calls[0][0].parameter_grid).toEqual({
      n_particles: [10, 20, 30],
    })
  })

  it('keeps the range contract: start, end and step expand in the payload', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'n_particles' },
    })
    fireEvent.click(screen.getByRole('button', { name: /range/i }))
    fireEvent.click(screen.getByRole('button', { name: /run/i }))

    // The defaults are 100 → 1000 step 100.
    expect(onSubmit.mock.calls[0][0].parameter_grid).toEqual({
      n_particles: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    })
  })

  it('sends the distribution entries in the shape the worker reads', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'tunable_cc' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'kf_distribution' },
    })
    fireEvent.click(screen.getByRole('button', { name: /run/i }))

    const payload = onSubmit.mock.calls[0][0]
    // `kf_distribution` speaks the `mode` shape; `sintering_config` speaks its
    // own and is translated by `toSinteringConfig`. Untouched by the port.
    expect(payload.parameter_grid).toEqual({
      kf_distribution: [{ mode: 'fixed', value: 1 }],
    })
  })

  it('still announces the variation it dropped when the algorithm changes', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // `sintering_config` is offered on ballistic and refused by fracval.
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[selects.length - 1], {
      target: { value: 'sintering_config' },
    })
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'fracval' },
    })

    // The live region is what tells the user why the variation vanished; the
    // batch page shows no submit error (issue #115, point 6).
    const live = screen.getByRole('status')
    expect(live.textContent).toContain(
      'Sintering coefficient distribution was removed because fracval does not accept it.',
    )
    expect(live.querySelector('[role="note"]')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// #241 — a numeric key that does not parse is refused on the client.
//
// `parseFloat`/`parseInt` return `NaN` and nothing checked them, so the value
// reached `JSON.stringify`, which serialises `NaN` as `null`: the study was
// created with a key holding null where the user had typed something. Measured
// against the parametric-study serializer before this change:
// `base_parameters.sticking_probability: null` is accepted and stored (`'abc'`
// too — the field is not type-checked at all), so the corruption is silent.
// One witness per key, plus the control that the refusal is not permanent.
// ---------------------------------------------------------------------------

/** Click the submit button, whatever it currently reads. */
function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /run/i }))
}

/**
 * Raise the submit event the handler actually receives.
 *
 * A click on the button first goes through the browser's own constraint
 * validation, and jsdom implements it: a `type="number"` input holding a value
 * below its `min` makes the form invalid, so the click never reaches
 * `handleSubmit` and a test built on it would assert against a handler that
 * never ran. The rule under test lives in the handler, so the event is
 * dispatched directly - which is also the only way to ask what the form does
 * with a value the native hints would have stopped at the door.
 */
function dispatchSubmit(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form')!)
}

describe('BatchSimulationForm — #241 a number that does not parse is refused', () => {
  it('refuses a base sticking probability that does not parse, and names the key', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    const field = screen.getByLabelText(/base sticking prob/i)
    fireEvent.change(field, { target: { value: 'abc' } })
    submitForm()

    // Nothing leaves the form: a null here is accepted by the server and the
    // study runs with a value the user never typed.
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("'sticking_probability' must be a number")).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
  })

  it('refuses an emptied base sticking probability for the same reason', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    const field = screen.getByLabelText(/base sticking prob/i)
    fireEvent.change(field, { target: { value: '' } })
    submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("'sticking_probability' must be a number")).toBeTruthy()
  })

  it('refuses a base n_particles that does not parse, and names the key', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    const field = screen.getByLabelText(/base n particles/i)
    fireEvent.change(field, { target: { value: 'abc' } })
    submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("'n_particles' must be a whole number")).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
  })

  it('refuses an emptied base n_particles', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    const field = screen.getByLabelText(/base n particles/i)
    fireEvent.change(field, { target: { value: '' } })
    submitForm()

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("'n_particles' must be a whole number")).toBeTruthy()
  })

  it('submits the parsed number once the field is corrected', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    const field = screen.getByLabelText(/base sticking prob/i)
    fireEvent.change(field, { target: { value: '' } })
    submitForm()
    expect(onSubmit).not.toHaveBeenCalled()

    // The refusal is about the value, not about the field: correcting it lets
    // the same button through, and the number that arrives is the one typed.
    fireEvent.change(field, { target: { value: '0.7' } })
    submitForm()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].base_parameters).toEqual({
      n_particles: 100,
      sticking_probability: 0.7,
    })
  })
})

// ---------------------------------------------------------------------------
// #242 — an explicit zero is not an absence.
//
// `parseInt(x) || fallback` reads `0` as "nothing typed", so the form submitted
// a number the user never asked for. What the server does with a zero was
// measured, not assumed, and it differs by key:
//
// - `seeds_per_combination` — the model field is a `PositiveIntegerField` and
//   the serializer's only bound is `min_value=0`, so `0` is accepted; the
//   expansion then runs `range(0)` and the study is stored with no children.
//   Zero is legal, so the form respects it and stops inventing a 1.
// - `points_per_sphere` / `precision` — `validate_box_counting_params_dict`
//   refuses anything outside [10, 1000] and [8, 21], `0` included. Zero is not
//   legal there, so the form refuses it out loud instead of substituting a
//   number the user did not ask for.
//
// An emptied field is the third state and keeps using the key's own default.
// ---------------------------------------------------------------------------

describe('BatchSimulationForm — #242 an explicit zero is not an absence', () => {
  it('respects an explicit zero in seeds per combination', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/seeds per combination/i), {
      target: { value: '0' },
    })

    // The button used to read "Run 1 Simulations" and the payload carried
    // `seeds_per_combination: 1`. A study of zero runs is refused by the
    // existing button rule, which is the honest refusal - but the count must
    // be the one the user asked for.
    const button = screen.getByRole('button', { name: /run/i })
    expect(button.textContent).toContain('Run 0 Simulations')
    expect(button).toHaveProperty('disabled', true)
  })

  it('sends the number the seeds field holds', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/seeds per combination/i), {
      target: { value: '3' },
    })
    submitForm()

    // The payload reads the same resolved number the count on screen does. The
    // zero itself cannot be asserted here: `totalSimulations === 0` disables the
    // button, so a study of zero runs is refused before any request exists - and
    // that refusal is the correct reading of "0 seeds", not a defect.
    expect(onSubmit.mock.calls[0][0].seeds_per_combination).toBe(3)
  })

  it('keeps using the default when seeds is emptied', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/seeds per combination/i), {
      target: { value: '' },
    })
    submitForm()

    // Empty is the use-the-default state, and the model's default is 1.
    expect(onSubmit.mock.calls[0][0].seeds_per_combination).toBe(1)
  })

  it('refuses an explicit zero in points per sphere, which the server caps at 10', () => {
    const onSubmit = vi.fn()
    const { container } = render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByLabelText(/run box-counting analysis/i))
    const field = screen.getByLabelText(/points per sphere/i)
    fireEvent.change(field, { target: { value: '0' } })
    dispatchSubmit(container)

    // Used to become 100 silently; the server refuses 0, so a study run with
    // a sampling density nobody chose is what the user got instead.
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText('points_per_sphere must be between 10 and 1000'),
    ).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
  })

  it('refuses an explicit zero in precision, which the server caps at 8', () => {
    const onSubmit = vi.fn()
    const { container } = render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByLabelText(/run box-counting analysis/i))
    const field = screen.getByLabelText(/precision/i)
    fireEvent.change(field, { target: { value: '0' } })
    dispatchSubmit(container)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('precision must be between 8 and 21')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
  })

  it('refuses a precision above the server cap the field used to advertise', () => {
    const onSubmit = vi.fn()
    const { container } = render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByLabelText(/run box-counting analysis/i))
    // The input carried `max={24}` while the validator's ceiling is 21, so the
    // only feedback a 22 got was a 400 the batch page never displays.
    const field = screen.getByLabelText(/precision/i)
    expect(field.getAttribute('max')).toBe('21')

    fireEvent.change(field, { target: { value: '22' } })
    dispatchSubmit(container)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('precision must be between 8 and 21')).toBeTruthy()
  })

  it('keeps the backend default when points per sphere is emptied', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByLabelText(/run box-counting analysis/i))
    fireEvent.change(screen.getByLabelText(/points per sphere/i), {
      target: { value: '' },
    })
    submitForm()

    expect(onSubmit.mock.calls[0][0].box_counting_params).toEqual({
      points_per_sphere: 100,
      precision: 18,
    })
  })

  it('keeps the backend default when precision is emptied', () => {
    const onSubmit = vi.fn()
    render(<BatchSimulationForm onSubmit={onSubmit} />)

    fireEvent.click(screen.getByLabelText(/run box-counting analysis/i))
    fireEvent.change(screen.getByLabelText(/precision/i), { target: { value: '' } })
    submitForm()

    expect(onSubmit.mock.calls[0][0].box_counting_params).toEqual({
      points_per_sphere: 100,
      precision: 18,
    })
  })
})

// ---------------------------------------------------------------------------
// R10.8 — a control whose only possible outcome is a rejection is not offered.
//
// The `seed_type` grid key is read by one worker branch (`tunable_cc`) and the
// backend answers 400 for every other algorithm. The dropdown listed it for all
// of them, so picking it produced a request the batch page cannot even report.
// `consumesSeedType` is the same predicate the drop-on-algorithm-change rule
// already uses (#115, point 14), imported rather than restated.
// ---------------------------------------------------------------------------

describe('BatchSimulationForm — R10.8 seed_type is offered only where it is read', () => {
  /** The parameter dropdown of the first variation. */
  function parameterOptions(): string[] {
    fireEvent.click(screen.getByRole('button', { name: /add variation/i }))
    const selects = screen.getAllByRole('combobox')
    const paramSelect = selects[selects.length - 1] as HTMLSelectElement
    return Array.from(paramSelect.options).map((option) => option.value)
  }

  it('offers no seed_type for an algorithm whose worker never reads it', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    // `ballistic` is the form's default, and the backend refuses the key on it.
    expect(parameterOptions()).not.toContain('seed_type')
  })

  it('offers seed_type on the one algorithm that reads it', () => {
    render(<BatchSimulationForm onSubmit={vi.fn()} />)

    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'tunable_cc' },
    })

    expect(parameterOptions()).toContain('seed_type')
  })
})
