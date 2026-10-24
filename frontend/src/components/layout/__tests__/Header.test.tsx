/**
 * T5.4b, covering app-shell-navigation R3 where the contract says it lives.
 *
 * The behaviour was already asserted from inside AppShell.test.tsx, but R3 is
 * about this component's own contract: it must yield when the shell shows its
 * chrome, and must keep working when it does not. A signed-out visitor on an
 * unprotected route has no other navigation.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  current: {
    user: null as { email: string; first_name: string; is_staff: boolean } | null,
    isAuthenticated: false,
    isLoading: false,
    logout: () => {},
  },
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/settings' }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }))
vi.mock('@/lib/ai-api', () => ({
  aiApi: { checkAccess: () => Promise.resolve({ has_access: false }) },
}))

import { AppShellProvider } from '@/components/shell/AppShellContext'

import { Header } from '../Header'

describe('Header', () => {
  it('renders its own navigation when no shell chrome is present', () => {
    render(<Header />)
    expect(screen.getByText('pyAgloGen3D')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sign In/i })).toBeTruthy()
  })

  it('keeps rendering inside the shell while the chrome is hidden', () => {
    // The provider is mounted unconditionally so the tree shape stays stable,
    // but its value follows the chrome. A signed-out visitor must not lose
    // every way to navigate.
    render(
      <AppShellProvider value={false}>
        <Header />
      </AppShellProvider>,
    )
    expect(screen.getByText('pyAgloGen3D')).toBeTruthy()
  })

  it('yields to the shell once the chrome is up', () => {
    const { container } = render(
      <AppShellProvider value>
        <Header />
      </AppShellProvider>,
    )
    expect(container.querySelector('header')).toBeNull()
    expect(screen.queryByText('pyAgloGen3D')).toBeNull()
  })
})
