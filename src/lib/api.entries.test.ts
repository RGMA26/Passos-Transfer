import { describe, it, expect, vi, beforeEach } from 'vitest'

type Res = { data: unknown; error: { message: string; code?: string } | null; status: number }
/** Respostas por operação: 'update' | 'delete' | 'select'. */
let replies: Record<string, Res>
const calls: unknown[][] = []

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select'
      const chain: Record<string, unknown> = {}
      for (const fn of ['select', 'eq', 'in', 'order', 'update', 'delete']) {
        chain[fn] = (...args: unknown[]) => {
          calls.push([table, fn, ...args])
          if (fn === 'update' || fn === 'delete') op = fn
          return chain
        }
      }
      chain.maybeSingle = () => Promise.resolve(replies.select)
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(replies[op]).then(res)
      return chain
    },
  },
}))
import { deleteFueling, deleteRide, listTodayEntries, updateFueling, updateRide } from './api'

const ok = (data: unknown): Res => ({ data, error: null, status: 200 })

beforeEach(() => {
  calls.length = 0
  replies = { update: ok([{ id: 'x' }]), delete: ok([{ id: 'x' }]), select: ok(null) }
})

describe('edição/exclusão dos próprios lançamentos', () => {
  it('updateRide grava valor e km', async () => {
    await updateRide({ id: 'r1', amount: 90, km: 20 })
    expect(calls).toContainEqual(['rides', 'update', { amount: 90, km: 20 }])
    expect(calls).toContainEqual(['rides', 'eq', 'id', 'r1'])
  })

  it('update sem linha afetada (turno aprovado/abastecimento conferido) é NOT_EDITABLE', async () => {
    replies.update = ok([])
    await expect(updateFueling({ id: 'f1', amount: 1, liters: 1 })).rejects.toMatchObject({ code: 'NOT_EDITABLE' })
  })

  it('delete de linha que já não existe é sucesso (idempotente)', async () => {
    replies.delete = ok([])
    replies.select = ok(null)
    await expect(deleteRide({ id: 'r1' })).resolves.toBeUndefined()
  })

  it('delete que não apagou uma linha ainda existente é NOT_EDITABLE', async () => {
    replies.delete = ok([])
    replies.select = ok({ id: 'f1' })
    await expect(deleteFueling({ id: 'f1' })).rejects.toMatchObject({ code: 'NOT_EDITABLE' })
  })

  it('falha de rede vira TypeError (a fila tenta depois)', async () => {
    replies.delete = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }
    await expect(deleteRide({ id: 'r1' })).rejects.toBeInstanceOf(TypeError)
  })
})

describe('listTodayEntries', () => {
  it('corrida editável enquanto o turno não for aprovado; abastecimento só pendente', async () => {
    replies.select = ok(null)
    let n = 0
    const rides = [
      { id: 'r1', platform: 'uber', amount: 100, km: 30, shifts: { review_status: 'pending' } },
      { id: 'r2', platform: 'blablacar', amount: 40, km: null, shifts: { review_status: 'approved' } },
    ]
    const fuelings = [
      { id: 'f1', amount: 200, liters: 40, review_status: 'pending' },
      { id: 'f2', amount: 80, liters: 16, review_status: 'rejected' },
    ]
    replies = new Proxy(replies, {
      get: (t, k: string) => (k === 'select' ? ok(n++ === 0 ? rides : fuelings) : t[k]),
    })
    const out = await listTodayEntries('d1', '2026-10-30')
    expect(out.map((e) => [e.id, e.editable])).toEqual([
      ['r1', true],
      ['r2', false],
      ['f1', true],
      ['f2', false],
    ])
    expect(out[0]).toMatchObject({ kind: 'ride', platform: 'uber', amount: 100, km: 30 })
    expect(out[2]).toMatchObject({ kind: 'fueling', amount: 200, liters: 40 })
  })
})
