import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api'
import type { Fuel, TodayEntry } from '../lib/api'
import { FUEL_LABEL, formatQty, formatUnitPrice, fuelUnit } from '../lib/fuel'
import { formatBRL } from '../lib/money'
import { enqueue } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'
import { localDate } from '../lib/periods'
import MoneyInput from '../components/MoneyInput'

const PLATFORM = { uber: 'Uber', blablacar: 'BlaBlaCar' } as const
const MSG_SAVE = 'Não foi possível salvar. Tente de novo.'

type Row = TodayEntry & { queued: boolean }

/** Número >= 0 com vírgula ou ponto decimal, ou null. */
function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

const decimalText = (n: number) => n.toFixed(2).replace('.', ',')
const qtyText = (n: number | null) => (n == null ? '' : String(n).replace('.', ','))
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

/** Servidor + fila: inserções pendentes aparecem (sem ações); edições/exclusões pendentes já valem. */
export function mergeEntries(server: TodayEntry[], ops: QueuedOp[], today: string): Row[] {
  const rows: Row[] = server.map((e) => ({ ...e, queued: false }))
  const known = new Set(rows.map((r) => r.id))
  for (const o of ops) {
    const p = o.payload
    if (o.kind === 'insert_ride' && p.ride_date === today && (p.platform === 'uber' || p.platform === 'blablacar')) {
      if (known.has(String(p.id))) continue
      rows.push({
        kind: 'ride', id: String(p.id), platform: p.platform, amount: Number(p.amount),
        km: p.km == null ? null : Number(p.km), quantity: null, unit_price: null, editable: false, queued: true,
      })
    } else if (o.kind === 'insert_fueling' && p.fueled_on === today) {
      if (known.has(String(p.id))) continue
      rows.push({
        kind: 'fueling', id: String(p.id), amount: Number(p.amount), fuel: p.fuel as Fuel,
        km: null, quantity: numOrNull(p.quantity), unit_price: numOrNull(p.unit_price),
        editable: false, queued: true,
      })
    }
  }
  let out = rows
  for (const o of ops) {
    const id = String(o.payload.id)
    if (o.kind === 'delete_ride' || o.kind === 'delete_fueling') {
      out = out.filter((r) => r.id !== id)
    } else if (o.kind === 'update_ride' || o.kind === 'update_fueling') {
      out = out.map((r) =>
        r.id === id
          ? {
              ...r,
              amount: Number(o.payload.amount),
              km: o.kind === 'update_ride' ? (o.payload.km == null ? null : Number(o.payload.km)) : r.km,
              quantity: o.kind === 'update_fueling' ? numOrNull(o.payload.quantity) : r.quantity,
              unit_price: o.kind === 'update_fueling' ? numOrNull(o.payload.unit_price) : r.unit_price,
              queued: true,
            }
          : r,
      )
    }
  }
  return out
}

export default function TodayEntries({ uid, ops }: { uid: string; ops: QueuedOp[] }) {
  const [server, setServer] = useState<TodayEntry[]>([])
  const today = localDate()

  useEffect(() => {
    let alive = true
    api
      .listTodayEntries(uid, today)
      .then((e) => alive && setServer(e))
      .catch(() => {}) // offline: mantém a última lista
    return () => {
      alive = false
    }
  }, [uid, today, ops])

  const rows = useMemo(() => mergeEntries(server, ops, today), [server, ops, today])
  if (rows.length === 0) return null

  return (
    <section className="panel" aria-label="Lançamentos de hoje">
      <strong>Lançamentos de hoje</strong>
      <ul className="entries">
        {rows.map((r) => (
          <EntryItem key={r.id} uid={uid} row={r} />
        ))}
      </ul>
    </section>
  )
}

function entryText(r: Row): string {
  if (r.kind === 'ride') {
    return `${PLATFORM[r.platform ?? 'uber']} ${formatBRL(r.amount)}${r.km == null ? '' : ` · ${r.km} km`}`
  }
  const fuel = r.fuel ?? 'gasolina'
  const qty = r.quantity == null ? '' : ` ${formatQty(r.quantity)} ${fuelUnit(fuel)}`
  const price = r.unit_price == null ? '' : ` × ${formatUnitPrice(r.unit_price)}`
  return `Abastecimento ${formatBRL(r.amount)} · ${r.fuel ? FUEL_LABEL[r.fuel] : ''}${qty}${price}`.trimEnd()
}

function EntryItem({ uid, row }: { uid: string; row: Row }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState<number | null>(row.amount)
  const ride = row.kind === 'ride'
  const [qty, setQty] = useState(ride ? String(row.km ?? '') : qtyText(row.quantity))
  const [price, setPrice] = useState(qtyText(row.unit_price))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const unit = fuelUnit(row.fuel ?? 'gasolina')

  async function queue(kind: QueuedOp['kind'], payload: Record<string, unknown>) {
    const id = crypto.randomUUID()
    await enqueue({ id, kind, ownerId: uid, payload, photos: [] })
  }

  async function save() {
    if (amount === null || (ride ? amount < 0 : amount <= 0)) return setError('Informe um valor válido')
    const n = qty.trim() === '' && ride ? null : parseNumber(qty)
    if (ride && qty.trim() !== '' && n === null) return setError('Informe os km')
    if (!ride && (n === null || n <= 0)) return setError('Informe a quantidade')
    const p = parseNumber(price)
    if (!ride && (p === null || p <= 0)) return setError(`Informe o preço por ${unit}`)
    setError('')
    setBusy(true)
    try {
      if (ride) await queue('update_ride', { id: row.id, amount, km: n })
      else await queue('update_fueling', { id: row.id, amount, quantity: n, unit_price: p })
      setEditing(false)
    } catch {
      setError(MSG_SAVE)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Excluir este lançamento?')) return
    setBusy(true)
    try {
      await queue(ride ? 'delete_ride' : 'delete_fueling', { id: row.id })
    } catch {
      setError(MSG_SAVE)
      setBusy(false)
    }
  }

  return (
    <li className="entry">
      <span>{entryText(row)}</span>
      {row.queued && <small className="hint"> pendente de envio</small>}
      {!row.editable && !row.queued && <small className="hint"> conferido</small>}
      {editing ? (
        <div className="inline-edit">
          <MoneyInput label="Valor" initial={decimalText(row.amount)} onChange={setAmount} />
          <label className="field">
            {ride ? 'Km' : `Quantidade (${unit})`}
            <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          {!ride && (
            <label className="field">
              {`Preço por ${unit}`}
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" disabled={busy} onClick={() => void save()}>
            Salvar alteração
          </button>
          <button type="button" className="link" onClick={() => { setEditing(false); setError('') }}>
            Cancelar
          </button>
        </div>
      ) : (
        row.editable && (
          <span className="seg">
            <button type="button" disabled={busy} onClick={() => setEditing(true)}>
              Editar
            </button>
            <button type="button" disabled={busy} onClick={() => void remove()}>
              Excluir
            </button>
          </span>
        )
      )}
      {!editing && error && <p className="error" role="alert">{error}</p>}
    </li>
  )
}
