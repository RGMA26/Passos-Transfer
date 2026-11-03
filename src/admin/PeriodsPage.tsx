import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import type { DriverPeriod } from '../lib/types'
import StatementView, { formatDay } from '../components/StatementView'
import PeriodSignal from '../components/PeriodSignal'
import MoneyInput from '../components/MoneyInput'
import { formatBRL } from '../lib/money'
import { localDate } from '../lib/periods'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_NOT_ENDED = 'A quinzena ainda não terminou. Fechar mesmo assim?'
const MSG_MISSING_PRICE =
  'Não há nota de abastecimento aprovada para calcular a gasolina desta quinzena. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?'
const MSG_MISSING_CONSUMPTION =
  'Falta o consumo do carro para calcular a gasolina. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?'
const MSG_DOC_TYPE = 'Envie JPG, PNG ou PDF de até 10 MB'
const MARK_TITLE = 'Fechada sem nota de abastecimento'
const CLOSE_ERRORS: Record<string, string> = {
  PREVIOUS_OPEN: 'Feche a quinzena anterior primeiro',
  OPEN_SHIFTS: 'Há turnos abertos',
  ASSIGNED_TRANSFERS: 'Há transfers não concluídos',
  PENDING_REVIEW: 'Há itens aguardando conferência',
  SHIFTS_NOT_APPROVED: 'Há turnos não aprovados',
  ALREADY_CLOSED: 'Esta quinzena já está fechada',
}
const KIND_LABEL: Record<api.AdjustmentKind, string> = {
  advance: 'Vale',
  fine: 'Multa',
  bonus: 'Bônus',
  correction: 'Correção',
}
const METHODS = ['Pix', 'Dinheiro', 'Transferência', 'Outro']

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const rangeShort = (p: { start_date: string; end_date: string }) => `${dm(p.start_date)} – ${dm(p.end_date)}`
const rangeLong = (p: { start_date: string; end_date: string }) => `${dm(p.start_date)} – ${formatDay(p.end_date)}`

export default function PeriodsPage() {
  const [rows, setRows] = useState<api.PeriodOverviewRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<api.PeriodOverviewRow | null>(null)
  const [params] = useSearchParams()
  const wanted = params.get('motorista')
  const opened = useRef(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await api.listPeriodOverview())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ?motorista=<id> (vindo das pendências): abre esse motorista uma única vez
  useEffect(() => {
    if (!rows || !wanted || opened.current) return
    opened.current = true
    const row = rows.find((r) => r.driver_id === wanted)
    if (row) setSelected(row)
  }, [rows, wanted])

  if (failed) {
    return (
      <section>
        <h2>Quinzenas</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!rows) return <p className="loading">Carregando…</p>

  if (selected) {
    return (
      <DriverPeriods
        driver={selected}
        onBack={() => {
          setSelected(null)
          void load()
        }}
      />
    )
  }

  return (
    <section>
      <h2>Quinzenas</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Motorista</th>
              <th>Quinzena atual</th>
              <th>Total</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driver_id}>
                <td>
                  {r.driver_name}
                  {r.active ? '' : ' (inativo)'} <PeriodSignal signal={r.signal} paused={r.paused} />
                </td>
                <td>{r.start_date && r.end_date ? rangeShort({ start_date: r.start_date, end_date: r.end_date }) : '—'}</td>
                <td>{r.total === null ? '—' : formatBRL(r.total)}</td>
                <td className="actions">
                  <button type="button" onClick={() => setSelected(r)}>
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="hint">Nenhum motorista ativo.</p>}
    </section>
  )
}

