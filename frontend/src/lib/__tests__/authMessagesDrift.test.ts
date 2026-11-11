import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PASSWORDS_DO_NOT_MATCH } from '../authMessages'

// ---------------------------------------------------------------------------
// The registration screen refuses a mismatched confirmation with the backend's
// own sentence, so the reader never meets two vocabularies for one condition
// (#247). Copying that sentence by hand is exactly the drift a judge flagged:
// nothing tied the two, and editing the serializer would silently restore the
// defect with a green suite.
//
// So this test reads the serializer. If the backend rewords it, the client must
// follow — or the refusal starts lying about what the server says.
// ---------------------------------------------------------------------------

const BACKEND = resolve(__dirname, '../../../../backend/apps/accounts/serializers.py')

function backendMismatchMessage(): string {
  const source = readFileSync(BACKEND, 'utf-8')
  const block = source.match(/\{"password_confirm":\s*"([^"]+)"\}/)
  if (!block) {
    throw new Error(
      'The password_confirm refusal was not found in the backend serializer. If it was ' +
        'renamed or moved, this test must follow it rather than be deleted: it is the only ' +
        'thing tying the two sentences together.',
    )
  }
  return block[1]
}

describe('the sentence the client shows when the passwords differ', () => {
  it('is the one the backend produces', () => {
    expect(PASSWORDS_DO_NOT_MATCH).toBe(backendMismatchMessage())
  })
})
