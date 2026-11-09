/**
 * AI provider settings migrated onto the design-system kit (issue #183, slice 2).
 *
 * Asserted through what a reader can perceive — headings, labels, roles,
 * messages, empty states — plus two things the page has to keep regardless of
 * how it is built: it draws no navigation or page frame of its own, and it
 * carries no colour literal.
 *
 * The page manages API keys, so the tests also pin the one property that
 * matters: the key is collected in a password field and travels to the API,
 * but it is never rendered back as page text.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPush, mockUseAuth, mockAiApi } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockUseAuth: vi.fn(),
  mockAiApi: {
    checkAccess: vi.fn(),
    listProviders: vi.fn(),
    createProvider: vi.fn(),
    deleteProvider: vi.fn(),
    testProvider: vi.fn(),
    refreshModels: vi.fn(),
    updateProvider: vi.fn(),
    setDefaultProvider: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@/lib/ai-api', () => ({
  aiApi: mockAiApi,
}))

import AISettingsPage from '../page'

const provider = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  provider: 'anthropic',
  model_name: 'claude-sonnet-4-20250514',
  is_default: true,
  is_active: true,
  available_models: [],
  models_refreshed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const sourceOf = async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  return readFileSync(join(process.cwd(), 'src/app/ai/settings/page.tsx'), 'utf8')
}

const addProviderButtons = () =>
  screen.getAllByRole('button', { name: /^add provider$/i })

describe('AI Settings', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'ada@example.com' },
      isLoading: false,
    })
    mockAiApi.checkAccess.mockResolvedValue({ has_access: true, reason: 'staff' })
    mockAiApi.listProviders.mockResolvedValue({ results: [provider()] })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('draws no navigation of its own: the shell owns the only one', async () => {
    const { container } = render(<AISettingsPage />)
    await screen.findByRole('heading', { level: 1, name: /ai settings/i })

    // Not "renders no <header>": the kit's own PageHeader is a <header>, so that
    // assertion would fail for the wrong reason. A <nav> is what a screen
    // growing its own navigation looks like, and the shell draws the only one
    // this route gets. Asserted after the screen has loaded, so the loading
    // branch cannot satisfy it.
    expect(container.querySelector('nav')).toBeNull()
  })

  it('draws no page frame of its own: the shell owns the gutter and the padding', async () => {
    const { container } = render(<AISettingsPage />)
    await screen.findByRole('heading', { level: 1, name: /ai settings/i })
    const source = await sourceOf()

    expect(container.querySelector('main')).toBeNull()
    expect(source).not.toMatch(/\bcontainer\b/)
  })

  it('titles the page once, at level 1', async () => {
    render(<AISettingsPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /ai settings/i }),
    ).toBeTruthy()
  })

  it('gates the settings behind the access check, without loading providers', async () => {
    mockAiApi.checkAccess.mockResolvedValue({
      has_access: false,
      reason: 'not_granted',
    })
    render(<AISettingsPage />)

    expect(
      await screen.findByRole('heading', { level: 2, name: /access required/i }),
    ).toBeTruthy()
    expect(mockAiApi.listProviders).not.toHaveBeenCalled()
  })

  it('offers the add form from the no-providers empty state', async () => {
    mockAiApi.listProviders.mockResolvedValue({ results: [] })
    render(<AISettingsPage />)

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: /no ai providers configured/i,
      }),
    ).toBeTruthy()

    const buttons = addProviderButtons()
    fireEvent.click(buttons[buttons.length - 1])

    expect(
      screen.getByRole('heading', { level: 2, name: /add ai provider/i }),
    ).toBeTruthy()
  })

  it('marks the account default with a worded pill, not colour alone', async () => {
    render(<AISettingsPage />)

    expect(await screen.findByText('Default')).toBeTruthy()
  })

  it('tests a provider and reports the result beside it', async () => {
    mockAiApi.testProvider.mockResolvedValue({
      success: true,
      message: 'Connection OK',
      models: null,
      refreshed_at: null,
    })
    render(<AISettingsPage />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Test connection' }),
    )

    expect(await screen.findByText('Connection OK')).toBeTruthy()
  })

  it('collects the key in a password field and sends it without rendering it back', async () => {
    mockAiApi.createProvider.mockResolvedValue(provider())
    render(<AISettingsPage />)

    await screen.findByRole('heading', { level: 1, name: /ai settings/i })
    fireEvent.click(addProviderButtons()[0])

    const keyInput = screen.getByLabelText(/api key/i) as HTMLInputElement
    // A password field keeps the key off a shoulder-surfer's screen and out
    // of a screen reader's readout.
    expect(keyInput.getAttribute('type')).toBe('password')

    // The value below is a synthetic fixture, not a credential.
    fireEvent.change(keyInput, { target: { value: 'fixture-token' } })

    const buttons = addProviderButtons()
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(mockAiApi.createProvider).toHaveBeenCalled())
    expect(mockAiApi.createProvider.mock.calls[0][0]).toMatchObject({
      provider: 'anthropic',
      api_key: 'fixture-token',
      // A provider already exists, so the new one is not the default.
      is_default: false,
    })
    // The key never becomes page text.
    expect(document.body.textContent).not.toContain('fixture-token')
  })

  it('announces a failed provider load as an alert', async () => {
    mockAiApi.listProviders.mockRejectedValue(new Error('Network down'))
    render(<AISettingsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Network down')
  })

  it('falls back to its own wording when the failure is not an Error', async () => {
    mockAiApi.listProviders.mockRejectedValue('nope')
    render(<AISettingsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Failed to load providers')
  })

  it('carries no colour literal and no shadcn card or alert bridge', async () => {
    const source = await sourceOf()

    expect(source).not.toMatch(/#(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(/)
    expect(source).not.toMatch(
      /\b(?:bg|text|border)-(?:yellow|green|red|blue|purple|slate|gray)-\d{2,3}\b/,
    )
    expect(source).not.toContain('ui/card')
    expect(source).not.toContain('ui/alert')
  })
})
