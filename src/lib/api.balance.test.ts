import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
import { listPendencies, monthlyBalance, monthlyDetail } from './api'

beforeEach(() => vi.clearAllMocks())

describe('api do balanço e pendências', () => {
  it('listPendencies chama admin_pendencies', async () => {
    rpc.mockResolvedValue({ data: [{ category: 'white', item_type: 'fueling', item_id: 'f1' }], error: null })
    const r = await listPendencies()
    expect(rpc).toHaveBeenCalledWith('admin_pendencies')
    expect(r).toHaveLength(1)
  })
  it('monthlyBalance e monthlyDetail passam p_month', async () => {
    rpc.mockResolvedValue({ data: { month: '2026-11-01' }, error: null })
    await monthlyBalance('2026-11-01')
    expect(rpc).toHaveBeenCalledWith('monthly_balance', { p_month: '2026-11-01' })
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await monthlyDetail('2026-11-01')).toEqual([])
    expect(rpc).toHaveBeenLastCalledWith('monthly_detail', { p_month: '2026-11-01' })
  })
  it('propaga erro', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: 'P0001' } })
    await expect(monthlyBalance('2026-11-01')).rejects.toThrow('FORBIDDEN')
  })
})
