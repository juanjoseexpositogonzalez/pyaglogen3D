/**
 * Unit tests for <FraktalAnalysisForm />.
 *
 * Covers the TIFF/BMP preview placeholder hotfix: the <img> tag is only
 * rendered for formats the browser can natively decode (PNG/JPEG).
 * TIFF and BMP files show an informative placeholder instead of a broken
 * image icon, while still being accepted for analysis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
