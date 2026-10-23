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
import { render, screen } from '@testing-library/react'
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

describe('the legacy Header inside the shell', () => {
  it('renders nothing, so no route shows two navigations', () => {
    // Eighteen files still import Header. Rather than edit pages belonging to
    // later waves, it yields to the shell.
    //
    // Counting navigations named "Main" would not catch this: Header's own
    // <nav> carries no such name, so a duplicated navigation would be
    // invisible to that assertion. The brand mark is what both render.
    pathname.current = '/dashboard'
    render(
      <AppShell>
        <Header />
        <p>page body</p>
      </AppShell>,
    )
    expect(screen.getAllByText('pyAgloGen3D')).toHaveLength(1)
    expect(screen.getAllByRole('navigation')).toHaveLength(2) // Main + Breadcrumb
  })

  it('still renders on its own, outside the shell', () => {
    pathname.current = '/dashboard'
    render(<Header />)
    expect(screen.getByText('pyAgloGen3D')).toBeTruthy()
  })
})
