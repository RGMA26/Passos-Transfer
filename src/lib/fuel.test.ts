import { describe, it, expect } from 'vitest'
import { conflictText, fuelOptions, fuelUnit, valuesConflict } from './fuel'

const norm = (s: string) => s.replace(/[  ]/g, ' ')

describe('combustível', () => {
  it('opções pelo tipo do carro', () => {
    expect(fuelOptions('flex')).toEqual(['gasolina', 'alcool'])
    expect(fuelOptions('hibrido')).toEqual(['gasolina', 'eletrico'])
    expect(fuelOptions('diesel')).toEqual(['diesel'])
    expect(fuelOptions('gnv')).toEqual(['gnv'])
    expect(fuelOptions('eletrico')).toEqual(['eletrico'])
    expect(fuelOptions(null)).toHaveLength(5)
  })

  it('unidades', () => {
    expect(fuelUnit('gasolina')).toBe('L')
    expect(fuelUnit('alcool')).toBe('L')
    expect(fuelUnit('diesel')).toBe('L')
    expect(fuelUnit('gnv')).toBe('m³')
    expect(fuelUnit('eletrico')).toBe('kWh')
  })

  it('conflito com a tolerância do banco (40 × 6,19)', () => {
    expect(valuesConflict(40, 6.19, 247.6)).toBe(false)
    expect(valuesConflict(40, 6.19, 247.65)).toBe(false)
    expect(valuesConflict(40, 6.19, 274.6)).toBe(true)
    // R$ 0,10 mínimo em valores pequenos
    expect(valuesConflict(1, 5, 5.1)).toBe(false)
    expect(valuesConflict(1, 5, 5.11)).toBe(true)
  })

  it('texto da conta', () => {
    expect(norm(conflictText(40, 6.19, 274.6, 'gasolina'))).toBe('40 L × R$ 6,19 = R$ 247,60 ≠ R$ 274,60')
    expect(norm(conflictText(10.5, 4.599, 60, 'gnv'))).toBe('10,5 m³ × R$ 4,599 = R$ 48,29 ≠ R$ 60,00')
  })
})
