import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const rpc = vi.fn()
let inserted: Record<string, unknown> | null = null

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      insert: (v: Record<string, unknown>) => {
        inserted = v
        return Promise.resolve({ error: null })
      },
    }),
  },
}))
import { closeDriverPeriod, createTransfer, estimateRoute, type AddressInput } from './api'

const o: AddressInput = { street: 'Rua A, 10', district: 'Centro', city: 'Palmas', state: 'TO', zip: '77000-000', ref: 'Portão azul' }
const d: AddressInput = { street: 'Av B, 20', district: 'Plano', city: 'Palmas', state: 'TO' }

beforeEach(() => {
  invoke.mockReset()
  rpc.mockReset()
  inserted = null
})

describe('estimateRoute', () => {
  it('chama a Edge Function estimate-route e devolve o km', async () => {
    invoke.mockResolvedValue({ data: { km: 12.3 }, error: null })
    expect(await estimateRoute(o, d)).toBe(12.3)
    expect(invoke).toHaveBeenCalledWith('estimate-route', {
      body: {
        origin: { street: 'Rua A, 10', district: 'Centro', city: 'Palmas', state: 'TO', zip: '77000-000' },
        destination: { street: 'Av B, 20', district: 'Plano', city: 'Palmas', state: 'TO', zip: '' },
      },
    })
  })
  it.each([
    ['km null', { data: { km: null, reason: 'NOT_FOUND' }, error: null }],
    ['erro HTTP', { data: null, error: new Error('x') }],
  ])('%s -> null', async (_n, res) => {
    invoke.mockResolvedValue(res)
    expect(await estimateRoute(o, d)).toBeNull()
  })
  it('exceção -> null', async () => {
    invoke.mockRejectedValue(new Error('rede'))
    expect(await estimateRoute(o, d)).toBeNull()
  })
})

describe('createTransfer', () => {
  it('grava as colunas de endereço e o km estimado', async () => {
    await createTransfer({
      driver_id: 'd1',
      client_name: 'Hotel',
      scheduled_at: '2026-11-02T17:30:00.000Z',
      ride_date: '2026-11-02',
      origin: o,
      destination: d,
      amount: 100,
      estimated_km: 12.3,
    })
    expect(inserted).toMatchObject({
      platform: 'transfer',
      transfer_status: 'assigned',
      origin_street: 'Rua A, 10',
      origin_district: 'Centro',
      origin_city: 'Palmas',
      origin_state: 'TO',
      origin_zip: '77000-000',
      origin_ref: 'Portão azul',
      dest_street: 'Av B, 20',
      dest_zip: null,
      dest_ref: null,
      estimated_km: 12.3,
      origin: 'Rua A, 10 – Centro, Palmas/TO',
    })
  })
})

describe('closeDriverPeriod', () => {
  it('chama close_driver_period sempre com todos os parâmetros', async () => {
    rpc.mockResolvedValue({ data: 's1', error: null })
    await closeDriverPeriod('p1')
    expect(rpc).toHaveBeenLastCalledWith('close_driver_period', {
      p_period: 'p1',
      p_force: false,
      p_allow_missing_fuel_price: false,
    })
    await closeDriverPeriod('p1', { force: true, allowMissingFuelPrice: true })
    expect(rpc).toHaveBeenLastCalledWith('close_driver_period', {
      p_period: 'p1',
      p_force: true,
      p_allow_missing_fuel_price: true,
    })
  })
  it('erro do servidor vira Error com o código na mensagem', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PREVIOUS_OPEN', code: 'P0001' } })
    await expect(closeDriverPeriod('p1')).rejects.toThrow('PREVIOUS_OPEN')
  })
})
