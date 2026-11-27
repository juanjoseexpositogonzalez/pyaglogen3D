import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getBoxCounting = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  simulationsApi: {
    getBoxCounting: (...args: unknown[]) => getBoxCounting(...args),
  },
}))

vi.mock('next/dynamic', () => ({
  default: () => function PlotStub() {
    return <div data-testid="plot" />
  },
}))

import { BoxCountingAnalysis } from '../BoxCountingAnalysis'

const result = {
  dimension: 2.1,
  r_squared: 0.99,
  std_error: 0.01,
  confidence_interval: [2.0, 2.2] as [number, number],
  log_scales: [0, 1, 2, 3, 4],
  log_values: [5, 4, 3, 2, 1],
  residuals: [0, 0, 0, 0, 0],
  linear_region_start: 1,
  execution_time_ms: 10,
  fit_window: [1, 4] as [number, number],
  window_source: 'legacy' as const,
}

describe('BoxCountingAnalysis fit-window attribution', () => {
  beforeEach(() => {
    getBoxCounting.mockReset()
    getBoxCounting.mockResolvedValue(result)
  })

  it('pairs a manually adjusted regression with the selected point window', async () => {
    render(<BoxCountingAnalysis projectId="project-1" simulationId="sim-1" />)

    fireEvent.click(screen.getByRole('button', { name: /run box-counting analysis/i }))

    await waitFor(() => {
      expect(screen.getByText('Fit window: [1, 4] · legacy')).toBeTruthy()
    })

    fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } })

    expect(screen.getByText('Fit window: [2, 4] · manual')).toBeTruthy()
    expect(screen.queryByText('Fit window: [1, 4] · legacy')).toBeNull()
  })

  it('keeps manual labels in effective coordinates for a truncated curve', async () => {
    getBoxCounting.mockResolvedValueOnce({
      ...result,
      effective_levels: 16,
      log_scales: [1, 2, 3, 4, 5],
      log_values: [5, 4, 3, 2, 1],
      residuals: [0, 0, 0, 0, 0],
      linear_region_start: 0,
      fit_window: [11, 15],
    })

    render(<BoxCountingAnalysis projectId="project-1" simulationId="sim-1" />)
    fireEvent.click(screen.getByRole('button', { name: /run box-counting analysis/i }))

    await waitFor(() => {
      expect(screen.getByText('Fit window: [11, 15] · legacy')).toBeTruthy()
    })

    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } })

    expect(screen.getByText('Fit window: [12, 15] · manual')).toBeTruthy()
  })
})
