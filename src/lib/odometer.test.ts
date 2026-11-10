import { describe, it, expect, beforeEach } from 'vitest'
import { checkReading, fmtInt, lastReading, odometerEcho, parseOdometerText, rememberReading } from './odometer'

beforeEach(() => localStorage.clear())

describe('odômetro', () => {
  it('formata com separador de milhar', () => {
    expect(fmtInt(10102500)).toBe('10.102.500')
    expect(odometerEcho('10102500')).toBe('10.102.500 km')
    expect(odometerEcho('')).toBeNull()
    expect(odometerEcho('57.876')).toBeNull()
  })

  it('só inteiro: ponto, vírgula ou letra é recusado', () => {
    expect(parseOdometerText(' 57876 ')).toBe(57876)
    expect(parseOdometerText('57.876')).toBeNull()
    expect(parseOdometerText('57876,5')).toBeNull()
    expect(parseOdometerText('')).toBeNull()
  })

  it('pede confirmação só acima de 1.000 km da referência', () => {
    expect(checkReading(10102500, 1010000)).toBe(
      'Confira a leitura: 10.102.500 km (9.092.500 km acima da última). Está certa?',
    )
    expect(checkReading(58876, 57876)).toBeNull()
    expect(checkReading(58877, 57876)).not.toBeNull()
    expect(checkReading(1000, null)).toBeNull()
  })

  it('guarda a última leitura por motorista', () => {
    expect(lastReading('u1')).toBeNull()
    rememberReading('u1', 57876)
    rememberReading('u1', 1000)
    expect(lastReading('u1')).toBe(1000)
    expect(lastReading('u2')).toBeNull()
  })
})
