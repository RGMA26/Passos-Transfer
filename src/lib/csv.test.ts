import { describe, it, expect } from 'vitest'
import { toCSV } from './csv'

describe('toCSV', () => {
  it('começa com BOM e usa vírgula decimal com 2 casas', () => {
    const out = toCSV([{ motorista: 'João', total: 213 }])
    expect(out.startsWith('\uFEFF')).toBe(true)
    expect(out).toContain('João;213,00')
  })
  it('cabeçalho vem das chaves da primeira linha, CRLF entre linhas', () => {
    const out = toCSV([
      { a: 'x', b: 1.5 },
      { a: 'y', b: -2 },
    ])
    expect(out).toBe('\uFEFFa;b\r\nx;1,50\r\ny;-2,00')
  })
  it('cita strings com ; aspas e quebra de linha, escapando aspas', () => {
    const out = toCSV([{ a: 'x;y', b: 'diz "oi"', c: 'l1\nl2', d: 'ok' }])
    expect(out).toContain('"x;y";"diz ""oi""";"l1\nl2";ok')
  })
  it('lista vazia gera só o BOM', () => {
    expect(toCSV([])).toBe('\uFEFF')
  })
})
