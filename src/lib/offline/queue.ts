import { openDB } from 'idb'
import * as api from '../api'
import { uploadPhoto } from '../photos'
import { supabase } from '../supabase'

export type QueuedOp = {
  id: string
  kind:
    | 'insert_ride'
    | 'insert_fueling'
    | 'insert_expense'
    | 'start_shift'
    | 'end_shift'
    | 'start_transfer'
    | 'complete_transfer'
    | 'update_ride'
    | 'delete_ride'
    | 'update_fueling'
    | 'delete_fueling'
    | 'attach_photo'
  payload: Record<string, unknown>
  /** Dono da op (auth.uid()): só ele envia/vê; path: `${ownerId}/${photoId}.jpg` (ou .pdf). */
  ownerId: string
  photos: StoredPhoto[]
  status: 'pending' | 'failed'
  error?: string
  /** Falhas transitórias seguidas (com rede); 5 → failed. */
  attempts?: number
  /** failed por falha de conexão: continua segurando as ops seguintes (a ordem importa). */
  stalled?: boolean
  createdAt: number
}

/**
 * Foto guardada na fila: bytes + tipo. Blob guardado no IndexedDB pode ficar ilegível no iOS
 * Safari depois de recarregar, então só gravamos os bytes. `blob` = formato antigo.
 */
export type StoredPhoto = { field: string; photoId: string; bytes?: ArrayBuffer; type?: string; blob?: Blob }
/** O que a tela entrega ao enfileirar. */
export type NewPhoto = { field: string; photoId: string; blob: Blob }
export type NewOp = Omit<QueuedOp, 'status' | 'createdAt' | 'photos' | 'attempts' | 'stalled'> & {
  photos: (NewPhoto | StoredPhoto)[]
}

export type AttachTarget = 'shift_start' | 'shift_end' | 'shift_uber' | 'transfer_start' | 'transfer_end'

/** A foto guardada não pode mais ser lida (Blob antigo perdido): nunca vai subir. */
export class PhotoLostError extends Error {
  constructor() {
    super('PHOTO_LOST')
    this.name = 'PhotoLostError'
  }
}

/** ArrayBuffer de qualquer realm (o IndexedDB/jsdom podem devolver de outro). */
const isBuffer = (x: unknown): x is ArrayBuffer => Object.prototype.toString.call(x) === '[object ArrayBuffer]'

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Response(blob).arrayBuffer()
}

/** Reconstrói o Blob da foto guardada; PhotoLostError se não há como ler. */
export async function readStoredPhoto(ph: StoredPhoto): Promise<Blob> {
  if (isBuffer(ph.bytes)) return new Blob([ph.bytes], { type: ph.type ?? '' })
  const legacy = ph.blob as Blob | undefined
  if (!legacy || typeof legacy.arrayBuffer !== 'function') throw new PhotoLostError()
  try {
    return new Blob([await legacy.arrayBuffer()], { type: legacy.type ?? '' })
  } catch {
    throw new PhotoLostError()
  }
}

async function toStored(ph: NewPhoto | StoredPhoto): Promise<StoredPhoto> {
  if ('bytes' in ph && isBuffer(ph.bytes)) {
    return { field: ph.field, photoId: ph.photoId, bytes: ph.bytes, type: ph.type ?? '' }
  }
  const blob = ph.blob as Blob
  return { field: ph.field, photoId: ph.photoId, bytes: await blobBytes(blob), type: blob.type }
}

type Detach = (p: Record<string, unknown>) => { target: AttachTarget; id: string }
/**
 * Fotos do odômetro / print da Uber não seguram o turno nem o Transfer: se não sobem, a op vai sem
 * elas e um attach_photo no fim da fila tenta de novo (o admin vê a pendência 📷 até lá).
 * Comprovantes (corrida, abastecimento, despesa) continuam obrigatórios.
 */
const DETACHABLE: Partial<Record<QueuedOp['kind'], Record<string, Detach>>> = {
  start_shift: { photo: (p) => ({ target: 'shift_start', id: String(p.id) }) },
  end_shift: {
    photo: (p) => ({ target: 'shift_end', id: String(p.shift_id) }),
    uber_photo: (p) => ({ target: 'shift_uber', id: String(p.shift_id) }),
  },
  start_transfer: { photo: (p) => ({ target: 'transfer_start', id: String(p.ride_id) }) },
  complete_transfer: { photo: (p) => ({ target: 'transfer_end', id: String(p.ride_id) }) },
}

const MAX_ATTEMPTS = 5
const MSG_CONNECTION = 'Não enviado: falha de conexão ao enviar. Tente de novo.'
const MSG_RECEIPT_LOST = 'Não enviado: a foto do comprovante se perdeu. Exclua e lance de novo.'
const MSG_PHOTO_LOST = 'Não enviado: a foto do odômetro se perdeu no aparelho. A administração vê a pendência; pode descartar.'

