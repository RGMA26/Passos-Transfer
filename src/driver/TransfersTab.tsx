import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatBRL } from '../lib/money'
import { enqueue } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'
import type { Ride, RideExpense } from '../lib/types'
import MoneyInput from '../components/MoneyInput'
import PhotoInput from '../components/PhotoInput'
import OdometerField from '../components/OdometerField'
import {
  MSG_ODO_INTEGER,
  confirmReading,
  fmtInt,
  lastReading,
  maxReading,
  odometerTextError,
  parseOdometerText,
} from '../lib/odometer'
import ReceiptInput from '../components/ReceiptInput'
import PausedNotice from './PausedNotice'
import { useShift } from './useShift'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_SAVE = 'Não foi possível salvar. Tente de novo.'
const MSG_ODO_LOWER = 'O odômetro final não pode ser menor que o inicial'
const STATUS: Record<string, string> = {
  assigned: 'Atribuída',
  in_progress: 'Em andamento',
  completed: 'Aguardando conferência',
  checked: 'Conferida',
}
const REVIEW: Record<string, string> = {
  pending: 'Aguardando conferência',
  approved: 'Aprovado',
  rejected: 'Recusado',
}
const KIND: Record<string, string> = { toll: 'Pedágio', parking: 'Estacionamento' }

const whenFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const kmFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })


/** "Rua, bairro, cidade/UF" (cai no texto antigo origin/destination). */
function address(street: string | null, district: string | null, city: string | null, state: string | null) {
  const place = [city, state].filter(Boolean).join('/')
  return [street, district, place].filter(Boolean).join(', ')
}

function route(r: Ride): string | null {
  const from = address(r.origin_street, r.origin_district, r.origin_city, r.origin_state) || r.origin || ''
  const to = address(r.dest_street, r.dest_district, r.dest_city, r.dest_state) || r.destination || ''
  return from || to ? `${from} → ${to}` : null
}

/** Status visto pelo motorista: servidor + iniciar/concluir ainda na fila. */
function effective(ride: Ride, ops: QueuedOp[]): { status: string; odometerStart: number | null } {
  let status = ride.transfer_status ?? 'assigned'
  let odometerStart = ride.odometer_start
  const start = ops.find((o) => o.kind === 'start_transfer' && o.status === 'pending')
  if (start && status === 'assigned') {
    status = 'in_progress'
    odometerStart = Number(start.payload.odometer)
  }
  if (ops.some((o) => o.kind === 'complete_transfer' && o.status === 'pending') && status === 'in_progress') {
    status = 'completed'
  }
  return { status, odometerStart }
}

export default function TransfersTab() {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const company = profile?.driver_type === 'company_car'
  const paused = !!profile?.paused
  const { ops, shift } = useShift(uid, true)
  const [rides, setRides] = useState<Ride[] | null>(null)
  const [expenses, setExpenses] = useState<RideExpense[]>([])
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!uid) return
    setFailed(false)
    try {
      const list = await api.listMyTransfers(uid)
      setRides(list)
      setExpenses(await api.listExpenses(list.map((r) => r.id)))
    } catch {
      setFailed(true)
    }
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  // quando a fila esvazia/muda (envio concluído), recarrega do servidor
  const opsKey = ops.map((o) => o.id).join(',')
  useEffect(() => {
    if (rides) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsKey])

  if (!uid || !profile) return null
  if (failed) {
    return (
      <section>
        <h2>Transfers</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!rides) return <p className="loading">Carregando…</p>

  return (
    <section>
      <h2>Transfers</h2>
      {paused && <PausedNotice />}
      {rides.length === 0 && <p className="hint">Nenhum transfer atribuído.</p>}
      {rides.map((r) => (
        <RideCard
          key={r.id}
          uid={uid}
          ride={r}
          expenses={expenses.filter((e) => e.ride_id === r.id)}
          ops={ops.filter((o) => o.payload.ride_id === r.id)}
          noShift={company && !shift}
          shiftStart={company ? (shift?.odometerStart ?? null) : null}
          paused={paused}
          open={openId === r.id}
          onToggle={() => setOpenId(openId === r.id ? null : r.id)}
        />
      ))}
    </section>
  )
}

