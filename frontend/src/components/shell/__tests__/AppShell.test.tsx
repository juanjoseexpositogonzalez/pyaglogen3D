/**
 * Covers app-shell-navigation R1 (mounted once), R2 (never on the public and
 * auth routes) and R3 (the legacy header yields).
 *
 * Driven at component level with `usePathname` mocked, which is the pattern
 * this repository already uses. Rendering `app/layout.tsx` is not an option:
 * it is a Server Component that imports `next/font/google`, and a route-level
 * assertion such as "no sidebar on /auth/login" would pass vacuously because
 * the layout would never be in the tree.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ current: '/dashboard' }))
const auth = vi.hoisted(() => ({
  current: {
    user: { email: 'a@b.c', first_name: 'Ada', full_name: 'Ada Lovelace', is_staff: false },
    isAuthenticated: true,
    logout: () => {},
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }))
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }))
vi.mock('@/lib/ai-api', () => ({ aiApi: { checkAccess: () => Promise.resolve({ has_access: false }) } }))

import { AppShell } from '../AppShell'
import { Header } from '@/components/layout/Header'

function renderAt(path: string) {
  pathname.current = path
  return render(
    <AppShell>
      <p>page body</p>
    </AppShell>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    auth.current = {
      user: { email: 'a@b.c', first_name: 'Ada', full_name: 'Ada Lovelace', is_staff: false },
      isAuthenticated: true,
      logout: () => {},
    }
  })

  it('wraps an application route in exactly one navigation', () => {
    renderAt('/dashboard')
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1)
    expect(screen.getByText('page body')).toBeTruthy()
  })

  it.each(['/auth/login', '/auth/register', '/'])(
    'renders no chrome on %s, which carries its own layout',
    (path) => {
      renderAt(path)
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
      expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
      // The page itself must still render: the guard hides the shell, not the
      // content.
      expect(screen.getByText('page body')).toBeTruthy()
    },
  )

  it('renders no chrome for a signed-out visitor', () => {
    auth.current = { ...auth.current, isAuthenticated: false, user: null as never }
    renderAt('/dashboard')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.getByText('page body')).toBeTruthy()
  })

  it('leaves the legacy header to navigate a signed-out visitor', () => {
    // Making the provider unconditional silenced Header everywhere, so a
    // visitor on an unprotected route had no navigation at all: middleware
    // guards only /dashboard and /projects, and /settings, /ai and /admin
    // became dead ends. The context value now follows the chrome.
    auth.current = { ...auth.current, isAuthenticated: false, user: null as never }
    pathname.current = '/settings'
    render(
      <AppShell>
        <Header />
        <p>page body</p>
      </AppShell>,
    )
    expect(screen.getByText('pyAgloGen3D')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sign In/i })).toBeTruthy()
  })

  it('keeps one <main> across the authentication flip, so pages are not remounted', () => {
    // The tree shape must not depend on auth state. Swapping <main> for a
    // bare children is a different element type at the same position, and
    // React remounts the entire page: local state lost, effects re-run,
    // queries re-issued. Every load passes through this transition.
    auth.current = { ...auth.current, isAuthenticated: false, user: null as never }
    pathname.current = '/dashboard'
    const { rerender, container } = render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    )
    const before = container.querySelector('main')
    expect(before).not.toBeNull()

    auth.current = { ...auth.current, isAuthenticated: true }
    rerender(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    )

    expect(container.querySelector('main')).toBe(before)
  })

  it('names the current entity in the breadcrumb', () => {
    renderAt('/dashboard')
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumb.textContent).toContain('Dashboard')
  })

  it('offers the theme control with its three states', () => {
    renderAt('/dashboard')
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(group).toBeTruthy()
    ;['System', 'Light', 'Dark'].forEach((label) =>
      expect(screen.getByRole('radio', { name: label })).toBeTruthy(),
    )
  })

  it('hides the admin destination from a non-administrator', () => {
    renderAt('/dashboard')
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
  })

  it('shows it to an administrator', () => {
    auth.current = { ...auth.current, user: { ...auth.current.user, is_staff: true } }
    renderAt('/dashboard')
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy()
  })
})

describe('the off-canvas drawer', () => {
  function openDrawer() {
    pathname.current = '/dashboard'
    render(
      <AppShell>
        <p>page body</p>
        <button type="button">behind the drawer</button>
      </AppShell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  }

  it('announces itself as a modal dialog', () => {
    // R6. The drawer covers the page; a keyboard user needs to be told that,
    // and to be kept inside it.
    openDrawer()
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy()
  })

  it('moves focus into itself when it opens', () => {
    openDrawer()
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(drawer.contains(document.activeElement)).toBe(true)
  })

  it('wraps Tab from the last item back to the first', () => {
    // jsdom does not move focus on a synthetic Tab, so asserting "focus is
    // still inside" passes with no trap at all. The discriminating assertion
    // is the wrap the handler performs itself.
    openDrawer()
    // Scoped to the drawer: the fixed rail is also in the DOM (CSS hides it
    // below lg, which jsdom does not apply). The trap operates on the drawer
    // panel, not the dialog wrapper, whose backdrop button is a sibling.
    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    const panel = within(dialog).getByRole('navigation', { name: 'Main' })
      .parentElement as HTMLElement
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape', () => {
    openDrawer()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull()
  })
})

describe('the theme control', () => {
  it('indicates the active option without relying on colour', () => {
    // R5's second THEN, which the previous test never asserted.
    pathname.current = '/dashboard'
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    )
    const checked = screen
      .getAllByRole('radio')
      .filter((el) => el.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
  })

  it('actually writes the theme the user picks', () => {
    // Nothing asserted that activating an option reached the document.
    pathname.current = '/dashboard'
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    delete document.documentElement.dataset.theme
  })
})
