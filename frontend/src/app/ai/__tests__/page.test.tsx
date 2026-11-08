/**
 * AI assistant migrated onto the design-system kit (issue #183, slice 2).
 *
 * Asserted through what a reader can perceive — headings, roles, messages,
 * empty states — plus the source-level contracts a DOM assertion cannot see:
 * the deprecated `Header` is no longer mounted, no page frame of the screen's
 * own is drawn, and no colour literal came along. A test that only counted
 * imports would pass a refactor that breaks the page.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPush, mockUseAuth, mockProjectsList, mockAiApi } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockUseAuth: vi.fn(),
  mockProjectsList: vi.fn(),
  mockAiApi: {
    checkAccess: vi.fn(),
    listProviders: vi.fn(),
    getActiveConversation: vi.fn(),
    listConversations: vi.fn(),
    listNotifications: vi.fn(),
    getUnreadCount: vi.fn(),
    getRecentSimulations: vi.fn(),
    chat: vi.fn(),
    addMessage: vi.fn(),
    clearConversation: vi.fn(),
    createConversation: vi.fn(),
    setActiveConversation: vi.fn(),
    getConversation: vi.fn(),
    deleteConversation: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/lib/ai-api', () => ({
  aiApi: mockAiApi,
}))

vi.mock('@/lib/api', () => ({
  projectsApi: { list: () => mockProjectsList() },
}))

import AIAssistantPage from '../page'

// jsdom has no layout, so the transcript's auto-scroll would throw.
window.HTMLElement.prototype.scrollIntoView = vi.fn()

const provider = () => ({
  id: 'p1',
  provider: 'anthropic' as const,
  model_name: 'claude-sonnet-4-20250514',
  is_default: true,
  is_active: true,
  available_models: [],
  models_refreshed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'New Conversation',
  project: null,
  is_active: true,
  message_count: 0,
  messages: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const storedMessage = (overrides: Record<string, unknown> = {}) => ({
  id: 'm1',
  role: 'user',
  content: 'Hello there',
  tool_calls: [],
  token_usage: {},
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const notification = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  notification_type: 'simulation_complete',
  notification_type_display: 'Simulation complete',
  title: 'Run finished',
  message: 'Your simulation finished',
  data: {},
  is_read: false,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const simulation = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Run one',
  algorithm: 'dla',
  status: 'completed',
  n_particles: 1000,
  project_id: 'proj-1',
  project_name: 'Agglomerates',
  created_at: '2026-01-01T00:00:00Z',
  completed_at: '2026-01-01T00:05:00Z',
  metrics: { fractal_dimension: 2.5, radius_of_gyration: 1.234 },
  ...overrides,
})

const sourceOf = async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  return readFileSync(join(process.cwd(), 'src/app/ai/page.tsx'), 'utf8')
}

const titleAppears = () =>
  screen.findByRole('heading', { level: 1, name: /ai assistant/i })

describe('AI Assistant', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'ada@example.com' },
      isLoading: false,
    })
    mockAiApi.checkAccess.mockResolvedValue({ has_access: true, reason: 'staff' })
    mockAiApi.listProviders.mockResolvedValue({ results: [provider()] })
    mockProjectsList.mockResolvedValue({
      results: [{ id: 'proj-1', name: 'Agglomerates' }],
    })
    mockAiApi.getActiveConversation.mockResolvedValue(conversation())
    mockAiApi.listConversations.mockResolvedValue({ results: [conversation()] })
    mockAiApi.listNotifications.mockResolvedValue({ results: [] })
    mockAiApi.getUnreadCount.mockResolvedValue({ count: 0 })
    mockAiApi.getRecentSimulations.mockResolvedValue({ simulations: [] })
    mockAiApi.chat.mockResolvedValue({
      message: 'Hi from the model',
      tool_calls: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    mockAiApi.addMessage.mockResolvedValue({})
    mockAiApi.markAllNotificationsRead.mockResolvedValue({ message: 'ok' })
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
    const { container } = render(<AIAssistantPage />)
    await titleAppears()
    const source = await sourceOf()

    // `/ai` is not chromeless (AppShell.isChromeless is `/` and `/auth/*`
    // only), so the shell already wraps this route in a padded, max-width
    // column. A `<main>` of the screen's own stacked a second landmark on top
    // of the shell's.
    expect(container.querySelector('main')).toBeNull()
    expect(source).not.toMatch(/\bcontainer\b/)
  })

  it('titles the page once, at level 1', async () => {
    render(<AIAssistantPage />)

    expect(await titleAppears()).toBeTruthy()
  })

  it('gates the assistant behind the access check, without loading data', async () => {
    mockAiApi.checkAccess.mockResolvedValue({
      has_access: false,
      reason: 'not_granted',
    })
    render(<AIAssistantPage />)

    expect(
      await screen.findByRole('heading', { level: 2, name: /access required/i }),
    ).toBeTruthy()
    expect(screen.getByText(/not enabled for your account/i)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /back to dashboard/i }),
    ).toBeTruthy()
    expect(mockAiApi.listProviders).not.toHaveBeenCalled()
  })

  it('asks for a provider through the empty state when none is configured', async () => {
    mockAiApi.listProviders.mockResolvedValue({ results: [] })
    render(<AIAssistantPage />)

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /configure ai provider/i,
      }),
    ).toBeTruthy()
    const link = screen.getByRole('link', {
      name: /go to settings/i,
    }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/ai/settings')
  })

  it('renders the stored conversation as speaker-labelled turns', async () => {
    mockAiApi.getActiveConversation.mockResolvedValue(
      conversation({
        messages: [
          storedMessage({ id: 'm1', role: 'user', content: 'Which algorithms exist?' }),
          storedMessage({
            id: 'm2',
            role: 'assistant',
            content: 'DLA and DLCA.',
            tool_calls: [],
          }),
        ],
        message_count: 2,
      }),
    )
    render(<AIAssistantPage />)

    expect(await screen.findByText('Which algorithms exist?')).toBeTruthy()
    expect(screen.getByText('DLA and DLCA.')).toBeTruthy()
    expect(screen.getAllByText('You').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AI Assistant').length).toBeGreaterThan(0)
  })

  it('sends the composed history and appends the assistant reply', async () => {
    render(<AIAssistantPage />)

    const input = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Run a DLA simulation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() =>
      expect(mockAiApi.chat).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Run a DLA simulation' }],
        undefined,
      ),
    )
    expect(await screen.findByText('Hi from the model')).toBeTruthy()
  })

  it('passes the selected project as the chat context', async () => {
    render(<AIAssistantPage />)

    const select = (await screen.findByLabelText(
      'Project context',
    )) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'proj-1' } })
    const input = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() =>
      expect(mockAiApi.chat).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Hello' }],
        'proj-1',
      ),
    )
  })

  it('announces a chat failure and restores the input', async () => {
    mockAiApi.chat.mockRejectedValue(new Error('Model unavailable'))
    render(<AIAssistantPage />)

    const input = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Model unavailable')
    await waitFor(() => expect(input.value).toBe('Hello'))
  })

  it('shows a simulation state as a worded chip and Rg as the engine value', async () => {
    mockAiApi.getRecentSimulations.mockResolvedValue({
      simulations: [simulation()],
    })
    render(<AIAssistantPage />)

    // State is never colour alone: the chip always carries its word.
    expect(await screen.findByText('Completed')).toBeTruthy()
    // Df and Rg go through `Num`, which keeps the unit a sibling; with no
    // parameters exposed, Rg stays the dimensionless engine value.
    expect(screen.getByText('2.50')).toBeTruthy()
    expect(screen.getByText('1.23')).toBeTruthy()
    expect(screen.getByText('(engine)')).toBeTruthy()
  })

  it('scales Rg to nm when the backend exposes the particle diameter', async () => {
    mockAiApi.getRecentSimulations.mockResolvedValue({
      simulations: [
        simulation({ parameters: { primary_particle_diameter_nm: 100 } }),
      ],
    })
    render(<AIAssistantPage />)

    // 1.234 engine units × (100 / 2) nm = 61.7 nm.
    expect(await screen.findByText('61.7')).toBeTruthy()
    expect(screen.getByText('nm')).toBeTruthy()
    expect(screen.queryByText('(engine)')).toBeNull()
  })

  it('marks all notifications read through the API', async () => {
    mockAiApi.listNotifications.mockResolvedValue({
      results: [notification()],
    })
    mockAiApi.getUnreadCount.mockResolvedValue({ count: 3 })
    render(<AIAssistantPage />)

    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }))

    await waitFor(() =>
      expect(mockAiApi.markAllNotificationsRead).toHaveBeenCalled(),
    )
  })

  it('carries no colour literal, no card bridge and no deprecated header', async () => {
    const source = await sourceOf()

    expect(source).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
    // The raw Tailwind palettes (`bg-gray-800`, `text-green-400`) are not
    // tokens: they survived the old theme and would survive the next one.
    expect(source).not.toMatch(
      /\b(?:bg|text|border)-(?:yellow|green|red|blue|purple|slate|gray)-\d{2,3}\b/,
    )
    expect(source).not.toContain('ui/card')
    expect(source).not.toContain('components/layout/Header')
  })
})
