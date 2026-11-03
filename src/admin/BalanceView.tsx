import { formatBRL } from '../lib/money'
import type { MonthlyBalance } from '../lib/api'
import { formatDay } from '../components/StatementView'

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const KIND_LABEL: Record<string, string> = { maintenance: 'Manutenção', insurance: 'Seguro', tax: 'Imposto', other: 'Outros' }

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** '2026-11' -> 'Novembro/2026' */
export function monthLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`
}

export function comparisonText(diff: number, pct: number | null): string {
  if (diff === 0) return '— igual ao mês anterior'
  const arrow = diff > 0 ? '▲' : '▼'
  const base = `${arrow} ${formatBRL(Math.abs(diff))}`
  if (pct === null) return base
  const p = pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return `${base} (${pct > 0 ? '+' : ''}${p}%)`
}

export function expenseNote(e: { mode: string; installment_no: number | null; installments: number | null }): string {
  if (e.mode === 'installments') return `parcela ${e.installment_no}/${e.installments}`
  if (e.mode === 'recurring') return 'recorrente'
  return ''
}

/** Linhas do CSV de resumo. */
export function summaryRows(b: MonthlyBalance): Record<string, string | number>[] {
  const r = b.result
  const rows: Record<string, string | number>[] = []
  const add = (secao: string, item: string, valor: number) => rows.push({ secao, item, valor })
  add('Faturamento', 'Uber', r.revenue.uber)
  add('Faturamento', 'Transfer', r.revenue.transfer)
  add('Faturamento', 'BlaBlaCar', r.revenue.blablacar)
  add('Faturamento', 'Total', r.revenue.total)
  add('Devido aos motoristas', 'Total', r.owed.total)
  for (const d of r.owed.by_driver) add('Devido aos motoristas', d.name, d.total)
  add('Combustível', 'Reembolsos', r.owed.fuel_reimbursement)
  add('Combustível', 'Gasolina dos Transfers', r.owed.transfer_fuel)
  add('Combustível', 'Desconto da gasolina por fora', -r.owed.off_duty_discount)
  add('Pedágios e estacionamentos', 'Reembolsos', r.owed.expense_reimbursement)
  add('Ajustes', 'Total', r.owed.adjustments)
  for (const e of r.car_expenses.items) {
    const note = expenseNote(e)
    add('Gastos dos carros', `${e.plate} ${e.model} — ${KIND_LABEL[e.kind] ?? e.kind}${note ? ` (${note})` : ''}`, e.amount)
  }
  add('Gastos dos carros', 'Total', r.car_expenses.total)
  add('Resultado', 'Resultado da empresa', r.company_result)
  add('Resultado', 'Mês anterior', r.previous_company_result)
  add('Caixa', 'Total pago no mês', b.cash.total)
  add('A pagar', 'Total', b.payable.total)
  return rows
}

export default function BalanceView({ b }: { b: MonthlyBalance }) {
  const r = b.result
  return (
    <>
      {b.estimated && <span className="badge badge-gray">estimado</span>}

      <section className="panel" aria-label="Resultado do mês">
        <h3>Resultado do mês</h3>
        <h4>Faturamento</h4>
        <p>{`Uber: ${formatBRL(r.revenue.uber)}`}</p>
        <p>{`Transfer: ${formatBRL(r.revenue.transfer)}`}</p>
        <p>{`BlaBlaCar: ${formatBRL(r.revenue.blablacar)}`}</p>
        <p>
          <strong>{`Total: ${formatBRL(r.revenue.total)}`}</strong>
        </p>
        <h4>Devido aos motoristas</h4>
        <p>
          <strong>{`Total: ${formatBRL(r.owed.total)}`}</strong>
        </p>
        <ul>
          {r.owed.by_driver.map((d) => (
            <li key={d.driver_id}>{`${d.name} — ${formatBRL(d.total)}`}</li>
          ))}
        </ul>
        <h4>Combustível</h4>
        <p>{`Reembolsos: ${formatBRL(r.owed.fuel_reimbursement)}`}</p>
        <p>{`Gasolina dos Transfers: ${formatBRL(r.owed.transfer_fuel)}`}</p>
        <p>{`Desconto da gasolina por fora: − ${formatBRL(r.owed.off_duty_discount)}`}</p>
        <h4>Pedágios e estacionamentos</h4>
        <p>{formatBRL(r.owed.expense_reimbursement)}</p>
        <h4>Ajustes</h4>
        <p>{formatBRL(r.owed.adjustments)}</p>
        <h4>Gastos dos carros da empresa</h4>
        <p>
          <strong>{`Total: ${formatBRL(r.car_expenses.total)}`}</strong>
        </p>
        {(['maintenance', 'insurance', 'tax', 'other'] as const).map((k) => (
          <p key={k}>{`${KIND_LABEL[k]}: ${formatBRL(r.car_expenses.by_kind[k])}`}</p>
        ))}
        <ul>
          {r.car_expenses.items.map((e) => {
            const note = expenseNote(e)
            return (
              <li key={e.expense_id}>
                {`${e.plate} ${e.model} — ${KIND_LABEL[e.kind] ?? e.kind}${e.description ? ` — ${e.description}` : ''} — ${formatBRL(e.amount)}`}
                {note && <span className="badge badge-gray">{note}</span>}
              </li>
            )
          })}
        </ul>
        <h4>Resultado da empresa</h4>
        <p className="big-number">{formatBRL(r.company_result)}</p>
        <p>{comparisonText(r.diff, r.diff_pct)}</p>
      </section>

      <section className="panel" aria-label="Caixa do mês">
        <h3>Caixa do mês</h3>
        <p>
          <strong>{`Total pago: ${formatBRL(b.cash.total)}`}</strong>
        </p>
        {b.cash.items.length === 0 && <p className="hint">Nenhum repasse pago neste mês.</p>}
        <ul>
          {b.cash.items.map((c) => (
            <li key={c.statement_id}>
              {`${formatDay(c.paid_at)} · ${c.name} · quinzena ${dm(c.period_start)} – ${dm(c.period_end)} · ${formatBRL(c.total)} · Comprovante ${c.has_payment_proof ? '✅' : '⚪'} · Recibo assinado ${c.has_signed_receipt ? '✅' : '⚪'}`}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-label="A pagar">
        <h3>A pagar</h3>
        <p>
          <strong>{`Total: ${formatBRL(b.payable.total)}`}</strong> <span className="badge badge-gray">estimado</span>
        </p>
        <ul>
          {b.payable.items.map((p) => (
            <li key={p.driver_id}>
              {`${p.name} — fechado não pago ${formatBRL(p.closed_unpaid)} · quinzena aberta (estimado) ${formatBRL(p.open_estimate)}`}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-label="Km por fora">
        <h3>Km por fora</h3>
        <h4>Por motorista</h4>
        {b.off_km_ranking.by_driver.length === 0 ? (
          <p className="hint">Sem dados neste mês.</p>
        ) : (
          <ol>
            {b.off_km_ranking.by_driver.map((d) => (
              <li key={d.driver_id}>{`${d.name} — ${d.km_off} km`}</li>
            ))}
          </ol>
        )}
        <h4>Por carro</h4>
        {b.off_km_ranking.by_car.length === 0 ? (
          <p className="hint">Sem dados neste mês.</p>
        ) : (
          <ol>
            {b.off_km_ranking.by_car.map((c) => (
              <li key={c.car_id}>{`${c.plate} ${c.model} — ${c.km_off} km`}</li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}
