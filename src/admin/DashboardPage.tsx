import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import { formatBRL } from '../lib/money'
import { localDate } from '../lib/periods'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'

export default function DashboardPage() {
  const [s, setS] = useState<api.PeriodSummary | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const id = await api.getCurrentPeriodId(localDate())
      if (!id) throw new Error('NO_PERIOD')
      setS(await api.periodSummary(id))
    } catch {
      setFailed(true)
    }
  }, [])

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
  if (!s) return <p className="loading">Carregando…</p>

  const total = s.revenue.uber + s.revenue.transfer + s.revenue.blablacar
  return (
    <section>
      <h2>Início</h2>
      <div className="cards">
        <div className="panel">
          <strong>Faturamento</strong>
          <span className="big-number">{formatBRL(total)}</span>
          <span>{`Uber: ${formatBRL(s.revenue.uber)}`}</span>
          <span>{`Transfer: ${formatBRL(s.revenue.transfer)}`}</span>
          <span>{`BlaBlaCar: ${formatBRL(s.revenue.blablacar)}`}</span>
        </div>
        <div className="panel">
          <strong>Parte dos motoristas</strong>
          <span className="big-number">{formatBRL(s.drivers_share)}</span>
        </div>
        <div className="panel">
          <strong>Parte da empresa</strong>
          <span className="big-number">{formatBRL(s.company_share)}</span>
        </div>
        <div className="panel">
          <strong>Gasolina reembolsada</strong>
          <span className="big-number">{formatBRL(s.fuel_reimbursed)}</span>
        </div>
        <div className="panel">
          <strong>Gasolina descontada</strong>
          <span className="big-number">{formatBRL(s.fuel_discounted)}</span>
        </div>
      </div>
      <div className="panel">
        <strong>Km por fora — ranking</strong>
        {s.off_km_ranking.length === 0 ? (
          <p className="hint">Sem dados nesta quinzena.</p>
        ) : (
          <ol>
            {s.off_km_ranking.map((r) => (
              <li key={r.driver_id}>{`${r.name} — ${r.km_off} km`}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
