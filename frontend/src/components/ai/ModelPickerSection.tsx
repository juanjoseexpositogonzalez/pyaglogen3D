/**
 * Model picker section for AI provider config cards.
 *
 * Shows either:
 * - Empty state CTA when no models are available
 * - A <select> dropdown populated from available_models
 *   with recommended badge, stale warning, and refresh time
 */
'use client'

import { useState } from 'react'
import type { ModelInfo } from '@/lib/ai-api'
import { buildModelOptions, isModelStale } from '@/lib/model-picker-utils'
import { formatDistanceToNow } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'

export interface ModelPickerSectionProps {
  availableModels: ModelInfo[]
  currentModelName: string
  modelsRefreshedAt: string | null
  onModelChange: (modelId: string) => void
  onRefreshModels: () => Promise<void>
}

export function ModelPickerSection({
  availableModels,
  currentModelName,
  modelsRefreshedAt,
  onModelChange,
  onRefreshModels,
}: ModelPickerSectionProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const options = buildModelOptions(availableModels, currentModelName)
  const stale = isModelStale(availableModels, currentModelName)

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      await onRefreshModels()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Empty state — no models available
  if (options.length === 0) {
    return (
      <div className="mt-2">
        <p className="text-sm text-yellow-400">
          Test connection to load available models
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Model select dropdown */}
      <div className="flex items-center gap-2">
        <select
          value={currentModelName}
          onChange={(e) => onModelChange(e.target.value)}
          className="flex h-9 w-full appearance-none rounded-md border border-gray-600 bg-gray-700 px-3 py-1 text-sm text-white"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.isRecommended ? `⭐ ${opt.label}` : opt.label}
              {opt.isStale ? ' (stale)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh models"
          className="inline-flex items-center justify-center rounded-md border border-gray-600 p-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Stale model warning */}
      {stale && (
        <p className="text-xs text-yellow-400">
          Not in latest catalog — consider refreshing
        </p>
      )}

      {/* Refresh timestamp */}
      {modelsRefreshedAt && (
        <p className="text-xs text-gray-500">
          Refreshed {formatDistanceToNow(modelsRefreshedAt)}
        </p>
      )}
    </div>
  )
}
