import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { Profile } from '../lib/types'
import MoneyInput from '../components/MoneyInput'
import { formatBRL } from '../lib/money'
import { localDate } from '../lib/periods'
import { MSG_CONFIRM_UNDO } from './helpers'
import AddressFields, { EMPTY_ADDRESS, hasStreetNumber, isAddressComplete } from './AddressFields'

import type { AddressValue } from './AddressFields'

const MSG_STREET_NUMBER = 'Informe o número da rua'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_NO_ESTIMATE = 'Não foi possível calcular o km estimado'
const MSG_NOT_DELETABLE = 'Este transfer não pode mais ser excluído'
const MSG_SAVE_EDIT = 'Não foi possível salvar o transfer'
const MSG_COMPLETED_EDIT = 'Concluído: só o valor e os endereços podem ser alterados.'
const KNOWN_EDIT_ERRORS = ['Quinzena fechada: não é possível alterar', 'Este transfer não pode mais ser alterado']

const EDITABLE =['assigned', 'in_progress', 'completed']
const STATUS_LABEL: Record<string, string> = {
  assigned: 'Atribuída',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  checked: 'Conferida',
}
const FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Atribuída', value: 'assigned' },
  { label: 'Em andamento', value: 'in_progress' },
  { label: 'Concluída', value: 'completed' },
  { label: 'Conferida', value: 'checked' },
]

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})
const kmFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const fmtKm = (n: number) => kmFmt.format(Number(n))
const fmtWhen = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : '—')

const spDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const spTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** Data (AAAA-MM-DD) e hora (HH:MM) de Brasília para os campos do formulário. */
const spDateTime = (iso: string | null) =>
  iso ? { date: spDateFmt.format(new Date(iso)), time: spTimeFmt.format(new Date(iso)) } : { date: '', time: '' }
/** Data e hora digitadas (Brasília, -03:00). */
const parseWhen = (date: string, time: string) => {
  const when = date && time ? new Date(`${date}T${time}:00-03:00`) : null
  return when && !Number.isNaN(when.getTime()) ? when : null
}

const toAddressInput = (a: AddressValue): api.AddressInput => ({
  street: a.street.trim(),
  district: a.district.trim(),
  city: a.city.trim(),
  state: a.state.trim(),
  zip: a.zip.trim() || null,
  ref: a.ref.trim() || null,
})

const sameAddress = (a: api.AddressInput, b: api.AddressInput) =>
  a.street === b.street && a.district === b.district && a.city === b.city && a.state === b.state &&
  (a.zip ?? null) === (b.zip ?? null) && (a.ref ?? null) === (b.ref ?? null)

/** Endereço gravado no Transfer → campos do formulário. */
function rowAddress(r: api.TransferRow, p: 'origin' | 'dest'): AddressValue {
  const g = (k: string) => String((r as unknown as Record<string, unknown>)[`${p}_${k}`] ?? '')
  return { street: g('street'), district: g('district'), city: g('city'), state: g('state'), zip: g('zip'), ref: g('ref') }
}

/** Erros do endereço (os mesmos do cadastro). */
function addressErrors(origin: AddressValue, destination: AddressValue): Record<string, string> {
  const errs: Record<string, string> = {}
  if (!isAddressComplete(origin)) errs.origin = 'Preencha o endereço de origem'
  else if (!hasStreetNumber(origin)) errs.origin = MSG_STREET_NUMBER
  if (!isAddressComplete(destination)) errs.destination = 'Preencha o endereço de destino'
  else if (!hasStreetNumber(destination)) errs.destination = MSG_STREET_NUMBER
  return errs
}

