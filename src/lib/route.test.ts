import { describe, expect, it } from 'vitest'
import { buildQuery, parseGeocode, parseRoute } from '../../supabase/functions/estimate-route/route'

describe('buildQuery', () => {
  it('junta as partes e ignora vazias', () => {
    expect(buildQuery({ street: 'Rua A, 10', district: 'Centro', city: 'Santos', state: 'SP', zip: '11010-000' }))
      .toBe('Rua A, 10, Centro, Santos, SP, 11010-000')
    expect(buildQuery({ street: ' Rua A ', district: '', city: 'Santos', state: 'SP' })).toBe('Rua A, Santos, SP')
  })
})

describe('parseRoute', () => {
  it('converte metros em km com 1 casa', () => {
    expect(parseRoute({ code: 'Ok', routes: [{ distance: 12345 }] })).toBe(12.3)
    expect(parseRoute({ code: 'Ok', routes: [{ distance: 0 }] })).toBe(0)
  })
  it('devolve null em respostas ruins', () => {
    expect(parseRoute(null)).toBeNull()
    expect(parseRoute({ code: 'NoRoute', routes: [] })).toBeNull()
    expect(parseRoute({ code: 'Ok', routes: [] })).toBeNull()
    expect(parseRoute({ code: 'Ok', routes: [{ distance: 'x' }] })).toBeNull()
  })
})

describe('parseGeocode', () => {
  it('lê lat/lon', () => {
    expect(parseGeocode([{ lat: '-23.5', lon: '-46.6' }])).toEqual({ lat: -23.5, lon: -46.6 })
    expect(parseGeocode([])).toBeNull()
    expect(parseGeocode([{ lat: 'a', lon: '1' }])).toBeNull()
  })
})
