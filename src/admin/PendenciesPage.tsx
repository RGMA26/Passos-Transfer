import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import { formatDay } from '../components/StatementView'
import { pendencyPath } from './pendencies'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
export const CATEGORY_LABEL: Record<api.PendencyCategory, string> = {
  white: '⚪ Aguardando conferência',
  yellow: '🟡 Quinzena terminando',
  red: '🔴 Quinzena atrasada',
  orange: '🟠 Valores conflitantes',
}

export default function PendenciesPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const tipo = params.get('tipo') as api.PendencyCategory | null
  const [items, setItems] = useState<api.Pendency[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    api
      .listPendencies()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [tries])

  if (failed) {
    return (
      <section>
        <h2>Pendências</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => setTries((n) => n + 1)}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!items) return <p className="loading">Carregando…</p>

  const list = tipo ? items.filter((i) => i.category === tipo) : items
  return (
    <section>
      <h2>{tipo && CATEGORY_LABEL[tipo] ? `Pendências — ${CATEGORY_LABEL[tipo]}` : 'Pendências'}</h2>
      {list.length === 0 && <p className="hint">Nenhuma pendência.</p>}
      <div className="panel">
        {list.map((i) => (
          <button
            key={`${i.item_type}-${i.item_id}`}
            type="button"
            className="link"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', gap: '0.125rem' }}
            onClick={() => navigate(pendencyPath(i))}
          >
            <strong>{i.driver_name}</strong>
            <span>{i.label}</span>
            <span>{formatDay(i.occurred_on)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
