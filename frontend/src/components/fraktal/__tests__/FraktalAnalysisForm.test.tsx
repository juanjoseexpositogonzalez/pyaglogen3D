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
  it('composes its sections as panels, each headed by a second-level heading', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    // The page owns the only h1; every section below it is an h2, so the
    // outline reads as one document instead of six. This is the heading
    // outline and nothing more: `Panel` renders a <section> without an
    // accessible name, and an unnamed section is not a landmark — so there is
    // deliberately no assertion about regions here, because there are none.
    expect(titles).toEqual([
      'Analysis Name',
      'Image Source',
      'Analysis Model',
      'Scale Calibration',
      'Model Parameters',
      'Segmentation',
    ])
  })

  it('names both selects that decide the request body, and labels every control', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    // An unnamed combobox announces as "combobox" and nothing else, so there
    // is no way to tell which one picks the image source and which the model.
    expect(screen.getByRole('combobox', { name: 'Image source' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Analysis model' })).toBeTruthy()

    // Labels wrap or point at their control, so `getByLabelText` resolves each
    // one to the input it names rather than finding only the text.
    const labelled = [
      /^Name \(optional\)/,
      /^Upload Image/,
      /^Pixels per 100nm/,
      /^Primary Particle Diameter/,
      /^Scale Reference/,
      /^Minimum Particle Count/,
      /^Min Pixel Value/,
      /^Max Pixel Value/,
    ]
    for (const label of labelled) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it('keeps every reading as a value plus a separate unit, never one string', () => {
    const onChange = () => {}
    render(<FraktalAnalysisForm onSubmit={onChange} simulations={[]} />)

    // `Num` marks the value itself with `.num` and puts the unit in a sibling,
    // which is what keeps a column of readings aligned. A reading written as
    // one interpolated string has no such element.
    const valueIn = (label: RegExp) => screen.getByText(label).querySelector('.num')

    expect(valueIn(/^Filling Factor \(delta\)/)?.textContent).toBe('1.10')

    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis model' }), {
      target: { value: 'voxel_2018' },
    })
    expect(valueIn(/^m Exponent/)?.textContent).toBe('1.00')

    fireEvent.change(screen.getByRole('combobox', { name: 'Image source' }), {
      target: { value: 'simulation_projection' },
    })
    expect(valueIn(/^Azimuth/)?.textContent).toBe('0')
    expect(valueIn(/^Elevation/)?.textContent).toBe('0')
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
    // It is the number a reader checks before launching, so it is the largest
    // reading on the screen: `Num`'s `lg` size, not body text.
    const value = helper!.querySelector('.num') as HTMLElement | null
    expect(value).toBeTruthy()
    expect(value!.className).toContain('text-[29px]')
  })

  it('announces auto-calibration as an attention notice with a stable toggle name', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const box = screen
      .getAllByRole('note')
      .find((note) => note.textContent?.includes('Auto-calibrate dpo'))

    expect(box).toBeTruthy()
    expect(box!.textContent).toContain('Automatically find optimal primary particle diameter')

    // The name stays the same in both states and the state travels in
    // `aria-pressed`: a button called "Enabled, pressed" says it twice.
    const toggle = within(box!).getByRole('button', { name: 'Auto-calibrate dpo' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(box!.textContent).toContain('test multiple dpo values')
  })

  it('reports the 3D-correction switch through aria-pressed, under its label', () => {
    render(<FraktalAnalysisForm onSubmit={vi.fn()} simulations={[]} />)

    const toggle = screen.getByRole('button', { name: '3D Correction' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    // Clicking it again returns to the off state, not to a third one.
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
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

    // Both selects are named: picking one by position would encode whichever
    // order the form happens to render in.
    fireEvent.change(screen.getByRole('combobox', { name: 'Image source' }), {
      target: { value: 'simulation_projection' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Select Simulation' }), {
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis model' }), {
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

  it('falls back to 512 when the resolution field is left empty', async () => {
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

    fireEvent.change(screen.getByRole('combobox', { name: 'Image source' }), {
      target: { value: 'simulation_projection' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Select Simulation' }), {
      target: { value: 'sim-1' },
    })
    // An empty box parses to NaN, and `parseInt(x) || 512` is what turns that
    // into a resolution the engine accepts instead of a NaN on the wire.
    fireEvent.change(screen.getByLabelText('Resolution (px)'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run FRAKTAL Analysis' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].projection_params).toEqual({
      azimuth: 0,
      elevation: 0,
      resolution: 512,
    })
  })

  it('sends no simulation id when the source returns to an upload', async () => {
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

    const source = () => screen.getByRole('combobox', { name: 'Image source' })
    fireEvent.change(source(), { target: { value: 'simulation_projection' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Select Simulation' }), {
      target: { value: 'sim-1' },
    })

    // Back to an upload: the chosen simulation stays in state, and the upload
    // branch is the only thing that decides what the request carries.
    fireEvent.change(source(), { target: { value: 'uploaded_image' } })
    selectFile(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', {
        type: 'image/png',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run FRAKTAL Analysis' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0]

    expect(payload.source_type).toBe('uploaded_image')
    expect(payload.simulation_id).toBeUndefined()
    expect(payload.projection_params).toBeUndefined()
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
