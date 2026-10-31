/**
 * Unit tests for <FraktalResultsView />: the CSV download (T6.4, change
 * fraktal-download-and-csv) and the migration onto the design-system kit
 * (issue #176, slice 2 of 3).
 *
 * The component has many dependencies (fraktalApi calls, blob URLs, polling).
 * The CSV tests are the behaviour the original file was written for; the
 * migration tests assert what a reader can perceive — the reading, its unit as
 * a separate element, the row a table paints, the notice a failure becomes —
 * rather than which components were imported, because an import assertion
 * passes a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// Hoist mocks
const { mockDownloadSingleCsv, mockGetOriginalImage, mockGet, mockCreate } = vi.hoisted(
  () => ({
    mockDownloadSingleCsv: vi.fn(),
    mockGetOriginalImage: vi.fn(),
    mockGet: vi.fn(),
    mockCreate: vi.fn(),
  })
)

vi.mock('@/lib/api', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    fraktalApi: {
      ...(actual.fraktalApi ?? {}),
      downloadSingleCsv: mockDownloadSingleCsv,
      getOriginalImage: mockGetOriginalImage,
      get: mockGet,
      create: mockCreate,
    },
  }
})

import { FraktalResultsView } from '../FraktalResultsView'
import type { FraktalAnalysis, FraktalResults } from '@/lib/types'

const BASE_RESULTS: FraktalResults = {
  status: 'completed',
  model: 'granulated_2012',
  df: 1.72,
  kf: 1.31,
  zf: 0.5,
  rg: 120,
  ap: 45000,
  jf: null,
  volume: 100000,
  surface_area: 80000,
  mass: 0.5,
  npo: 48,
  npo_visual: 50,
  npo_aligned: true,
  npo_ratio: 0.96,
  dpo_estimated: 25,
  calibration_attempts: [],
}

function makeAnalysis(
  overrides: Partial<FraktalAnalysis> = {}
): FraktalAnalysis {
  return {
    id: 'analysis-123',
    project: 'proj-1',
    created_at: '2026-04-01T12:00:00Z',
    completed_at: '2026-04-01T12:00:05Z',
    status: 'completed',
    model: 'granulated_2012',
    source_type: 'uploaded_image',
    original_filename: 'test.png',
    original_content_type: 'image/png',
    npix: 500,
    escala: 10,
    dpo: 25,
    delta: 1,
    correction_3d: false,
    pixel_min: 0,
    pixel_max: 255,
    npo_limit: 100,
    execution_time_ms: 150,
    engine_version: '1.0.0',
    error_message: null,
    projection_params: null,
    auto_calibrate: false,
    m_exponent: null,
    results: BASE_RESULTS,
    ...overrides,
  } as FraktalAnalysis
}

const PROJECT_ID = 'proj-1'

/** The analysis with an auto-calibration sweep the engine picked a winner in. */
const calibratedAnalysis = (): FraktalAnalysis =>
  makeAnalysis({
    results: {
      ...BASE_RESULTS,
      npo_aligned: false,
      npo_visual: 50,
      npo_ratio: 3.4,
      dpo_estimated: 44.4,
      best_dpo: 25,
      calibration_attempts: [
        { dpo: 20, npo: 40, npo_ratio: 0.8, npo_aligned: false },
        { dpo: 25, npo: 50, npo_ratio: 1, npo_aligned: true },
        { dpo: 30, npo: 61, npo_ratio: 1.22, npo_aligned: false },
      ],
    },
  })

