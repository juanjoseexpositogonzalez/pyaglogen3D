/**
 * Tests for <StatusBadge /> — defensive rendering for unknown/missing status.
 *
 * Covers:
 *   - Known status values render with correct label
 *   - Unknown status (e.g. "empty") renders fallback without crashing
 *   - Undefined/null status renders "unknown" text as fallback
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { StatusBadge } from '../StatusBadge'

describe('<StatusBadge />', () => {
  it('renders a known status ("completed") with its configured label', () => {
    render(<StatusBadge status={'completed'} />)
    expect(screen.getByText('Completed')).toBeTruthy()
  })

  it('renders unknown status "empty" without crashing, using fallback', () => {
    // @ts-expect-error — intentionally passing unknown status
    render(<StatusBadge status={'empty'} />)
    // Should display the raw status text, not crash
    expect(screen.getByText('empty')).toBeTruthy()
  })

  it('renders unknown status "weird-status" without crashing, using fallback', () => {
    // @ts-expect-error — intentionally passing unknown status
    render(<StatusBadge status={'weird-status'} />)
    expect(screen.getByText('weird-status')).toBeTruthy()
  })

  it('renders undefined status as "unknown" fallback text', () => {
    // @ts-expect-error — intentionally passing undefined
    render(<StatusBadge status={undefined} />)
    expect(screen.getByText('unknown')).toBeTruthy()
  })
})
