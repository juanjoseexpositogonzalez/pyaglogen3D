/**
 * Settings migrated onto the design-system kit (issue #183, slice 1).
 *
 * Asserted through what a reader can perceive — headings, labels, roles,
 * messages — plus the two source-level contracts a DOM assertion cannot see:
 * the deprecated `Header` is no longer mounted and no colour literal came
 * along. A test that only counted imports would pass a refactor that breaks
 * the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const mockUpdateProfile = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  // The deprecated header reads this while it is still mounted.
  usePathname: () => '/settings',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

// The header asks on mount whether the account has AI access. Stubbed so the
// pre-migration run of this file fails on its assertions, not on a socket.
vi.mock('@/lib/ai-api', () => ({
  aiApi: { checkAccess: () => Promise.resolve({ has_access: false }) },
}))

import SettingsPage from '../page'

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  full_name: 'Ada Lovelace',
  email_verified: true,
  is_staff: false,
  avatar_url: null,
  oauth_provider: '',
  created_at: '2026-10-01T00:00:00Z',
  csv_decimal_separator: '.',
  csv_column_delimiter: ',',
  ...overrides,
})

const sourceOf = async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  return readFileSync(join(process.cwd(), 'src/app/settings/page.tsx'), 'utf8')
}

describe('Settings', () => {
  beforeEach(() => {
    mockUpdateProfile.mockResolvedValue(undefined)
    mockUseAuth.mockReturnValue({
      user: user(),
      isLoading: false,
      isAuthenticated: true,
      updateProfile: mockUpdateProfile,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not mount the deprecated header', async () => {
    const source = await sourceOf()

    // Asserted on the import, not on the absence of `<header>` elements: the
    // kit primitives use that tag legitimately, so counting tags would both
    // fail on a correct page and pass on a wrong one.
    expect(source).not.toContain('components/layout/Header')
  })

  it('draws no page frame of its own: the shell owns the gutter and the padding', async () => {
    const { container } = render(<SettingsPage />)
    const source = await sourceOf()

    // `/settings` is not chromeless (AppShell.isChromeless is `/` and
    // `/auth/*` only), so the shell already wraps this route in a padded,
    // max-width column. A `<main class="container …">` here padded it twice
    // and stacked a second landmark on top of the shell's.
    expect(container.querySelector('main')).toBeNull()
    expect(source).not.toMatch(/\bcontainer\b/)
  })

  it('titles the page once, at level 1, above the section', () => {
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { level: 1, name: /settings/i })).toBeTruthy()
    // The preference block keeps its own heading so the outline has a step
    // between the page title and the fields.
    expect(
      screen.getByRole('heading', { level: 2, name: /csv export preferences/i }),
    ).toBeTruthy()
  })

  it('keeps both preferences as labelled selects hydrated from the account', () => {
    const { container } = render(<SettingsPage />)

    const decimal = screen.getByLabelText(/decimal separator/i) as HTMLSelectElement
    const delimiter = screen.getByLabelText(/column delimiter/i) as HTMLSelectElement

    expect(decimal.value).toBe('.')
    expect(delimiter.value).toBe(',')
    // Both are real <select> elements, not a custom widget: the native
    // control is what keeps the page usable with a keyboard and a screen
    // reader without any ARIA of our own.
    expect(decimal.tagName).toBe('SELECT')
    expect(delimiter.tagName).toBe('SELECT')
    expect(container.querySelectorAll('select')).toHaveLength(2)
  })

  it('saves the chosen pair through updateProfile and confirms in a callout', async () => {
    render(<SettingsPage />)

    fireEvent.change(screen.getByLabelText(/decimal separator/i), {
      target: { value: ',' },
    })
    fireEvent.change(screen.getByLabelText(/column delimiter/i), {
      target: { value: ';' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        csv_decimal_separator: ',',
        csv_column_delimiter: ';',
      })
    })
    expect(await screen.findByText('Preferences saved.')).toBeTruthy()
  })

  it('announces the ambiguous combination as a notice, not as bare text', () => {
    render(<SettingsPage />)

    // Comma decimal plus comma delimiter is accepted by the backend and
    // produces a file that is hard to reparse, so the screen says so out loud.
    expect(screen.queryByText(/ambiguous format/i)).toBeNull()

    fireEvent.change(screen.getByLabelText(/decimal separator/i), {
      target: { value: ',' },
    })

    const notice = screen.getByRole('note')
    expect(notice.textContent).toContain('Ambiguous format')
    expect(notice.textContent).toContain('Consider switching the delimiter to semicolon')
  })

  it('shows a failed save as an alert carrying the message the API gave', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('Server said no'))
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Server said no')
    // The confirmation of a previous save must not survive a failure.
    expect(screen.queryByText('Preferences saved.')).toBeNull()
  })

  it('falls back to its own wording when the failure is not an Error', async () => {
    mockUpdateProfile.mockRejectedValue('nope')
    render(<SettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Failed to save preferences.')
  })

  it('presents the two samples as code, in the monospace numeric style', () => {
    const { container } = render(<SettingsPage />)

    const samples = Array.from(container.querySelectorAll('code')).map((c) => c.textContent)
    expect(samples).toContain('1,5;2,5')
    expect(samples).toContain('1.5,2.5')
    // The samples are numbers, so they carry the tabular numeric face the
    // rest of the product uses; the rule lives in `.num`, not in a copy here.
    container.querySelectorAll('code').forEach((c) => {
      expect(c.className).toContain('num')
    })
  })

  it('sends an unauthenticated visitor to the login page', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      updateProfile: mockUpdateProfile,
    })
    render(<SettingsPage />)

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/auth/login'))
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('carries no colour literal and no shadcn bridge utility of its own', async () => {
    const source = await sourceOf()

    expect(source).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
    // The raw Tailwind palettes (`bg-yellow-500/10`, `text-green-500`) are not
    // tokens: they survived the old theme and would survive the next one.
    expect(source).not.toMatch(/\b(?:bg|text|border)-(?:yellow|green|red|blue|purple|slate|gray)-\d{2,3}\b/)
    expect(source).not.toContain('ui/card')
  })
})
