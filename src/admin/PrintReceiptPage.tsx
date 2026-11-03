import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../lib/api'
import StatementView, { formatDay } from '../components/StatementView'
import { formatCpf } from '../lib/cpf'
import { formatBRL } from '../lib/money'
import { valorPorExtenso } from '../lib/extenso'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'

/** Recibo de pagamento de um repasse (página de impressão/PDF). */
export default function PrintReceiptPage() {
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
    if (data && data.paid_at && !printed.current) {
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
  if (!data.paid_at) {
    return (
      <section>
        <p className="error">O pagamento ainda não foi registrado</p>
        <Link to="/admin/quinzenas" className="no-print">
          Voltar
        </Link>
      </section>
    )
  }

  return (
    <section className="print-page receipt">
      <h1>Passos Transfer — Recibo de pagamento</h1>
      <p>
        <strong>{data.driver.name}</strong>
      </p>
      <p>{`CPF: ${data.driver.cpf ? formatCpf(data.driver.cpf) : '—'}`}</p>
      <p>{`Código: ${data.driver.login_code}`}</p>
      <p>{`Período: ${formatDay(data.period.start_date)} a ${formatDay(data.period.end_date)}`}</p>
      <StatementView
        lines={data.lines}
        status="paid"
        paidAt={data.paid_at}
        method={data.payment_method}
        driverType={data.driver.driver_type}
      />
      {data.total > 0 ? (
        <p>
          {'Recebi de Passos Transfer a importância de '}
          <strong className="receipt-amount">{formatBRL(data.total)}</strong>
          {` (${valorPorExtenso(data.total)}).`}
        </p>
      ) : (
        <p>{`Sem valor a receber nesta quinzena (saldo ${formatBRL(data.total)}).`}</p>
      )}
      <p>{`Data do pagamento: ${formatDay(data.paid_at)}`}</p>
      <p>{`Forma de pagamento: ${data.payment_method ?? '—'}`}</p>
      <div style={{ marginTop: '3rem', borderTop: '1px solid #000', width: '20rem', paddingTop: '0.25rem' }}>
        Assinatura do motorista
      </div>
      <Link to="/admin/quinzenas" className="no-print">
        Voltar
      </Link>
    </section>
  )
}
