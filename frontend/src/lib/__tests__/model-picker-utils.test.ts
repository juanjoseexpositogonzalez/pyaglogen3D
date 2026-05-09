/**
 * Unit tests for model-picker-utils — pure functions (no React, no mocks).
 *
 * Covers: buildModelOptions (T4.3/T4.4/T4.5), isModelStale (T4.6).
 * TDD: RED → GREEN → TRIANGULATE.
 */
import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../ai-api'
import { buildModelOptions, isModelStale } from '../model-picker-utils'

// ── Fixtures ──────────────────────────────────────────────────────────

const MODELS: ModelInfo[] = [
  { id: 'gpt-4o', display_name: 'GPT 4o', is_recommended: true },
  { id: 'gpt-4o-mini', display_name: 'GPT 4o Mini', context_window: 128000, is_recommended: false },
  { id: 'gpt-4-turbo', display_name: 'GPT 4 Turbo', is_recommended: false },
]

const SINGLE_MODEL: ModelInfo[] = [
  { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4 20250514', is_recommended: true },
]

// ── buildModelOptions ─────────────────────────────────────────────────

describe('buildModelOptions', () => {
  it('returns one option per available model with correct value and label', () => {
    const opts = buildModelOptions(MODELS)
    expect(opts).toHaveLength(3)
    expect(opts[0]).toMatchObject({ value: 'gpt-4o', label: 'GPT 4o' })
    expect(opts[1]).toMatchObject({ value: 'gpt-4o-mini', label: 'GPT 4o Mini' })
  })

  it('marks recommended model with isRecommended=true', () => {
    const opts = buildModelOptions(MODELS)
    const recommended = opts.filter(o => o.isRecommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0].value).toBe('gpt-4o')
  })

  it('returns empty array when no models and no current selection', () => {
    const opts = buildModelOptions([])
    expect(opts).toEqual([])
  })

  it('returns empty array when no models and current model is empty string', () => {
    const opts = buildModelOptions([], '')
    expect(opts).toEqual([])
  })

  // ── Stale model (T4.5) ───────────────────────────────

  it('adds stale option when currentModelName is not in available_models', () => {
    const opts = buildModelOptions(MODELS, 'gpt-3.5-turbo')
    expect(opts).toHaveLength(4) // 3 from catalog + 1 stale
    const stale = opts.find(o => o.value === 'gpt-3.5-turbo')
    expect(stale).toBeDefined()
    expect(stale!.isStale).toBe(true)
    expect(stale!.isRecommended).toBe(false)
  })

  it('does NOT add stale option when currentModelName IS in available_models', () => {
    const opts = buildModelOptions(MODELS, 'gpt-4o')
    expect(opts).toHaveLength(3)
    expect(opts.every(o => !o.isStale)).toBe(true)
  })

  it('handles single model catalog correctly', () => {
    const opts = buildModelOptions(SINGLE_MODEL)
    expect(opts).toHaveLength(1)
    expect(opts[0].isRecommended).toBe(true)
    expect(opts[0].isStale).toBe(false)
  })

  it('adds stale option when catalog is empty but current model is set', () => {
    const opts = buildModelOptions([], 'gpt-4o')
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({
      value: 'gpt-4o',
      label: 'gpt-4o',
      isStale: true,
      isRecommended: false,
    })
  })
})

// ── isModelStale ──────────────────────────────────────────────────────

describe('isModelStale', () => {
  it('returns true when current model is not in non-empty catalog', () => {
    expect(isModelStale(MODELS, 'gpt-3.5-turbo')).toBe(true)
  })

  it('returns false when current model IS in catalog', () => {
    expect(isModelStale(MODELS, 'gpt-4o')).toBe(false)
  })

  it('returns false when catalog is empty (empty state, not stale)', () => {
    expect(isModelStale([], 'gpt-4o')).toBe(false)
  })

  it('returns false when no current model is set', () => {
    expect(isModelStale(MODELS)).toBe(false)
    expect(isModelStale(MODELS, '')).toBe(false)
  })
})
