import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { formatBRL } from '../lib/money'
import { localDate } from '../lib/periods'
import { comparisonText, monthLabel } from './BalanceView'
import { pendencyPath } from './pendencies'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const DOTS: { cat: api.PendencyCategory; icon: string; label: string }[] = [
  { cat: 'white', icon: '⚪', label: 'aguardando conferência' },
  { cat: 'yellow', icon: '🟡', label: 'quinzena terminando' },
  { cat: 'red', icon: '🔴', label: 'quinzena atrasada' },
  { cat: 'orange', icon: '🟠', label: 'valores conflitantes' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<{ pend: api.Pendency[]; bal: api.MonthlyBalance } | null>(null)
  const [failed, setFailed] = useState(false)
  const ym = localDate().slice(0, 7)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [pend, bal] = await Promise.all([api.listPendencies(), api.monthlyBalance(`${ym}-01`)])
      setData({ pend, bal })
    } catch {
      setFailed(true)
    }
  }, [ym])

  useEffect(() => {
    void load()
  }, [load])

  if (failed) {
    return (
      <section>
        <h2>Início</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!data) return <p className="loading">Carregando…</p>

  const { pend, bal } = data
  const r = bal.result
  const open = (cat: api.PendencyCategory) => {
    const list = pend.filter((p) => p.category === cat)
    if (list.length === 1) navigate(pendencyPath(list[0]))
    else if (list.length > 1) navigate(`/admin/pendencias?tipo=${cat}`)
  }

  return (
    <section>
      <h2>Início</h2>
      <div className="seg" aria-label="Pendências">
        {DOTS.map((d) => {
          const n = pend.filter((p) => p.category === d.cat).length
          return (
            <button
              key={d.cat}
              type="button"
              disabled={n === 0}
              title={d.label}
              style={n === 0 ? { opacity: 0.4 } : undefined}
              onClick={() => open(d.cat)}
            >
              {`${d.icon} ${n}`}
            </button>
          )
        })}
      </div>
      <h3>{monthLabel(ym)}</h3>
      <div className="cards">
        <div className="panel">
          <strong>Faturamento</strong>
          <span className="big-number">{formatBRL(r.revenue.total)}</span>
          <span>{`Uber: ${formatBRL(r.revenue.uber)}`}</span>
          <span>{`Transfer: ${formatBRL(r.revenue.transfer)}`}</span>
          <span>{`BlaBlaCar: ${formatBRL(r.revenue.blablacar)}`}</span>
        </div>
        <div className="panel">
          <strong>Devido aos motoristas</strong>
          <span className="big-number">{formatBRL(r.owed.total)}</span>
        </div>
        <div className="panel">
          <strong>Gastos dos carros</strong>
          <span className="big-number">{formatBRL(r.car_expenses.total)}</span>
        </div>
        <div className="panel">
          <strong>Resultado da empresa</strong>
          <span className="big-number">{formatBRL(r.company_result)}</span>
          <span>{comparisonText(r.diff, r.diff_pct)}</span>
          {bal.estimated && <span className="badge badge-gray">estimado</span>}
        </div>
      </div>
      <div className="panel">
        <strong>Km por fora — por motorista</strong>
        {bal.off_km_ranking.by_driver.length === 0 ? (
          <p className="hint">Sem dados neste mês.</p>
        ) : (
          <ol>
            {bal.off_km_ranking.by_driver.map((d) => (
              <li key={d.driver_id}>{`${d.name} — ${d.km_off} km`}</li>
            ))}
          </ol>
        )}
      </div>
      <div className="panel">
        <strong>Km por fora — por carro</strong>
        {bal.off_km_ranking.by_car.length === 0 ? (
          <p className="hint">Sem dados neste mês.</p>
        ) : (
          <ol>
            {bal.off_km_ranking.by_car.map((c) => (
              <li key={c.car_id}>{`${c.plate} ${c.model} — ${c.km_off} km`}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