export default function TransfersPage() {
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<api.TransferRow[] | null>(null)
  const [drivers, setDrivers] = useState<Profile[]>([])
  const [failed, setFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [reassignId, setReassignId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [r, d] = await Promise.all([api.listTransfers(status ? { status } : {}), api.listDrivers()])
      setRows(r)
      setDrivers(d.filter((x) => x.active))
    } catch {
      setFailed(true)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(r: api.TransferRow) {
    if (!window.confirm('Excluir este transfer?')) return
    setActionError('')
    try {
      await api.deleteTransfer(r.id)
      await load()
    } catch (err) {
      const msg = (err as Error).message
      setActionError(msg === MSG_NOT_DELETABLE ? msg : 'Não foi possível excluir')
      await load()
    }
  }

  async function unreview(r: api.TransferRow) {
    if (!window.confirm(MSG_CONFIRM_UNDO)) return
    setActionError('')
    try {
      await api.unreviewItem('transfer', r.id)
    } catch (err) {
      const msg = (err as Error).message
      setActionError(msg === 'PERIOD_CLOSED' ? KNOWN_EDIT_ERRORS[0] : 'Não foi possível desfazer a conferência')
    }
    await load()
  }

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
  if (!rows) return <p className="loading">Carregando…</p>

  return (
    <section>
      <h2>Transfers</h2>
      {actionError && <p className="error" role="alert">{actionError}</p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}>
          Novo transfer
        </button>
      )}
      {showForm && (
        <NewTransferForm
          drivers={drivers}
          onCancel={() => setShowForm(false)}
          onCreated={(noEstimate) => {
            setShowForm(false)
            setNotice(noEstimate ? MSG_NO_ESTIMATE : '')
            void load()
          }}
        />
      )}
      {editId && rows.find((r) => r.id === editId) && (
        <EditTransferForm
          key={editId}
          row={rows.find((r) => r.id === editId)!}
          onCancel={() => setEditId(null)}
          onSaved={(noEstimate) => {
            setEditId(null)
            setNotice(noEstimate ? MSG_NO_ESTIMATE : '')
            void load()
          }}
        />
      )}
      <div className="seg" role="group" aria-label="Filtrar por status">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={status === f.value}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Data/hora</th>
              <th>Motorista</th>
              <th>Valor</th>
              <th>Km estimado</th>
              <th>Km real</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.client_name}</td>
                <td>{fmtWhen(r.scheduled_at)}</td>
                <td>{r.driver_name}</td>
                <td>{formatBRL(Number(r.amount))}</td>
                <td>{r.estimated_km === null ? '—' : fmtKm(r.estimated_km)}</td>
                <td>{r.km === null ? '—' : fmtKm(r.km)}</td>
                <td>{STATUS_LABEL[r.transfer_status ?? ''] ?? '—'}</td>
                <td className="actions">
                  {EDITABLE.includes(r.transfer_status ?? '') && reassignId !== r.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false)
                        setEditId(r.id)
                      }}
                    >
                      Editar
                    </button>
                  )}
                  {r.transfer_status === 'checked' && (
                    <button type="button" onClick={() => void unreview(r)}>
                      Desfazer conferência
                    </button>
                  )}
                  {r.transfer_status === 'assigned' &&
                    (reassignId === r.id ? (
                      <Reassign
                        row={r}
                        drivers={drivers}
                        onDone={(changed) => {
                          setReassignId(null)
                          if (changed) void load()
                        }}
                      />
                    ) : (
                      <>
                        <button type="button" onClick={() => setReassignId(r.id)}>
                          Trocar motorista
                        </button>
                        <button type="button" onClick={() => void remove(r)}>
                          Excluir
                        </button>
                      </>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="hint">Nenhum transfer.</p>}
    </section>
  )
}

function Reassign({
  row,
  drivers,
  onDone,
}: {
  row: api.TransferRow
  drivers: Profile[]
  onDone: (changed: boolean) => void
}) {
  const [driverId, setDriverId] = useState('')
  const [error, setError] = useState('')

  async function save() {
    if (!driverId || driverId === row.driver_id) return setError('Escolha o motorista')
    try {
      await api.reassignTransfer(row.id, driverId)
      onDone(true)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg === 'Este transfer não pode mais ser alterado' ? msg : 'Não foi possível trocar o motorista')
    }
  }

  return (
    <div className="inline-edit">
      <label className="field">
        Novo motorista
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Escolha o motorista</option>
          {drivers
            .filter((d) => d.id !== row.driver_id)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" onClick={() => void save()}>
        Salvar motorista
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </div>
  )
}