describe('<FraktalResultsView /> CSV download (T6.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Prevent the original image useEffect from hanging
    mockGetOriginalImage.mockRejectedValue(new Error('not available'))
  })

  it('renders a Download CSV button for a completed analysis', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis()}
        projectId={PROJECT_ID}
      />
    )
    expect(
      screen.getByRole('button', { name: /download csv/i })
    ).toBeTruthy()
  })

  it('calls downloadSingleCsv with correct projectId and analysisId on click', async () => {
    mockDownloadSingleCsv.mockResolvedValue(new Blob(['csv data']))
    const mockCreateObjectURL = vi.fn(() => 'blob:test')
    const mockRevokeObjectURL = vi.fn()
    globalThis.URL.createObjectURL = mockCreateObjectURL
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL

    render(
      <FraktalResultsView
        analysis={makeAnalysis()}
        projectId={PROJECT_ID}
      />
    )
    const btn = screen.getByRole('button', { name: /download csv/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockDownloadSingleCsv).toHaveBeenCalledWith(
        PROJECT_ID,
        'analysis-123'
      )
    })
  })

  it('does not render Download CSV button for non-completed analysis', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({ status: 'running', results: null })}
        projectId={PROJECT_ID}
      />
    )
    expect(
      screen.queryByRole('button', { name: /download csv/i })
    ).toBeNull()
  })
})

