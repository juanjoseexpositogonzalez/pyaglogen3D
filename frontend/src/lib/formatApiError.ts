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

/** DRF's key for a refusal that belongs to no single field. */
const NO_FIELD = 'non_field_errors'

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError && error.details) {
    const lines = Object.entries(error.details)
      .map(([field, messages]) => {
        // The wire format is not guaranteed: a value that is not an array, or
        // an array holding something that is not a string, would make `join`
        // throw *inside* `onError` - and a throw there leaves the screen empty,
        // which is the exact defect this module exists to remove.
        const text = (Array.isArray(messages) ? messages : [])
          .filter((message): message is string => typeof message === 'string')
          .join(' ')
        if (!text) return ''
        // `non_field_errors` is not a field: printing it verbatim puts a
        // serializer key in the sentence a person reads, and the message
        // already names what it is about (#115, point 6).
        return field === NO_FIELD ? text : `${field}: ${text}`
      })
      .filter((line) => line.length > 0)
    if (lines.length > 0) return lines.join('\n')
  }
  if (error instanceof Error && error.message) return error.message
  return 'The request failed.'
}
