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

  it('does not print the wire key for a refusal that belongs to no field', () => {
    // The numeric-cast refusal (#115 point 5) is filed under `non_field_errors`,
    // and the sentence a person reads must not begin with a serializer key.
    const error = new ApiError('Request failed: 400', 400, {
      non_field_errors: ["'target_df' must be a real number, got 'abc'."],
    })

    const message = formatApiError(error)
    expect(message).toContain('target_df')
    expect(message).not.toContain('non_field_errors')
  })

  it('survives a details value the wire format does not promise', () => {
    // Joining a non-array would throw inside `onError`, and a throw there leaves
    // the screen empty - the defect this module removes.
    const asString = new ApiError('x', 400, {
      parameter_grid: "not an array" as unknown as string[],
    })
    const withNoise = new ApiError('x', 400, {
      parameter_grid: [42 as unknown as string, 'real message'],
    })

    expect(() => formatApiError(asString)).not.toThrow()
    expect(formatApiError(withNoise)).toContain('real message')
    expect(formatApiError(withNoise)).not.toContain('42')
  })
})


describe('#236 - the failure that is not a field error is still news', () => {
  // `compare/page.tsx` separates these five outcomes and this module used to
  // collapse them into `Request failed: 500`, which tells a reader on a flaky
  // connection that their work is broken when the truth may be "retry".
  it('names an expired session as a session', () => {
    const message = formatApiError(new ApiError('Request failed: 401', 401))
    expect(message).toMatch(/session expired/i)
    expect(message).toMatch(/sign in again/i)
  })

  it('names a missing record as gone, not as the reader\'s fault', () => {
    const message = formatApiError(new ApiError('Request failed: 404', 404))
    expect(message).toMatch(/gone or it is not yours/i)
  })

  it('tells the reader a 500 may be worth retrying', () => {
    const message = formatApiError(new ApiError('Request failed: 500', 500))
    expect(message).toMatch(/server failed/i)
    expect(message).toMatch(/retrying/i)
  })

  it('says a request that never arrived never arrived', () => {
    const message = formatApiError(new TypeError('Failed to fetch'))
    expect(message).toMatch(/did not reach the server/i)
    expect(message).toMatch(/connection/i)
  })

  it('keeps a refusal that names its field exactly as it is', () => {
    const message = formatApiError(
      new ApiError('Request failed: 400', 400, { name: ['This field may not be blank.'] })
    )
    expect(message).toBe('name: This field may not be blank.')
  })
})
