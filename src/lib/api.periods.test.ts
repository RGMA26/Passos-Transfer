import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const tables: Record<string, unknown> = {}

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order']) b[m] = () => b
      b.single = () => Promise.resolve({ data: tables[table], error: null })
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(res)
      return b
    },
  },
}))
import { closePeriod, periodDriverStatements } from './api'

beforeEach(() => {
  rpc.mockReset()
  tables.periods = { status: 'open' }
  tables.profiles = [
    { id: 'd1', name: 'Ana', login_code: 'A1', driver_type: 'own_car', active: true },
    { id: 'd2', name: 'Beto', login_code: 'B2', driver_type: 'company_car', active: false },
  ]
})

describe('periodDriverStatements (quinzena aberta)', () => {
  it('usa period_drivers e compute_statement por motorista, inclusive inativos', async () => {
    rpc.mockImplementation((fn: string, args: Record<string, string>) => {
      if (fn === 'period_drivers') return Promise.resolve({ data: ['d2', 'd1'], error: null })
      if (fn === 'compute_statement') return Promise.resolve({ data: { total: args.p_driver === 'd1' ? 10 : 20 }, error: null })
      return Promise.resolve({ data: null, error: { message: 'unexpected' } })
    })
    const out = await periodDriverStatements('p1')
    expect(rpc).toHaveBeenCalledWith('period_drivers', { p_period: 'p1' })
    expect(rpc).toHaveBeenCalledWith('compute_statement', { p_driver: 'd1', p_period: 'p1' })
    expect(rpc).toHaveBeenCalledWith('compute_statement', { p_driver: 'd2', p_period: 'p1' })
    expect(rpc).not.toHaveBeenCalledWith('period_movement_drivers', expect.anything())
    expect(out.map((r) => [r.driver_name, r.total])).toEqual([
      ['Ana', 10],
      ['Beto (inativo)', 20],
    ])
  })
})

describe('closePeriod', () => {
  it('sempre envia p_force (false por padrão, true ao forçar)', async () => {
    rpc.mockResolvedValue({ data: 1, error: null })
    await closePeriod('p1')
    expect(rpc).toHaveBeenLastCalledWith('close_period', { p_period: 'p1', p_force: false })
    await closePeriod('p1', true)
    expect(rpc).toHaveBeenLastCalledWith('close_period', { p_period: 'p1', p_force: true })
  })
})
