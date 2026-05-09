/**
 * Pure utility functions for the AI model picker UI.
 *
 * Extracted to enable direct unit testing without component mocks.
 */
import type { ModelInfo } from './ai-api'

export interface ModelOption {
  value: string
  label: string
  isRecommended: boolean
  isStale: boolean
}

/**
 * Build select options from available models and current selection.
 *
 * - Maps each ModelInfo to a ModelOption
 * - If currentModelName is set but not in available_models, adds it as a stale option
 * - Returns empty array when no models and no current selection
 */
export function buildModelOptions(
  availableModels: ModelInfo[],
  currentModelName?: string,
): ModelOption[] {
  const options: ModelOption[] = availableModels.map((m) => ({
    value: m.id,
    label: m.display_name,
    isRecommended: m.is_recommended,
    isStale: false,
  }))

  // If current model is set and not found in catalog, add as stale entry
  if (currentModelName && currentModelName.length > 0) {
    const found = availableModels.some((m) => m.id === currentModelName)
    if (!found) {
      options.push({
        value: currentModelName,
        label: currentModelName,
        isRecommended: false,
        isStale: true,
      })
    }
  }

  return options
}

/**
 * Check whether a stale model warning should be shown.
 *
 * Stale = currentModelName is set AND available_models is non-empty AND
 * currentModelName is not found in available_models by id.
 */
export function isModelStale(
  availableModels: ModelInfo[],
  currentModelName?: string,
): boolean {
  if (!currentModelName || currentModelName.length === 0) return false
  if (availableModels.length === 0) return false
  return !availableModels.some((m) => m.id === currentModelName)
}
