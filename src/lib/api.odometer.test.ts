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
import { unreviewItem } from './api'

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
