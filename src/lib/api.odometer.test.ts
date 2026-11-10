import { describe, it, expect, vi, beforeEach } from 'vitest'

let result: { data: unknown; error: { message: string; code?: string } | null }
let rpcArgs: unknown[]

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      rpcArgs = a
      return Promise.resolve(result)
    },
  },
}))
import { fixTransferOdometer, unreviewItem, updateShiftOdometers } from './api'

beforeEach(() => {
  result = { data: null, error: null }
})

describe('unreviewItem', () => {
  it('chama unreview_item com tipo e id', async () => {
    await unreviewItem('transfer', 't1')
    expect(rpcArgs).toEqual(['unreview_item', { p_kind: 'transfer', p_id: 't1' }])
  })

  it('erro do servidor vira Error com o código na mensagem', async () => {
    result = { data: null, error: { message: 'PERIOD_CLOSED', code: 'P0001' } }
    await expect(unreviewItem('shift', 's1')).rejects.toThrow('PERIOD_CLOSED')
  })
})

describe('fixTransferOdometer', () => {
  it('chama admin_fix_transfer_odometer com as leituras', async () => {
    await fixTransferOdometer('t1', 57876, 57925)
    expect(rpcArgs).toEqual(['admin_fix_transfer_odometer', { p_id: 't1', p_start: 57876, p_end: 57925 }])
  })

  it('em andamento: leitura final nula', async () => {
    await fixTransferOdometer('t1', 57876, null)
    expect(rpcArgs).toEqual(['admin_fix_transfer_odometer', { p_id: 't1', p_start: 57876, p_end: null }])
  })

  it('erro do servidor vira Error com o código', async () => {
    result = { data: null, error: { message: 'NOT_CHANGEABLE', code: 'P0001' } }
    await expect(fixTransferOdometer('t1', 1, 2)).rejects.toThrow('NOT_CHANGEABLE')
  })
})

describe('updateShiftOdometers', () => {
  it('usa a RPC admin_fix_shift_odometer (vale também em quinzena fechada)', async () => {
    await updateShiftOdometers('s1', 57876, 57880)
    expect(rpcArgs).toEqual(['admin_fix_shift_odometer', { p_id: 's1', p_start: 57876, p_end: 57880 }])
  })
})