const dbp = openDB('passos-queue', 1, {
  upgrade(db) {
    db.createObjectStore('ops', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
  },
})

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((cb) => cb())
export function onQueueChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

let seq = 0
// seq garante ordem FIFO estável mesmo com enqueues no mesmo milissegundo
const nextCreatedAt = () => Date.now() * 1000 + (seq++ % 1000)

export async function enqueue(op: NewOp): Promise<void> {
  if (!op.ownerId) throw new Error('ownerId obrigatório')
  const photos = await Promise.all(op.photos.map(toStored))
  const db = await dbp
  await db.put('ops', { ...op, photos, status: 'pending', createdAt: nextCreatedAt() })
  notify()
  void flush()
}

export async function listOps(ownerId?: string): Promise<QueuedOp[]> {
  const db = await dbp
  const all = await db.getAllFromIndex('ops', 'createdAt')
  return ownerId ? all.filter((o) => o.ownerId === ownerId) : all
}

export async function retryOp(id: string): Promise<void> {
  const db = await dbp
  const op = await db.get('ops', id)
  if (!op || op.status !== 'failed') return
  await db.put('ops', { ...op, status: 'pending', error: undefined, attempts: 0, stalled: false })
  notify()
  // um envio em andamento pode parar por rede sem voltar a esta op: nova passada depois dele
  if (inflight) void inflight.finally(() => void flush())
  else void flush()
}

export async function discardOp(id: string): Promise<void> {
  const db = await dbp
  await db.delete('ops', id)
  notify()
}

const MESSAGES: Record<string, string> = {
  PERIOD_CLOSED: 'Não enviado: quinzena fechada',
  NO_OPEN_SHIFT: 'Não enviado: nenhum turno aberto',
  SHIFT_ALREADY_OPEN: 'Não enviado: já existe um turno aberto',
  ODOMETER_BELOW_START: 'Não enviado: odômetro final menor que o inicial',
  UBER_PHOTO_REQUIRED: 'Não enviado: falta o print dos ganhos da Uber',
  NOT_EDITABLE: 'Não enviado: lançamento já conferido, não pode mais ser alterado',
  ODOMETER_BELOW_LAST: 'Não enviado: odômetro menor que o último registrado',
  DRIVER_PAUSED: 'Não enviado: cadastro pausado',
  NO_PERIOD: 'Não enviado: cadastro pausado',
  BEFORE_CYCLE_START: 'Não enviado: data anterior ao seu cadastro',
  RECEIPT_REQUIRED: 'Não enviado: falta o comprovante',
  PHOTO_REQUIRED: 'Não enviado: falta a foto',
  FUEL_CAR_NOT_ALLOWED: 'Não enviado: abastecimento de outro carro',
  FUEL_NOT_ALLOWED: 'Não enviado: combustível não aceito por este carro',
  TRANSFER_IN_PROGRESS: 'Não enviado: conclua o Transfer em andamento antes de encerrar o turno',
  NOT_STARTED: 'Não enviado: o Transfer ainda não foi iniciado',
  ALREADY_STARTED: 'Não enviado: o Transfer já foi iniciado',
  ALREADY_COMPLETED: 'Não enviado: o Transfer já foi concluído',
  INVALID_ODOMETER: 'Não enviado: leitura do odômetro inválida',
  FUTURE_DATE: 'Não enviado: data no futuro',
}

/** Repetição de iniciar/concluir já aplicado (o Transfer andou): conta como enviado. */
function alreadyApplied(kind: QueuedOp['kind'], e: unknown): boolean {
  if (kind !== 'start_transfer' && kind !== 'complete_transfer') return false
  // o código da regra vem no message (code é o SQLSTATE P0001), como em errorMessage
  const { code, message } = (e ?? {}) as Err
  const applied = ['INVALID_STATUS', 'ALREADY_CHECKED']
  return applied.includes(message ?? '') || applied.includes(code ?? '')
}

type Err = { code?: string; message?: string; status?: number }

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Transitório: falha de rede, offline, status 0 ou 5xx. Todo o resto é permanente. */
function isTransient(e: unknown): boolean {
  if (isOffline()) return true
  if (e instanceof TypeError) return true
  const { code, status } = (e ?? {}) as Err
  if (code) return code === 'PGRST301' || code === 'PGRST303'
  return status === 0 || status === 401 || (status !== undefined && status >= 500)
}

function errorMessage(e: unknown): string {
  const { code, message, status } = (e ?? {}) as Err
  const known = MESSAGES[message ?? ''] ?? MESSAGES[code ?? '']
  if (known) return known
  return `Não enviado: erro ao salvar (${code || message || status || 'desconhecido'})`
}

async function dispatch(kind: QueuedOp['kind'], p: Record<string, unknown>): Promise<void> {
  switch (kind) {
    case 'insert_ride':
      return api.insertRide(p as never)
    case 'insert_fueling':
      return api.insertFueling(p as never)
    case 'insert_expense':
      return api.insertExpense(p as never)
    case 'start_shift':
      return api.startShift(p as never)
    case 'end_shift':
      await api.endShift(p as never)
      return
    case 'start_transfer':
      return api.startTransfer(p as never)
    case 'complete_transfer':
      return api.completeTransfer(p as never)
    case 'update_ride':
      return api.updateRide(p as never)
    case 'delete_ride':
      return api.deleteRide(p as never)
    case 'update_fueling':
      return api.updateFueling(p as never)
    case 'delete_fueling':
      return api.deleteFueling(p as never)
    case 'attach_photo':
      return api.attachPhoto(p as never)
  }
}

/** Sobe as fotos da op no payload; as do odômetro que não sobem viram attach_photo (devolvidos). */
async function uploadAll(op: QueuedOp, payload: Record<string, unknown>): Promise<QueuedOp[]> {
  const later: QueuedOp[] = []
  for (const ph of op.photos) {
    const detach = DETACHABLE[op.kind]?.[ph.field]
    let stored: StoredPhoto | null = null
    try {
      const blob = await readStoredPhoto(ph)
      stored = isBuffer(ph.bytes) ? ph : { field: ph.field, photoId: ph.photoId, bytes: await blobBytes(blob), type: blob.type }
      payload[ph.field] = await uploadPhoto(blob, op.ownerId, ph.photoId)
      continue
    } catch (e) {
      if (!detach) throw e
      payload[ph.field] = null
    }
    if (!stored) continue // foto perdida: nada para anexar, fica a pendência 📷 no admin
    later.push({
      id: `${op.id}:${ph.field}`,
      kind: 'attach_photo',
      ownerId: op.ownerId,
      payload: detach(op.payload),
      photos: [stored],
      status: 'pending',
      createdAt: 0,
    })
  }
  return later
}

async function pass(): Promise<void> {
  const db = await dbp
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user.id
  if (!uid) return // sem sessão: nada é enviado
  for (const op of await listOps(uid)) {
    if (op.status === 'failed') {
      if (op.stalled) return // falhou por conexão: as seguintes esperam o "Tentar de novo"
      continue
    }
    const attach = op.kind === 'attach_photo'
    try {
      const payload = { ...op.payload }
      if (attach) {
        const ph = op.photos[0]
        payload.path = await uploadPhoto(await readStoredPhoto(ph), op.ownerId, ph.photoId)
        await dispatch(op.kind, payload)
        await db.delete('ops', op.id)
        notify()
        continue
      }
      const later = await uploadAll(op, payload)
      try {
        await dispatch(op.kind, payload)
      } catch (e) {
        if (!alreadyApplied(op.kind, e)) throw e
      }
      // anexos vão para o fim da fila (depois de tudo que já esperava)
      for (const a of later) await db.put('ops', { ...a, createdAt: nextCreatedAt() })
      await db.delete('ops', op.id)
      notify()
    } catch (e) {
      if (e instanceof PhotoLostError) {
        await db.put('ops', { ...op, status: 'failed', error: attach ? MSG_PHOTO_LOST : MSG_RECEIPT_LOST })
        notify()
        continue
      }
      if (isTransient(e)) {
        const offline = isOffline()
        // sem rede no aparelho não conta: só insistência com rede "boa" que não passa
        const attempts = (op.attempts ?? 0) + (offline ? 0 : 1)
        const giveUp = attempts >= MAX_ATTEMPTS
        await db.put('ops', {
          ...op,
          attempts,
          ...(giveUp ? { status: 'failed' as const, error: MSG_CONNECTION, stalled: !attach } : {}),
        })
        if (giveUp) notify()
        // anexo de foto nunca segura a fila
        if (attach && !offline) continue
        rerun = false // rede ruim: não insistir agora
        return
      }
      await db.put('ops', { ...op, status: 'failed', error: errorMessage(e) })
      notify()
    }
  }
}

let rerun = false
async function run(): Promise<void> {
  do {
    rerun = false
    await pass()
  } while (rerun)
}

let inflight: Promise<void> | null = null
export function flush(): Promise<void> {
  if (inflight) {
    rerun = true // ops enfileiradas durante o envio entram numa nova passada
    return inflight
  }
  inflight = run().finally(() => {
    inflight = null
  })
  return inflight
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush())
  setInterval(() => {
    void listOps().then((ops) => {
      if (ops.some((o) => o.status === 'pending')) void flush()
    })
  }, 30_000)
}
