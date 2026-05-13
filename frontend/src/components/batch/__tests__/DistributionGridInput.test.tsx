import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DistributionGridInput } from '../DistributionGridInput'
import type { DistributionValue } from '@/lib/types'

// ---------------------------------------------------------------------------
// Phase 5 — DistributionGridInput unit tests
// ---------------------------------------------------------------------------

describe('DistributionGridInput', () => {
  // T5.2 — renders array of DistributionSelector instances
  it('renders one DistributionSelector per entry in value array', () => {
    const values: DistributionValue[] = [
      { mode: 'fixed', value: 1.0 },
      { mode: 'normal', mean: 1.5, std: 0.1 },
    ]

    render(
      <DistributionGridInput
        value={values}
        onChange={vi.fn()}
        label="kf Distribution"
      />
    )

    // Each DistributionSelector renders a combobox
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)
  })

  it('renders the label text', () => {
    render(
      <DistributionGridInput
        value={[{ mode: 'fixed', value: 1.0 }]}
        onChange={vi.fn()}
        label="kf Distribution"
      />
    )

    expect(screen.getByText('kf Distribution')).toBeDefined()
  })

  // T5.3 — "+ Add" appends entry
  it('"+ Add" button appends a new entry and calls onChange', () => {
    const onChange = vi.fn()
    const initial: DistributionValue[] = [{ mode: 'fixed', value: 1.0 }]

    render(
      <DistributionGridInput
        value={initial}
        onChange={onChange}
        label="kf Distribution"
      />
    )

    const addButton = screen.getByRole('button', { name: /add/i })
    fireEvent.click(addButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    const newArray = onChange.mock.calls[0][0] as DistributionValue[]
    expect(newArray).toHaveLength(2)
    // New entry should be a fixed default
    expect(newArray[1].mode).toBe('fixed')
  })

  // T5.4 — trash icon removes entry
  it('trash button removes entry and calls onChange', () => {
    const onChange = vi.fn()
    const values: DistributionValue[] = [
      { mode: 'fixed', value: 1.0 },
      { mode: 'normal', mean: 2.0, std: 0.2 },
    ]

    render(
      <DistributionGridInput
        value={values}
        onChange={onChange}
        label="kf Distribution"
      />
    )

    // There should be 2 remove buttons
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    expect(removeButtons).toHaveLength(2)

    fireEvent.click(removeButtons[0])

    expect(onChange).toHaveBeenCalledTimes(1)
    const newArray = onChange.mock.calls[0][0] as DistributionValue[]
    expect(newArray).toHaveLength(1)
    expect(newArray[0]).toEqual({ mode: 'normal', mean: 2.0, std: 0.2 })
  })

  // T5.5 — min 1 enforced: remove button hidden when only 1 entry
  it('hides remove button when only 1 entry (min 1 enforced)', () => {
    render(
      <DistributionGridInput
        value={[{ mode: 'fixed', value: 1.0 }]}
        onChange={vi.fn()}
        label="kf Distribution"
      />
    )

    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })

  // T5.6 — onChange emits updated array when child changes
  it('onChange emits updated array when a child DistributionSelector changes', () => {
    const onChange = vi.fn()
    const values: DistributionValue[] = [
      { mode: 'fixed', value: 1.0 },
      { mode: 'fixed', value: 2.0 },
    ]

    render(
      <DistributionGridInput
        value={values}
        onChange={onChange}
        label="kf Distribution"
      />
    )

    // Change the second entry's value input
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[1], { target: { value: '3.5' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const newArray = onChange.mock.calls[0][0] as DistributionValue[]
    expect(newArray).toHaveLength(2)
    expect(newArray[0]).toEqual({ mode: 'fixed', value: 1.0 }) // unchanged
    expect(newArray[1]).toEqual({ mode: 'fixed', value: 3.5 }) // updated
  })

  // T5.7 — passes allowedTypes to children
  it('passes allowedTypes to child DistributionSelectors', () => {
    render(
      <DistributionGridInput
        value={[{ mode: 'fixed', value: 1.0 }]}
        onChange={vi.fn()}
        label="particle radius"
        allowedTypes={['fixed', 'normal']}
      />
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = Array.from(select.options)
    expect(options).toHaveLength(2)
    expect(options.map(o => o.value)).toEqual(['fixed', 'normal'])
  })
})
