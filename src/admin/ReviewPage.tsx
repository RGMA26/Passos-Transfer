import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import * as api from '../lib/api'
import { formatBRL } from '../lib/money'
import { conflictText, formatQty, fuelUnit } from '../lib/fuel'
import { MSG_CONFIRM_UNDO, parseDecimal } from './helpers'
import { fmtInt } from '../lib/odometer'
import OdometerFix from './OdometerFix'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_PERIOD_CLOSED = 'Quinzena fechada: não é possível alterar'
const MSG_NEW_EXPENSES = 'Há despesas novas neste Transfer. Atualize a conferência.'
const MSG_REASON = 'Informe o motivo'
const MSG_ODO = 'O odômetro final não pode ser menor que o inicial'

const errorText = (err: unknown, fallback: string) =>
  (err as Error)?.message === 'PERIOD_CLOSED' ? MSG_PERIOD_CLOSED : fallback

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})
const fmtWhen = (iso?: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : '—')
const fmtDay = (d: string) => d.split('-').reverse().join('/')

type Kind = 'fueling' | 'shift' | 'transfer'

/** Km real mais de 20% acima do estimado. */
const kmAboveEstimate = (km: number | null, est: number | null) =>
  km !== null && est !== null && est > 0 && km > est * 1.2 + 1e-9

const EXPENSE_LABEL: Record<string, string> = { toll: 'Pedágio', parking: 'Estacionamento' }

export default function ReviewPage() {
  const [queue, setQueue] = useState<api.PendingReview | null>(null)
  const [alerts, setAlerts] = useState<api.AdminAlert[]>([])
  const [failed, setFailed] = useState(false)
  const { hash } = useLocation()

  const [reviewed, setReviewed] = useState<api.ReviewedItem[]>([])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [q, a] = await Promise.all([api.listPendingReview(), api.listAlerts()])
      setQueue(q)
      setAlerts(a)
    } catch {
      setFailed(true)
    }
    // conferidos recentes ("Desfazer conferência"): falha aqui não derruba a fila
    try {
      setReviewed((await api.listReviewed()) ?? [])
    } catch {
      setReviewed([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // #item-<id>: leva o item pendente (vindo do Início/pendências) para a tela
  useEffect(() => {
    if (!queue || !hash.startsWith('#item-')) return
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'center' })
  }, [queue, hash])

  if (failed) {
    return (
      <section>
        <h2>Conferência</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!queue) return <p className="loading">Carregando…</p>

  const total = queue.fuelings.length + queue.shifts.length + queue.transfers.length
  const reload = () => void load()

  return (
    <section>
      <h2>Conferência</h2>
      <AlertsPanel alerts={alerts} />
      {total === 0 && <p className="hint">Nada para conferir.</p>}
      {queue.fuelings.length > 0 && (
        <section className="panel" aria-label="Abastecimentos">
          <h3>Abastecimentos</h3>
          {queue.fuelings.map((f) => (
            <ReviewItem
              key={f.id}
              kind="fueling"
              id={f.id}
              onDone={reload}
              photos={[{ path: f.photo_path, alt: 'Foto do abastecimento' }]}
              conflict={f.values_conflict}
            >
              <strong>{f.driver_name}</strong>
              <span>{`${fmtDay(f.fueled_on)} · ${formatBRL(f.amount)} · ${formatQty(f.quantity)} ${fuelUnit(f.fuel)}`}</span>
              {f.values_conflict && (
                <>
                  <span className="warn">🟠 Valores conflitantes</span>
                  <span>{conflictText(f.quantity, f.unit_price, f.amount, f.fuel)}</span>
                </>
              )}
            </ReviewItem>
          ))}
        </section>
      )}
      {queue.shifts.length > 0 && (
        <section className="panel" aria-label="Turnos">
          <h3>Turnos</h3>
          {queue.shifts.map((s) => (
            <ShiftItem key={s.id} shift={s} onDone={reload} />
          ))}
        </section>
      )}
      {queue.transfers.length > 0 && (
        <section className="panel" aria-label="Transfers concluídos">
          <h3>Transfers concluídos</h3>
          {queue.transfers.map((t) => (
            <TransferItem key={t.id} transfer={t} onDone={reload} />
          ))}
        </section>
      )}
      <ReviewedPanel items={reviewed} onDone={reload} />
    </section>
  )
}

function ReviewedPanel({ items, onDone }: { items: api.ReviewedItem[]; onDone: () => void }) {
  if (items.length === 0) return null
  return (
    <section className="panel" aria-label="Conferidos recentemente">
      <h3>Conferidos recentemente</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((it) => (
          <ReviewedRow key={`${it.kind}-${it.id}`} item={it} onDone={onDone} />
        ))}
      </ul>
    </section>
  )
}

