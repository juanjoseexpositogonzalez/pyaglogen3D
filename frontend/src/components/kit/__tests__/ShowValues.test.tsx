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
