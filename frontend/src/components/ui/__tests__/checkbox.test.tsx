/**
 * Regression tests for `<Checkbox>` (hotfix batch — stale-tick bug).
 *
 * The checkbox used on the project page is a native `<input type="checkbox">`
 * wrapped to expose the shadcn-style `checked` + `onCheckedChange` API.
 *
 * The reported bug was visual: clicking a row's checkbox wouldn't show the
 * tick until *another* row's checkbox was clicked. Root cause on the
 * project page was `onClick={(e) => e.preventDefault()}` on the Checkbox,
 * which cancelled the browser's native toggle before React's controlled
 * state update re-rendered with the new `checked` value.
 *
 * These tests lock in the component's contract so the Checkbox itself
 * can't silently regress: given a controlled `checked` prop and an
 * `onCheckedChange` handler, a user click must fire exactly one change
 * with the toggled value.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { Checkbox } from '../checkbox'

describe('<Checkbox />', () => {
  it('fires onCheckedChange with the toggled value when clicked (unchecked → checked)', () => {
    const handleChange = vi.fn()
    render(
      <Checkbox
        aria-label="test"
        checked={false}
        onCheckedChange={handleChange}
      />,
    )

    fireEvent.click(screen.getByLabelText('test'))
    expect(handleChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith(true)
  })

  it('fires onCheckedChange with false when clicked while checked', () => {
    const handleChange = vi.fn()
    render(
      <Checkbox
        aria-label="test"
        checked={true}
        onCheckedChange={handleChange}
      />,
    )

    fireEvent.click(screen.getByLabelText('test'))
    expect(handleChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith(false)
  })

  it('reflects the updated checked prop immediately after controlled state change (no stale tick)', () => {
    // This simulates the project page's usage: a parent owns the selection
    // state and updates it in response to `onCheckedChange`. The checkbox's
    // visible `checked` state must match the prop on the very next render —
    // i.e. one click = one visual flip, not two.
    function Host() {
      const [checked, setChecked] = useState(false)
      return (
        <Checkbox
          aria-label="host"
          checked={checked}
          onCheckedChange={setChecked}
        />
      )
    }

    render(<Host />)
    const input = screen.getByLabelText('host') as HTMLInputElement

    expect(input.checked).toBe(false)
    fireEvent.click(input)
    expect(input.checked).toBe(true)
    fireEvent.click(input)
    expect(input.checked).toBe(false)
  })

  it('honors the disabled attribute on the underlying input', () => {
    // jsdom's synthetic click fires through the disabled guard, so we
    // assert the attribute rather than the handler. Real browsers swallow
    // the click natively.
    render(
      <Checkbox
        aria-label="disabled"
        checked={false}
        disabled
        onCheckedChange={() => {}}
      />,
    )

    const input = screen.getByLabelText('disabled') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })
})
