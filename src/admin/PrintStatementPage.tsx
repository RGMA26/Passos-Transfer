import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import StatementView, { formatDay } from '../components/StatementView'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'

export default function PrintStatementPage() {
  const { statementId } = useParams()
  const [data, setData] = useState<api.FullStatement | null>(null)
  const [failed, setFailed] = useState(false)
  const printed = useRef(false)

  useEffect(() => {
    if (!statementId) return
    let alive = true
    setFailed(false)
    api
      .getStatement(statementId)
      .then((s) => alive && setData(s))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [statementId])

  useEffect(() => {
    if (data && !printed.current) {
      printed.current = true
      window.print()
    }
  }, [data])

  if (failed) {
    return (
      <section>
        <p className="error">{MSG_LOAD}</p>
        <Link to="/admin/quinzenas" className="no-print">
          Voltar
        </Link>
      </section>
    )
  }
  if (!data) return <p className="loading">Carregando…</p>

  return (
    <section className="print-page">
      <h1>Passos Transfer — Extrato</h1>
      <p>{`${data.driver.name} (${data.driver.login_code})`}</p>
      <p>{`Quinzena: ${formatDay(data.period.start_date)} a ${formatDay(data.period.end_date)}`}</p>
      <StatementView
        lines={data.lines}
        status={data.paid_at ? 'paid' : 'closed'}
        paidAt={data.paid_at}
        method={data.payment_method}
        driverType={data.driver.driver_type}
      />
      <Link to="/admin/quinzenas" className="no-print">
        Voltar
      </Link>
    </section>
  )
}
