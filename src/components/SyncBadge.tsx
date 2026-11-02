import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { discardOp, listOps, onQueueChange, retryOp } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'
import { formatBRL } from '../lib/money'

const PLATFORM: Record<string, string> = { uber: 'Uber', blablacar: 'BlaBlaCar', transfer: 'Transfer' }

/** 'YYYY-MM-DD' -> 'dd/mm'; sem data usa o dia em que a op foi criada. */
function day(value: unknown, createdAt: number): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}`
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(
    new Date(createdAt / 1000),
  )
}

const money = (v: unknown) => formatBRL(Number(v) || 0)

/** Descrição curta da op para o motorista (ex.: "Abastecimento R$ 200,00 de 30/10"). */
export function opLabel(op: QueuedOp): string {
  const p = op.payload
  const when = (d?: unknown) => day(d, op.createdAt)
  switch (op.kind) {
    case 'insert_ride':
      return `${PLATFORM[String(p.platform)] ?? 'Corrida'} ${money(p.amount)} de ${when(p.ride_date)}`
    case 'insert_fueling':
      return `Abastecimento ${money(p.amount)} de ${when(p.fueled_on)}`
    case 'insert_expense':
      return `${p.kind === 'toll' ? 'Pedágio' : 'Estacionamento'} ${money(p.amount)} de ${when()}`
    case 'start_shift':
      return `Início de turno (odômetro ${p.odometer}) de ${when()}`
    case 'end_shift':
      return `Encerramento de turno (odômetro ${p.odometer}) de ${when()}`
    case 'complete_transfer':
      return `Conclusão de transfer (${p.km} km) de ${when()}`
    default:
      return `Lançamento de ${when()}`
  }
}

export default function SyncBadge() {
  const [ops, setOps] = useState<QueuedOp[]>([])
  const uid = useAuth().session?.user.id

  useEffect(() => {
    let alive = true
    if (!uid) {
      setOps([])
      return
    }
    const load = () => void listOps(uid).then((o) => alive && setOps(o))
    load()
    const off = onQueueChange(load)
    return () => {
      alive = false
      off()
    }
  }, [uid])

  const pending = ops.filter((o) => o.status === 'pending').length
  const failed = ops.filter((o) => o.status === 'failed')
  if (pending === 0 && failed.length === 0) return null

  return (
    <div className="sync-badge" role="status">
      {pending > 0 && <span>{pending} pendente(s) de envio</span>}
      {failed.length > 0 && <span>{failed.length} com erro</span>}
      {failed.length > 0 && (
        <ul>
          {failed.map((o) => (
            <li key={o.id}>
              {o.error}{' '}
              <button type="button" onClick={() => void retryOp(o.id)}>
                Tentar de novo
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Descartar ${opLabel(o)}? Ele não será enviado.`)) void discardOp(o.id)
                }}
              >
                Descartar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