function ReviewedRow({ item, onDone }: { item: api.ReviewedItem; onDone: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function undo() {
    if (!window.confirm(MSG_CONFIRM_UNDO)) return
    setError('')
    setBusy(true)
    try {
      await api.unreviewItem(item.kind, item.id)
      onDone()
    } catch (err) {
      setError(errorText(err, 'Não foi possível desfazer a conferência'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li style={{ borderTop: '1px solid #e5e7eb', padding: '0.5rem 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <strong>{item.driver_name}</strong>
      <span>{fmtDay(item.date)}</span>
      <span>{item.text}</span>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void undo()}>
        Desfazer conferência
      </button>
    </li>
  )
}

function AlertsPanel({ alerts }: { alerts: api.AdminAlert[] }) {
  if (alerts.length === 0) return null
  const text = (a: api.AdminAlert) => {
    const d = a.detail
    if (a.kind === 'HIGH_OFF_KM') return `km por fora acima de 20% (${d.km_off} / ${d.km_total} km)`
    if (a.kind === 'NEGATIVE_OFF_KM') return `km lançado maior que o rodado (${d.km_service} lançados / ${d.km_total} km rodados)`
    return `Turno aberto há mais de 24 h (desde ${fmtWhen(d.started_at)})`
  }
  return (
    <section className="panel" aria-label="Alertas">
      <h3>Alertas</h3>
      <ul>
        {alerts.map((a, i) => (
          <li key={`${a.kind}-${a.shift_id}-${i}`}>{`${a.driver_name} — ${text(a)}`}</li>
        ))}
      </ul>
    </section>
  )
}

function Thumb({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    api
      .signedPhotoUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [path])
  if (failed) return <span className="hint">Foto indisponível</span>
  if (!url) return <span className="hint">Carregando foto…</span>
  if (/\.pdf$/i.test(path)) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {`${alt} (PDF)`}
      </a>
    )
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
    </a>
  )
}

function ReviewItem({
  kind,
  id,
  photos,
  onDone,
  children,
  extra,
  conflict,
  expenseIds,
}: {
  kind: Kind
  id: string
  /** Transfer: ids das despesas exibidas (o servidor recusa se houver outra pendente). */
  expenseIds?: string[]
  photos: { path: string; alt: string }[]
  onDone: () => void
  children: ReactNode
  extra?: ReactNode
  conflict?: boolean
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(approved: boolean) {
    const r = reason.trim()
    if (!approved && !r) return setError(MSG_REASON)
    setError('')
    setBusy(true)
    try {
      if (approved && expenseIds) await api.reviewItem(kind, id, true, null, expenseIds)
      else await api.reviewItem(kind, id, approved, approved ? null : r)
      onDone()
    } catch (err) {
      if ((err as Error)?.message === 'NEW_EXPENSES') {
        window.alert(MSG_NEW_EXPENSES)
        onDone()
        return
      }
      setError(errorText(err, 'Não foi possível concluir a ação'))
      setBusy(false)
    }
  }

  return (
    <div
      id={`item-${id}`}
      className={conflict ? 'review-item conflict' : 'review-item'}
      style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem', ...(conflict ? { background: '#fff4e5' } : {}) }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>{children}</div>
      {photos.length > 0 && (
        <div className="seg">
          {photos.map((p) => (
            <Thumb key={p.path} path={p.path} alt={p.alt} />
          ))}
        </div>
      )}
      {extra}
      {rejecting && (
        <>
          <label className="field">
            Motivo
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </label>
          <button type="button" disabled={busy} onClick={() => void run(false)}>
            Confirmar recusa
          </button>
          <button type="button" className="link" onClick={() => { setRejecting(false); setError('') }}>
            Cancelar
          </button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {!rejecting && (
        <div className="seg">
          <button type="button" disabled={busy} onClick={() => void run(true)}>
            Aprovar
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)}>
            Recusar
          </button>
        </div>
      )}
    </div>
  )
}

function TransferItem({ transfer: t, onDone }: { transfer: api.PendingTransfer; onDone: () => void }) {
  const photos = [
    t.odometer_start_photo && { path: t.odometer_start_photo, alt: 'Foto do odômetro inicial' },
    t.odometer_end_photo && { path: t.odometer_end_photo, alt: 'Foto do odômetro final' },
    ...t.expenses.map((e) => ({
      path: e.photo_path,
      alt: `Comprovante do ${(EXPENSE_LABEL[e.kind] ?? e.kind).toLowerCase()}`,
    })),
  ].filter((p): p is { path: string; alt: string } => !!p)
  return (
    <ReviewItem
      kind="transfer"
      id={t.id}
      onDone={onDone}
      photos={photos}
      expenseIds={t.expenses.filter((e) => e.review_status === 'pending').map((e) => e.id)}
      extra={<OdometerFix id={t.id} start={t.odometer_start} end={t.odometer_end} withEnd onDone={onDone} />}
    >
      <strong>{t.driver_name}</strong>
      <span>{`${t.client_name ?? '—'} · ${fmtWhen(t.scheduled_at)} · ${formatBRL(t.amount)}`}</span>
      {(t.origin || t.destination) && <span>{`${t.origin ?? '—'} → ${t.destination ?? '—'}`}</span>}
      <span>{`Odômetro ${t.odometer_start == null ? '—' : fmtInt(t.odometer_start)} → ${
        t.odometer_end == null ? '—' : fmtInt(t.odometer_end)
      }`}</span>
      <span>{`Km real: ${t.km ?? '—'} · Km estimado: ${t.estimated_km ?? '—'}`}</span>
      {kmAboveEstimate(t.km, t.estimated_km) && <span className="warn">Km acima do estimado</span>}
      {t.odometer_start != null && !t.odometer_start_photo && (
        <span className="warn">📷 Foto do odômetro não enviada (início)</span>
      )}
      {t.odometer_end != null && !t.odometer_end_photo && (
        <span className="warn">📷 Foto do odômetro não enviada (fim)</span>
      )}
      {t.expenses.map((e) => (
        <span key={e.id}>{`${EXPENSE_LABEL[e.kind] ?? e.kind} · ${formatBRL(e.amount)}`}</span>
      ))}
    </ReviewItem>
  )
}

const RIDE_LABEL: Record<string, string> = { uber: 'Uber', blablacar: 'BlaBlaCar', transfer: 'Transfer' }

function ShiftItem({ shift, onDone }: { shift: api.PendingShift; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(String(shift.odometer_start))
  const [end, setEnd] = useState(String(shift.odometer_end ?? ''))
  const [error, setError] = useState('')

  async function save() {
    const s = parseDecimal(start)
    const e = parseDecimal(end)
    if (s === null || e === null) return setError('Informe os dois odômetros')
    if (e < s) return setError(MSG_ODO)
    setError('')
    try {
      await api.updateShiftOdometers(shift.id, s, e)
      setEditing(false)
      onDone()
    } catch (err) {
      setError(errorText(err, 'Não foi possível salvar o odômetro'))
    }
  }

  const photos = [
    shift.odometer_start_photo && { path: shift.odometer_start_photo, alt: 'Foto do odômetro inicial' },
    shift.odometer_end_photo && { path: shift.odometer_end_photo, alt: 'Foto do odômetro final' },
    shift.uber_earnings_photo && { path: shift.uber_earnings_photo, alt: 'Print de ganhos Uber' },
  ].filter((p): p is { path: string; alt: string } => !!p)

  return (
    <ReviewItem
      kind="shift"
      id={shift.id}
      photos={photos}
      onDone={onDone}
      extra={
        editing ? (
          <div className="inline-edit">
            <label className="field">
              Odômetro inicial
              <input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              Odômetro final
              <input inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="button" onClick={() => void save()}>
              Salvar odômetro
            </button>
            <button type="button" className="link" onClick={() => { setEditing(false); setError('') }}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)}>
            Corrigir odômetro
          </button>
        )
      }
    >
      <strong>{shift.driver_name}</strong>
      <span>{`${fmtDay(shift.start_date)} · odômetro ${shift.odometer_start} → ${shift.odometer_end ?? '—'}`}</span>
      <span className="shift-totals">
        {`Uber: ${formatBRL(shift.totals.uber.amount)} (${shift.totals.uber.km} km)`}
      </span>
      <span>{`BlaBlaCar: ${formatBRL(shift.totals.blablacar.amount)} (${shift.totals.blablacar.km} km)`}</span>
      <span>{`Transfers: ${shift.totals.transfer_km} km`}</span>
      {!shift.odometer_start_photo && <span className="warn">📷 Foto do odômetro não enviada (início)</span>}
      {shift.odometer_end != null && !shift.odometer_end_photo && (
        <span className="warn">📷 Foto do odômetro não enviada (fim)</span>
      )}
      {!shift.uber_earnings_photo && shift.rides.some((r) => r.platform === 'uber') && (
        <span className="warn">📷 Print da Uber não enviado</span>
      )}
      {shift.rides.length > 0 && (
        <ul className="shift-rides" aria-label="Corridas do turno" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {shift.rides.map((r, i) => {
            const label = RIDE_LABEL[r.platform] ?? r.platform
            return (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{`${label} · ${formatBRL(r.amount)} · ${r.km === null ? '— km' : `${r.km} km`}`}</span>
                {r.receipt_path ? (
                  <Thumb path={r.receipt_path} alt={`Comprovante da corrida ${i + 1} (${label})`} />
                ) : (
                  r.platform !== 'transfer' && <span className="hint">Sem comprovante</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {shift.review_status === 'rejected' && (
        <span className="error">{`Recusado: ${shift.reject_reason ?? '—'}`}</span>
      )}
    </ReviewItem>
  )
}
