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
 * Two witnesses here do not describe behaviour this migration wanted; they pin
 * behaviour it found and was not allowed to change, so that a later slice has
 * to invert them on purpose rather than by accident:
 *   - a rejected create navigates nowhere and says nothing (the `catch` only
 *     writes to the console);
 *   - the Cancel control is one link, not a button inside a link.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockMutateAsync = vi.fn()
const mockPush = vi.fn()
// First-render state for the mocked mutation, so the pending branch is reachable
// without weakening the stateful mock below.
let mockInitialPending = false

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

// Mirrors `useMutation`, including the part that matters to a failure witness:
// the request settling flips `isPending`/`isError` and re-renders the page. A
// static return value would keep `isError` undefined forever, so a page that
// grew an error banner would pass this file without ever showing it.
vi.mock('@/hooks/useProjects', () => ({
  useCreateProject: () => {
    const [state, setState] = React.useState({
      isPending: mockInitialPending,
      isError: false,
    })
    return {
      isPending: state.isPending,
      isError: state.isError,
      mutateAsync: async (input: unknown) => {
        setState({ isPending: true, isError: false })
        try {
          const created = await mockMutateAsync(input)
          setState({ isPending: false, isError: false })
          return created
        } catch (error) {
          setState({ isPending: false, isError: true })
          throw error
        }
      },
    }
  },
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
  mockInitialPending = false
  mockMutateAsync.mockResolvedValue({ id: 'p9', name: 'Soot study' })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('new-project page', () => {
  it('does not mount the deprecated header', () => {
    renderPage()

    // Asserted on what is on screen, not on an import line: a page can import
    // the component and not render it. The mock stands in for the deprecated
    // component so its presence is observable at all.
    expect(screen.queryByTestId('deprecated-header')).toBeNull()
  })

  it('keeps title and form inside one capped column, and draws no main of its own', () => {
    const { container } = renderPage()

    // The shell owns `<main>`. A second one on the route gives the document two
    // main landmarks and makes the skip link land on the inner one.
    expect(container.querySelector('main')).toBeNull()

    const column = container.firstElementChild as HTMLElement
    const tokens = column.className.split(/\s+/)
    // 672px, the measure the migrated FRAKTAL screens use.
    expect(tokens).toContain('max-w-2xl')
    expect(tokens).toContain('mx-auto')
    // Not the legacy `container px-4 py-8`: the shell already owns the page
    // gutter, and both together pad the screen twice. This is the part the old
    // wrapper got wrong, so the assertion has to name it.
    expect(tokens).not.toContain('container')
    expect(tokens).not.toContain('px-4')
    expect(tokens).not.toContain('py-8')

    // The cap applies to the title and the form together: a heading that spans
    // the shell over a capped form reads as two screens.
    expect(column.contains(screen.getByRole('heading', { level: 1 }))).toBe(true)
    expect(column.contains(form())).toBe(true)
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

  it('names the surface that holds the form, and labels both its fields', () => {
    const { container } = renderPage()

    const surface = container.querySelector('section') as HTMLElement
    expect(surface).toBeTruthy()
    // A titled surface, not a bare run of inputs: the heading is what tells a
    // reader moving by headings that the fields belong to the page title above.
    expect(surface.contains(form())).toBe(true)
    const name = screen.getByRole('heading', { level: 2 })
    expect(name.textContent).toBe('Project details')
    expect(surface.contains(name)).toBe(true)

    // An input and a textarea have no accessible name by default; these two get
    // theirs from the `Label`/`id` pair, and this is what proves it.
    const nameField = screen.getByLabelText(/Project Name/) as HTMLInputElement
    expect(nameField.tagName).toBe('INPUT')
    expect(nameField.getAttribute('placeholder')).toBe('e.g., DLA Sticking Probability Study')
    expect(nameField.hasAttribute('required')).toBe(true)
    expect(nameField.value).toBe('')

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
    mockInitialPending = true

    renderPage()

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Soot study' } })

    const button = screen.getByRole('button', { name: 'Creating...' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('stays silent when the create is rejected: nowhere to go, nothing said', async () => {
    // Pins today's defect on purpose. A rejected create leaves the screen
    // exactly as it was — no message, no navigation — and the console is the
    // only trace. When a later slice shows the server's reason, this test is
    // the one to invert, not to delete.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockMutateAsync.mockRejectedValue(new Error('duplicate name'))

    renderPage()

    fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Soot study' } })
    await submit()

    expect(mockPush).not.toHaveBeenCalled()
    // Both roles the kit's Callout can carry: a failure reads `alert`, a note
    // reads `note`. Neither may appear yet — and the mock above does flip
    // `isError`, so a page that renders on it would be caught here.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(console.error).toHaveBeenCalled()
    // The form is still there and still usable: the rejection is not a dead end.
    expect(form()).toBeTruthy()
  })

  it('offers Cancel as one link, not a button nested inside a link', () => {
    renderPage()

    const cancel = screen.getByRole('link', { name: 'Cancel' })
    expect(cancel.getAttribute('href')).toBe('/projects')

    // `<a><button>Cancel</button></a>` is invalid HTML with two tab stops for a
    // single destination, and the inner button fires nothing. `Button` declares
    // `asChild` but does not destructure it, so it lands on the DOM `<button>`
    // as an unknown attribute instead of merging the two elements: the look has
    // to come from `buttonVariants()` on the link.
    expect(cancel.querySelector('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(cancel.getAttribute('aschild')).toBeNull()
  })
})
