import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { downloadCSV, toCSV } from '../lib/csv'
import { localDate } from '../lib/periods'
import BalanceView, { monthLabel, summaryRows } from './BalanceView'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_EXPORT = 'Não foi possível exportar. Tente novamente.'
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

const br = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

export default function BalancePage() {
  const [ym, setYm] = useState(() => localDate().slice(0, 7))
  const [b, setB] = useState<api.MonthlyBalance | null>(null)
  const [failed, setFailed] = useState(false)
  const [exportError, setExportError] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    setB(null)
    try {
      setB(await api.monthlyBalance(`${ym}-01`))
    } catch {
      setFailed(true)
    }
  }, [ym])

  useEffect(() => {
    if (ISO_MONTH.test(ym)) void load()
  }, [ym, load])

  async function exportDetail() {
    setExportError(false)
    try {
      const rows = await api.monthlyDetail(`${ym}-01`)
      const csv = toCSV(
        rows.map((r) => ({
          data: br(r.occurred_on),
          motorista: r.driver_name ?? '',
          cpf: r.cpf ?? '',
          codigo: r.login_code ?? '',
          tipo: r.kind,
          descricao: r.description ?? '',
          valor_bruto: r.gross ?? 0,
          valor_motorista: r.driver_amount ?? 0,
          quinzena: r.period_label ?? '',
          situacao: r.status ?? '',
        })),
      )
      downloadCSV(`passos-balanco-detalhado-${ym}.csv`, csv)
    } catch {
      setExportError(true)
    }
  }

  return (
    <section>
      <h2>Balanço mensal</h2>
      <label className="field">
        Mês
        <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
      </label>
      {ISO_MONTH.test(ym) && <h3>{monthLabel(ym)}</h3>}
      {failed && (
        <>
          <p className="error">{MSG_LOAD}</p>
          <button type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </>
      )}
      {!failed && !b && <p className="loading">Carregando…</p>}
      {b && (
        <>
          <div className="seg">
            <button type="button" onClick={() => void exportDetail()}>
              Exportar planilha detalhada
            </button>
            <button type="button" onClick={() => downloadCSV(`passos-balanco-${ym}.csv`, toCSV(summaryRows(b)))}>
              Exportar resumo
            </button>
            <Link to={`/admin/balanco/imprimir/${ym}`}>Imprimir / PDF</Link>
          </div>
          {exportError && (
            <p className="error" role="alert">
              {MSG_EXPORT}
            </p>
          )}
          <BalanceView b={b} />
        </>
      )}
    </section>
  )
}
