import { describe, expect, it } from 'vitest'
import { candidateQueries, expandStreet, geocodeFirst, parseGeocode, parseRoute } from '../../supabase/functions/estimate-route/route'

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

// ---------- geocodificação em tentativas (fix 2026-11-03) ----------
// Endereços reais que voltavam km nulo: o Nominatim não acha "Av. São Rafael, 2152, São Rafael, ...",
// mas acha "Avenida São Rafael 2152, Salvador, BA" e postalcode=41253-190.
const SAO_RAFAEL = { street: 'Av. São Rafael, 2152', district: 'São Rafael', city: 'salvador', state: 'BA', zip: '41253-190' }
const ARIVALDO = { street: 'Rua Arivaldo de carvalho 734', district: 'Sobradinho', city: 'Feira de Santana', state: 'BA', zip: '44021-225' }

describe('expandStreet', () => {
  it.each([
    ['Av. São Rafael, 2152', 'Avenida São Rafael, 2152'],
    ['Av São Rafael 2152', 'Avenida São Rafael 2152'],
    ['R. das Flores, 10', 'Rua das Flores, 10'],
    ['R Bahia 5', 'Rua Bahia 5'],
    ['Rod. BR-116, km 3', 'Rodovia BR-116, km 3'],
    ['Trav. Um, 2', 'Travessa Um, 2'],
    ['Al. Santos, 3', 'Alameda Santos, 3'],
    ['Pç. da Sé, 1', 'Praça da Sé, 1'],
    ['Pça. da Sé, 1', 'Praça da Sé, 1'],
    ['Pca da Sé 1', 'Praça da Sé 1'],
    ['Est. Velha, 9', 'Estrada Velha, 9'],
    ['Av. Dr. José Silva, 4', 'Avenida Doutor José Silva, 4'],
    ['Rua Arivaldo de carvalho 734', 'Rua Arivaldo de carvalho 734'],
    ['Avenida Brasil, 1', 'Avenida Brasil, 1'],
    ['Estrada do Coco, 2', 'Estrada do Coco, 2'],
    ['Rodovia X, 1', 'Rodovia X, 1'],
  ])('%s → %s', (inp, out) => {
    expect(expandStreet(inp)).toBe(out)
  })
})

describe('candidateQueries', () => {
  it('Av. São Rafael: rua expandida, +bairro, CEP, bairro (nessa ordem)', () => {
    expect(candidateQueries(SAO_RAFAEL)).toEqual([
      { q: 'Avenida São Rafael 2152, salvador, BA' },
      { q: 'Avenida São Rafael 2152, São Rafael, salvador, BA' },
      { postalcode: '41253-190', country: 'Brasil' },
      { q: 'São Rafael, salvador, BA' },
    ])
  })
  it('Rua Arivaldo: primeiro candidato é a rua com número + cidade + UF', () => {
    const c = candidateQueries(ARIVALDO)
    expect(c[0]).toEqual({ q: 'Rua Arivaldo de carvalho 734, Feira de Santana, BA' })
    expect(c).toHaveLength(4)
  })
  it('sem bairro nem CEP: só a rua; nunca mais de 4', () => {
    expect(candidateQueries({ street: 'R. A, 1', city: 'Passos', state: 'MG' })).toEqual([{ q: 'Rua A 1, Passos, MG' }])
    expect(candidateQueries({ street: '', city: '', state: '' })).toEqual([])
  })
  it('CEP inválido é ignorado; CEP sem hífen é formatado', () => {
    expect(candidateQueries({ street: 'Rua A 1', city: 'X', state: 'MG', zip: '123' })).toEqual([{ q: 'Rua A 1, X, MG' }])
    expect(candidateQueries({ street: 'Rua A 1', city: 'X', state: 'MG', zip: '37900000' })).toContainEqual({ postalcode: '37900-000', country: 'Brasil' })
  })
})

describe('geocodeFirst', () => {
  it('tenta em ordem, espera entre chamadas e para no primeiro achado', async () => {
    const calls: string[] = []
    const waits: number[] = []
    const fetchJson = async (params: Record<string, string>) => {
      calls.push(JSON.stringify(params))
      return calls.length === 3 ? [{ lat: '-12.9', lon: '-38.4' }] : []
    }
    const r = await geocodeFirst(candidateQueries(SAO_RAFAEL), fetchJson, async (ms) => void waits.push(ms), () => 0)
    expect(r).toEqual({ lat: -12.9, lon: -38.4 })
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([1100, 1100])
  })
  it('erro numa tentativa não derruba: segue para a próxima; sem tempo, para', async () => {
    let n = 0
    const r = await geocodeFirst(
      candidateQueries(SAO_RAFAEL),
      async () => {
        n++
        if (n === 1) throw new Error('HTTP 503')
        return [{ lat: '1', lon: '2' }]
      },
      async () => {},
      () => 0,
    )
    expect(r).toEqual({ lat: 1, lon: 2 })
    let t = 0
    const none = await geocodeFirst(candidateQueries(SAO_RAFAEL), async () => [], async () => void (t += 1100), () => t, 2000)
    expect(none).toBeNull()
    expect(t).toBeLessThanOrEqual(2200)
  })
})
