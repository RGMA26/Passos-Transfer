import { formatBRL } from '../lib/money'
import type { StatementLines } from '../lib/types'

export interface RejectedLine {
  kind: string
  date: string
  /** null para turno (sem valor próprio). */
  amount: number | null
  reason: string
}

interface Props {
  lines: StatementLines
  status: 'estimated' | 'closed' | 'paid'
  paidAt?: string | null
  method?: string | null
  rejected?: RejectedLine[]
  /** Filtra linhas que não se aplicam; sem valor mostra todas (visão do admin). */
  driverType?: 'company_car' | 'own_car' | string | null
}

const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** 'YYYY-MM-DD' (ou ISO) -> 'dd/mm/aaaa'. */
export function formatDay(value: string): string {
  return value.length === 10
    ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : dayFmt.format(new Date(value))
}

/** Valor com sinal: negativos viram "− R$ x". */
function signed(v: number): string {
  return v < 0 ? `− ${formatBRL(-v)}` : formatBRL(v)
}

export default function StatementView({
  lines,
  status,
  paidAt,
  method,
  rejected = [],
  driverType,
}: Props) {
  const own = driverType === 'own_car'
  const company = driverType === 'company_car'
  const pending = lines.pending.fuelings + lines.pending.expenses

  let badge: string
  if (status === 'estimated') badge = 'A receber (estimado)'
  else if (status === 'closed') badge = 'Fechado'
  else badge = `Pago em ${paidAt ? formatDay(paidAt) : ''} (${method ?? ''})`

  const rows: { label: string; value: string; show: boolean }[] = [
    { label: 'Parte Uber', value: formatBRL(lines.uber_share), show: !own },
    { label: 'Parte Transfer', value: formatBRL(lines.transfer_share), show: true },
    { label: 'Reembolso de abastecimento', value: formatBRL(lines.fuel_reimbursement), show: !own },
    {
      label: 'Reembolso de gasolina (Transfer)',
      value: formatBRL(lines.transfer_fuel_reimbursement),
      show: !company,
    },
    {
      label: 'Reembolso de pedágio/estacionamento',
      value: formatBRL(lines.expense_reimbursement),
      show: true,
    },
    {
      label: 'Gasolina por fora',
      value: lines.off_duty_fuel_discount > 0 ? `− ${formatBRL(lines.off_duty_fuel_discount)}` : formatBRL(0),
      show: !own,
    },
    { label: 'Ajustes', value: signed(lines.adjustments), show: true },
  ]

  return (
    <div className="statement">
      <span className={status === 'estimated' ? 'badge estimate' : 'badge ok'}>{badge}</span>
      <dl className="panel">
        {rows
          .filter((r) => r.show)
          .map((r) => (
            <div key={r.label} className="stmt-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        <div className="stmt-row total">
          <dt>{status === 'estimated' ? 'A receber (estimado)' : 'Total'}</dt>
          <dd>{formatBRL(lines.total)}</dd>
        </div>
      </dl>
      {pending > 0 && <p className="hint">{`${formatBRL(pending)} aguardando conferência`}</p>}
      {lines.missing_fuel_price && (
        <p className="error">Ainda não há nota de abastecimento aprovada para calcular a gasolina</p>
      )}
      {lines.missing_consumption && (
        <p className="error">Falta o consumo do carro para calcular a gasolina</p>
      )}
      <div className="panel">
        <strong>Quilometragem</strong>
        <span>{`Km total: ${lines.km.total}`}</span>
        <span>{`Km em serviço: ${lines.km.service}`}</span>
        <span>{`Km por fora: ${lines.km.off}`}</span>
      </div>
      {rejected.length > 0 && (
        <div className="panel">
          <strong>Itens recusados</strong>
          <ul>
            {rejected.map((r, i) => (
              <li key={i}>
                {r.amount === null
                  ? `${r.kind} de ${formatDay(r.date).slice(0, 5)}: ${r.reason}`
                  : `${r.kind} de ${formatDay(r.date)} (${formatBRL(r.amount)}) – Recusado: ${r.reason}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
