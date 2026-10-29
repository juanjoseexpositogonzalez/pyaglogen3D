import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BatchResultsTable } from '../BatchResultsTable'
import type { ParametricStudyResults, ParametricStudyResult } from '@/lib/types'

// ---------------------------------------------------------------------------
// R13.3 — the varying-parameter column shows the configured VALUE.
//
// Measured before this module existed: the cell was `String(parameters[param])`,
// so every distribution key rendered `[object Object]` and the one thing the
// column exists to say - what this child was configured with - was a
// placeholder. The same defect lived in `formatConfigLabel`, which the
// FractalAnalysisTab witness caught; this is the other of the two views.
// ---------------------------------------------------------------------------

const KF = { mode: 'fixed', value: 1.9 }

const ROW: ParametricStudyResult = {
  simulation_id: 'sim-1',
  status: 'completed',
  parameters: { kf_distribution: KF, n_particles: 60 },
  seed: 42,
  execution_time_ms: 100,
  fractal_dimension: 1.82,
}

const DATA: ParametricStudyResults = {
  study_id: 'study-1',
  name: 'Study A',
  description: '',
  base_algorithm: 'tunable_cc',
  base_parameters: { n_particles: 60 },
  parameter_grid: { kf_distribution: [KF] },
  status: 'completed',
  progress: { total: 1, completed: 1, failed: 0, running: 0 },
  results: [ROW],
}

function renderTable() {
  return render(
    <BatchResultsTable
      data={DATA}
      projectId="proj-1"
      onExport={vi.fn()}
      onRefresh={vi.fn()}
    />,
  )
}

describe('BatchResultsTable — the varying-parameter column carries the value', () => {
  it('shows the declared value of a distribution key', () => {
    renderTable()

    const cell = screen.getByText((content) => content.includes('1.9'))
    expect(cell.textContent).not.toContain('[object Object]')
    expect(cell.textContent).toContain('1.9')
  })

  it('never renders a placeholder for a configured distribution', () => {
    renderTable()

    expect(screen.queryByText('[object Object]')).toBeNull()
  })
})
