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
    | 'complete_transfer'
  payload: Record<string, unknown>
  /** Dono da op (auth.uid()): só ele envia/vê; path das fotos: `${ownerId}/${photoId}.jpg`. */
  ownerId: string
  photos: { field: string; photoId: string; blob: Blob }[]
  status: 'pending' | 'failed'
  error?: string
  createdAt: number
}

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
export async function enqueue(op: Omit<QueuedOp, 'status' | 'createdAt'>): Promise<void> {
  if (!op.ownerId) throw new Error('ownerId obrigatório')
  const db = await dbp
  // seq garante ordem FIFO estável mesmo com enqueues no mesmo milissegundo
  await db.put('ops', { ...op, status: 'pending', createdAt: Date.now() * 1000 + (seq++ % 1000) })
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
  await db.put('ops', { ...op, status: 'pending', error: undefined })
  notify()
  void flush()
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
}

type Err = { code?: string; message?: string; status?: number }

/** Transitório: falha de rede, offline, status 0 ou 5xx. Todo o resto é permanente. */
function isTransient(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
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
    case 'complete_transfer':
      return api.completeTransfer(p as never)
  }
}

async function pass(): Promise<void> {
  const db = await dbp
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user.id
  if (!uid) return // sem sessão: nada é enviado
  for (const op of await listOps(uid)) {
    if (op.status === 'failed') continue
    try {
      const payload = { ...op.payload }
      for (const ph of op.photos) {
        payload[ph.field] = await uploadPhoto(ph.blob, op.ownerId, ph.photoId)
      }
      await dispatch(op.kind, payload)
      await db.delete('ops', op.id)
      notify()
    } catch (e) {
      if (isTransient(e)) {
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
