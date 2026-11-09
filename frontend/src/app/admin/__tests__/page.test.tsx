/**
 * Admin users screen migrated onto the design-system kit (issue #183, slice 1).
 *
 * The screen has no table of its own: the users are cards that expand, so
 * `DataTable` is not what holds them. What is tabular is the projects list
 * inside an expanded user — one row per project with counts that a reader
 * compares down the column — and that is the `DataTable` asserted below.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseAuth = vi.fn()
const mockGetDashboard = vi.fn()
const mockUpdateUser = vi.fn()
const mockDeleteUser = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/lib/api', () => ({
  adminApi: {
    getDashboard: () => mockGetDashboard(),
    updateUser: (id: string, payload: unknown) => mockUpdateUser(id, payload),
    deleteUser: (id: string) => mockDeleteUser(id),
  },
}))

vi.mock('@/lib/ai-api', () => ({
  aiApi: { checkAccess: () => Promise.resolve({ has_access: false }) },
}))

import AdminPage from '../page'

interface Row {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  email_verified: boolean
  is_staff: boolean
  is_active: boolean
  has_ai_access: boolean
  oauth_provider: string | null
  created_at: string
  last_login: string | null
  project_count: number
  simulation_count: number
  projects: Array<{
    id: string
    name: string
    description: string
    simulation_count: number
    study_count: number
    created_at: string
  }>
}

const adminUser = (overrides: Partial<Row> = {}): Row => ({
  id: 'u1',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  full_name: 'Ada Lovelace',
  email_verified: true,
  is_staff: false,
  is_active: true,
  has_ai_access: false,
  oauth_provider: null,
  created_at: '2026-10-01T00:00:00Z',
  last_login: null,
  project_count: 2,
  simulation_count: 7,
  projects: [
    {
      id: 'p1',
      name: 'Soot aggregates',
      description: 'DLA runs',
      simulation_count: 5,
      study_count: 3,
      created_at: '2026-10-02T00:00:00Z',
    },
    {
      id: 'p2',
      name: 'Sintered necks',
      description: '',
      simulation_count: 2,
      study_count: 1,
      created_at: '2026-10-03T00:00:00Z',
    },
  ],
  ...overrides,
})

const dashboard = (users: Row[]) => ({
  summary: {
    total_users: users.length,
    total_projects: users.reduce((n, u) => n + u.project_count, 0),
    total_simulations: users.reduce((n, u) => n + u.simulation_count, 0),
  },
  users,
})

const sourceOf = async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  return readFileSync(join(process.cwd(), 'src/app/admin/page.tsx'), 'utf8')
}

describe('Admin users', () => {
  beforeEach(() => {
    mockGetDashboard.mockResolvedValue(dashboard([adminUser()]))
    mockUpdateUser.mockImplementation((_id, payload) =>
      Promise.resolve(adminUser(payload as Partial<Row>)),
    )
    mockDeleteUser.mockResolvedValue({ message: 'deleted' })
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: { id: 'admin-1', email: 'root@example.com', is_staff: true },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('draws no navigation of its own: the shell owns the only one', async () => {
    const { container } = render(<AdminPage />)

    // Waits on a user row, not on the h1: `PageHeader` renders outside the
    // `data ?` branch, so the heading is already there while the screen still
    // shows "Loading admin data...". The table of users is what only the
    // loaded screen can paint.
    await screen.findByText('ada@example.com')

    // Not "renders no <header>": the kit's own PageHeader is a <header>, so that
    // assertion would fail for the wrong reason. A <nav> is what a screen
    // growing its own navigation looks like, and the shell draws the only one
    // this route gets.
    expect(container.querySelector('nav')).toBeNull()
  })

  it('draws no page frame of its own: /admin is not chromeless', async () => {
    const { container } = render(<AdminPage />)
    const source = await sourceOf()

    await screen.findByRole('heading', { level: 1 })

    expect(container.querySelector('main')).toBeNull()
    expect(source).not.toMatch(/\bcontainer\b/)
  })

  it('titles the screen once and offers a refresh that re-reads the dashboard', async () => {
    render(<AdminPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /admin dashboard/i }),
    ).toBeTruthy()
    expect(mockGetDashboard).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(mockGetDashboard).toHaveBeenCalledTimes(2))
  })

  it('states the three totals, right-aligned numbers with no decimals', async () => {
    const { container } = render(<AdminPage />)

    await screen.findByRole('heading', { level: 1 })

    const totalFor = (label: string) => {
      const card = screen.getByText(label).closest('article, section, div')
      return card?.textContent ?? ''
    }

    // Exact, not `toContain`: a substring match accepts '2.000', which is what
    // a card formats to when it is not told these are counts.
    expect(totalFor('Total Users')).toBe('Total Users1')
    expect(totalFor('Total Projects')).toBe('Total Projects2')
    expect(totalFor('Total Simulations')).toBe('Total Simulations7')

    // A count is a number and renders through the numeric primitive.
    expect(container.querySelectorAll('.num').length).toBeGreaterThanOrEqual(3)
  })

  it('lists each account with its email, join date and its own numbers', async () => {
    render(<AdminPage />)

    const heading = await screen.findByRole('heading', { level: 3, name: /ada lovelace/i })
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.getByText(/joined/i)).toBeTruthy()

    // Asserted on the card's text, not through `getByText`: the figure and its
    // unit are separate elements by design, so a text-node matcher misses them
    // and the assertion would be about the markup rather than the reading.
    const card = heading.closest('article')
    expect(card).not.toBeNull()
    expect(card!.textContent).toMatch(/2\s*projects/)
    expect(card!.textContent).toMatch(/7\s*sims/)
  })

  it('names every account flag with a word, not with a colour', async () => {
    mockGetDashboard.mockResolvedValue(
      dashboard([
        adminUser({ is_staff: true, has_ai_access: true, email_verified: false }),
      ]),
    )
    render(<AdminPage />)

    const row = (await screen.findByRole('heading', { level: 3 })).closest('article')
    expect(row).not.toBeNull()
    const pills = Array.from(row!.querySelectorAll('span')).map((s) => s.textContent)

    expect(pills).toContain('Admin')
    expect(pills).toContain('AI')
    // `email_verified: false` is the state the badge names.
    expect(pills).toContain('Unverified')
  })

  it('marks the signed-in account as the reader and withholds the delete control', async () => {
    mockGetDashboard.mockResolvedValue(
      dashboard([adminUser({ id: 'admin-1', full_name: 'Root Operator' })]),
    )
    render(<AdminPage />)

    await screen.findByRole('heading', { level: 3, name: /root operator/i })

    expect(screen.getByText('You')).toBeTruthy()
    // Deleting yourself would take the only administrator with it.
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('expands one account to its projects and says so with aria-expanded', async () => {
    render(<AdminPage />)

    const toggle = await screen.findByRole('button', {
      name: /show projects for ada lovelace/i,
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Soot aggregates')).toBeNull()

    fireEvent.click(toggle)

    expect(
      screen.getByRole('button', { name: /hide projects for ada lovelace/i }).getAttribute(
        'aria-expanded',
      ),
    ).toBe('true')
    expect(screen.getByText('Soot aggregates')).toBeTruthy()
  })

  it('renders the expanded projects as a table with a caption and right-aligned counts', async () => {
    render(<AdminPage />)

    fireEvent.click(
      await screen.findByRole('button', { name: /show projects for ada lovelace/i }),
    )

    const table = screen.getByRole('table')
    // The caption is the accessible name of the table; without it a screen
    // reader announces "table, 3 columns, 3 rows" and nothing else.
    expect(within(table).getByText(/projects owned by ada lovelace/i)).toBeTruthy()

    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => ({ text: th.textContent, align: th.className }))
    const countHeader = headers.find((h) => h.text === 'Simulations')
    expect(countHeader).toBeTruthy()
    // A numeric column is right-aligned and tabular, so decimal separators
    // line up down the column.
    expect(countHeader!.align).toContain('text-right')
    expect(headers.find((h) => h.text === 'Project')!.align).toContain('text-left')

    // Each row keeps the link to its project.
    const link = within(table).getByRole('link', { name: /soot aggregates/i })
    expect(link.getAttribute('href')).toBe('/projects/p1')
  })

  it('says a project list is empty instead of showing a bare table', async () => {
    mockGetDashboard.mockResolvedValue(
      dashboard([adminUser({ projects: [], project_count: 0, simulation_count: 0 })]),
    )
    render(<AdminPage />)

    fireEvent.click(
      await screen.findByRole('button', { name: /show projects for ada lovelace/i }),
    )

    expect(screen.getByText(/no projects yet/i)).toBeTruthy()
  })

  it('asks before deleting, and deletes only after the confirmation', async () => {
    render(<AdminPage />)

    fireEvent.click(await screen.findByRole('button', { name: /delete ada lovelace/i }))

    const prompt = screen.getByRole('alert')
    expect(prompt.textContent).toContain('Delete this user?')
    expect(prompt.textContent).toContain('ada@example.com')
    expect(mockDeleteUser).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mockDeleteUser).toHaveBeenCalledWith('u1'))
    // The row leaves the list and the total follows it.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: /ada lovelace/i })).toBeNull(),
    )
    expect(screen.getByText('Total Users').closest('article, section, div')?.textContent).toBe(
      'Total Users0',
    )
  })

  it('keeps the account on screen when the delete fails', async () => {
    mockDeleteUser.mockRejectedValue(new Error('Still has data'))
    render(<AdminPage />)

    fireEvent.click(await screen.findByRole('button', { name: /delete ada lovelace/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mockDeleteUser).toHaveBeenCalledWith('u1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^deleting/i })).toBeNull(),
    )

    // The row must survive a refused delete: removing it locally would claim a
    // deletion that did not happen.
    expect(screen.getByRole('heading', { level: 3, name: /ada lovelace/i })).toBeTruthy()
    expect(screen.getByText('Total Users').closest('article, section, div')?.textContent).toBe(
      'Total Users1',
    )

    // Known defect, deliberately not fixed here: the catch block writes the
    // message into `editError`, which only the edit form renders, so a refused
    // delete is silent unless the form happens to be open. Repairing it would
    // change behaviour inside a presentation port; it belongs in its own issue.
    expect(screen.queryByText('Still has data')).toBeNull()
  })

  it('saves the edited account through the API and shows the result', async () => {
    render(<AdminPage />)

    fireEvent.click(await screen.findByRole('button', { name: /edit ada lovelace/i }))

    const firstName = screen.getByLabelText(/first name/i)
    fireEvent.change(firstName, { target: { value: 'Augusta' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith('u1', {
        first_name: 'Augusta',
        last_name: 'Lovelace',
        is_staff: false,
        is_active: true,
        has_ai_access: false,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('heading', { level: 4 })).toBeNull())
  })

  it('gives every switch an accessible name and locks the two that guard yourself', async () => {
    mockGetDashboard.mockResolvedValue(
      dashboard([adminUser({ id: 'admin-1', full_name: 'Root Operator', is_staff: true })]),
    )
    render(<AdminPage />)

    fireEvent.click(await screen.findByRole('button', { name: /edit root operator/i }))

    const adminSwitch = screen.getByRole('switch', { name: /admin access/i }) as HTMLButtonElement
    const activeSwitch = screen.getByRole('switch', {
      name: /active account/i,
    }) as HTMLButtonElement
    const aiSwitch = screen.getByRole('switch', {
      name: /ai assistant access/i,
    }) as HTMLButtonElement

    // You cannot demote or deactivate the account you are signed in with.
    expect(adminSwitch.disabled).toBe(true)
    expect(activeSwitch.disabled).toBe(true)
    // Admins always have the assistant, so its switch has nothing to toggle.
    expect(aiSwitch.disabled).toBe(true)
  })

  it('offers an explanation where the user list is empty', async () => {
    mockGetDashboard.mockResolvedValue(dashboard([]))
    render(<AdminPage />)

    expect(await screen.findByText(/no users yet/i)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a failed read as an alert instead of an empty dashboard', async () => {
    mockGetDashboard.mockRejectedValue(new Error('Backend is down'))
    render(<AdminPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Backend is down')
    // An empty list is a claim about the data; a failure is a claim about the
    // request. Rendering the first for the second loses users off the screen.
    expect(screen.queryByText(/no users yet/i)).toBeNull()
  })

  it('never renders the dashboard to a non-staff account', async () => {
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: { id: 'u9', email: 'ada@example.com', is_staff: false },
    })
    render(<AdminPage />)

    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 1, name: /admin dashboard/i })).toBeNull(),
    )
    expect(screen.getByText(/redirecting/i)).toBeTruthy()
  })

  it('carries no colour literal and no shadcn bridge utility of its own', async () => {
    const source = await sourceOf()

    expect(source).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
    expect(source).not.toMatch(/\b(?:bg|text|border)-(?:yellow|green|red|blue|purple|slate|gray)-\d{2,3}\b/)
    expect(source).not.toContain('ui/card')
  })
})
