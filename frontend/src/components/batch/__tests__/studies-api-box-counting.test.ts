/**
 * API client tests for the batch box-counting endpoints (spec R3/R5 of
 * change batch-windowed-box-counting).
 *
 * Covers:
 *  - `studiesApi.runBoxCounting` dual response handling: the sync summary
 *    (200) and the 202 Accepted `{task_id, total}` async dispatch.
 *  - `studiesApi.boxCountingJobStatus`: GET .../run-box-counting/<task_id>/
 *    with the canonical `{status, progress, current, total}` payload.
 *  - `studiesApi.fractalAnalysisSummary`: GET .../fractal-analysis/ with the
 *    `{study_id, configs: [{config, estimators}]}` envelope.
 *  - `pollBoxCountingJobStatus`: processing → done and processing → failed
 *    lifecycles, plus the polling timeout.
 *
 * `global.fetch` is mocked because that's what `request`/`authFetch`
 * ultimately call (same pattern as `api-projections.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  studiesApi,
  pollBoxCountingJobStatus,
  ApiError,
} from '@/lib/api'

const PROJECT_ID = 'proj-1'
const STUDY_ID = 'study-1'
const TASK_ID = 'task-abc'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('studiesApi.runBoxCounting — dual response handling', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('returns the sync summary when the backend responds 200 (≤30 work set)', async () => {
    const syncBody = {
      status: 'completed',
      message: 'Box-counting completed: 2 processed, 0 skipped, 0 failed',
      results: {
        total: 2,
        processed: 2,
        skipped: 0,
        failed: 0,
        errors: [],
      },
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, syncBody))

    const result = await studiesApi.runBoxCounting(PROJECT_ID, STUDY_ID, {
      points_per_sphere: 100,
      precision: 18,
    })

    // Sync summary (no task_id) — discriminated by the 'task_id' key
    expect('task_id' in result).toBe(false)
    expect(result).toEqual(syncBody)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain(
      `/projects/${PROJECT_ID}/studies/${STUDY_ID}/run-box-counting/`,
    )
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toContain('"points_per_sphere":100')
  })

  it('returns the 202 {task_id, total} shape when the run dispatches async (>30 work set)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(202, { task_id: TASK_ID, total: 31 }),
    )

    const result = await studiesApi.runBoxCounting(PROJECT_ID, STUDY_ID, {
      points_per_sphere: 100,
      precision: 18,
      windowed: true,
    })

    expect('task_id' in result).toBe(true)
    expect(result).toEqual({ task_id: TASK_ID, total: 31 })
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toContain(
      '"windowed":true',
    )
  })
})

describe('studiesApi.boxCountingJobStatus', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('GETs the canonical status endpoint and returns the payload', async () => {
    const payload = {
      status: 'processing',
      progress: 0.5,
      current: 15,
      total: 31,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, payload))

    const status = await studiesApi.boxCountingJobStatus(
      PROJECT_ID,
      STUDY_ID,
      TASK_ID,
    )

    expect(status).toEqual(payload)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain(
      `/projects/${PROJECT_ID}/studies/${STUDY_ID}/run-box-counting/${TASK_ID}/`,
    )
  })
})

describe('studiesApi.fractalAnalysisSummary', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('GETs the fractal-analysis endpoint and returns the {study_id, configs} envelope', async () => {
    const envelope = {
      study_id: STUDY_ID,
      configs: [
        {
          config: { kf: 1.7 },
          estimators: {
            rg: { n: 2, mean: 1.82, median: 1.82, q1: 1.81, q3: 1.83, min: 1.81, max: 1.83, values: [1.81, 1.83], insufficient_levels: 0, errors: 0 },
            bc_legacy: { n: 2, mean: 1.79, median: 1.79, q1: 1.78, q3: 1.8, min: 1.78, max: 1.8, values: [1.78, 1.8], insufficient_levels: 0, errors: 0 },
            bc_windowed: { n: 1, mean: 1.81, median: 1.81, q1: null, q3: null, min: 1.81, max: 1.81, values: [1.81], insufficient_levels: 1, errors: 0 },
          },
        },
      ],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, envelope))

    const summary = await studiesApi.fractalAnalysisSummary(PROJECT_ID, STUDY_ID)

    expect(summary).toEqual(envelope)
    expect(summary.configs[0].estimators.bc_windowed.insufficient_levels).toBe(1)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain(
      `/projects/${PROJECT_ID}/studies/${STUDY_ID}/fractal-analysis/`,
    )
  })
})

describe('pollBoxCountingJobStatus', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  it('polls through processing states until done, reporting progress', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { status: 'processing', progress: 0.2, current: 6, total: 31 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { status: 'processing', progress: 0.7, current: 21, total: 31 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { status: 'done', progress: 1.0, current: 31, total: 31 }),
      )

    const onProgress = vi.fn()
    const final = await pollBoxCountingJobStatus(PROJECT_ID, STUDY_ID, TASK_ID, {
      intervalMs: 1,
      onProgress,
    })

    expect(final.status).toBe('done')
    expect(final.total).toBe(31)
    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('resolves (does not throw) with the failed payload and its error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: 'failed', error: 'celery worker exploded' }),
    )

    const final = await pollBoxCountingJobStatus(PROJECT_ID, STUDY_ID, TASK_ID, {
      intervalMs: 1,
    })

    expect(final.status).toBe('failed')
    expect(final.error).toBe('celery worker exploded')
  })

  it('terminates when the backend maps REVOKED to failed (F2)', async () => {
    // The status endpoint maps REVOKED/RETRY onto `failed` with a clear
    // error; the poller must resolve on that payload, not spin until the
    // 30-minute deadline.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: 'failed',
        progress: 0.0,
        current: 0,
        total: 0,
        error: 'Task ended in state REVOKED',
      }),
    )

    const final = await pollBoxCountingJobStatus(PROJECT_ID, STUDY_ID, TASK_ID, {
      intervalMs: 1,
    })

    expect(final.status).toBe('failed')
    expect(final.error).toBe('Task ended in state REVOKED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws ApiError when the polling deadline passes', async () => {
    // Fresh Response per call — a Response body can only be consumed once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, { status: 'processing', progress: 0.0, current: 0, total: 31 }),
      ),
    )

    await expect(
      pollBoxCountingJobStatus(PROJECT_ID, STUDY_ID, TASK_ID, {
        intervalMs: 1,
        timeoutMs: 10,
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
