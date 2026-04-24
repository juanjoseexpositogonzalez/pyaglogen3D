/**
 * Unit tests for <FraktalComparisonCard /> (T4.7, change:
 * fraktal-batch-analysis).
 *
 * The component is pure presentation — no state, no async — so the
 * assertions focus on:
 *   - all three metric cells render (R11)
 *   - the Sorensen footnote is surfaced as written by the backend
 *   - null sim_target_df degrades gracefully to "—"
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FraktalComparisonCard } from '../FraktalComparisonCard'
import type { FraktalBatchComparison } from '@/lib/api'

function makeComparison(
  overrides: Partial<FraktalBatchComparison> = {}
): FraktalBatchComparison {
  return {
    sim_id: 'some-uuid',
    sim_name: 'Test Sim',
    sim_target_df: 1.8,
    sim_box_counting_df: 1.82,
    batch_mean_df: 1.75,
    batch_std_df: 0.05,
    sorensen_note:
      'Note: 2D projection fractal dimension is systematically lower than the 3D aggregate Df (Sorensen 1992).',
    ...overrides,
  }
}

describe('<FraktalComparisonCard />', () => {
  it('renders the three metric labels (FRAKTAL mean, Sim target, Sim 3D box-counting)', () => {
    render(<FraktalComparisonCard comparison={makeComparison()} />)
    expect(screen.getByText(/FRAKTAL mean/i)).toBeTruthy()
    expect(screen.getByText(/Sim target/i)).toBeTruthy()
    expect(screen.getByText(/Sim 3D box-counting/i)).toBeTruthy()
  })

  it('renders the numeric values for each metric', () => {
    render(<FraktalComparisonCard comparison={makeComparison()} />)
    expect(screen.getByText('1.750')).toBeTruthy() // batch_mean_df
    expect(screen.getByText('1.800')).toBeTruthy() // sim_target_df
    expect(screen.getByText('1.820')).toBeTruthy() // sim_box_counting_df
  })

  it('surfaces the Sorensen note verbatim', () => {
    render(<FraktalComparisonCard comparison={makeComparison()} />)
    expect(screen.getByText(/Sorensen 1992/i)).toBeTruthy()
  })

  it('shows "—" when sim_target_df is null', () => {
    render(
      <FraktalComparisonCard
        comparison={makeComparison({ sim_target_df: null })}
      />
    )
    // The "—" sentinel appears in the sim_target cell. No other cell has
    // null-values in this fixture, so a single match is expected.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
