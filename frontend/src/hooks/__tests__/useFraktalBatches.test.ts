/**
 * Tests for useFraktalBatches hook + fraktalApi.listBatches.
 *
 * Covers:
 *   - listBatches(projectId) calls the correct endpoint
 *   - useFraktalBatches returns paginated batch data from react-query
 *   - Hook disabled when projectId is empty
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import { fraktalApi } from '@/lib/api'
import { useFraktalBatches } from '@/hooks/useFraktalBatches'

// ---------- helpers ----------

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const PROJECT_ID = 'proj-123'

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

// ---------- test suite ----------

describe('fraktalApi.listBatches', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the project-scoped batches list URL', async () => {
    const payload = {
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 'batch-1',
          status: 'completed',
          created_at: '2026-04-28T10:00:00Z',
          n_images: 5,
          mean_df: 1.78,
          algorithm: 'granulated_2012',
          dpo_used: 25.0,
        },
      ],
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, payload)
    )

    const result = await fraktalApi.listBatches(PROJECT_ID)
    expect(result).toEqual(payload)

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(calledUrl).toContain(`/projects/${PROJECT_ID}/fraktal/batches/`)
  })

  it('propagates API errors', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(403, { detail: 'Forbidden' })
    )

    await expect(fraktalApi.listBatches(PROJECT_ID)).rejects.toThrow()
  })
})

describe('useFraktalBatches hook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches batches via react-query when projectId is provided', async () => {
    const payload = {
      count: 2,
      next: null,
      previous: null,
      results: [
        { id: 'b1', status: 'completed', n_images: 3, mean_df: 1.80 },
        { id: 'b2', status: 'completed', n_images: 5, mean_df: 1.72 },
      ],
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, payload)
    )

    const { result } = renderHook(() => useFraktalBatches(PROJECT_ID), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.count).toBe(2)
    expect(result.current.data?.results).toHaveLength(2)
    expect(result.current.data?.results[0].id).toBe('b1')
  })

  it('is disabled when projectId is empty', () => {
    const { result } = renderHook(() => useFraktalBatches(''), {
      wrapper: makeWrapper(),
    })

    // Should NOT fire a fetch — query is disabled
    expect(result.current.fetchStatus).toBe('idle')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
