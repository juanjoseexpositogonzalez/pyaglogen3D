/**
 * Covers design-system-foundation R7: a chart or spatial view can be swapped
 * for the data behind it, in place, and the control is reachable by keyboard
 * and reports its own state.
 *
 * Driven with `fireEvent`, not `user-event`: this repository has
 * `@testing-library/react` and `/dom`, but not `@testing-library/user-event`,
 * and adding a dependency falls outside this change's editable surface.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Column } from '../DataTable'
import { ShowValues } from '../ShowValues'

interface Point {
  n: number
  rg: number
}

const columns: Column<Point>[] = [
  { key: 'n', header: 'N', numeric: true, digits: 0, value: (r) => r.n },
  { key: 'rg', header: 'Rg', numeric: true, unit: 'nm', digits: 1, value: (r) => r.rg },
]

const rows: Point[] = [
  { n: 64, rg: 22.4 },
  { n: 128, rg: 31.9 },
]

function Chart() {
  return <div data-testid="chart">chart</div>
}

function renderSubject(caption?: string) {
  return render(
    <ShowValues columns={columns} rows={rows} caption={caption}>
      <Chart />
    </ShowValues>,
  )
}

describe('ShowValues', () => {
  it('shows the visual first and the table only on request', () => {
    renderSubject()

    expect(screen.getByTestId('chart')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.queryByTestId('chart')).toBeNull()
  })

  it('renames itself so the control always says what it will do next', () => {
    renderSubject()
    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))
    expect(screen.getByRole('button', { name: 'Show chart' })).toBeTruthy()
  })

  it('reports its state through aria-pressed', () => {
    renderSubject()

    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('is a native button, so the keyboard reaches and activates it', () => {
    // A div with a click handler would pass the assertions above and still be
    // unreachable by keyboard; asserting the element type is what rules that
    // out in jsdom, which does not synthesise Enter into a click.
    renderSubject()

    const button = screen.getByRole('button')
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('tabindex')).toBeNull()

    button.focus()
    expect(document.activeElement).toBe(button)
  })

  it('renders every row of the underlying data', () => {
    renderSubject('Rg against N')

    fireEvent.click(screen.getByRole('button'))

    // one header row plus one row per data point
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1)
    expect(screen.getByText('Rg against N')).toBeTruthy()
    expect(screen.getByText('22.4')).toBeTruthy()
  })

  it('keeps the unit out of the value inside the table', () => {
    renderSubject()
    fireEvent.click(screen.getByRole('button'))

    const cell = screen.getByText('22.4')
    expect(cell.textContent).toBe('22.4')
    expect(cell.parentElement?.textContent).toContain('nm')
  })
})

/**
 * The render-prop form exists because the panel is the caller's: a component
 * that owns a boxed stage needs the toggle in its own header and the table
 * inside its own body, and laying both out here put them on either side of the
 * frame. Same primitive, same state, same table — the caller places the parts.
 */
describe('ShowValues driven by a render prop', () => {
  function Subject() {
    return (
      <ShowValues columns={columns} rows={rows} caption="Rg against N" maxHeight={200}>
        {({ toggle, table }) => (
          <section>
            <header data-testid="panel-header">{toggle}</header>
            <div data-testid="panel-body">{table ?? <Chart />}</div>
          </section>
        )}
      </ShowValues>
    )
  }

  it('hands over the control and the table, and a null table until it is used', () => {
    render(<Subject />)

    // Both parts reach the caller, and the body is the caller's own visual
    // while nothing has been asked for: no table is constructed eagerly.
    expect(screen.getByTestId('panel-header').querySelector('button')).toBeTruthy()
    expect(screen.getByTestId('panel-body').textContent).toBe('chart')
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show values' }))

    const table = screen.getByRole('table')
    expect(screen.getByTestId('panel-body').contains(table)).toBe(true)
    expect(screen.queryByTestId('chart')).toBeNull()
  })

  it('renders no layout of its own around the composition it is given', () => {
    const { container } = render(<Subject />)

    // Exactly one control: the primitive must not add a header row beside the
    // one the caller renders, which is the defect this form exists to fix.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(container.querySelectorAll('header')).toHaveLength(1)
  })

  it('configures the table it passes: columns, rows, caption and scrolling', () => {
    render(<Subject />)

    fireEvent.click(screen.getByRole('button'))

    // The caller supplies configuration and never assembles a DataTable, so
    // these four facts are the contract the primitive has to honour.
    expect(screen.getByRole('columnheader', { name: 'N' })).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1)
    expect(screen.getByText('Rg against N')).toBeTruthy()
    const region = screen.getByRole('region')
    expect(region.getAttribute('aria-label')).toBe('Rg against N')
    expect(region.getAttribute('tabindex')).toBe('0')
  })

  it('keeps the node form laying out header and body exactly as before', () => {
    // The old shape is not deprecated by the new one: a caller that passes a
    // node still gets the toggle rendered for it, in the primitive's own
    // right-aligned wrapper and *before* the visual in the document — the
    // wrapper and the order are the two things the render-prop form must not
    // have disturbed.
    const { container } = render(
      <ShowValues columns={columns} rows={rows} caption="Rg against N">
        <Chart />
      </ShowValues>,
    )

    const toggle = screen.getByRole('button', { name: 'Show values' })
    const chart = screen.getByTestId('chart')

    expect(container.querySelector('header')).toBeNull()
    expect(toggle.parentElement?.className).toContain('mb-2.5')
    expect(toggle.parentElement?.className).toContain('justify-end')
    expect(
      toggle.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(toggle)
    expect(screen.getByRole('table')).toBeTruthy()
  })
})
