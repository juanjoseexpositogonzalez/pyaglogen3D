/**
 * The stateful and ARIA-bearing primitives, which a blind review found were
 * precisely the ones with no test: SegmentedControl and VisualPanel were both
 * broken because nothing exercised them.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CopyText } from '../CopyText'
import { DataTable, type Column } from '../DataTable'
import { DisclosurePanel } from '../DisclosurePanel'
import { SegmentedControl } from '../SegmentedControl'
import { VisualPanel } from '../VisualPanel'

describe('SegmentedControl', () => {
  const options = [
    { value: 'box', label: 'Box counting' },
    { value: 'rg', label: 'Rg power law' },
    { value: 'sandbox', label: 'Sandbox' },
  ]

  function renderSubject(value = 'box') {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        options={options}
        value={value}
        onChange={onChange}
        ariaLabel="Estimator"
      />,
    )
    return onChange
  }

  it('announces itself and its selection', () => {
    renderSubject()
    expect(screen.getByRole('radiogroup', { name: 'Estimator' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Box counting' }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })

  it('keeps one tab stop for the whole group', () => {
    // Without a roving tabindex a six-option control costs six tab presses.
    renderSubject()
    const tabbable = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0].textContent).toBe('Box counting')
  })

  it('moves selection with the right arrow', () => {
    const onChange = renderSubject()
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Box counting' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('rg')
  })

  it('wraps around at the ends', () => {
    const onChange = renderSubject()
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Box counting' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('sandbox')
  })

  it('jumps to the ends with Home and End', () => {
    const onChange = renderSubject('rg')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Rg power law' }), { key: 'End' })
    expect(onChange).toHaveBeenCalledWith('sandbox')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Rg power law' }), { key: 'Home' })
    expect(onChange).toHaveBeenCalledWith('box')
  })

  it('selects on click as well', () => {
    const onChange = renderSubject()
    fireEvent.click(screen.getByRole('radio', { name: 'Sandbox' }))
    expect(onChange).toHaveBeenCalledWith('sandbox')
  })
})

describe('DisclosurePanel', () => {
  it('wires aria-expanded and aria-controls to the real region', () => {
    render(
      <DisclosurePanel title="Simulation parameters">
        <p>contents</p>
      </DisclosurePanel>,
    )

    const button = screen.getByRole('button', { name: /Simulation parameters/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')

    const id = button.getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(id as string)).not.toBeNull()
    expect(document.getElementById(id as string)?.hasAttribute('hidden')).toBe(true)
  })

  it('opens on click when uncontrolled', () => {
    render(
      <DisclosurePanel title="Advanced">
        <p>contents</p>
      </DisclosurePanel>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })

  it('obeys the parent when controlled, instead of its own state', () => {
    // This is the mode the component exists for: an error summary opening the
    // collapsed section it points into.
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <DisclosurePanel title="Advanced" open={false} onOpenChange={onOpenChange}>
        <p>contents</p>
      </DisclosurePanel>,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    // The parent has not re-rendered it yet, so it must stay closed.
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')

    rerender(
      <DisclosurePanel title="Advanced" open onOpenChange={onOpenChange}>
        <p>contents</p>
      </DisclosurePanel>,
    )
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })
})

describe('DataTable', () => {
  interface Row {
    id: string
    rg: number | null
  }
  const columns: Column<Row>[] = [
    { key: 'id', header: 'Run', value: (r) => r.id },
    { key: 'rg', header: 'Rg', numeric: true, unit: 'nm', digits: 1, value: (r) => r.rg },
  ]

  it('makes a scrolling table reachable by keyboard', () => {
    // A scrollable box with no focusable content strands every row below the
    // fold. ShowValues sets maxHeight by default, so this is the common case.
    const { container } = render(
      <DataTable columns={columns} rows={[{ id: 'r1', rg: 22.4 }]} maxHeight={200} caption="Runs" />,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('tabindex')).toBe('0')
    expect(region?.getAttribute('aria-label')).toBe('Runs')
  })

  it('adds no scroll affordance when the table is not capped', () => {
    const { container } = render(<DataTable columns={columns} rows={[{ id: 'r1', rg: 1 }]} />)
    expect(container.querySelector('[role="region"]')).toBeNull()
  })

  it('keeps the caption and the headers when there is nothing to show', () => {
    // Via ShowValues the caption is the only thing saying what the chart was.
    render(<DataTable columns={columns} rows={[]} caption="Rg against N" />)
    expect(screen.getByText('Rg against N')).toBeTruthy()
    expect(screen.getByText('Run')).toBeTruthy()
    expect(screen.getByText('No data.')).toBeTruthy()
  })

  it('renders a null numeric cell as an em dash, not as blank', () => {
    render(<DataTable columns={columns} rows={[{ id: 'r1', rg: null }]} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('CopyText', () => {
  it('reports the copy to assistive technology and restores itself', () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<CopyText label="Seed" value={48213} />)
    expect(screen.getByText('48213')).toBeTruthy()

    fireEvent.click(screen.getByRole('button'))
    expect(writeText).toHaveBeenCalledWith('48213')
    vi.useRealTimers()
  })

  it('survives a denied clipboard without interrupting the reader', () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.assign(navigator, { clipboard: { writeText } })

    render(<CopyText value="abc" />)
    fireEvent.click(screen.getByRole('button'))
    // The value stays on screen and selectable; nothing throws.
    expect(screen.getByText('abc')).toBeTruthy()
  })
})

describe('VisualPanel', () => {
  it('names its readouts and keeps the numbers selectable', () => {
    const { container } = render(
      <VisualPanel title="Aggregate" readouts={[{ label: 'Df', value: '2.533' }]}>
        <div />
      </VisualPanel>,
    )

    expect(screen.getByText('Df')).toBeTruthy()
    expect(screen.getByText('2.533')).toBeTruthy()
    // The bar ignores pointer events so the canvas stays usable, but the
    // readouts are the data and must remain copyable.
    expect(container.querySelector('.pointer-events-auto')).not.toBeNull()
  })

  it('uses whole colour tokens, never opacity modifiers', () => {
    // Tailwind cannot apply alpha to a var() colour and drops the utility
    // silently; that once left these labels at 1.28:1.
    const { container } = render(
      <VisualPanel readouts={[{ label: 'N', value: '512' }]}>
        <div />
      </VisualPanel>,
    )
    expect(container.innerHTML).not.toMatch(/text-ink-on-dark\//)
  })
})
