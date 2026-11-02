import { describe, expect, it } from 'vitest'
import { formatBRL, parseBRL } from './money'

describe('parseBRL', () => {
  it('parses values', () => {
    expect(parseBRL('45,90')).toBe(45.9)
    expect(parseBRL('R$ 1.234,50')).toBe(1234.5)
    expect(parseBRL('12.5')).toBe(12.5)
    expect(parseBRL('1.5')).toBe(1.5)
    expect(parseBRL('12.50')).toBe(12.5)
    expect(parseBRL('abc')).toBeNull()
    expect(parseBRL('')).toBeNull()
  })
})

describe('parseBRL: ponto como milhar sem vírgula', () => {
  it.each([
    ['1.200', 1200],
    ['12.345.678', 12345678],
    ['R$ 2.500', 2500],
    ['999.999', 999999],
  ])('%s → %d', (input, value) => {
    expect(parseBRL(input)).toBe(value)
  })

  it('formatos ambíguos ou inválidos', () => {
    expect(parseBRL('1.2345')).toBe(1.2345)
    expect(parseBRL('1.20.0')).toBeNull()
  })
})

describe('formatBRL', () => {
  it('formats', () => {
    expect(formatBRL(1234.5).replace(/ /g, ' ')).toBe('R$ 1.234,50')
  })
})
