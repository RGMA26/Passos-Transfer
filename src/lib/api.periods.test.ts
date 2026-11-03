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
import { getCurrentPeriod, listPeriodOverview } from './api'

const per = { id: 'p1', start_date: '2026-11-10', end_date: '2026-11-24', status: 'open' }

beforeEach(() => {
  rpc.mockReset()
  calls.length = 0
  tables.driver_periods = per
})

describe('listPeriodOverview', () => {
  it('inclui motorista inativo que o banco devolve (quinzena aberta ou extrato não pago)', async () => {
    tables.profiles = [
      { id: 'd1', name: 'Ana', active: true },
      { id: 'd2', name: 'Bia', active: false },
    ]
    const sig = (id: string, name: string, active: boolean) => ({
      driver_id: id, name, paused: false, active, current_period_id: null,
      start_date: null, end_date: null, days_left: null, signal: active ? null : 'red',
    })
    rpc.mockResolvedValue({ data: [sig('d1', 'Ana', true), sig('d2', 'Bia', false)], error: null })
    const rows = await listPeriodOverview()
    expect(rows.map((r) => [r.driver_id, r.active, r.signal])).toEqual([
      ['d1', true, null],
      ['d2', false, 'red'],
    ])
    expect(rpc).toHaveBeenCalledWith('driver_period_signals')
  })
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
