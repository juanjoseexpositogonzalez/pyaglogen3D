import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SINTERING_ALGORITHMS } from '../sinteringShape'

// ---------------------------------------------------------------------------
// The client's list of algorithms that consume sintering is a hand-copy of the
// backend's. A judge pointed out that nothing tied the two, and that drift is
// exactly the failure T6 exists to fix: the backend learned in T4 which
// algorithms consume sintering, the form did not, and the mismatch showed up
// as a 400 the page cannot display.
//
// So this test reads the backend constant. If someone adds an algorithm there
// and not here, the option stays hidden forever with a green suite; if someone
// narrows it there, the silent 400 comes back.
// ---------------------------------------------------------------------------

const BACKEND = resolve(
  __dirname,
  '../../../../backend/apps/simulations/sintering_shape.py',
)

function backendSinteringAlgorithms(): string[] {
  const source = readFileSync(BACKEND, 'utf-8')
  const block = source.match(/SINTERING_ALGORITHMS = frozenset\(\s*\{([^}]*)\}/)
  if (!block) {
    throw new Error(
      'SINTERING_ALGORITHMS not found in the backend module. If it was renamed, ' +
        'this test must follow it rather than be deleted: it is the only thing ' +
        'tying the two lists together.',
    )
  }
  // A plain exec loop instead of spreading matchAll: this tsconfig targets a
  // level where spreading an iterator needs downlevelIteration, and a test is
  // no reason to loosen the project's compiler settings.
  const names: string[] = []
  const pattern = /"([a-z_]+)"/g
  let match = pattern.exec(block[1])
  while (match !== null) {
    names.push(match[1])
    match = pattern.exec(block[1])
  }
  return names.sort()
}

describe('the client list of sintering algorithms does not drift from the backend', () => {
  it('holds exactly the algorithms the worker receives sintering for', () => {
    expect([...SINTERING_ALGORITHMS].sort()).toEqual(backendSinteringAlgorithms())
  })
})
