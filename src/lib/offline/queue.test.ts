import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({
  insertRide: vi.fn(),
  insertFueling: vi.fn(),
  insertExpense: vi.fn(),
  startShift: vi.fn(),
  endShift: vi.fn(),
  completeTransfer: vi.fn(),
  startTransfer: vi.fn(),
  updateRide: vi.fn(),
  deleteRide: vi.fn(),
  updateFueling: vi.fn(),
  deleteFueling: vi.fn(),
}))
const photos = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../api', () => api)
vi.mock('../photos', () => photos)
let uid: string | null = 'u1'
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null } }) } },
}))

import { enqueue, flush, listOps, discardOp, onQueueChange, retryOp } from './queue'
import type { QueuedOp } from './queue'

function op(id: string, over: Partial<QueuedOp> = {}): Omit<QueuedOp, 'status' | 'createdAt'> {
  return { id, kind: 'insert_ride', ownerId: 'u1', payload: { id, amount: 10 }, photos: [], ...over }
}
const codeErr = (code: string) => Object.assign(new Error(code), { code })

describe('fila offline', () => {
  beforeEach(async () => {
    uid = 'u1'
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
    uid = 'drv'
    const calls: string[] = []
    photos.uploadPhoto.mockImplementation(async (_b, d, p) => (calls.push('upload'), `${d}/${p}.jpg`))
    api.insertFueling.mockImplementation(async () => void calls.push('op'))
    await enqueue(
      op('f', {
        kind: 'insert_fueling',
        payload: { id: 'f' },
        ownerId: 'drv',
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
    await enqueue(op('t', { kind: 'complete_transfer', payload: { ride_id: 'r', odometer: 5 } }))
    await flush()
    expect(api.completeTransfer).toHaveBeenCalledWith({ ride_id: 'r', odometer: 5 })
    expect(cb).toHaveBeenCalled()
    await discardOp('t')
    expect(await listOps()).toEqual([])
    off()
  })

  it('foto da op do usuário drv usa o ownerId (sessão drv)', async () => {
    uid = 'drv'
    await enqueue(op('o', { ownerId: 'drv', photos: [{ field: 'photo', photoId: 'p', blob: new Blob(['x']) }] }))
    await flush()
    expect(photos.uploadPhoto).toHaveBeenCalledWith(expect.anything(), 'drv', 'p')
  })

  it('sem sessão nada é enviado', async () => {
    uid = null
    await enqueue(op('a'))
    await flush()
    expect(api.insertRide).not.toHaveBeenCalled()
    expect(await listOps()).toHaveLength(1)
  })

  it('op de outro usuário não é enviada nem listada para o usuário atual', async () => {
    uid = 'userB'
    await enqueue(op('a', { ownerId: 'userA' }))
    await flush()
    expect(api.insertRide).not.toHaveBeenCalled()
    expect(await listOps('userB')).toEqual([])
    expect(await listOps('userA')).toHaveLength(1)
  })

  it('enqueue sem ownerId lança', async () => {
    await expect(enqueue(op('a', { ownerId: '' }))).rejects.toThrow()
  })

  it('retryOp reenvia uma op failed', async () => {
    api.insertRide.mockRejectedValueOnce(codeErr('PERIOD_CLOSED'))
    await enqueue(op('a'))
    await flush()
    expect((await listOps())[0].status).toBe('failed')
    await retryOp('a')
    await flush()
    expect(api.insertRide).toHaveBeenCalledTimes(2)
    expect(await listOps()).toEqual([])
  })

  it('edição e exclusão de lançamentos despacham na ordem com os args certos', async () => {
    const order: string[] = []
    api.updateRide.mockImplementation(async () => void order.push('update_ride'))
    api.deleteRide.mockImplementation(async () => void order.push('delete_ride'))
    api.updateFueling.mockImplementation(async () => void order.push('update_fueling'))
    api.deleteFueling.mockImplementation(async () => void order.push('delete_fueling'))
    await enqueue(op('u1', { kind: 'update_ride', payload: { id: 'r1', amount: 90, km: 20 } }))
    await enqueue(op('d1', { kind: 'delete_ride', payload: { id: 'r2' } }))
    await enqueue(op('u2', { kind: 'update_fueling', payload: { id: 'f1', amount: 150, quantity: 30, unit_price: 5 } }))
    await enqueue(op('d2', { kind: 'delete_fueling', payload: { id: 'f2' } }))
    await flush()
    expect(order).toEqual(['update_ride', 'delete_ride', 'update_fueling', 'delete_fueling'])
    expect(api.updateRide).toHaveBeenCalledWith({ id: 'r1', amount: 90, km: 20 })
    expect(api.deleteRide).toHaveBeenCalledWith({ id: 'r2' })
    expect(api.updateFueling).toHaveBeenCalledWith({ id: 'f1', amount: 150, quantity: 30, unit_price: 5 })
    expect(api.deleteFueling).toHaveBeenCalledWith({ id: 'f2' })
    expect(await listOps()).toEqual([])
  })

  it('NOT_EDITABLE (lançamento já conferido) marca failed com mensagem', async () => {
    api.updateFueling.mockRejectedValueOnce(codeErr('NOT_EDITABLE'))
    await enqueue(op('u', { kind: 'update_fueling', payload: { id: 'f1', amount: 1, quantity: 1, unit_price: 1 } }))
    await flush()
    expect((await listOps())[0]).toMatchObject({
      status: 'failed',
      error: 'Não enviado: lançamento já conferido, não pode mais ser alterado',
    })
  })

  it('edição/exclusão também exige ownerId', async () => {
    await expect(enqueue(op('a', { kind: 'delete_ride', payload: { id: 'r' }, ownerId: '' }))).rejects.toThrow()
  })

  it.each([
    ['ODOMETER_BELOW_LAST', 'Não enviado: odômetro menor que o último registrado'],
    ['DRIVER_PAUSED', 'Não enviado: cadastro pausado'],
    ['BEFORE_CYCLE_START', 'Não enviado: data anterior ao seu cadastro'],
    ['RECEIPT_REQUIRED', 'Não enviado: falta o comprovante'],
    ['FUEL_CAR_NOT_ALLOWED', 'Não enviado: abastecimento de outro carro'],
    ['TRANSFER_IN_PROGRESS', 'Não enviado: conclua o Transfer em andamento antes de encerrar o turno'],
  ])('%s vira mensagem', async (code, msg) => {
    api.insertRide.mockRejectedValueOnce(codeErr(code))
    await enqueue(op('a'))
    await flush()
    expect((await listOps())[0]).toMatchObject({ status: 'failed', error: msg })
  })

  it('start_transfer despacha com odômetro e foto enviada', async () => {
    await enqueue(
      op('s', {
        kind: 'start_transfer',
        payload: { ride_id: 'r', odometer: 5000 },
        photos: [{ field: 'photo', photoId: 'p', blob: new Blob(['x']) }],
      }),
    )
    await flush()
    expect(api.startTransfer).toHaveBeenCalledWith({ ride_id: 'r', odometer: 5000, photo: 'u1/p.jpg' })
    expect(await listOps()).toEqual([])
  })

  it.each([
    ['start_transfer', 'startTransfer', 'INVALID_STATUS'],
    ['start_transfer', 'startTransfer', 'ALREADY_CHECKED'],
    ['complete_transfer', 'completeTransfer', 'INVALID_STATUS'],
    ['complete_transfer', 'completeTransfer', 'ALREADY_CHECKED'],
  ] as const)('%s já aplicado (%s → %s) conta como enviado', async (kind, fn, code) => {
    api[fn].mockRejectedValueOnce(codeErr(code))
    await enqueue(op('t', { kind, payload: { ride_id: 'r', odometer: 1 } }))
    await flush()
    expect(await listOps()).toEqual([])
  })

  it('INVALID_STATUS em outra op continua sendo erro', async () => {
    api.insertRide.mockRejectedValueOnce(codeErr('INVALID_STATUS'))
    await enqueue(op('a'))
    await flush()
    expect((await listOps())[0].status).toBe('failed')
  })
})
