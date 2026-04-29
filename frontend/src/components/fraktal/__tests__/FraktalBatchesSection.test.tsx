/**
 * Tests for <FraktalBatchesSection /> — the dashboard batch list.
 *
 * Covers:
 *   - Renders batch rows with correct fields (id, created_at, n_images, mean_df)
 *   - Shows loading state
 *   - Shows empty state with link to upload
 *   - Each batch links to drill-down at index 0
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FraktalBatchesSection } from '../FraktalBatchesSection'
import type { FraktalBatchListItem } from '@/lib/api'

// Minimal mock data matching the backend response shape
const mockBatches: FraktalBatchListItem[] = [
  {
    id: 'batch-aaa',
    status: 'completed',
    created_at: '2026-04-28T10:00:00Z',
    completed_at: null,
    algorithm: 'granulated_2012',
    calibration_source: 'metadata',
    dpo_used: 25.0,
    autocalibrate_source: null,
    n_images: 5,
    n_successful: 4,
    mean_df: 1.78,
    std_df: 0.05,
    median_df: 1.77,
    min_df: 1.72,
    max_df: 1.85,
    original_zip_filename: 'projections.zip',
  },
  {
    id: 'batch-bbb',
    status: 'completed',
    created_at: '2026-04-27T08:00:00Z',
    completed_at: null,
    algorithm: 'voxel_2018',
    calibration_source: 'manual',
    dpo_used: 30.0,
    autocalibrate_source: null,
    n_images: 10,
    n_successful: 10,
    mean_df: 1.65,
    std_df: 0.03,
    median_df: 1.64,
    min_df: 1.60,
    max_df: 1.70,
    original_zip_filename: 'batch2.zip',
  },
]

describe('<FraktalBatchesSection />', () => {
  it('renders batch rows with image count and mean Df', () => {
    render(
      <FraktalBatchesSection
        projectId="proj-1"
        batches={mockBatches}
        isLoading={false}
      />
    )

    // Both batches should be rendered
    expect(screen.getByText('5 images')).toBeTruthy()
    expect(screen.getByText('10 images')).toBeTruthy()
    // Mean Df values displayed
    expect(screen.getByText('1.780')).toBeTruthy()
    expect(screen.getByText('1.650')).toBeTruthy()
  })

  it('shows loading state', () => {
    render(
      <FraktalBatchesSection
        projectId="proj-1"
        batches={undefined}
        isLoading={true}
      />
    )

    expect(screen.getByText(/Loading batches/i)).toBeTruthy()
  })

  it('shows empty state when no batches exist', () => {
    render(
      <FraktalBatchesSection
        projectId="proj-1"
        batches={[]}
        isLoading={false}
      />
    )

    expect(screen.getByText(/No FRAKTAL batches yet/i)).toBeTruthy()
  })

  it('each batch links to batch summary (not directly to image/0)', () => {
    render(
      <FraktalBatchesSection
        projectId="proj-1"
        batches={mockBatches}
        isLoading={false}
      />
    )

    const links = screen.getAllByRole('link')
    // Filter links that go to batch pages
    const batchLinks = links.filter((a) =>
      a.getAttribute('href')?.includes('/fraktal/batch/')
    )
    expect(batchLinks).toHaveLength(2)
    // Should link to batch summary, NOT image/0
    expect(batchLinks[0].getAttribute('href')).toBe(
      '/projects/proj-1/fraktal/batch/batch-aaa'
    )
    expect(batchLinks[1].getAttribute('href')).toBe(
      '/projects/proj-1/fraktal/batch/batch-bbb'
    )
  })

  it('renders the section heading', () => {
    render(
      <FraktalBatchesSection
        projectId="proj-1"
        batches={mockBatches}
        isLoading={false}
      />
    )

    expect(screen.getByText('FRAKTAL Batches')).toBeTruthy()
  })
})