function NewTransferForm({
  drivers,
  onCancel,
  onCreated,
}: {
  drivers: Profile[]
  onCancel: () => void
  onCreated: (noEstimate: boolean) => void
}) {
  const [client, setClient] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [origin, setOrigin] = useState<AddressValue>(EMPTY_ADDRESS)
  const [destination, setDestination] = useState<AddressValue>(EMPTY_ADDRESS)
  const [amount, setAmount] = useState<number | null>(null)
  const [driverId, setDriverId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!client.trim()) errs.client = 'Informe o cliente'
    const when = parseWhen(date, time)
    if (!when) errs.when = 'Informe data e horário'
    if (amount === null || amount <= 0) errs.amount = 'Informe um valor válido'
    if (!driverId) errs.driver = 'Escolha o motorista'
    Object.assign(errs, addressErrors(origin, destination))
    setErrors(errs)
    setError('')
    if (Object.keys(errs).length > 0 || !when || amount === null) return
    setBusy(true)
    const o = toAddressInput(origin)
    const d = toAddressInput(destination)
    const km = await api.estimateRoute(o, d)
    try {
      await api.createTransfer({
        driver_id: driverId,
        client_name: client.trim(),
        scheduled_at: when.toISOString(),
        ride_date: localDate(when),
        origin: o,
        destination: d,
        amount,
        estimated_km: km,
      })
      onCreated(km === null)
    } catch {
      setError('Não foi possível criar o transfer')
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>Novo transfer</strong>
      <label className="field">
        Cliente
        <input value={client} onChange={(e) => setClient(e.target.value)} />
      </label>
      {errors.client && <p className="error">{errors.client}</p>}
      <label className="field">
        Data
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        Horário
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      {errors.when && <p className="error">{errors.when}</p>}
      <AddressFields legend="Origem" value={origin} onChange={setOrigin} />
      {errors.origin && <p className="error">{errors.origin}</p>}
      <AddressFields legend="Destino" value={destination} onChange={setDestination} />
      {errors.destination && <p className="error">{errors.destination}</p>}
      <MoneyInput label="Valor contratado" onChange={setAmount} />
      {errors.amount && <p className="error">{errors.amount}</p>}
      <label className="field">
        Motorista
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Escolha…</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {errors.driver && <p className="error">{errors.driver}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Criar transfer
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  )
}

/**
 * Edição pelo admin. Atribuída/em andamento: cliente, data/hora, endereços e valor; concluída: só valor
 * e endereços. Endereço alterado → recalcula o km estimado (falha: nulo e aviso). O servidor
 * (update_transfer) confere de novo e nunca mexe em leituras, status, motorista ou km real.
 */
function EditTransferForm({
  row,
  onCancel,
  onSaved,
}: {
  row: api.TransferRow
  onCancel: () => void
  onSaved: (noEstimate: boolean) => void
}) {
  const full = row.transfer_status !== 'completed'
  const initialWhen = spDateTime(row.scheduled_at)
  const initialOrigin = rowAddress(row, 'origin')
  const initialDest = rowAddress(row, 'dest')
  const [client, setClient] = useState(row.client_name ?? '')
  const [date, setDate] = useState(initialWhen.date)
  const [time, setTime] = useState(initialWhen.time)
  const [origin, setOrigin] = useState<AddressValue>(initialOrigin)
  const [destination, setDestination] = useState<AddressValue>(initialDest)
  const [amount, setAmount] = useState<number | null>(Number(row.amount))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    const when = full ? parseWhen(date, time) : null
    if (full && !client.trim()) errs.client = 'Informe o cliente'
    if (full && !when) errs.when = 'Informe data e horário'
    if (amount === null || amount <= 0) errs.amount = 'Informe um valor válido'
    Object.assign(errs, addressErrors(origin, destination))
    setErrors(errs)
    setError('')
    if (Object.keys(errs).length > 0 || amount === null) return

    const patch: api.TransferPatch = {}
    if (full && client.trim() !== (row.client_name ?? '')) patch.client_name = client.trim()
    if (full && when && (date !== initialWhen.date || time !== initialWhen.time)) {
      // ride_date é derivada no servidor (update_transfer) pela data de Brasília
      patch.scheduled_at = when.toISOString()
    }
    if (amount !== Number(row.amount)) patch.amount = amount
    const o = toAddressInput(origin)
    const d = toAddressInput(destination)
    const addressChanged =
      !sameAddress(o, toAddressInput(initialOrigin)) || !sameAddress(d, toAddressInput(initialDest))
    if (!addressChanged && Object.keys(patch).length === 0) return onCancel()

    setBusy(true)
    let noEstimate = false
    if (addressChanged) {
      const km = await api.estimateRoute(o, d)
      patch.origin = o
      patch.destination = d
      patch.estimated_km = km
      noEstimate = km === null
    }
    try {
      await api.updateTransfer(row.id, patch)
      onSaved(noEstimate)
    } catch (err) {
      const msg = (err as Error).message
      setError(KNOWN_EDIT_ERRORS.includes(msg) ? msg : MSG_SAVE_EDIT)
      setBusy(false)
    }
  }

  return (
    <form className="panel" aria-label="Editar transfer" onSubmit={(e) => void submit(e)} noValidate>
      <strong>{`Editar transfer – ${row.client_name ?? ''}`}</strong>
      {!full && <p className="hint">{MSG_COMPLETED_EDIT}</p>}
      <label className="field">
        Cliente
        <input value={client} disabled={!full} onChange={(e) => setClient(e.target.value)} />
      </label>
      {errors.client && <p className="error">{errors.client}</p>}
      <label className="field">
        Data
        <input type="date" value={date} disabled={!full} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        Horário
        <input type="time" value={time} disabled={!full} onChange={(e) => setTime(e.target.value)} />
      </label>
      {errors.when && <p className="error">{errors.when}</p>}
      <AddressFields legend="Origem" value={origin} onChange={setOrigin} />
      {errors.origin && <p className="error">{errors.origin}</p>}
      <AddressFields legend="Destino" value={destination} onChange={setDestination} />
      {errors.destination && <p className="error">{errors.destination}</p>}
      <MoneyInput
        label="Valor contratado"
        initial={Number(row.amount).toFixed(2).replace('.', ',')}
        onChange={setAmount}
      />
      {errors.amount && <p className="error">{errors.amount}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Salvar alterações
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  )
}
