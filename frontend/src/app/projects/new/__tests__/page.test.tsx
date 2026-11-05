/**
 * The create-project page, migrated onto the design-system kit (issue #181,
 * slice 1 of 3).
 *
 * Asserted through what a user can perceive — the heading level, the labels
 * the fields answer to, the payload the API receives — rather than through
 * which components were imported. A test that checks imports passes a refactor
 * that breaks the page.
 *
 * The behaviour is the contract here, not only the paint: the name is trimmed
 * before it travels, a blank description is dropped instead of sent as an
 * empty string, a whitespace-only name never reaches the API, and a successful
 * create lands on the project it made.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockMutateAsync = vi.fn()
const mockUseCreateProject = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/hooks/useProjects', () => ({
  useCreateProject: () => mockUseCreateProject(),
}))

// The deprecated header still exists and eighteen pages import it; this stub
// stands in for it so its presence on the page is observable instead of
// crashing the render on a router the shell already provides.
vi.mock('@/components/layout/Header', () => ({
  Header: () => React.createElement('div', { 'data-testid': 'deprecated-header' }),
}))

import NewProjectPage from '../page'

const renderPage = () => render(<NewProjectPage />)

const form = () => document.querySelector('form') as HTMLFormElement

const submit = async () => {
  await act(async () => {
    fireEvent.submit(form())
  })
}

beforeEach(() => {
  mockMutateAsync.mockResolvedValue({ id: 'p9', name: 'Soot study' })
  mockUseCreateProject.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('new-project page', () => {
  it('does not mount the deprecated header', () => {
    renderPage()

    // Asserted on what is on screen, not on an import line: a page can import
    // the component and not render it. The mock stands in for the deprecated
    // component so its presence is observable at all.
    expect(screen.queryByTestId('deprecated-header')).toBeNull()
  })

  it('keeps its column at the width the other creation screens use, and draws no main of its own', () => {
    const { container } = renderPage()

    // The shell owns `<main>`. A second one on the route gives the document two
    // main landmarks and makes the skip link land on the inner one.
    expect(container.querySelector('main')).toBeNull()

    // Without a cap the form stretches to the shell's 1440px and a single field
    // grows to ~650px. 672px is the measure the migrated FRAKTAL screens use.
    const column = container.querySelector('.max-w-2xl')
    expect(column).toBeTruthy()
    expect(column!.contains(form())).toBe(true)
    // The heading belongs to the same column as the form: a title that spans
    // the shell over a capped form reads as two screens.
    expect(column!.textContent).toContain('Create New Project')
  })

  it('names the screen in the kit page header, after the way back to the list', () => {
    renderPage()

    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe('Create New Project')

    // The eyebrow names the context the new project will join.
    expect(screen.getByText('PROJECTS')).toBeTruthy()
    expect(
      screen.getByText(/Projects help you organize simulations and analyses/),
    ).toBeTruthy()

    const back = screen.getByText('Back to Projects')
    expect(back.closest('a')?.getAttribute('href')).toBe('/projects')
  })

  it('puts the form in a panel and labels both fields', () => {
    const { container } = renderPage()

    // A titled surface around the form, not a bare run of inputs.
    expect(container.querySelector('section')).toBeTruthy()

    // A `<select>` and a bare input have no accessible name by default; these
    // two get theirs from the `Label`/`id` pair, and this is what proves it.
    const name = screen.getByLabelText(/Project Name/) as HTMLInputElement
    expect(name.tagName).toBe('INPUT')
    expect(name.getAttribute('placeholder')).toBe('e.g., DLA Sticking Probability Study')
    expect(name.hasAttribute('required')).toBe(true)
    expect(name.value).toBe('')

    const description = screen.getByLabelText(/Description \(optional\)/) as HTMLTextAreaElement
    expect(description.tagName).toBe('TEXTAREA')
    expect(description.getAttribute('placeholder')).toBe('Describe the purpose of this project...')
    expect(description.getAttribute('rows')).toBe('3')
    expect(description.value).toBe('')
    expect(description.hasAttribute('required')).toBe(false)
  })

  it('keeps the submit button disabled until a name is typed, and again for blanks', () => {
    renderPage()

    const button = screen.getByRole('button', { name: 'Create Project' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Soot study' } })
    expect(button.disabled).toBe(false)

    // Whitespace is not a name: the guard trims, so spaces leave it disabled.
    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: '   ' } })
    expect(button.disabled).toBe(true)
  })

  it('sends the trimmed name, drops a blank description, and opens the project it made', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: '  Soot study  ' } })
    fireEvent.change(screen.getByLabelText(/Description \(optional\)/), {
      target: { value: '   ' },
    })
    await submit()

    // `description: undefined` rather than `''`: the API treats a missing key
    // as "no description", and an empty string as a description that is empty.
    expect(mockMutateAsync).toHaveBeenCalledWith({
      name: 'Soot study',
      description: undefined,
    })
    expect(mockPush).toHaveBeenCalledWith('/projects/p9')
  })

  it('keeps a description that has text in it', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Soot study' } })
    fireEvent.change(screen.getByLabelText(/Description \(optional\)/), {
      target: { value: '  Tunable Df from 1.6 to 2.4  ' },
    })
    await submit()

    expect(mockMutateAsync).toHaveBeenCalledWith({
      name: 'Soot study',
      description: 'Tunable Df from 1.6 to 2.4',
    })
  })

  it('refuses a whitespace-only name without calling the API', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: '   ' } })
    await submit()

    // The disabled button is the first line of defence; this is the second, for
    // the submit an Enter key can still produce on some browsers.
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('says it is creating while the request is in flight', () => {
    mockUseCreateProject.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
    })

    renderPage()

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Soot study' } })

    const button = screen.getByRole('button', { name: 'Creating...' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('offers a cancel route back to the project list', () => {
    renderPage()

    const cancel = screen.getByText('Cancel')
    expect(cancel.closest('a')?.getAttribute('href')).toBe('/projects')
  })
})
