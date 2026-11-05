/**
 * A refused payload must reach the caller with the field the server named (#115, point 6).
 *
 * DRF answers a refused study as `{field: ["message", ...]}` - never `message`,
 * `detail` or `details`. The client read only those three, so every validation
 * error the backend reports arrived as `Request failed: 400`, with the field
 * name thrown away. The batch page has no `onError` either, which is the other
 * half of the same problem: a rejected study was an invisible dead button.
 *
 * Plain matchers only: this repository's vitest setup does not load
 * @testing-library/jest-dom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, studiesApi } from '../api'
import { formatApiError } from '../formatApiError'

const BODY = {
  parameter_grid: ["'target_df' must be a real number, got 'abc'."],
  base_parameters: ['n_particles must be at least 10'],
}

function mockRefusal(body: unknown, status = 400) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => body,
      headers: new Headers(),
    }),
  )
}

describe('a refused request keeps the fields the server named', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('puts the DRF field errors on the ApiError', async () => {
    mockRefusal(BODY)

    const error = await studiesApi.create('p1', {} as never).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.details).toEqual(BODY)
  })

  it('formats them so a reader can tell which field to fix', async () => {
    mockRefusal(BODY)

    const error = await studiesApi.create('p1', {} as never).catch((e: unknown) => e)

    const message = formatApiError(error)
    expect(message).toContain('parameter_grid')
    expect(message).toContain('target_df')
    expect(message).not.toBe('Request failed: 400')
  })

  it('leaves an ordinary message alone', () => {
    expect(formatApiError(new Error('boom'))).toBe('boom')
  })
})
