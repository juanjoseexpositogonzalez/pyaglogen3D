/**
 * Unit tests for <FraktalAnalysisForm />.
 *
 * Covers the TIFF/BMP preview placeholder hotfix: the <img> tag is only
 * rendered for formats the browser can natively decode (PNG/JPEG).
 * TIFF and BMP files show an informative placeholder instead of a broken
 * image icon, while still being accepted for analysis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

import { FraktalAnalysisForm } from '../FraktalAnalysisForm'

beforeEach(() => {
  // jsdom implements createObjectURL as undefined by default — stub it so
  // the component's preview path runs without throwing.
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock-url'),
      writable: true,
      configurable: true,
    })
  } else {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    })
  } else {
    URL.revokeObjectURL = vi.fn()
  }
})

function selectFile(file: File) {
  // The file input is visually hidden (`className="hidden"`); query it
  // directly on the rendered DOM so we can dispatch a change event.
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement | null
  expect(input).not.toBeNull()
  fireEvent.change(input!, { target: { files: [file] } })
}

/**
 * The form migrated onto the design-system kit (issue #176, slice 1 of 3).
 *
 * Two kinds of guard live here. The first kind fails on the pre-migration form:
 * it states the shape the kit requires (panel sections, notices with a role, no
 * palette literal). The second kind passes on both versions on purpose — it is
 * the regression net for "the behaviour does not change": same payload, same
 * validation, same conditional parameters.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
describe('<FraktalAnalysisForm /> — design-system kit', () => {
  it('composes its sections as panels, each with a second-level heading', () => {
    const { container } = render(
      <FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />,
    )

    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    // The page owns the only h1; every section below it is an h2, so the
    // outline still reads as one document instead of six.
    expect(titles).toEqual([
      'Analysis Name',
      'Image Source',
      'Analysis Model',
      'Scale Calibration',
      'Model Parameters',
      'Segmentation',
    ])
    // A `Panel` is a <section>: the sections are real regions, not divs that
    // only look like cards.
    expect(container.querySelectorAll('section').length).toBeGreaterThanOrEqual(6)
  })

  it('carries no palette literal: every colour comes from a token', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(process.cwd(), 'src/components/fraktal/FraktalAnalysisForm.tsx'),
      'utf8',
    )

    // Tailwind's named palette. `bg-panel-teal` and friends are kit tones and
    // carry no shade suffix, so they do not match.
    const PALETTE =
      /-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/
    expect(source.match(PALETTE)).toBeNull()
    // A hex colour always carries at least one letter; `#176` in a comment does
    // not, which keeps this from failing on the issue number.
    expect(source).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
  })

  it('presents the scale-bar helper as an informational note', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const helper = screen
      .getAllByRole('note')
      .find((note) => note.textContent?.includes('Measure your scale bar to calibrate'))

    expect(helper).toBeTruthy()
    // The derived value lives inside the notice it belongs to, number and unit
    // kept apart by `Num` rather than concatenated into one string.
    expect(helper!.textContent).toContain('px/100nm')
    expect(helper!.textContent).toContain('1.000')
    expect(helper!.textContent).toContain('pixels per nm')
  })

  it('announces auto-calibration as an attention notice that owns its toggle', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const box = screen
      .getAllByRole('note')
      .find((note) => note.textContent?.includes('Auto-calibrate dpo'))

    expect(box).toBeTruthy()
    expect(box!.textContent).toContain('Automatically find optimal primary particle diameter')

    // The toggle is the notice's action, and its state is spelled out in
    // words rather than carried by the tint alone.
    const toggle = within(box!).getByRole('button', { name: 'Disabled' })
    fireEvent.click(toggle)
    expect(within(box!).getByRole('button', { name: 'Enabled' })).toBeTruthy()
    expect(box!.textContent).toContain('test multiple dpo values')
  })
})

describe('<FraktalAnalysisForm /> — behaviour that the migration must not change', () => {
  it('submits the chosen image as base64, with the parameters on screen', async () => {
    const onSubmit = vi.fn()
    render(<FraktalAnalysisForm onSubmit={onSubmit} simulations={[]} />)

    const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', {
      type: 'image/png',
    })
    selectFile(pngFile)
    fireEvent.change(screen.getByLabelText('Name (optional)'), {
      target: { value: '  Run 7  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run FRAKTAL Analysis' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0]

    // Trimmed, and omitted entirely when empty.
    expect(payload.name).toBe('Run 7')
    expect(payload.source_type).toBe('uploaded_image')
    expect(payload.original_filename).toBe('test.png')
    expect(payload.original_content_type).toBe('image/png')
    // The data-URL prefix is stripped: the backend wants the payload only.
    expect(payload.image).toBe('iVBORw==')
    expect(payload.model).toBe('granulated_2012')
    expect(payload.npix).toBe(100)
    expect(payload.dpo).toBe(40)
    expect(payload.delta).toBe(1.1)
    expect(payload.correction_3d).toBe(false)
    expect(payload.pixel_min).toBe(10)
    expect(payload.pixel_max).toBe(240)
    expect(payload.npo_limit).toBe(5)
    expect(payload.escala).toBe(100)
    expect(payload.auto_calibrate).toBe(false)
  })

  it('refuses an upload with no file, and says which input is missing', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onSubmit = vi.fn()
    render(<FraktalAnalysisForm onSubmit={onSubmit} simulations={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run FRAKTAL Analysis' }))

    expect(alertSpy).toHaveBeenCalledWith('Please select an image file')
    expect(onSubmit).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('sends the projection parameters when the source is a simulation', async () => {
    const onSubmit = vi.fn()
    render(
      <FraktalAnalysisForm
        onSubmit={onSubmit}
        simulations={[
          {
            id: 'sim-1',
            algorithm: 'tunable_cc',
            status: 'completed',
            created_at: '2026-10-02T10:00:00Z',
          },
        ]}
      />,
    )

    // The source selector is the first combobox on the form; the simulation
    // selector only exists once the projection branch is chosen.
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'simulation_projection' },
    })
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'sim-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run FRAKTAL Analysis' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0]

    expect(payload.source_type).toBe('simulation_projection')
    expect(payload.simulation_id).toBe('sim-1')
    expect(payload.projection_params).toEqual({
      azimuth: 0,
      elevation: 0,
      resolution: 512,
    })
    expect(payload.image).toBeUndefined()
  })

  it('drops the granulated-only parameters when the voxel model is chosen', async () => {
    const onSubmit = vi.fn()
    render(<FraktalAnalysisForm onSubmit={onSubmit} simulations={[]} />)

    selectFile(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', {
        type: 'image/png',
      }),
    )
    // On the upload branch the model selector is the second combobox.
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'voxel_2018' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run FRAKTAL Analysis' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0]

    // Sending dpo to the voxel model is rejected by the backend: the field is
    // absent, not zero.
    expect(payload.model).toBe('voxel_2018')
    expect(payload.dpo).toBeUndefined()
    expect(payload.auto_calibrate).toBeUndefined()
    expect(payload.m_exponent).toBe(1)
  })
})

describe('<FraktalAnalysisForm /> — image preview', () => {
  it('renders an <img> tag for PNG files', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const pngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', {
      type: 'image/png',
    })
    selectFile(pngFile)

    const previewImg = screen.getByAltText(/Preview/i) as HTMLImageElement
    expect(previewImg).toBeTruthy()
    expect(previewImg.tagName).toBe('IMG')
    expect(previewImg.getAttribute('src')).toBe('blob:mock-url')
  })

  it('shows placeholder (not <img>) for TIFF files', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const tiffFile = new File([new Uint8Array([0x49, 0x49, 0x2a])], 'scan.tif', {
      type: 'image/tiff',
    })
    selectFile(tiffFile)

    // No <img> should be rendered for a TIFF file — only the placeholder.
    expect(screen.queryByAltText(/Preview/i)).toBeNull()

    // Placeholder text identifies the format and filename.
    const placeholder = screen.getByText(/Preview not available/i)
    expect(placeholder).toBeTruthy()
    expect(placeholder.textContent).toMatch(/TIFF/)
    // The filename appears in two places: the "Select file" button label
    // and the placeholder — both valid, so use getAllByText.
    expect(screen.getAllByText(/scan\.tif/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows placeholder for BMP files', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const bmpFile = new File([new Uint8Array([0x42, 0x4d])], 'image.bmp', {
      type: 'image/bmp',
    })
    selectFile(bmpFile)

    expect(screen.queryByAltText(/Preview/i)).toBeNull()
    const placeholder = screen.getByText(/Preview not available/i)
    expect(placeholder).toBeTruthy()
    expect(placeholder.textContent).toMatch(/BMP/)
  })
})
