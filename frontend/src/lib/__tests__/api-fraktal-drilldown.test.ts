/**
 * Unit tests for fraktalApi drill-down methods (T5.1, change:
 * fraktal-drilldown-and-csv).
 *
 * Covers:
 *   - getBatch(projectId, batchId)
 *   - getBatchImage(projectId, batchId, index)
 *   - getBatchImagePngUrl(projectId, batchId, index) — pure, no fetch
 *   - reanalyzeBatchImage(projectId, batchId, index)
 *   - deleteBatch(projectId, batchId)
 *   - downloadBatchCsv(projectId, batchId) — blob download
 *   - downloadSingleCsv(projectId, analysisId) — blob download
 *   - analyzeBatch project-scoped URL migration
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  fraktalApi,
  type FraktalBatchResult,
} from '@/lib/api'

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
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response
}

function csvBlobResponse(status: number, csv: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'text/csv' : null,
    },
    json: async () => ({}),
    text: async () => csv,
    blob: async () => new Blob([csv], { type: 'text/csv' }),
  } as unknown as Response
}

const PROJECT_ID = 'proj-1'
const BATCH_ID = 'batch-abc'
const ANALYSIS_ID = 'analysis-xyz'

// ---------- test suite ----------

describe('fraktalApi drill-down methods (T5.1)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- getBatch ---
  describe('getBatch', () => {
    it('fetches batch detail from the project-scoped URL', async () => {
      const payload = { batch_id: BATCH_ID, images: [], stats: {} }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(200, payload)
      )

      const result = await fraktalApi.getBatch(PROJECT_ID, BATCH_ID)
      expect(result).toEqual(payload)

      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledUrl).toContain(`/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/`)
    })

    it('rejects with ApiError on 404', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(404, { detail: 'Not found' })
      )

      await expect(fraktalApi.getBatch(PROJECT_ID, 'bad')).rejects.toBeInstanceOf(ApiError)
    })
  })

  // --- getBatchImage ---
  describe('getBatchImage', () => {
    it('fetches image detail from the project-scoped URL', async () => {
      const payload = {
        batch_id: BATCH_ID,
        index: 0,
        filename: 'proj_000.png',
        fractal_dimension: 1.7,
        prev_index: null,
        next_index: 1,
      }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(200, payload)
      )

      const result = await fraktalApi.getBatchImage(PROJECT_ID, BATCH_ID, 0)
      expect(result).toEqual(payload)

      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledUrl).toContain(
        `/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/images/0/`
      )
    })

    it('rejects with ApiError on 404 for out-of-range index', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(404, { detail: 'Image index out of range' })
      )

      await expect(
        fraktalApi.getBatchImage(PROJECT_ID, BATCH_ID, 999)
      ).rejects.toBeInstanceOf(ApiError)
    })
  })

  // --- getBatchImagePngUrl ---
  describe('getBatchImagePngUrl', () => {
    it('returns a URL string containing the project-scoped PNG path', () => {
      const url = fraktalApi.getBatchImagePngUrl(PROJECT_ID, BATCH_ID, 2)
      expect(typeof url).toBe('string')
      expect(url).toContain(
        `/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/images/2/png/`
      )
    })

    it('returns different URLs for different indexes', () => {
      const url0 = fraktalApi.getBatchImagePngUrl(PROJECT_ID, BATCH_ID, 0)
      const url5 = fraktalApi.getBatchImagePngUrl(PROJECT_ID, BATCH_ID, 5)
      expect(url0).not.toBe(url5)
      expect(url0).toContain('/images/0/png/')
      expect(url5).toContain('/images/5/png/')
    })
  })

  // --- reanalyzeBatchImage ---
  describe('reanalyzeBatchImage', () => {
    it('POSTs to the reanalyze endpoint and returns the analysis id', async () => {
      const payload = { analysis_id: 'new-analysis-123' }
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(200, payload)
      )

      const result = await fraktalApi.reanalyzeBatchImage(PROJECT_ID, BATCH_ID, 3)
      expect(result).toEqual(payload)

      const [calledUrl, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(calledUrl).toContain(
        `/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/images/3/reanalyze/`
      )
      expect(opts.method).toBe('POST')
    })
  })

  // --- deleteBatch ---
  describe('deleteBatch', () => {
    it('sends DELETE to the project-scoped batch URL', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(204, undefined)
      )

      await fraktalApi.deleteBatch(PROJECT_ID, BATCH_ID)

      const [calledUrl, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(calledUrl).toContain(
        `/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/`
      )
      expect(opts.method).toBe('DELETE')
    })
  })

  // --- downloadBatchCsv ---
  describe('downloadBatchCsv', () => {
    it('fetches CSV blob from the batch csv endpoint', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        csvBlobResponse(200, 'index,Df\n0,1.7')
      )

      const blob = await fraktalApi.downloadBatchCsv(PROJECT_ID, BATCH_ID)
      expect(blob).toBeInstanceOf(Blob)

      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledUrl).toContain(
        `/projects/${PROJECT_ID}/fraktal/batches/${BATCH_ID}/csv/`
      )
    })
  })

  // --- downloadSingleCsv ---
  describe('downloadSingleCsv', () => {
    it('fetches CSV blob from the single analysis csv endpoint', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        csvBlobResponse(200, 'analysis_id,Df\nabc,1.7')
      )

      const blob = await fraktalApi.downloadSingleCsv(PROJECT_ID, ANALYSIS_ID)
      expect(blob).toBeInstanceOf(Blob)

      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledUrl).toContain(
        `/projects/${PROJECT_ID}/fraktal/${ANALYSIS_ID}/csv/`
      )
    })
  })

  // --- analyzeBatch URL migration ---
  describe('analyzeBatch project-scoped URL', () => {
    it('uses the project-scoped URL when projectId is provided', async () => {
      const expected: FraktalBatchResult = {
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
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(200, expected)
      )

      const mockFile = new File([new ArrayBuffer(10)], 'test.zip', {
        type: 'application/zip',
      })

      await fraktalApi.analyzeBatch(
        { file: mockFile, algorithm: 'granulated_2012' },
        { projectId: PROJECT_ID }
      )

      const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(calledUrl).toContain(
        `/projects/${PROJECT_ID}/fraktal/analyze-batch/`
      )
      // Must NOT hit the old global endpoint (which is /api/v1/fraktal/analyze-batch/)
      expect(calledUrl).not.toMatch(/\/api\/v1\/fraktal\/analyze-batch\/$/)
    })
  })
})
