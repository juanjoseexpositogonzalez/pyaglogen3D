/**
 * Unit tests for `fraktalApi.analyzeBatch` polling helper (T4.8, change:
 * fraktal-batch-analysis).
 *
 * Covers the sync/async dual-mode flow documented in api.ts:
 *   - 200 sync: resolve with the parsed payload directly
 *   - 202 async: poll /fraktal-status/{job_id}/ until done, then GET
 *     /fraktal-status/{job_id}/results/
 *   - 4xx: reject with ApiError (status surfaced)
 *   - status=failed: reject with the backend-provided error
 *   - timeout: reject when maxWaitMs elapses with the job still processing
 *
 * All tests stub `global.fetch`. `authFetch` inside api.ts wraps `fetch`
 * but only adds Authorization headers and an optional 401 refresh loop —
 * with a clean localStorage (no refresh token) the wrapper is effectively
 * a pass-through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, fraktalApi, type FraktalBatchResult } from '@/lib/api'

function makeResultFixture(): FraktalBatchResult {
  return {
    images: [],
    stats: {
      n_images: 0,
      n_successful: 0,
      mean_df: null,
      std_df: null,
      median_df: null,
      q1_df: null,
      q3_df: null,
      min_df: null,
      max_df: null,
    },
    histogram: null,
    comparison: null,
    calibration: {
      source: 'metadata',
      pixels_per_100nm: 500,
      dpo_used: 25,
      autocalibrate_image: null,
    },
  }
}

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
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response
}

describe('fraktalApi.analyzeBatch', () => {
  const mockFile = new File([new ArrayBuffer(100)], 'test.zip', {
    type: 'application/zip',
  })

  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves with the parsed result on a 200 sync response', async () => {
    const expected = makeResultFixture()
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, expected)
    )

    const result = await fraktalApi.analyzeBatch({
      file: mockFile,
      algorithm: 'granulated_2012',
    })
    expect(result).toEqual(expected)
  })

  it('polls the status endpoint on a 202 async response and resolves on done', async () => {
    const expected = makeResultFixture()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    fetchMock
      // POST /fraktal/analyze-batch/ → accepted async
      .mockResolvedValueOnce(jsonResponse(202, { job_id: 'abc123' }))
      // GET /fraktal-status/abc123/ → processing tick
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'processing',
          progress: 0.5,
          current: 5,
          total: 10,
          stage: 'analyzing',
        })
      )
      // GET /fraktal-status/abc123/ → done
      .mockResolvedValueOnce(jsonResponse(200, { status: 'done' }))
      // GET /fraktal-status/abc123/results/
      .mockResolvedValueOnce(jsonResponse(200, expected))

    const onProgress = vi.fn()
    const result = await fraktalApi.analyzeBatch(
      { file: mockFile, algorithm: 'granulated_2012' },
      { onProgress, pollIntervalMs: 1 }
    )

    expect(result).toEqual(expected)
    expect(onProgress).toHaveBeenCalledWith({
      progress: 0.5,
      current: 5,
      total: 10,
      stage: 'analyzing',
    })
  })

  it('rejects with ApiError on a 400 validation response', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(400, { detail: 'No calibration available' })
    )

    await expect(
      fraktalApi.analyzeBatch({
        file: mockFile,
        algorithm: 'granulated_2012',
      })
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects when the async job reports status=failed', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { job_id: 'fail-job' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { status: 'failed', error: 'Rust analyzer crashed' })
      )

    await expect(
      fraktalApi.analyzeBatch(
        { file: mockFile, algorithm: 'granulated_2012' },
        { pollIntervalMs: 1 }
      )
    ).rejects.toThrow(/crashed/)
  })

  it('rejects with a timeout error when maxWaitMs elapses with the job still processing', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse(202, { job_id: 'slow-job' })
    )
    // Every subsequent poll returns processing — the helper should bail
    // when Date.now() - startedAt exceeds maxWaitMs (10 ms here).
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        status: 'processing',
        progress: 0,
        current: 0,
        total: 100,
        stage: 'analyzing',
      })
    )

    await expect(
      fraktalApi.analyzeBatch(
        { file: mockFile, algorithm: 'granulated_2012' },
        { pollIntervalMs: 1, maxWaitMs: 10 }
      )
    ).rejects.toThrow(/timed out/i)
  })
})
