/**
 * The public landing (issue #182, slice 3).
 *
 * It is the only route someone without an account sees, and it is chromeless by
 * pathname: the frame is the page's own, so `<main>` here is a decision, not an
 * oversight.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ current: { isAuthenticated: false, isLoading: false } }))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }))

import LandingPage from '../page'

beforeEach(() => {
  auth.current = { isAuthenticated: false, isLoading: false }
})

describe('the landing', () => {
  it('names the product once, at level one', () => {
    render(<LandingPage />)

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('pyAgloGen3D')
  })

  it('offers sign-in and registration to someone without an account', () => {
    render(<LandingPage />)

    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/auth/login')
    expect(screen.getByRole('link', { name: /create account/i }).getAttribute('href')).toBe('/auth/register')
  })

  it('offers the dashboard instead when the session is already live', () => {
    auth.current = { isAuthenticated: true, isLoading: false }
    render(<LandingPage />)

    expect(screen.getByRole('link', { name: /dashboard/i }).getAttribute('href')).toBe('/dashboard')
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
  })

  it('speaks the kit, not the shadcn bridge', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/app/page.tsx', 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(code).not.toMatch(/text-muted-foreground|bg-primary|text-primary-foreground|bg-card|border-border/)
  })
})
