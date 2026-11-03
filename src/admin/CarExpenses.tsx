import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { CarExpense, CarExpenseKind, CarExpenseMode } from '../lib/api'
import type { Car } from '../lib/types'
import { formatBRL, parseBRL } from '../lib/money'
import { localDate } from '../lib/periods'

const KIND_LABEL: Record<CarExpenseKind, string> = {
  maintenance: 'Manutenção',
  insurance: 'Seguro',
  tax: 'Imposto',
  other: 'Outro',
}
const MODE_LABEL: Record<CarExpenseMode, string> = {
  single: 'Pontual',
  installments: 'Parcelado',
  recurring: 'Recorrente',
}
const MSG_LOAD = 'Não foi possível carregar os gastos.'
const MSG_SAVE = 'Não foi possível salvar o gasto'
const MSG_DELETE_CONFIRM =
  'Excluir este gasto? Ele deixa de contar a partir deste mês; os meses anteriores continuam registrados.'

const fmtDay = (iso: string) => iso.split('-').reverse().join('/')
const fmtMonth = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Prévia do parcelamento: a última parcela absorve os centavos. */
export function installmentsPreview(amount: number, n: number): string {
  const cents = Math.round(amount * 100)
  const each = Math.round(cents / n)
  const last = cents - each * (n - 1)
  if (last === each) return `${n}× ${formatBRL(each / 100)}`
  return `${n}× ${formatBRL(each / 100)} (última ${formatBRL(last / 100)})`
}

function modeText(e: CarExpense, today: string): string {
  if (e.mode === 'single') return 'Pontual'
  if (e.mode === 'recurring') {
    return e.finished && e.end_date ? `Recorrente – finalizado em ${fmtMonth(e.end_date)}` : 'Recorrente – ativo'
  }
  const n = e.installments ?? 0
  const k =
    (Number(today.slice(0, 4)) - Number(e.start_date.slice(0, 4))) * 12 +
    Number(today.slice(5, 7)) -
    Number(e.start_date.slice(5, 7))
  if (k < 0) return `Parcelado em ${n}× a partir de ${fmtMonth(e.start_date)}`
  return `Parcela ${Math.min(k + 1, n)} de ${n}`
}

