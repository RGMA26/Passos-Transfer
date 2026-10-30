import { Fragment, useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import type { Period } from '../lib/types'
import StatementView, { formatDay } from '../components/StatementView'
import MoneyInput from '../components/MoneyInput'
import { formatBRL } from '../lib/money'
import { parseDecimal } from './helpers'
import { localDate } from '../lib/periods'
import { toCSV } from '../lib/csv'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const CLOSE_ERRORS: Record<string, string> = {
  OPEN_SHIFTS: 'Há turnos abertos',
  ASSIGNED_TRANSFERS: 'Há transfers não concluídos',
  PENDING_REVIEW: 'Há itens aguardando conferência',
  MISSING_REFERENCE_PRICE: 'Defina o preço de referência do litro',
}
const KIND_LABEL: Record<api.AdjustmentKind, string> = {
  advance: 'Vale',
  fine: 'Multa',
  bonus: 'Bônus',
  correction: 'Correção',
}
const METHODS = ['Pix', 'Dinheiro', 'Transferência', 'Outro']

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const rangeShort = (p: Pick<Period, 'start_date' | 'end_date'>) => `${dm(p.start_date)} – ${dm(p.end_date)}`
const rangeLong = (p: Pick<Period, 'start_date' | 'end_date'>) =>
  `${dm(p.start_date)} – ${formatDay(p.end_date)}`

function statusOf(open: boolean, r: api.PeriodDriverStatement): string {
  if (open) return 'Estimado'
  return r.paid_at ? `Pago em ${dm(r.paid_at)}` : 'A pagar'
}

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[] | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [rows, setRows] = useState<api.PeriodDriverStatement[]>([])
  const [adjustments, setAdjustments] = useState<api.Adjustment[]>([])
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [closeError, setCloseError] = useState('')

  const loadPeriods = useCallback(async () => {
    setFailed(false)
    try {
      const list = await api.listPeriods()
      setPeriods(list)
      setPeriodId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? '')))
    } catch {
      setFailed(true)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return
    setFailed(false)
    try {
      const [r, a] = await Promise.all([api.periodDriverStatements(id), api.listAdjustments(id)])
      setRows(r)
      setAdjustments(a)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void loadPeriods()
  }, [loadPeriods])

  useEffect(() => {
    setRows([])
    setExpanded(null)
    setCloseError('')
    void loadDetail(periodId)
  }, [periodId, loadDetail])

  const period = periods?.find((p) => p.id === periodId)

  if (failed) {
    return (
      <section>
        <h2>Quinzenas</h2>
        <p className="error">{MSG_LOAD}</p>
        <button
          type="button"
          onClick={() => {
            void loadPeriods()
            void loadDetail(periodId)
          }}
        >
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!periods || !period) return <p className="loading">Carregando…</p>

  const open = period.status === 'open'

  async function close() {
    if (!period) return
    if (!window.confirm(`Fechar a quinzena ${rangeShort(period)}? Os valores serão congelados.`)) return
    setCloseError('')
    try {
      await api.closePeriod(period.id)
      await loadPeriods()
      await loadDetail(period.id)
    } catch (err) {
      setCloseError(CLOSE_ERRORS[(err as Error).message] ?? 'Não foi possível fechar a quinzena')
    }
  }

  function exportCsv() {
    if (!period) return
    const csv = toCSV(
      rows.map((r) => ({
        motorista: r.driver_name,
        codigo: r.driver_code,
        parte_uber: r.lines.uber_share,
        parte_transfer: r.lines.transfer_share,
        reembolsos:
          r.lines.fuel_reimbursement + r.lines.transfer_fuel_reimbursement + r.lines.expense_reimbursement,
        desconto_gasolina: r.lines.off_duty_fuel_discount,
        ajustes: r.lines.adjustments,
        total: r.total,
        pago_em: r.paid_at ? formatDay(r.paid_at) : '',
      })),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `passos-quinzena-${period.start_date}.csv`
    a.click()
    URL.revokeObjectURL?.(url)
  }

  return (
    <section>
      <h2>Quinzenas</h2>
      <label className="field">
        Quinzena
        <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {`${rangeLong(p)} · ${p.status === 'open' ? 'Aberta' : 'Fechada'}`}
            </option>
          ))}
        </select>
      </label>

      <PriceForm key={period.id} period={period} onSaved={() => void loadDetail(period.id)} />

      {open && (
        <>
          <button type="button" onClick={() => void close()}>
            Fechar quinzena
          </button>
          {closeError && (
            <p className="error" role="alert">
              {closeError}
            </p>
          )}
        </>
      )}
      <button type="button" onClick={exportCsv} disabled={rows.length === 0}>
        Exportar CSV
      </button>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Motorista</th>
              <th>Total</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = expanded === r.driver_id
              return (
                <Fragment key={r.driver_id}>
                  <tr>
                    <td>{r.driver_name}</td>
                    <td>{formatBRL(r.total)}</td>
                    <td>{statusOf(open, r)}</td>
                    <td className="actions">
                      <button type="button" onClick={() => setExpanded(isOpen ? null : r.driver_id)}>
                        {isOpen ? 'Ocultar extrato' : 'Ver extrato'}
                      </button>
                      {r.statement_id && (
                        <Link to={`/admin/extrato/${r.statement_id}`}>Imprimir / PDF</Link>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={4}>
                        <StatementView
                          lines={r.lines}
                          status={open ? 'estimated' : r.paid_at ? 'paid' : 'closed'}
                          paidAt={r.paid_at}
                          method={r.payment_method}
                          driverType={r.driver_type}
                        />
                        {!open && !r.paid_at && r.statement_id && (
                          <PayForm statementId={r.statement_id} onPaid={() => void loadDetail(period.id)} />
                        )}
                        <Adjustments
                          open={open}
                          driverId={r.driver_id}
                          periodId={period.id}
                          items={adjustments.filter((a) => a.driver_id === r.driver_id)}
                          onChanged={() => void loadDetail(period.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="hint">Nenhum motorista com movimento nesta quinzena.</p>}
    </section>
  )
}

function PriceForm({ period, onSaved }: { period: Period; onSaved: () => void }) {
  const [text, setText] = useState(
    period.reference_fuel_price == null ? '' : String(period.reference_fuel_price).replace('.', ','),
  )
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const open = period.status === 'open'

  async function save() {
    setSaved(false)
    const n = parseDecimal(text)
    if (n === null || n <= 0 || !/^\d+([.,]\d{1,3})?$/.test(text.trim())) {
      return setError('Informe um preço válido')
    }
    setError('')
    try {
      await api.setReferencePrice(period.id, n)
      setSaved(true)
      onSaved()
    } catch {
      setError('Não foi possível salvar o preço')
    }
  }

  return (
    <div className="panel">
      <label className="field">
        Preço de referência do litro
        <input
          type="text"
          inputMode="decimal"
          placeholder="0,000"
          value={text}
          disabled={!open}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="ok">Preço salvo</p>}
      {open && (
        <button type="button" onClick={() => void save()}>
          Salvar
        </button>
      )}
    </div>
  )
}

function PayForm({ statementId, onPaid }: { statementId: string; onPaid: () => void }) {
  const [show, setShow] = useState(false)
  const [date, setDate] = useState(localDate())
  const [method, setMethod] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!date || !method) return setError('Informe data e forma de pagamento')
    setError('')
    try {
      await api.markStatementPaid(statementId, date, method)
      onPaid()
    } catch {
      setError('Não foi possível registrar o pagamento')
    }
  }

  if (!show) {
    return (
      <button type="button" onClick={() => setShow(true)}>
        Marcar como pago
      </button>
    )
  }
  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <label className="field">
        Data
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        Forma
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Escolha…</option>
          {METHODS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit">Confirmar pagamento</button>
      <button type="button" className="link" onClick={() => setShow(false)}>
        Cancelar
      </button>
    </form>
  )
}

