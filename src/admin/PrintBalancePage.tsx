import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import BalanceView, { monthLabel } from './BalanceView'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'

/** Balanço do mês para impressão/PDF. */
export default function PrintBalancePage() {
  const { month } = useParams()
  const [b, setB] = useState<api.MonthlyBalance | null>(null)
  const [failed, setFailed] = useState(false)
  const printed = useRef(false)

  useEffect(() => {
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      setFailed(true)
      return
    }
    let alive = true
    setFailed(false)
    api
      .monthlyBalance(`${month}-01`)
      .then((r) => alive && setB(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [month])

  useEffect(() => {
    if (b && !printed.current) {
      printed.current = true
      window.print()
    }
  }, [b])

  if (failed) {
    return (
      <section>
        <p className="error">{MSG_LOAD}</p>
        <Link to="/admin/balanco">Voltar</Link>
      </section>
    )
  }
  if (!b || !month) return <p className="loading">Carregando…</p>
  return (
    <section>
      <h2>{`Balanço — ${monthLabel(month)}`}</h2>
      <p className="no-print">
        <Link to="/admin/balanco">Voltar</Link>
      </p>
      <BalanceView b={b} />
    </section>
  )
}
