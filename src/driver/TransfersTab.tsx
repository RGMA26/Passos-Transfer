import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatBRL, parseBRL } from '../lib/money'
import { enqueue } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'
import type { Ride, RideExpense } from '../lib/types'
import MoneyInput from '../components/MoneyInput'
import PhotoInput from '../components/PhotoInput'
import { useShift } from './useShift'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const STATUS: Record<string, string> = {
  assigned: 'Atribuída',
  completed: 'Concluída',
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

export default function TransfersTab() {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const company = profile?.driver_type === 'company_car'
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
      {rides.length === 0 && <p className="hint">Nenhum transfer atribuído.</p>}
      {rides.map((r) => (
        <RideCard
          key={r.id}
          uid={uid}
          ride={r}
          expenses={expenses.filter((e) => e.ride_id === r.id)}
          ops={ops.filter((o) => o.payload.ride_id === r.id)}
          noShift={company && !shift && !r.shift_id}
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
  open,
  onToggle,
}: {
  uid: string
  ride: Ride
  expenses: RideExpense[]
  ops: QueuedOp[]
  noShift: boolean
  open: boolean
  onToggle: () => void
}) {
  const status = ride.transfer_status ?? 'assigned'
  const actionable = status === 'assigned' || status === 'completed'
  const queued = ops.filter(
    (o) => (o.kind === 'complete_transfer' || o.kind === 'insert_expense') && o.status === 'pending',
  )
  const failedOps = ops.filter((o) => o.status === 'failed')

  return (
    <div className="panel">
      <button type="button" className="card-head" onClick={onToggle} aria-expanded={open}>
        <strong>{ride.client_name}</strong>
        {ride.scheduled_at && <span>{whenFmt.format(new Date(ride.scheduled_at))}</span>}
        {(ride.origin || ride.destination) && (
          <span>{`${ride.origin ?? ''} → ${ride.destination ?? ''}`}</span>
        )}
        <span>{`Valor contratado: ${formatBRL(Number(ride.amount))}`}</span>
        <span className="badge">{STATUS[status] ?? status}</span>
        {ride.reject_reason && <span className="error">{`Recusado: ${ride.reject_reason}`}</span>}
        {queued.length > 0 && <span className="hint">pendente de envio</span>}
      </button>
      {failedOps.map((o) => (
        <p key={o.id} className="error">{o.error}</p>
      ))}
      {open && (
        <div>
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
          {actionable && <Actions uid={uid} ride={ride} noShift={noShift} />}
        </div>
      )}
    </div>
  )
}

function Actions({ uid, ride, noShift }: { uid: string; ride: Ride; noShift: boolean }) {
  const [km, setKm] = useState('')
  const [kmError, setKmError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expKind, setExpKind] = useState<'toll' | 'parking' | null>(null)

  async function complete(e: FormEvent) {
    e.preventDefault()
    const n = parseBRL(km)
    if (n === null) return setKmError('Informe o km')
    setKmError('')
    setBusy(true)
    try {
      await enqueue({
        id: crypto.randomUUID(),
        kind: 'complete_transfer',
        ownerId: uid,
        payload: { ride_id: ride.id, km: n },
        photos: [],
      })
      setKm('')
    } catch {
      setKmError('Não foi possível salvar. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={(e) => void complete(e)} noValidate>
        <label className="field">
          Km
          <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
        </label>
        {noShift && <p className="hint">Inicie um turno para concluir</p>}
        {kmError && <p className="error" role="alert">{kmError}</p>}
        <button type="submit" className="big" disabled={busy || noShift}>
          Concluir
        </button>
      </form>
      <div className="seg">
        <button type="button" onClick={() => setExpKind('toll')}>
          Adicionar pedágio
        </button>
        <button type="button" onClick={() => setExpKind('parking')}>
          Adicionar estacionamento
        </button>
      </div>
      {expKind && (
        <ExpenseForm
          key={expKind}
          uid={uid}
          rideId={ride.id}
          kind={expKind}
          onDone={() => setExpKind(null)}
        />
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
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    if (!photo) return setError('Adicione a foto do comprovante')
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_expense',
        ownerId: uid,
        payload: { id, ride_id: rideId, kind, amount },
        photos: [{ field: 'photo_path', photoId: crypto.randomUUID(), blob: photo }],
      })
      onDone()
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <strong>{kind === 'toll' ? 'Pedágio' : 'Estacionamento'}</strong>
      <MoneyInput label="Valor" onChange={setAmount} />
      <PhotoInput label="Foto do comprovante" onChange={setPhoto} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Salvar despesa
      </button>
    </form>
  )
}