function RideCard({
  uid,
  ride,
  expenses,
  ops,
  noShift,
  shiftStart,
  paused,
  open,
  onToggle,
}: {
  uid: string
  ride: Ride
  expenses: RideExpense[]
  ops: QueuedOp[]
  noShift: boolean
  /** Leitura inicial do turno aberto (carro da empresa): referência para iniciar o Transfer. */
  shiftStart: number | null
  paused: boolean
  open: boolean
  onToggle: () => void
}) {
  const { status, odometerStart } = effective(ride, ops)
  const queued = ops.filter((o) => o.status === 'pending')
  const failedOps = ops.filter((o) => o.status === 'failed')
  const where = route(ride)
  const expensesOpen = status !== 'checked' && !paused

  return (
    <div className="panel">
      <button type="button" className="card-head" onClick={onToggle} aria-expanded={open}>
        <strong>{ride.client_name}</strong>
        {ride.scheduled_at && <span>{whenFmt.format(new Date(ride.scheduled_at))}</span>}
        {where && <span>{where}</span>}
        {ride.estimated_km != null && <span>{`Km estimado: ${kmFmt.format(Number(ride.estimated_km))}`}</span>}
        <span>{`Valor contratado: ${formatBRL(Number(ride.amount))}`}</span>
        <span className="badge">{STATUS[status] ?? status}</span>
        {ride.reject_reason && status === 'in_progress' && (
          <span className="error">{`Recusado: ${ride.reject_reason}`}</span>
        )}
        {queued.length > 0 && <span className="hint">pendente de envio</span>}
      </button>
      {failedOps.map((o) => (
        <p key={o.id} className="error">
          {o.error}
        </p>
      ))}
      {open && (
        <div>
          {odometerStart != null && <p className="hint">{`Odômetro inicial: ${fmtInt(odometerStart)}`}</p>}
          {(status === 'completed' || status === 'checked') && ride.km != null && (
            <p className="hint">{`Km: ${kmFmt.format(Number(ride.km))}`}</p>
          )}
          {expenses.length > 0 && (
            <ul>
              {expenses.map((e) => (
                <li key={e.id}>
                  {`${KIND[e.kind] ?? e.kind} ${formatBRL(Number(e.amount))} – ${
                    REVIEW[e.review_status] ?? e.review_status
                  }${e.reject_reason ? `: ${e.reject_reason}` : ''}`}
                </li>
              ))}
            </ul>
          )}
          {status === 'assigned' && (
            <OdometerForm
              uid={uid}
              rideId={ride.id}
              kind="start_transfer"
              label="Odômetro inicial"
              button="Iniciar"
              reference={shiftStart}
              blocked={paused || noShift}
              hint={noShift && !paused ? 'Inicie um turno para iniciar o Transfer' : null}
            />
          )}
          {status === 'in_progress' && (
            <OdometerForm
              uid={uid}
              rideId={ride.id}
              kind="complete_transfer"
              label="Odômetro final"
              button="Concluir"
              min={odometerStart}
              reference={odometerStart}
              blocked={paused}
              hint={null}
            />
          )}
          {expensesOpen && <ExpenseButtons uid={uid} rideId={ride.id} />}
        </div>
      )}
    </div>
  )
}

/** Iniciar (assigned) ou Concluir (in_progress): leitura do odômetro + foto. Ninguém digita km. */
function OdometerForm({
  uid,
  rideId,
  kind,
  label,
  button,
  min,
  reference,
  blocked,
  hint,
}: {
  uid: string
  rideId: string
  kind: 'start_transfer' | 'complete_transfer'
  label: string
  button: string
  min?: number | null
  /** Última leitura conhecida (turno / início do Transfer) para decidir a confirmação. */
  reference?: number | null
  blocked: boolean
  hint: string | null
}) {
  const [odo, setOdo] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!odo.trim()) return setError('Informe o odômetro')
    const odometer = parseOdometerText(odo)
    if (odometer === null) return setError(odometerTextError(odo) ?? MSG_ODO_INTEGER)
    if (min != null && odometer < min) return setError(MSG_ODO_LOWER)
    if (!photo) return setError('Adicione a foto do odômetro')
    // concluir: referência = início do Transfer (km do Transfer); iniciar: turno ou última do aparelho
    const ref =
      kind === 'complete_transfer' ? (reference ?? lastReading(uid)) : maxReading(reference, lastReading(uid))
    if (!confirmReading(odometer, ref)) return
    setError('')
    setBusy(true)
    try {
      await enqueue({
        id: crypto.randomUUID(),
        kind,
        ownerId: uid,
        payload: { ride_id: rideId, odometer },
        photos: [{ field: 'photo', photoId: crypto.randomUUID(), blob: photo }],
      })
      setOdo('')
    } catch {
      setError(MSG_SAVE)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <OdometerField label={label} value={odo} onChange={setOdo} />
      <PhotoInput label="Foto do odômetro" onChange={setPhoto} />
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="big" disabled={busy || blocked}>
        {button}
      </button>
    </form>
  )
}

function ExpenseButtons({ uid, rideId }: { uid: string; rideId: string }) {
  const [expKind, setExpKind] = useState<'toll' | 'parking' | null>(null)
  return (
    <>
      <div className="seg">
        <button type="button" onClick={() => setExpKind('toll')}>
          Adicionar pedágio
        </button>
        <button type="button" onClick={() => setExpKind('parking')}>
          Adicionar estacionamento
        </button>
      </div>
      {expKind && (
        <ExpenseForm key={expKind} uid={uid} rideId={rideId} kind={expKind} onDone={() => setExpKind(null)} />
      )}
    </>
  )
}

function ExpenseForm({
  uid,
  rideId,
  kind,
  onDone,
}: {
  uid: string
  rideId: string
  kind: 'toll' | 'parking'
  onDone: () => void
}) {
  const [amount, setAmount] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    if (!receipt) return setError('Adicione o comprovante')
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_expense',
        ownerId: uid,
        payload: { id, ride_id: rideId, kind, amount },
        photos: [{ field: 'photo_path', photoId: crypto.randomUUID(), blob: receipt }],
      })
      onDone()
    } catch {
      setError(MSG_SAVE)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <strong>{KIND[kind]}</strong>
      <MoneyInput label="Valor" onChange={setAmount} />
      <ReceiptInput label="Comprovante" onChange={setReceipt} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        Salvar despesa
      </button>
    </form>
  )
}
