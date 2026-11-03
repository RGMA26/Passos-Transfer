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
  attachPhoto: vi.fn(),
}))
const photos = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../api', () => api)
vi.mock('../photos', () => photos)
let uid: string | null = 'u1'
vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null } }) } },
}))

import { openDB } from 'idb'
import { enqueue, flush, listOps, discardOp, onQueueChange, retryOp, readStoredPhoto, PhotoLostError } from './queue'
import type { QueuedOp } from './queue'

function op(id: string, over: Partial<QueuedOp> = {}): Omit<QueuedOp, 'status' | 'createdAt'> {
  return { id, kind: 'insert_ride', ownerId: 'u1', payload: { id, amount: 10 }, photos: [], ...over }
}
// como os erros reais do servidor: código da regra no message, SQLSTATE P0001 no code
const codeErr = (code: string) => Object.assign(new Error(code), { code: 'P0001', status: 400 })

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
    api.insertFueling.mockRejectedValueOnce(
      Object.assign(new Error('new row violates check constraint'), { code: '23514', status: 400 }),
    )
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
    ['NOT_STARTED', 'Não enviado: o Transfer ainda não foi iniciado'],
    ['ALREADY_STARTED', 'Não enviado: o Transfer já foi iniciado'],
    ['ALREADY_COMPLETED', 'Não enviado: o Transfer já foi concluído'],
    ['INVALID_ODOMETER', 'Não enviado: leitura do odômetro inválida'],
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

  // ---------- fotos robustas e fila que não trava (fix 2026-11-03) ----------

  const netErr = () => new TypeError('Failed to fetch')
  const photo = (field = 'photo', photoId = 'p') => ({ field, photoId, blob: new Blob(['abc'], { type: 'image/jpeg' }) })
  /** Grava uma op "antiga" direto no IndexedDB (formato com Blob). */
  async function putRaw(o: Record<string, unknown>) {
    const db = await openDB('passos-queue', 1)
    await db.put('ops', { status: 'pending', createdAt: Date.now() * 1000, ...o })
    db.close()
  }
  const lostBlob = () => {
    const b = new Blob(['x'])
    Object.defineProperty(b, 'arrayBuffer', { value: () => Promise.reject(new DOMException('gone', 'NotReadableError')) })
    return b
  }

  it('guarda a foto como bytes (ArrayBuffer + tipo), não como Blob, e reconstrói no envio', async () => {
    uid = null // não envia: só inspeciona o que foi gravado
    await enqueue(op('f', { kind: 'insert_fueling', payload: { id: 'f' }, photos: [photo('photo_path', 'p1')] }))
    const [stored] = await listOps()
    const ph = stored.photos[0] as unknown as Record<string, unknown>
    expect(ph.blob).toBeUndefined()
    expect(Object.prototype.toString.call(ph.bytes)).toBe('[object ArrayBuffer]')
    expect(ph.type).toBe('image/jpeg')
    uid = 'u1'
    await flush()
    const sent = photos.uploadPhoto.mock.calls[0][0] as Blob
    expect(sent).toBeInstanceOf(Blob)
    expect(sent.type).toBe('image/jpeg')
    expect(await sent.text()).toBe('abc')
  })

  it('op antiga com Blob: lê os bytes se o Blob ainda é legível; senão, PhotoLostError', async () => {
    const ok = await readStoredPhoto({ field: 'f', photoId: 'p', blob: new Blob(['z'], { type: 'image/jpeg' }) })
    expect(ok.type).toBe('image/jpeg')
    expect(await ok.text()).toBe('z')
    await expect(readStoredPhoto({ field: 'f', photoId: 'p', blob: lostBlob() })).rejects.toBeInstanceOf(PhotoLostError)
    // o que o IndexedDB devolve quando o Blob não sobreviveu (objeto vazio)
    await expect(readStoredPhoto({ field: 'f', photoId: 'p', blob: {} as Blob })).rejects.toBeInstanceOf(PhotoLostError)
  })

  it.each([
    ['start_shift', 'startShift', { id: 's1', car_id: 'c', odometer: 10 }, 'photo', 'shift_start', 's1'],
    ['end_shift', 'endShift', { shift_id: 's1', odometer: 20 }, 'photo', 'shift_end', 's1'],
    ['end_shift', 'endShift', { shift_id: 's1', odometer: 20 }, 'uber_photo', 'shift_uber', 's1'],
    ['start_transfer', 'startTransfer', { ride_id: 'r1', odometer: 10 }, 'photo', 'transfer_start', 'r1'],
    ['complete_transfer', 'completeTransfer', { ride_id: 'r1', odometer: 20 }, 'photo', 'transfer_end', 'r1'],
  ] as const)('%s: foto que não sobe não trava — envia sem a foto e anexa depois (%s/%s)', async (kind, fn, payload, field, target, id) => {
    photos.uploadPhoto.mockRejectedValue(netErr())
    await enqueue(op('a', { kind, payload: { ...payload }, photos: [photo(field, 'ph')] }))
    await enqueue(op('b')) // corrida lançada depois
    await flush()
    expect(api[fn]).toHaveBeenCalledWith(expect.objectContaining({ [field]: null }))
    expect(api.insertRide).toHaveBeenCalledTimes(1) // a fila andou
    const ops = await listOps()
    expect(ops.map((o) => o.kind)).toEqual(['attach_photo'])
    expect(ops[0]).toMatchObject({ status: 'pending', payload: { target, id } })
    // a rede volta: a foto sobe e é anexada
    photos.uploadPhoto.mockReset().mockImplementation(async (_b, d, p) => `${d}/${p}.jpg`)
    await flush()
    expect(api.attachPhoto).toHaveBeenCalledWith({ target, id, path: 'u1/ph.jpg' })
    expect(await listOps()).toEqual([])
  })

  it('attach_photo que falha não segura as ops seguintes', async () => {
    photos.uploadPhoto.mockRejectedValue(netErr())
    await enqueue(op('s', { kind: 'start_transfer', payload: { ride_id: 'r', odometer: 1 }, photos: [photo()] }))
    await flush()
    await enqueue(op('c', { kind: 'complete_transfer', payload: { ride_id: 'r', odometer: 9 } }))
    await flush()
    expect(api.completeTransfer).toHaveBeenCalledWith({ ride_id: 'r', odometer: 9 })
    expect((await listOps()).map((o) => o.kind)).toEqual(['attach_photo'])
  })

  it('Blob antigo ilegível (iOS) em início de Transfer: envia sem foto, sem anexo, e a fila anda', async () => {
    await putRaw({ id: 'st', kind: 'start_transfer', ownerId: 'u1', payload: { ride_id: 'r', odometer: 5 }, photos: [{ field: 'photo', photoId: 'p', blob: lostBlob() }] })
    await enqueue(op('b'))
    await flush()
    expect(api.startTransfer).toHaveBeenCalledWith({ ride_id: 'r', odometer: 5, photo: null })
    expect(api.insertRide).toHaveBeenCalledTimes(1)
    expect(await listOps()).toEqual([])
  })

  it('comprovante ilegível: op fica failed com mensagem clara e a fila anda', async () => {
    await putRaw({ id: 'f', kind: 'insert_fueling', ownerId: 'u1', payload: { id: 'f' }, photos: [{ field: 'photo_path', photoId: 'p', blob: lostBlob() }] })
    await enqueue(op('b'))
    await flush()
    expect(api.insertFueling).not.toHaveBeenCalled()
    expect(api.insertRide).toHaveBeenCalledTimes(1)
    expect(await listOps()).toEqual([
      expect.objectContaining({ id: 'f', status: 'failed', error: 'Não enviado: a foto do comprovante se perdeu. Exclua e lance de novo.' }),
    ])
  })

  it('comprovante que não sobe por rede continua obrigatório (op fica pending)', async () => {
    photos.uploadPhoto.mockRejectedValue(netErr())
    await enqueue(op('f', { kind: 'insert_fueling', payload: { id: 'f' }, photos: [photo('photo_path')] }))
    await flush()
    expect(api.insertFueling).not.toHaveBeenCalled()
    expect((await listOps())[0]).toMatchObject({ status: 'pending', attempts: 1 })
  })

  it('5 falhas transitórias seguidas: op fica failed, as seguintes continuam pending e não passam na frente', async () => {
    api.insertRide.mockImplementation(async (p: { id: string }) => {
      if (p.id === 'a') throw netErr()
    })
    await enqueue(op('a'))
    await enqueue(op('b'))
    for (let i = 0; i < 4; i++) await flush()
    expect((await listOps()).map((o) => [o.id, o.status, o.attempts])).toEqual([['a', 'pending', 4], ['b', 'pending', undefined]])
    await flush()
    expect((await listOps()).map((o) => [o.id, o.status])).toEqual([['a', 'failed'], ['b', 'pending']])
    expect((await listOps())[0].error).toBe('Não enviado: falha de conexão ao enviar. Tente de novo.')
    await flush() // a travada continua segurando a fila
    expect(api.insertRide.mock.calls.some(([p]) => p.id === 'b')).toBe(false)
    // "Tentar de novo" com a rede boa envia as duas, na ordem
    api.insertRide.mockReset().mockResolvedValue(undefined)
    await retryOp('a')
    await flush()
    expect(api.insertRide.mock.calls.map(([p]) => p.id)).toEqual(['a', 'b'])
    expect(await listOps()).toEqual([])
  })

  it('sem rede (navigator offline) não conta tentativa', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    api.insertRide.mockRejectedValue(netErr())
    await enqueue(op('a'))
    for (let i = 0; i < 6; i++) await flush()
    expect((await listOps())[0]).toMatchObject({ status: 'pending' })
    expect((await listOps())[0].attempts ?? 0).toBe(0)
  })

  it('"Tentar de novo" durante um envio em andamento que cai por rede ainda reenvia', async () => {
    api.insertRide.mockRejectedValueOnce(codeErr('PERIOD_CLOSED'))
    await enqueue(op('x'))
    await flush()
    expect((await listOps())[0].status).toBe('failed')
    let release!: (e: unknown) => void
    api.insertRide.mockReset().mockImplementationOnce(() => new Promise((_r, rej) => (release = rej)))
    api.insertRide.mockResolvedValue(undefined)
    await enqueue(op('y'))
    await new Promise((r) => setTimeout(r, 10)) // 'y' em envio
    await retryOp('x')
    release(netErr()) // a passada atual cai por rede
    await new Promise((r) => setTimeout(r, 30))
    expect(api.insertRide.mock.calls.map(([p]) => p.id)).toContain('x')
    expect((await listOps()).map((o) => o.id)).not.toContain('x')
  })
})