/** Gastos de um carro da empresa: ver, adicionar, editar, finalizar e excluir. */
export default function CarExpenses({ car, onClose }: { car: Car; onClose: () => void }) {
  const [items, setItems] = useState<CarExpense[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState<CarExpense | 'new' | null>(null)
  const [finishId, setFinishId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setItems(await api.listCarExpenses(car.id))
    } catch {
      setFailed(true)
    }
  }, [car.id])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(e: CarExpense) {
    if (!window.confirm(MSG_DELETE_CONFIRM)) return
    setError('')
    try {
      await api.deleteCarExpense(e.id)
      await load()
    } catch {
      setError('Não foi possível excluir o gasto')
    }
  }

  const today = localDate()
  const active = (items ?? []).filter((e) => !e.deleted_on)
  const deleted = (items ?? []).filter((e) => e.deleted_on)

  return (
    <div className="panel" role="region" aria-label={`Gastos de ${car.model} ${car.plate}`}>
      <strong>{`Gastos de ${car.model} ${car.plate}`}</strong>
      {failed && (
        <>
          <p className="error">{MSG_LOAD}</p>
          <button type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </>
      )}
      {!items && !failed && <p className="loading">Carregando…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {items && (
        <>
          {active.length === 0 && <p className="hint">Nenhum gasto cadastrado.</p>}
          <ul className="list">
            {active.map((e) => (
              <li key={e.id}>
                <span>
                  {`${KIND_LABEL[e.kind as CarExpenseKind] ?? e.kind}${e.description ? ` · ${e.description}` : ''} · ${formatBRL(Number(e.amount))} · ${modeText(e, today)} · início ${fmtDay(e.start_date)}`}
                </span>{' '}
                <button type="button" onClick={() => setForm(e)}>
                  Editar gasto
                </button>
                {e.mode === 'recurring' && !e.finished && (
                  <button type="button" onClick={() => setFinishId(e.id)}>
                    Finalizar
                  </button>
                )}
                <button type="button" onClick={() => void remove(e)}>
                  Excluir gasto
                </button>
                {finishId === e.id && (
                  <FinishForm
                    expense={e}
                    onDone={(changed) => {
                      setFinishId(null)
                      if (changed) void load()
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {deleted.length > 0 && (
            <>
              <strong>Excluídos</strong>
              <ul className="list">
                {deleted.map((e) => (
                  <li key={e.id}>
                    {`${KIND_LABEL[e.kind as CarExpenseKind] ?? e.kind}${e.description ? ` · ${e.description}` : ''} · ${formatBRL(Number(e.amount))} · excluído em ${fmtDay(e.deleted_on!)}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {form ? (
        <ExpenseForm
          carId={car.id}
          expense={form === 'new' ? undefined : form}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            void load()
          }}
        />
      ) : (
        <button type="button" onClick={() => setForm('new')}>
          Adicionar gasto
        </button>
      )}
      <button type="button" className="link" onClick={onClose}>
        Fechar gastos
      </button>
    </div>
  )
}

function FinishForm({ expense, onDone }: { expense: CarExpense; onDone: (changed: boolean) => void }) {
  const [month, setMonth] = useState(localDate().slice(0, 7))
  const [error, setError] = useState('')

  async function save() {
    if (!/^\d{4}-\d{2}$/.test(month)) return setError('Informe o último mês')
    if (month < expense.start_date.slice(0, 7)) return setError('O último mês não pode ser antes do início')
    setError('')
    try {
      await api.finishCarExpense(expense.id, `${month}-01`)
      onDone(true)
    } catch {
      setError('Não foi possível finalizar o gasto')
    }
  }

  return (
    <div className="inline-edit">
      <label className="field">
        Último mês que conta
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" onClick={() => void save()}>
        Confirmar fim do gasto
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </div>
  )
}

function ExpenseForm({
  carId,
  expense,
  onCancel,
  onSaved,
}: {
  carId: string
  expense?: CarExpense
  onCancel: () => void
  onSaved: () => void
}) {
  const [kind, setKind] = useState<CarExpenseKind>((expense?.kind as CarExpenseKind) ?? 'maintenance')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [mode, setMode] = useState<CarExpenseMode>((expense?.mode as CarExpenseMode) ?? 'single')
  const [amount, setAmount] = useState(expense ? String(expense.amount).replace('.', ',') : '')
  const [installments, setInstallments] = useState(expense?.installments ? String(expense.installments) : '')
  const [startDate, setStartDate] = useState(expense?.start_date ?? localDate())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const value = parseBRL(amount)
  const n = Number(installments)
  const preview =
    mode === 'installments' && value !== null && value > 0 && Number.isInteger(n) && n >= 2
      ? installmentsPreview(value, n)
      : ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if ((kind === 'tax' || kind === 'other') && !description.trim()) return setError('Descreva o gasto')
    if (value === null || value <= 0) return setError('Informe o valor')
    if (mode === 'installments') {
      if (!Number.isInteger(n) || n < 2) return setError('Informe pelo menos 2 parcelas')
      if (value < n * 0.01) return setError('Valor pequeno demais para este número de parcelas')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return setError('Informe a data de início')
    const input = {
      kind,
      description: description.trim() || null,
      mode,
      amount: value,
      installments: mode === 'installments' ? n : null,
      start_date: startDate,
    }
    setBusy(true)
    try {
      if (expense) await api.updateCarExpense(expense.id, input)
      else await api.createCarExpense({ car_id: carId, ...input })
      onSaved()
    } catch {
      setError(MSG_SAVE)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <strong>{expense ? 'Editar gasto' : 'Novo gasto'}</strong>
      <label className="field">
        Tipo do gasto
        <select value={kind} onChange={(e) => setKind(e.target.value as CarExpenseKind)}>
          {(Object.keys(KIND_LABEL) as CarExpenseKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Descrição
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        Forma
        <select value={mode} disabled={!!expense} onChange={(e) => setMode(e.target.value as CarExpenseMode)}>
          {(Object.keys(MODE_LABEL) as CarExpenseMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Valor
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {mode === 'installments' && (
        <label className="field">
          Parcelas
          <input inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)} />
        </label>
      )}
      {preview && <p className="hint">{preview}</p>}
      <label className="field">
        Data de início
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Salvar gasto
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  )
}
