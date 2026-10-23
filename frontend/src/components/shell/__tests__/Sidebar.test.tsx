/**
 * Covers app-shell-navigation R4 (grouped, context-aware navigation) and the
 * accessible-name half of R6.
 *
 * Rendered at component level with an explicit `pathname`, not through a
 * route: no test in this repository renders `app/layout.tsx`, which is a
 * Server Component importing `next/font/google`, so a route-level assertion
 * would pass vacuously.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Sidebar } from '../Sidebar'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const project = { id: 'p1', name: 'Soot campaign' }

describe('Sidebar', () => {
  it('always offers the workspace destinations', () => {
    render(<Sidebar pathname="/dashboard" />)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Projects' })).toBeTruthy()
  })

  it('shows the project group, named after the project, while one is in scope', () => {
    render(<Sidebar pathname="/projects/p1" project={project} />)

    expect(screen.getByText('Soot campaign')).toBeTruthy()
    ;[
      'Overview',
      'New simulation',
      'Batch studies',
      'New FRAKTAL analysis',
      'FRAKTAL batches',
    ].forEach((label) => expect(screen.getByRole('link', { name: label })).toBeTruthy())
  })

  it('hides the project group outside a project', () => {
    render(<Sidebar pathname="/dashboard" />)
    expect(screen.queryByRole('link', { name: 'Batch studies' })).toBeNull()
  })

  it('offers the assistant only to users who have access', () => {
    const { unmount } = render(<Sidebar pathname="/dashboard" hasAiAccess={false} />)
    expect(screen.queryByRole('link', { name: 'AI Assistant' })).toBeNull()
    unmount()

    render(<Sidebar pathname="/dashboard" hasAiAccess />)
    expect(screen.getByRole('link', { name: 'AI Assistant' })).toBeTruthy()
  })

  it('offers the admin section only to administrators', () => {
    const { unmount } = render(<Sidebar pathname="/dashboard" isAdmin={false} />)
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
    unmount()

    render(<Sidebar pathname="/dashboard" isAdmin />)
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy()
  })

  it('marks the current destination for assistive technology, not only by colour', () => {
    render(<Sidebar pathname="/projects" />)
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull()
  })

  it('offers only destinations that exist in the product', () => {
    // An earlier version linked Simulations and FRAKTAL analyses with
    // `?section=`, which no page reads, and Compare without the `?sims=` it
    // requires. All three came from the Base44 prototype, not the product.
    render(<Sidebar pathname="/projects/p1" project={project} />)

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs.some((h) => h?.includes('section='))).toBe(false)
    expect(hrefs).toContain('/projects/p1/batch')
    expect(hrefs).toContain('/projects/p1/fraktal/batch')
    expect(hrefs).toContain('/projects/p1/simulations/new')
  })

  it('keeps an accessible name when collapsed to icons', () => {
    // The label leaves the screen in the 1280-1439px band; it must not leave
    // the accessibility tree with it.
    render(<Sidebar pathname="/dashboard" collapsed />)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.queryByText('Workspace')).toBeNull()
  })

  it('reports engine state in words as well as with a dot', () => {
    render(<Sidebar pathname="/dashboard" engine={{ online: true, queued: 3 }} />)
    expect(screen.getAllByText('Engine online').length).toBeGreaterThan(0)
    expect(screen.getByText('3 queued')).toBeTruthy()
  })
})
