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

    // Exact, not `toContain`: a substring match accepts '2.000', which is
    // what the card rendered until it was told these are counts. The loose
    // assertion is why that shipped green.
    expect(totalFor('Total Projects')).toBe('Total Projects2')
    expect(totalFor('Total Simulations')).toBe('Total Simulations11')
    expect(totalFor('Total Analyses')).toBe('Total Analyses2')
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

  it('announces loading before any total exists', () => {
    mockUseProjects.mockReturnValue({ data: undefined, isLoading: true, error: null })
    const { container } = render(<DashboardPage />)

    expect(screen.getByText(/loading projects/i)).toBeTruthy()
    // Totals computed from absent data would read as zero, which is a claim
    // about the user's projects rather than about the request.
    expect(container.querySelectorAll('.num')).toHaveLength(0)
  })

  it('says so when the projects cannot be loaded', () => {
    mockUseProjects.mockReturnValue({ data: undefined, isLoading: false, error: new Error('nope') })
    const { container } = render(<DashboardPage />)

    expect(screen.getByText(/projects could not be loaded/i)).toBeTruthy()
    expect(container.querySelectorAll('.num')).toHaveLength(0)
  })

  it('shows at most six recent projects', () => {
    mockUseProjects.mockReturnValue({
      data: {
        results: Array.from({ length: 9 }, (_, i) => project(`p${i}`, `Project ${i}`, i, i)),
      },
      isLoading: false,
      error: null,
    })
    render(<DashboardPage />)

    // "Recent" is the whole point: an unbounded list turns this section into
    // a second, worse projects page.
    const cards = screen.getAllByRole('link', { name: /^Project \d/ })
    expect(cards).toHaveLength(6)
  })

  it('keeps the page heading and its primary action', () => {
    render(<DashboardPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /new project/i }).getAttribute('href')).toBe(
      '/projects/new',
    )
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