function DriverPeriods({ driver, onBack }: { driver: api.PeriodOverviewRow; onBack: () => void }) {
  const [periods, setPeriods] = useState<DriverPeriod[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setPeriods(await api.listDriverPeriods(driver.driver_id))
    } catch {
      setFailed(true)
    }
  }, [driver.driver_id])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section>
      <h2>
        {`Quinzenas — ${driver.driver_name}${driver.active ? '' : ' (inativo)'} `}
        <PeriodSignal signal={driver.signal} paused={driver.paused} />
      </h2>
      <button type="button" className="link" onClick={onBack}>
        Voltar
      </button>
      {failed && (
        <>
          <p className="error">{MSG_LOAD}</p>
          <button type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </>
      )}
      {!failed && !periods && <p className="loading">Carregando…</p>}
      {periods && periods.length === 0 && <p className="hint">Nenhuma quinzena.</p>}
      <ul className="list">
        {periods?.map((p) => (
          <li key={p.id}>
            <PeriodItem
              period={p}
              driverId={driver.driver_id}
              open={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onChanged={() => void load()}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function PeriodItem({
  period,
  driverId,
  open,
  onToggle,
  onChanged,
}: {
  period: DriverPeriod
  driverId: string
  open: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [stmt, setStmt] = useState<api.PeriodStatement | null>(null)
  const [adjustments, setAdjustments] = useState<api.Adjustment[]>([])
  const [failed, setFailed] = useState(false)
  const [closeError, setCloseError] = useState('')
  const isOpen = period.status === 'open'

  const loadDetail = useCallback(async () => {
    setFailed(false)
    try {
      const [s, a] = await Promise.all([api.driverPeriodStatement(period.id), api.listAdjustments(period.id)])
      setStmt(s)
      setAdjustments(a)
    } catch {
      setFailed(true)
    }
  }, [period.id])

  useEffect(() => {
    if (open) void loadDetail()
  }, [open, loadDetail])

  async function close() {
    if (!window.confirm(`Fechar a quinzena ${rangeShort(period)}? Os valores serão congelados.`)) return
    setCloseError('')
    // quinzena em andamento: pede a segunda confirmação antes (evita a ida e volta com erro)
    let force = localDate() <= period.end_date
    if (force && !window.confirm(MSG_NOT_ENDED)) return
    let allowMissingFuelPrice = false
    for (;;) {
      try {
        await api.closeDriverPeriod(period.id, { force, allowMissingFuelPrice })
        break
      } catch (err) {
        const code = (err as Error).message
        if (code === 'PERIOD_NOT_ENDED' && !force) {
          // relógio do aparelho atrasado: o servidor é quem decide
          if (!window.confirm(MSG_NOT_ENDED)) return
          force = true
        } else if (code === 'MISSING_FUEL_PRICE' && !allowMissingFuelPrice) {
          let noConsumption = stmt?.lines.missing_consumption
          if (noConsumption === undefined) {
            try {
              noConsumption = (await api.driverPeriodStatement(period.id)).lines.missing_consumption
            } catch {
              noConsumption = false
            }
          }
          if (!window.confirm(noConsumption ? MSG_MISSING_CONSUMPTION : MSG_MISSING_PRICE)) return
          allowMissingFuelPrice = true
        } else {
          setCloseError(CLOSE_ERRORS[code] ?? 'Não foi possível fechar a quinzena')
          return
        }
      }
    }
    onChanged()
    await loadDetail()
  }

  const reload = () => {
    onChanged()
    void loadDetail()
  }

  return (
    <div>
      <strong>{`${rangeLong(period)} · ${isOpen ? 'Aberta' : 'Fechada'}`}</strong>
      {!isOpen && period.missing_fuel_price && (
        <span role="img" aria-label={MARK_TITLE} title={MARK_TITLE} style={{ color: '#dc2626' }}>
          ❗
        </span>
      )}{' '}
      <button type="button" onClick={onToggle}>
        {open ? 'Ocultar extrato' : 'Ver extrato'}
      </button>{' '}
      {isOpen && (
        <button type="button" onClick={() => void close()}>
          Fechar quinzena
        </button>
      )}
      {closeError && (
        <p className="error" role="alert">
          {closeError}
        </p>
      )}
      {open && failed && (
        <>
          <p className="error">{MSG_LOAD}</p>
          <button type="button" onClick={() => void loadDetail()}>
            Tentar novamente
          </button>
        </>
      )}
      {open && !failed && !stmt && <p className="loading">Carregando…</p>}
      {open && stmt && (
        <div>
          <p>{`Total: ${formatBRL(stmt.total)}`}</p>
          <StatementView
            lines={stmt.lines}
            status={isOpen ? 'estimated' : stmt.paid_at ? 'paid' : 'closed'}
            paidAt={stmt.paid_at}
            method={stmt.payment_method}
            driverType={stmt.driver.driver_type}
          />
          {stmt.statement_id && (
            <p>
              <Link to={`/admin/extrato/${stmt.statement_id}`}>Imprimir / PDF</Link>
              {stmt.paid_at && (
                <>
                  {' '}
                  <Link to={`/admin/recibo/${stmt.statement_id}`}>Recibo</Link>
                </>
              )}
            </p>
          )}
          {!isOpen && !stmt.paid_at && stmt.statement_id && (
            <PayForm statementId={stmt.statement_id} onPaid={reload} />
          )}
          {stmt.paid_at && stmt.statement_id && (
            <PaymentDocuments driverId={driverId} statementId={stmt.statement_id} />
          )}
          <Adjustments
            open={isOpen}
            driverId={driverId}
            periodId={period.id}
            items={adjustments}
            onChanged={reload}
          />
        </div>
      )}
    </div>
  )
}

const OK_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const MAX_DOC_BYTES = 10 * 1024 * 1024

function PaymentDocuments({ driverId, statementId }: { driverId: string; statementId: string }) {
  const [docs, setDocs] = useState<api.AdminDocument[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setDocs(await api.listAdminDocuments({ statementId }))
    } catch {
      setFailed(true)
    }
  }, [statementId])

  useEffect(() => {
    void load()
  }, [load])

  if (failed) {
    return (
      <div>
        <p className="error">Não foi possível carregar os anexos.</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    )
  }
  if (!docs) return <p className="loading">Carregando…</p>
  return (
    <>
      <DocSection
        title="Comprovante de pagamento"
        uploadLabel="Anexar comprovante de pagamento"
        kind="payment_proof"
        driverId={driverId}
        statementId={statementId}
        docs={docs.filter((d) => d.kind === 'payment_proof')}
        onChanged={() => void load()}
      />
      <DocSection
        title="Recibo assinado"
        uploadLabel="Anexar recibo assinado"
        kind="signed_receipt"
        driverId={driverId}
        statementId={statementId}
        docs={docs.filter((d) => d.kind === 'signed_receipt')}
        onChanged={() => void load()}
      />
    </>
  )
}

function DocSection({
  title,
  uploadLabel,
  kind,
  driverId,
  statementId,
  docs,
  onChanged,
}: {
  title: string
  uploadLabel: string
  kind: 'payment_proof' | 'signed_receipt'
  driverId: string
  statementId: string
  docs: api.AdminDocument[]
  onChanged: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(files: File[]) {
    setError('')
    if (files.length === 0) return
    if (files.some((f) => !OK_DOC_TYPES.includes(f.type) || f.size > MAX_DOC_BYTES)) return setError(MSG_DOC_TYPE)
    setBusy(true)
    try {
      for (const file of files) {
        await api.uploadAdminDocument({ driverId, statementId, kind, file })
      }
    } catch (err) {
      setError((err as { code?: string }).code === 'INVALID_FILE' ? MSG_DOC_TYPE : 'Não foi possível enviar o arquivo')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      onChanged()
    }
  }

  async function open(d: api.AdminDocument) {
    setError('')
    try {
      window.open(await api.adminDocumentUrl(d.file_path), '_blank', 'noopener')
    } catch {
      setError('Não foi possível abrir o documento')
    }
  }

  async function remove(d: api.AdminDocument) {
    if (!window.confirm('Excluir este documento?')) return
    setError('')
    try {
      await api.deleteAdminDocument(d)
      onChanged()
    } catch {
      setError('Não foi possível excluir o documento')
    }
  }

  return (
    <section className="panel" aria-label={title}>
      <strong>{title}</strong>{' '}
      {docs.length > 0 ? (
        <span role="img" aria-label="Anexado">
          ✅
        </span>
      ) : (
        <span role="img" aria-label="Sem anexo">
          ⚪
        </span>
      )}
      <ul className="list">
        {docs.map((d) => (
          <li key={d.id}>
            <span>{d.file_path.split('/').pop()}</span>{' '}
            <button type="button" onClick={() => void open(d)}>
              Abrir
            </button>{' '}
            <button type="button" onClick={() => void remove(d)}>
              Excluir
            </button>
          </li>
        ))}
      </ul>
      <label className="field">
        {uploadLabel}
        <input
          ref={fileRef}
          type="file"
          multiple
          disabled={busy}
          accept="image/jpeg,image/png,application/pdf"
          onChange={(e) => void upload(Array.from(e.target.files ?? []))}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
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
