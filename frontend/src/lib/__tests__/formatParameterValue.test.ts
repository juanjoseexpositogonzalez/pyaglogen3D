import { describe, it, expect } from 'vitest'
import { formatParameterValue } from '../formatParameterValue'

describe('formatParameterValue', () => {
  it('renders a distribution object as its JSON, never as a placeholder', () => {
    expect(formatParameterValue({ mode: 'fixed', value: 1.9 })).toBe('{"mode":"fixed","value":1.9}')
  })

  it('renders a scalar as its string form', () => {
    expect(formatParameterValue(60)).toBe('60')
    expect(formatParameterValue(1.5)).toBe('1.5')
  })

  it('renders an absent value as an em dash, like Num does', () => {
    expect(formatParameterValue(null)).toBe('—')
    expect(formatParameterValue(undefined)).toBe('—')
  })
})
