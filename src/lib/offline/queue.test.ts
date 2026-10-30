import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({
  insertRide: vi.fn(),
  insertFueling: vi.fn(),
  insertExpense: vi.fn(),
  startShift: vi.fn(),
  endShift: vi.fn(),
  completeTransfer: vi.fn(),
}))
const photos = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../api', () => api)
vi.mock('../photos', () => photos)

import { enqueue, flush, listOps, discardOp, onQueueChange } from './queue'
import type { QueuedOp } from './queue'

function op(id: string, over: Partial<QueuedOp> = {}): Omit<QueuedOp, 'status' | 'createdAt'> {
  return { id, kind: 'insert_ride', payload: { id, amount: 10 }, photos: [], ...over }
}
const codeErr = (code: string) => Object.assign(new Error(code), { code })

describe('fila offline', () => {
  beforeEach(async () => {
    Object.values(api).forEach((f) => f.mockReset().mockResolvedValue(undefined))
    photos.uploadPhoto.mockReset().mockImplementation(async (_b, d, p) => `${d}/${p}.jpg`)
    for (const o of await listOps()) await discardOp(o.id)
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('envia as ops na ordem e esvazia a fila', async () => {
    const order: string[] = []
    api.insertRide.mockImplementation(async (p: { id: string }) => void order.push(p.id))
    await enqueue(op('a'))
    await enqueue(op('b'))
    await flush()
    expect(order).toEqual(['a', 'b'])
    expect(await listOps()).toEqual([])
  })

  it('erro de rede mantém a op pending e para a fila', async () => {
    api.insertRide.mockRejectedValue(new TypeError('Failed to fetch'))
    await enqueue(op('a'))
    await enqueue(op('b'))
    await flush()
    // 'b' nunca é tentada: a fila para na primeira falha de rede
    expect(api.insertRide.mock.calls.every(([p]) => p.id === 'a')).toBe(true)
    const ops = await listOps()
    expect(ops.map((o) => [o.id, o.status])).toEqual([['a', 'pending'], ['b', 'pending']])
  })

  it('erro 5xx também é transitório', async () => {
    api.insertRide.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
    await enqueue(op('a'))
    await flush()
    expect((await listOps())[0].status).toBe('pending')
  })

  it('PERIOD_CLOSED marca failed com mensagem e a próxima op segue', async () => {
    api.insertRide.mockRejectedValueOnce(codeErr('PERIOD_CLOSED'))
    await enqueue(op('a'))
    await enqueue(op('b'))
    await flush()
    expect(api.insertRide).toHaveBeenCalledTimes(2)
    const ops = await listOps()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ id: 'a', status: 'failed', error: 'Não enviado: quinzena fechada' })
  })

  it('SHIFT_ALREADY_OPEN em start_shift é permanente; código desconhecido mostra o código', async () => {
    api.startShift.mockRejectedValueOnce(codeErr('SHIFT_ALREADY_OPEN'))
    api.insertFueling.mockRejectedValueOnce(codeErr('23514'))
    await enqueue(op('s', { kind: 'start_shift', payload: { id: 's' } }))
    await enqueue(op('f', { kind: 'insert_fueling', payload: { id: 'f' } }))
    await flush()
    const ops = await listOps()
    expect(ops.find((o) => o.id === 's')?.error).toBe('Não enviado: já existe um turno aberto')
    expect(ops.find((o) => o.id === 'f')?.error).toBe('Não enviado: erro ao salvar (23514)')
  })

  it('flush simultâneo não envia a op em dobro', async () => {
    let release!: () => void
    api.insertRide.mockImplementation(() => new Promise<void>((r) => (release = r)))
    await enqueue(op('a'))
    const p1 = flush()
    const p2 = flush()
    expect(p2).toBe(p1)
    await new Promise((r) => setTimeout(r, 10))
    release()
    await p1
    expect(api.insertRide).toHaveBeenCalledTimes(1)
  })

  it('foto é enviada antes da op e o path vai no payload', async () => {
    const calls: string[] = []
    photos.uploadPhoto.mockImplementation(async (_b, d, p) => (calls.push('upload'), `${d}/${p}.jpg`))
    api.insertFueling.mockImplementation(async () => void calls.push('op'))
    await enqueue(
      op('f', {
        kind: 'insert_fueling',
        payload: { id: 'f', driver_id: 'drv' },
        driverId: 'drv',
        photos: [{ field: 'photo_path', photoId: 'p1', blob: new Blob(['x']) }],
      }),
    )
    await flush()
    expect(calls).toEqual(['upload', 'op'])
    expect(api.insertFueling).toHaveBeenCalledWith(
      expect.objectContaining({ photo_path: 'drv/p1.jpg' }),
    )
  })

  it('end_shift despacha com os args certos; discardOp remove e onQueueChange notifica', async () => {
    const cb = vi.fn()
    const off = onQueueChange(cb)
    api.completeTransfer.mockRejectedValueOnce(codeErr('NOT_FOUND'))
    await enqueue(op('t', { kind: 'complete_transfer', payload: { ride_id: 'r', km: 5 } }))
    await flush()
    expect(api.completeTransfer).toHaveBeenCalledWith({ ride_id: 'r', km: 5 })
    expect(cb).toHaveBeenCalled()
    await discardOp('t')
    expect(await listOps()).toEqual([])
    off()
  })
})
