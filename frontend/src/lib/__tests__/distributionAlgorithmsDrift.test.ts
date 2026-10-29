import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DISTRIBUTION_ALGORITHMS } from '../sinteringShape'

// ---------------------------------------------------------------------------
// The client's list of algorithms that consume the distribution keys is a
// hand-copy of the backend's `CONSUMING_ALGORITHMS`. Its sibling - the
// sintering list - already has this guard, and a judge pointed out that the
// new copy had none: if the backend widens or narrows the set, the form keeps
// offering or hiding both keys forever with a green suite, which is exactly
// the 400-the-page-cannot-display failure T6 exists to fix.
// ---------------------------------------------------------------------------

const BACKEND = resolve(
  __dirname,
  '../../../../backend/apps/simulations/distribution_shape.py',
)

function backendConsumingAlgorithms(): string[] {
  const source = readFileSync(BACKEND, 'utf-8')
  const block = source.match(/CONSUMING_ALGORITHMS[^=]*=\s*frozenset\(\s*\{([^}]*)\}/)
  if (!block) {
    throw new Error(
      'CONSUMING_ALGORITHMS not found in the backend module. If it was renamed, ' +
        'this test must follow it rather than be deleted: it is the only thing ' +
        'tying the two lists together.',
    )
  }
  const names: string[] = []
  const pattern = /"([a-z_]+)"/g
  let match = pattern.exec(block[1])
  while (match !== null) {
    names.push(match[1])
    match = pattern.exec(block[1])
  }
  return names.sort()
}

describe('the distribution allow-list is the backend one', () => {
  it('matches CONSUMING_ALGORITHMS exactly', () => {
    expect([...DISTRIBUTION_ALGORITHMS].sort()).toEqual(backendConsumingAlgorithms())
  })
})
