/**
 * Dashboard migrated onto the design-system kit (wave 2).
 *
 * The screen is asserted through what a user can perceive — headings, roles,
 * accessible names and the classes that carry the typographic rules — rather
 * than through which components were imported. A test that checks imports
 * passes a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseProjects = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The deprecated header reads this. Once the page stops mounting it the
  // stub is dead weight, which is itself a signal worth keeping until then.
  usePathname: () => '/dashboard',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => mockUseProjects(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

import DashboardPage from '../page'

const project = (id: string, name: string, sims: number, analyses: number) => ({
  id,
  name,
  description: `Description of ${name}`,
  simulation_count: sims,
  analysis_count: analyses,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
})

describe('Dashboard', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false })
    mockUseProjects.mockReturnValue({
      data: { results: [project('p1', 'Soot aggregates', 6, 2), project('p2', 'Sintered necks', 5, 0)] },
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not mount the deprecated header', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(process.cwd(), 'src/app/dashboard/page.tsx'), 'utf8')

    // Asserted on the import, not on the absence of `<header>` elements: the
    // kit primitives use that tag legitimately, so counting tags would both
    // fail on a correct page and pass on a wrong one.
    //
    // The shell owns navigation now. Leaving the old header imported is how a
    // page ends up with two of them the moment the shell changes.
    expect(source).not.toContain('components/layout/Header')
  })

  it('states the totals it adds up, each next to its own label', () => {
    render(<DashboardPage />)

    // Anchored to the card that owns each figure. Searching for the bare text
    // matches project counts elsewhere on the page, so the assertion would
    // pass while the totals showed anything at all.
    const totalFor = (label: string) => {
      const card = screen.getByText(label).closest('article, section, div')
      return card?.textContent ?? ''
    }

    // 2 projects; 6 + 5 simulations; 2 + 0 analyses.
    expect(totalFor('Total Projects')).toContain('2')
    expect(totalFor('Total Simulations')).toContain('11')
    expect(totalFor('Total Analyses')).toContain('2')
  })

  it('renders every figure tabular, in the cards as well as the totals', () => {
    const { container } = render(<DashboardPage />)

    // Counting globally was not enough: the three totals alone satisfied it,
    // so removing the rule from the project cards went unnoticed. Each card
    // carries two counts of its own, and those are exactly the figures a
    // reader compares down a column.
    const totals = container.querySelectorAll('.num')
    expect(totals.length).toBe(3 + 2 * 2)

    const firstCard = screen.getByRole('link', { name: /soot aggregates/i })
    expect(firstCard.querySelectorAll('.num')).toHaveLength(2)
  })

  it('offers the empty state when there are no projects', () => {
    mockUseProjects.mockReturnValue({ data: { results: [] }, isLoading: false, error: null })
    render(<DashboardPage />)

    expect(screen.getByText('No projects yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: /create project/i })).toBeTruthy()
  })

  it('keeps each project reachable by name', () => {
    render(<DashboardPage />)

    expect(screen.getByRole('link', { name: /soot aggregates/i }).getAttribute('href')).toBe(
      '/projects/p1',
    )
  })

  it('carries no colour literals of its own', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(process.cwd(), 'src/app/dashboard/page.tsx'), 'utf8')

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
  })
})
