import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const tables: Record<string, unknown> = {}
const calls: unknown[][] = []

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => (calls.push([table, m, ...args]), b)
      }
      const res = () => Promise.resolve({ data: tables[table], error: null })
      b.single = res
      b.maybeSingle = res
      b.then = (r: (v: unknown) => unknown) => res().then(r)
      return b
    },
  },
}))
import { closePeriod, getCurrentPeriod, periodDriverStatements } from './api'

const per = { id: 'p1', start_date: '2026-11-10', end_date: '2026-11-24', status: 'open' }

beforeEach(() => {
  rpc.mockReset()
  calls.length = 0
  tables.driver_periods = per
})

describe('getCurrentPeriod', () => {
  it('usa driver_period_for do motorista e lê a quinzena', async () => {
    rpc.mockResolvedValue({ data: 'p1', error: null })
    expect(await getCurrentPeriod('d1', '2026-11-20')).toEqual(per)
    expect(rpc).toHaveBeenCalledWith('driver_period_for', { p_driver: 'd1', p_date: '2026-11-20' })
    expect(calls).toContainEqual(['driver_periods', 'eq', 'id', 'p1'])
  })

  it('pausado: cai na última quinzena aberta do motorista', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'DRIVER_PAUSED', code: 'P0001' } })
    expect(await getCurrentPeriod('d1', '2026-11-20')).toEqual(per)
    expect(calls).toContainEqual(['driver_periods', 'eq', 'driver_id', 'd1'])
    expect(calls).toContainEqual(['driver_periods', 'eq', 'status', 'open'])
  })

  it('outro erro propaga', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: 'P0001' } })
    await expect(getCurrentPeriod('d1', '2026-11-20')).rejects.toMatchObject({ message: 'FORBIDDEN' })
  })
})

describe('quinzenas globais (removidas)', () => {
  it('periodDriverStatements não está mais disponível', async () => {
    await expect(periodDriverStatements('p1')).rejects.toMatchObject({ code: 'NOT_AVAILABLE' })
  })
})

describe('closePeriod', () => {
  it('chama close_driver_period sempre com todos os parâmetros', async () => {
    rpc.mockResolvedValue({ data: 's1', error: null })
    await closePeriod('p1')
    expect(rpc).toHaveBeenLastCalledWith('close_driver_period', {
      p_period: 'p1',
      p_force: false,
      p_allow_missing_fuel_price: false,
    })
    await closePeriod('p1', true, true)
    expect(rpc).toHaveBeenLastCalledWith('close_driver_period', {
      p_period: 'p1',
      p_force: true,
      p_allow_missing_fuel_price: true,
    })
  })
})
