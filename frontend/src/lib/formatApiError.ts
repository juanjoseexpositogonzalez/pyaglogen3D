/**
 * Turn a rejected request into something a person can act on.
 *
 * DRF reports a refused payload as `{field: ["message", ...]}` - one entry per
 * field the server looked at. Rendered raw it is noise; dropped it leaves the
 * generic `Request failed: 400`, which tells the reader nothing about which
 * field to fix. The backend work in #115 points 2, 4 and 5 exists precisely so
 * that a refusal names its field, and this is the client half of it.
 */
import { ApiError } from './api'

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError && error.details) {
    const lines = Object.entries(error.details)
      .filter(([, messages]) => messages.length > 0)
      .map(([field, messages]) => `${field}: ${messages.join(' ')}`)
    if (lines.length > 0) return lines.join('\n')
  }
  if (error instanceof Error && error.message) return error.message
  return 'The request failed.'
}
