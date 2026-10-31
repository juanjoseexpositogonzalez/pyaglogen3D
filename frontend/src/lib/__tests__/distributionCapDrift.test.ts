import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CAPPED_MAGNITUDES, STD_OVER_MEAN_CAP } from '../distributionShape'

// ---------------------------------------------------------------------------
// The client mirror of R2's cap is a hand-copy of two backend facts, and #201
// exists because that mirror was narrower than the backend for months. Its
// sibling - the allow-list drift test - ties one list; this ties the number and
// the set of magnitudes, so neither can be edited on one side only.
// ---------------------------------------------------------------------------

const BACKEND = resolve(
  __dirname,
  '../../../../backend/apps/simulations/distribution_shape.py',
)

function backendSource(): string {
  return readFileSync(BACKEND, 'utf-8')
}

function backendCap(): number {
  const match = backendSource().match(/STD_OVER_MEAN_CAP:\s*float\s*=\s*([0-9.]+)/)
  if (!match) {
    throw new Error(
      'STD_OVER_MEAN_CAP not found in the backend module. If it was renamed, this ' +
        'test must follow it rather than be deleted: it is the only thing tying ' +
        'the two numbers together.',
    )
  }
  return Number(match[1])
}

function backendCappedMagnitudes(): string[] {
  const match = backendSource().match(/CAPPED_MAGNITUDE[^=]*=\s*frozenset\(\s*\{([^}]*)\}/)
  if (!match) {
    throw new Error('CAPPED_MAGNITUDE not found in the backend module.')
  }
  const names: string[] = []
  const pattern = /"([a-z_]+)"/g
  let found = pattern.exec(match[1])
  while (found !== null) {
    names.push(found[1])
    found = pattern.exec(match[1])
  }
  return names.sort()
}

describe('the std/mean cap is the backend one', () => {
  it('uses the same number', () => {
    expect(STD_OVER_MEAN_CAP).toBe(backendCap())
  })

  it('caps the same magnitudes', () => {
    expect([...CAPPED_MAGNITUDES].sort()).toEqual(backendCappedMagnitudes())
  })
})