function Adjustments({
  open,
  driverId,
  periodId,
  items,
  onChanged,
}: {
  open: boolean
  driverId: string
  periodId: string
  items: api.Adjustment[]
  onChanged: () => void
}) {
  const [kind, setKind] = useState<api.AdjustmentKind>('advance')
  const [amount, setAmount] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [formKey, setFormKey] = useState(0)
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (amount === null || amount === 0 || (kind !== 'correction' && amount < 0)) {
      return setError('Informe um valor válido')
    }
    if (!description.trim()) return setError('Informe a descrição')
    const signed = kind === 'advance' || kind === 'fine' ? -Math.abs(amount) : kind === 'bonus' ? Math.abs(amount) : amount
    setError('')
    try {
      await api.createAdjustment({
        driver_id: driverId,
        period_id: periodId,
        kind,
        amount: signed,
        description: description.trim(),
      })
      setAmount(null)
      setDescription('')
      setFormKey((k) => k + 1)
      onChanged()
    } catch {
      setError('Não foi possível salvar o ajuste')
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteAdjustment(id)
      onChanged()
    } catch {
      setError('Não foi possível excluir o ajuste')
    }
  }

  return (
    <div className="panel">
      <strong>Ajustes</strong>
      {items.length === 0 && <p className="hint">Nenhum ajuste.</p>}
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            {`${KIND_LABEL[a.kind as api.AdjustmentKind] ?? a.kind}: ${formatBRL(Number(a.amount))} – ${a.description}`}
            {open && (
              <button type="button" className="link" onClick={() => void remove(a.id)}>
                Excluir
              </button>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <form key={formKey} onSubmit={(e) => void add(e)} noValidate>
          <label className="field">
            Tipo
            <select value={kind} onChange={(e) => {
                setKind(e.target.value as api.AdjustmentKind)
                setAmount(null)
              }}>
              {(Object.keys(KIND_LABEL) as api.AdjustmentKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <MoneyInput key={kind} label="Valor" allowNegative={kind === 'correction'} onChange={setAmount} />
          <label className="field">
            Descrição
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit">Adicionar ajuste</button>
        </form>
      )}
    </div>
  )
}
