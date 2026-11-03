import type { MonthlyDetailRow } from '../lib/api'
import { formatCpf } from '../lib/cpf'
import { toCSV } from '../lib/csv'

export const DETAIL_HEADERS = [
  'data', 'motorista', 'cpf', 'codigo', 'tipo', 'descricao', 'valor_bruto', 'valor_motorista', 'quinzena', 'situacao',
]

const KIND: Record<string, string> = {
  uber: 'Corrida Uber',
  blablacar: 'Corrida BlaBlaCar',
  transfer: 'Transfer',
  fueling: 'Abastecimento',
  toll: 'Pedágio',
  parking: 'Estacionamento',
  payment: 'Pagamento',
}
const ADJUSTMENT: Record<string, string> = { advance: 'Vale', fine: 'Multa', bonus: 'Bônus', correction: 'Correção' }
const CAR_EXPENSE: Record<string, string> = {
  maintenance: 'Manutenção',
  insurance: 'Seguro',
  tax: 'Imposto',
  other: 'Outro',
}
const STATUS: Record<string, string> = {
  approved: 'Aprovado',
  pending: 'Pendente',
  rejected: 'Recusado',
  checked: 'Conferido',
  completed: 'Concluído',
  paid: 'Pago',
  assigned: 'Atribuído',
  in_progress: 'Em andamento',
  recurring: 'recorrente',
  single: 'pontual',
}
// descrição do gasto de carro vinda do banco: "PLACA Modelo — kind[ — descrição]"
const CAR_KIND_IN_DESC = / — (maintenance|insurance|tax|other)(?= — |$)/

const br = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

function kindStatus(r: MonthlyDetailRow): { tipo: string; descricao: string; situacao: string } {
  const descricao = r.description ?? ''
  const st = r.status ?? ''
  if (r.kind === 'adjustment') {
    return { tipo: `Ajuste – ${ADJUSTMENT[st] ?? st}`, descricao, situacao: '' }
  }
  if (r.kind === 'car_expense') {
    const m = CAR_KIND_IN_DESC.exec(descricao)
    const sub = m ? CAR_EXPENSE[m[1]] : null
    const inst = /^installment (\d+\/\d+)$/.exec(st)
    return {
      tipo: sub ? `Gasto do carro – ${sub}` : 'Gasto do carro',
      descricao: m && sub ? descricao.replace(CAR_KIND_IN_DESC, ` — ${sub}`) : descricao,
      situacao: inst ? `parcela ${inst[1]}` : (STATUS[st] ?? st),
    }
  }
  return { tipo: KIND[r.kind ?? ''] ?? r.kind ?? '', descricao, situacao: STATUS[st] ?? st }
}

/** Planilha detalhada do mês para o contador (rótulos em português, CPF com máscara). */
export function detailCsv(rows: MonthlyDetailRow[]): string {
  return toCSV(
    rows.map((r) => {
      const ks = kindStatus(r)
      return {
        data: br(r.occurred_on),
        motorista: r.driver_name ?? '',
        cpf: r.cpf ? formatCpf(r.cpf) : '',
        codigo: r.login_code ?? '',
        tipo: ks.tipo,
        descricao: ks.descricao,
        valor_bruto: r.gross ?? 0,
        valor_motorista: r.driver_amount === null || r.driver_amount === undefined ? '' : r.driver_amount,
        quinzena: r.period_label ?? '',
        situacao: ks.situacao,
      }
    }),
    DETAIL_HEADERS,
  )
}
