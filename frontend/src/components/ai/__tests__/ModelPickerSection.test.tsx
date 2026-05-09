/**
 * Unit tests for <ModelPickerSection /> — AI model catalog UI (T4.3–T4.8).
 *
 * Tests verify behavioral output: what text the user sees. No CSS assertions,
 * no implementation details. Pure data-in → text-out.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelPickerSection } from '../ModelPickerSection'
import type { ModelInfo } from '@/lib/ai-api'

// ── Fixtures ──────────────────────────────────────────────────────────

const MODELS: ModelInfo[] = [
  { id: 'gpt-4o', display_name: 'GPT 4o', is_recommended: true },
  { id: 'gpt-4o-mini', display_name: 'GPT 4o Mini', context_window: 128000, is_recommended: false },
  { id: 'gpt-4-turbo', display_name: 'GPT 4 Turbo', is_recommended: false },
]

// ── T4.3: Empty state CTA ─────────────────────────────────────────────

describe('ModelPickerSection — empty state', () => {
  it('renders CTA message when available_models is empty', () => {
    render(
      <ModelPickerSection
        availableModels={[]}
        currentModelName=""
        modelsRefreshedAt={null}
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    expect(screen.getByText(/test connection to load available models/i)).toBeTruthy()
  })

  it('does NOT render CTA when models are available', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    expect(screen.queryByText(/test connection to load available models/i)).toBeNull()
  })
})

// ── T4.4: Dropdown populates from available_models ────────────────────

describe('ModelPickerSection — dropdown', () => {
  it('renders a select with one option per model', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    const select = screen.getByRole('combobox')
    expect(select).toBeTruthy()
    // All models are rendered as options (recommended has ⭐ prefix)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0].textContent).toContain('GPT 4o')
    expect(options[1].textContent).toContain('GPT 4o Mini')
    expect(options[2].textContent).toContain('GPT 4 Turbo')
  })

  it('calls onModelChange when selection changes', () => {
    const onChange = vi.fn()
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={onChange}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'gpt-4o-mini' } })
    expect(onChange).toHaveBeenCalledWith('gpt-4o-mini')
  })
})

// ── T4.5: Recommended badge ───────────────────────────────────────────

describe('ModelPickerSection — recommended badge', () => {
  it('shows star indicator for recommended model option', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    // The recommended option should have a ⭐ in its text
    const options = screen.getAllByRole('option')
    const recommendedOpt = options.find(o => o.getAttribute('value') === 'gpt-4o')
    expect(recommendedOpt).toBeTruthy()
    expect(recommendedOpt!.textContent).toContain('⭐')
  })

  it('does NOT show star for non-recommended models', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    const options = screen.getAllByRole('option')
    const nonRecommended = options.filter(o => o.getAttribute('value') === 'gpt-4o-mini')
    expect(nonRecommended[0].textContent).not.toContain('⭐')
  })
})

// ── T4.6: Stale model warning ─────────────────────────────────────────

describe('ModelPickerSection — stale warning', () => {
  it('shows warning when current model is not in catalog', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-3.5-turbo"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    expect(screen.getByText(/not in latest catalog/i)).toBeTruthy()
  })

  it('does NOT show warning when current model is in catalog', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    expect(screen.queryByText(/not in latest catalog/i)).toBeNull()
  })
})

// ── T4.7: Relative time display ───────────────────────────────────────

describe('ModelPickerSection — refresh time', () => {
  it('shows relative time text when modelsRefreshedAt is set', () => {
    // Use a date from a few hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt={twoHoursAgo}
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    expect(screen.getByText(/refreshed.*ago/i)).toBeTruthy()
  })

  it('does NOT show refresh time when modelsRefreshedAt is null', () => {
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt={null}
        onModelChange={() => {}}
        onRefreshModels={() => Promise.resolve()}
      />
    )
    expect(screen.queryByText(/refreshed/i)).toBeNull()
  })
})

// ── T4.8: Refresh button calls onRefreshModels ────────────────────────

describe('ModelPickerSection — refresh action', () => {
  it('calls onRefreshModels when refresh button is clicked', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <ModelPickerSection
        availableModels={MODELS}
        currentModelName="gpt-4o"
        modelsRefreshedAt="2026-05-09T10:00:00Z"
        onModelChange={() => {}}
        onRefreshModels={onRefresh}
      />
    )
    const refreshBtn = screen.getByRole('button', { name: /refresh/i })
    fireEvent.click(refreshBtn)
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })
})