describe('<FraktalResultsView /> on the design-system kit (issue #176)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOriginalImage.mockRejectedValue(new Error('not available'))
  })

  it('renders a reading and its unit as two elements, never one string', () => {
    render(<FraktalResultsView analysis={makeAnalysis()} projectId={PROJECT_ID} />)

    const label = screen.getByText('Radius of Gyration (Rg)')
    const reading = label.parentElement?.querySelector('dd')
    expect(reading).toBeTruthy()

    // The number and the unit are separate nodes: a column of readings stays
    // scannable and the tabular width does not pad the unit.
    const number = reading!.querySelector('.num')
    const unit = reading!.querySelector('.num-unit')
    expect(number?.textContent).toBe('120.00')
    expect(unit?.textContent).toBe('nm')

    // The regression this guards is `${value}${unit}` interpolated into a
    // single span: it leaves `.num-unit` empty and glues the unit into the
    // number's own element. Comparing `textContent` to "120.00 nm" would not
    // see it — the DOM never holds that space, the gap is CSS — so the guard
    // has to read the number element on its own.
    expect(number!.textContent).not.toContain('nm')
  })

  it('keeps a panel reading larger than the label that names it', () => {
    render(<FraktalResultsView analysis={makeAnalysis()} projectId={PROJECT_ID} />)

    // Rg, Ap, Volume, Surface Area and Mass are the figures a researcher
    // copies out. Rendered at the label's own 11px they stop reading as
    // readings, which is what `size="sm"` on every Readout produced.
    const number = screen
      .getByText('Radius of Gyration (Rg)')
      .parentElement!.querySelector('.num')
    expect(number!.className).not.toContain('text-[11px]')
    expect(number!.className).toContain('text-[29px]')
  })

  it("states a failed run's own message as the alert body", () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({
          status: 'failed',
          error_message: 'Camera calibration could not be resolved',
        })}
        projectId={PROJECT_ID}
      />
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Analysis Failed')
    expect(alert.textContent).toContain('Camera calibration could not be resolved')
    expect(screen.queryByRole('button', { name: /download csv/i })).toBeNull()
  })

  it('paints one row per calibration attempt and marks the chosen dpo once', () => {
    render(<FraktalResultsView analysis={calibratedAnalysis()} projectId={PROJECT_ID} />)

    expect(screen.getByRole('heading', { name: 'Auto-Calibration Results' })).toBeTruthy()

    const table = screen.getByRole('table', {
      name: /every dpo the auto-calibration tried/i,
    })
    const rows = within(table).getAllByRole('row')
    // One header row plus the three attempts.
    expect(rows).toHaveLength(4)

    // The winner is flagged in its own cell rather than by tinting the row:
    // the marker survives greyscale, a background does not. It is painted with
    // the kit's positive tokens, not `Badge variant="success"`: that variant
    // spells `bg-green-500 text-white`, 2.28:1 on white, on the one word that
    // says what the sweep returned.
    const best = within(table).getAllByText('Best')
    expect(best).toHaveLength(1)
    expect(within(rows[2]).getByText('Best')).toBeTruthy()
    expect(best[0].className).toContain('text-success')
    expect(best[0].className).toContain('bg-success-soft')
    expect(best[0].className).not.toContain('bg-green-500')

    // Header cells of a numeric column sit on the right, as the primitive
    // prescribes.
    const ratioHeader = within(table).getByRole('columnheader', { name: 'Ratio' })
    expect(ratioHeader.className).toContain('text-right')

    // The dpo reading keeps its unit in a sibling element.
    expect(within(rows[1]).getByText('20.0')).toBeTruthy()
    expect(within(rows[1]).getByText('nm')).toBeTruthy()
    expect(within(rows[1]).getByText('40')).toBeTruthy()
    expect(within(rows[1]).getByText('0.80')).toBeTruthy()
    expect(within(rows[1]).getByText('x')).toBeTruthy()
  })

  it('paints the optimal-dpo marker with the kit tokens, not a palette literal', () => {
    render(<FraktalResultsView analysis={calibratedAnalysis()} projectId={PROJECT_ID} />)

    const marker = screen.getByText('Best Match')
    expect(marker.className).toContain('text-success')
    expect(marker.className).toContain('bg-success-soft')
    expect(marker.className).not.toContain('bg-green-500')
  })

  it('writes an absent reading as the kit em dash, in a card and in a table cell', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({
          results: {
            ...BASE_RESULTS,
            // The wire can send null for a reading the engine could not
            // produce; the type says number because the happy path is a number.
            rg: null,
            best_dpo: 25,
            calibration_attempts: [
              { dpo: 25, npo: null, npo_ratio: 1, npo_aligned: true },
            ],
          } as unknown as FraktalResults,
        })}
        projectId={PROJECT_ID}
      />
    )

    // In a card: the glyph alone, and no unit for a magnitude that is not there.
    const reading = screen
      .getByText('Radius of Gyration (Rg)')
      .parentElement!.querySelector('dd')!
    expect(reading.querySelector('.num')!.textContent).toBe('—')
    expect(reading.querySelector('.num-unit')).toBeNull()

    // In a table cell: the sweep's particle count.
    const table = screen.getByRole('table', {
      name: /every dpo the auto-calibration tried/i,
    })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByText('—')).toBeTruthy()
  })

  it('writes the absent current dpo as the same em dash as the rest of the notice', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({
          dpo: null,
          results: {
            ...BASE_RESULTS,
            npo_aligned: false,
            npo_visual: 60,
            dpo_estimated: 44.4,
          },
        })}
        projectId={PROJECT_ID}
      />
    )

    // One vocabulary for "the record does not carry this", in the same callout
    // that already renders "Calculated particles (…)" through `Num`.
    const warning = screen.getByRole('note')
    expect(warning.textContent).toContain('current: —')
    expect(warning.textContent).not.toContain('N/A')
  })

  it('offers the re-run the mismatch calls for, at the suggested dpo', () => {
    render(<FraktalResultsView analysis={calibratedAnalysis()} projectId={PROJECT_ID} />)

    const warning = screen.getByRole('note')
    expect(warning.textContent).toContain('Parameter Mismatch Detected')
    expect(warning.textContent).toContain('Suggested dpo:')

    // Math.round(44.4): the label the original screen printed.
    expect(
      screen.getByRole('button', { name: 'Re-run with dpo = 44 nm' })
    ).toBeTruthy()
  })

  it('writes a failing alignment with its own sign and an absent value with a dash', async () => {
    const blob = new Blob(['image'])
    mockGetOriginalImage.mockResolvedValue(blob)
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:image')
    globalThis.URL.revokeObjectURL = vi.fn()

    mockCreate.mockResolvedValue({
      ...makeAnalysis(),
      id: 'analysis-rerun',
      status: 'completed',
      dpo: 44,
      results: {
        ...BASE_RESULTS,
        // The re-run moves down and the alignment is still wrong.
        df: 1.67,
        npo: 46,
        kf: 0,
        npo_aligned: false,
      },
    })

    render(<FraktalResultsView analysis={calibratedAnalysis()} projectId={PROJECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run with dpo = 44 nm' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    const comparison = screen.getByRole('table', {
      name: /The original run and the re-run/i,
    })
    const rows = within(comparison).getAllByRole('row')

    // A fall keeps its own sign: `signed` only prefixes growth.
    expect(within(comparison).getByText('-0.0500')).toBeTruthy()
    expect(within(comparison).getByText('-2')).toBeTruthy()
    expect(within(comparison).queryByText('+0.0500')).toBeNull()

    // kf arrived as zero, so there is no difference to state: the cell holds
    // the dash, not "+0.0000".
    expect(within(rows[5]).getByText('-')).toBeTruthy()
    expect(within(rows[5]).queryByText('+0.0000')).toBeNull()
  })

  it('prints a ratio at a fixed two decimals, never in exponential form', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({
          results: {
            ...BASE_RESULTS,
            npo_aligned: false,
            npo_visual: 60,
            // The far-off estimate: the case a ratio exists to show.
            npo_ratio: 0.0008,
            dpo_estimated: 44.4,
          },
        })}
        projectId={PROJECT_ID}
      />
    )

    const warning = screen.getByRole('note')
    expect(warning.textContent).toContain('ratio: 0.00x')
    expect(warning.textContent).not.toContain('e-4')
  })

  it('names the comparison table so it can be found without seeing it', async () => {
    const blob = new Blob(['image'])
    mockGetOriginalImage.mockResolvedValue(blob)
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:image')
    globalThis.URL.revokeObjectURL = vi.fn()

    mockCreate.mockResolvedValue({
      ...makeAnalysis(),
      id: 'analysis-rerun',
      status: 'completed',
      dpo: 44,
      results: {
        ...BASE_RESULTS,
        df: 1.77,
        kf: 1.35,
        zf: 0.54,
        npo: 50,
        npo_aligned: true,
      },
    })

    render(<FraktalResultsView analysis={calibratedAnalysis()} projectId={PROJECT_ID} />)

    fireEvent.click(screen.getByRole('button', { name: 'Re-run with dpo = 44 nm' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    // The re-run posts the suggested dpo, not the record's own.
    expect(mockCreate.mock.calls[0][1].dpo).toBe(44)

    const panel = screen
      .getByRole('heading', { name: /Comparison: Re-run with Suggested dpo/ })
      .closest('section')
    expect(panel).toBeTruthy()

    // Found by the caption `DataTable` turns into the table's accessible name,
    // not by its position among the tables on the page.
    const comparison = screen.getByRole('table', {
      name: /The original run and the re-run/i,
    })
    expect(within(panel as HTMLElement).getByRole('table', {
      name: /The original run and the re-run/i,
    })).toBe(comparison)
    const rows = within(comparison).getAllByRole('row')
    // Header plus the six metrics the side-by-side has always listed.
    expect(rows).toHaveLength(7)

    // The change column keeps its explicit sign and its four decimals.
    expect(within(comparison).getByText('+0.0500')).toBeTruthy()
    expect(within(comparison).getByText('+2')).toBeTruthy()
    // The alignment the re-run fixed is stated in words, not only in colour.
    expect(within(comparison).getByText('✓ Fixed')).toBeTruthy()
  })

  it('says a queued analysis is queued instead of painting an empty result', () => {
    render(
      <FraktalResultsView
        analysis={makeAnalysis({ status: 'queued', results: null })}
        projectId={PROJECT_ID}
      />
    )

    expect(screen.getByRole('note').textContent).toContain('Analysis queued...')
    expect(screen.queryByText('Fractal Dimension (Df)')).toBeNull()
  })

  it('explains a missing original image instead of leaving a blank frame', async () => {
    render(<FraktalResultsView analysis={makeAnalysis()} projectId={PROJECT_ID} />)

    expect(await screen.findByRole('heading', { name: 'Image not available' })).toBeTruthy()
  })
})
