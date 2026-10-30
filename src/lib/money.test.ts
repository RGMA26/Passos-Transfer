import { describe, expect, it } from 'vitest'
import { formatBRL, parseBRL } from './money'

describe('parseBRL', () => {
  it('parses values', () => {
    expect(parseBRL('45,90')).toBe(45.9)
    expect(parseBRL('R$ 1.234,50')).toBe(1234.5)
    expect(parseBRL('12.5')).toBe(12.5)
    expect(parseBRL('abc')).toBeNull()
    expect(parseBRL('')).toBeNull()
  })
})

describe('formatBRL', () => {
  it('formats', () => {
    expect(formatBRL(1234.5).replace(/ /g, ' ')).toBe('R$ 1.234,50')
  })
})
