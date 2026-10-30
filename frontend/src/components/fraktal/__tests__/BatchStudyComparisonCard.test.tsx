/**
 * Unit tests for <BatchStudyComparisonCard /> (R12, change:
 * fraktal-batch-extensions).
 *
 * The card REPLACES FraktalComparisonCard at the shared swap point
 * (R12.3): exactly one card and one Sorensen note per page, values from
 * the study_comparison block ONLY, note gated by show_sorensen_note.
 *
 * Note: this repo's vitest setup does NOT load @testing-library/jest-dom
 * (see src/test/setup.ts) — assertions use plain matchers.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { BatchStudyComparisonCard } from '../BatchStudyComparisonCard'
import type { FraktalStudyComparison } from '@/lib/api'

function makeStudyComparison(
  overrides: Partial<FraktalStudyComparison> = {}
): FraktalStudyComparison {
  return {
    sim_id: '6d0b7a41-1111-4222-8333-444455556666',
    images_with_df: 30,
    images_without_df: 2,
    image_df: {
      n: 30,
      mean: 1.805,
      median: 1.81,
      min: 1.7,
      max: 1.95,
      n_converged: 26,
      n_approximate: 4,
    },
    sim_df: { value: 2.42, target_df: 2.3 },
    mean_delta: -0.61,
    deltas: Array.from({ length: 30 }, () => -0.61),
    show_sorensen_note: true,
    ...overrides,
  }
}

describe('BatchStudyComparisonCard', () => {
  it('renders the population breakdown and image stats', () => {
    render(<BatchStudyComparisonCard studyComparison={makeStudyComparison()} />)

    expect(
      screen.getByTestId('study-comparison-images-with-df').textContent
    ).toContain('30')
    expect(
      screen.getByTestId('study-comparison-images-without-df').textContent
    ).toContain('2')
    expect(
      screen.getByTestId('study-comparison-image-mean').textContent
    ).toContain('1.805')
    expect(screen.getByTestId('study-comparison-image-mean').textContent).toContain(
      '1.805'
    )
    expect(screen.getByText(/26 converged · 4 approximate/)).toBeTruthy()
  })

  it('renders sim_df.value and target from the study_comparison block only', () => {
    render(<BatchStudyComparisonCard studyComparison={makeStudyComparison()} />)

    const simDf = screen.getByTestId('study-comparison-sim-df')
    expect(simDf.textContent).toContain('2.420')
    // The target is a reading too: value, then the word that names it, with
    // no unit to glue onto it.
    expect(simDf.textContent).toContain('target 2.300')
  })

  it('renders mean_delta', () => {
    render(<BatchStudyComparisonCard studyComparison={makeStudyComparison()} />)

    expect(screen.getByTestId('study-comparison-mean-delta').textContent).toContain(
      '-0.610'
    )
  })

  it('renders the Sorensen note EXACTLY ONCE (R12.3)', () => {
    render(<BatchStudyComparisonCard studyComparison={makeStudyComparison()} />)

    const notes = screen.getAllByTestId('study-comparison-sorensen-note')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toContain('Sorensen 1992')
  })

  it('renders no Sorensen note when show_sorensen_note is false', () => {
    render(
      <BatchStudyComparisonCard
        studyComparison={makeStudyComparison({ show_sorensen_note: false })}
      />
    )

    expect(screen.queryByTestId('study-comparison-sorensen-note')).toBeNull()
  })

  it('renders em dashes for null stats without crashing', () => {
    render(
      <BatchStudyComparisonCard
        studyComparison={makeStudyComparison({ mean_delta: null })}
      />
    )

    expect(screen.getByTestId('study-comparison-mean-delta').textContent).toContain(
      '—'
    )
  })

  it('names itself with a section heading the page outline can follow', () => {
    render(<BatchStudyComparisonCard studyComparison={makeStudyComparison()} />)

    // A card title painted as a div leaves the comparison invisible to a
    // reader navigating by headings.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Study Comparison' })
    ).toBeTruthy()
  })

  it('states the Sorensen note as a notice, not as loose prose', () => {
    render(<BatchStudyComparisonCard studyComparison={makeStudyComparison()} />)

    const note = screen.getByTestId('study-comparison-sorensen-note')
    const notice = note.querySelector('[role="note"]')
    expect(notice).toBeTruthy()
    expect(notice!.textContent).toContain('does NOT indicate simulation error')
  })
})
