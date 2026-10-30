import { describe, it, expect, vi, beforeEach } from 'vitest'

let result: { data: unknown; error: { message: string; code?: string } | null }
let calls: { fn: string; args: unknown[] }[]
let rpcArgs: unknown[]

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      rpcArgs = a
      return Promise.resolve(result)
    },
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['delete', 'eq', 'select']) {
        b[m] = (...args: unknown[]) => {
          calls.push({ fn: m, args })
          return b
        }
      }
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
      return b
    },
  },
}))
import { deleteTransfer, reviewItem } from './api'

beforeEach(() => {
  calls = []
  result = { data: [], error: null }
})

describe('deleteTransfer', () => {
  it('só apaga transfers atribuídos e falha se nenhuma linha for removida', async () => {
    await expect(deleteTransfer('t1')).rejects.toThrow('Este transfer não pode mais ser excluído')
    expect(calls).toContainEqual({ fn: 'eq', args: ['transfer_status', 'assigned'] })
  })

  it('ok quando a linha foi removida', async () => {
    result = { data: [{ id: 't1' }], error: null }
    await expect(deleteTransfer('t1')).resolves.toBeUndefined()
  })
})

describe('reviewItem', () => {
  it('envia sempre os quatro parâmetros (p_reason null na aprovação)', async () => {
    result = { data: null, error: null }
    await reviewItem('fueling', 'f1', true, null)
    expect(rpcArgs).toEqual(['review_item', { p_kind: 'fueling', p_id: 'f1', p_approved: true, p_reason: null }])
  })

  it('propaga o código do servidor', async () => {
    result = { data: null, error: { message: 'REASON_REQUIRED', code: 'P0001' } }
    await expect(reviewItem('shift', 's1', false, '')).rejects.toThrow('REASON_REQUIRED')
  })
})
