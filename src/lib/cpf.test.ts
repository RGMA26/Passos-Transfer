import { describe, expect, it } from 'vitest'
import { formatCpf, isValidCpf } from './cpf'

describe('cpf', () => {
  it('valida com e sem máscara', () => {
    expect(isValidCpf('52998224725')).toBe(true)
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('10000001090')).toBe(true)
  })
  it('rejeita inválidos', () => {
    expect(isValidCpf('52998224726')).toBe(false)
    expect(isValidCpf('11111111111')).toBe(false)
    expect(isValidCpf('1234567890')).toBe(false)
    expect(isValidCpf('529.982.247/25')).toBe(false)
    expect(isValidCpf('')).toBe(false)
  })
  it('formata', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25')
    expect(formatCpf('123')).toBe('123')
  })
})
