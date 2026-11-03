import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { downloadCSV, toCSV } from '../lib/csv'
import { detailCsv } from './detailCsv'
import { localDate } from '../lib/periods'
import BalanceView, { monthLabel, summaryRows } from './BalanceView'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_EXPORT = 'Não foi possível exportar. Tente novamente.'
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export default function BalancePage() {
  const [ym, setYm] = useState(() => localDate().slice(0, 7))
  const [b, setB] = useState<api.MonthlyBalance | null>(null)
  const [failed, setFailed] = useState(false)
  const [exportError, setExportError] = useState(false)
  // só a resposta do último pedido vale (trocar de mês rápido não deixa um mês antigo na tela)
  const req = useRef(0)
  const valid = ISO_MONTH.test(ym)

  const load = useCallback(async () => {
    const id = ++req.current
    setFailed(false)
    setB(null)
    try {
      const r = await api.monthlyBalance(`${ym}-01`)
      if (id === req.current) setB(r)
    } catch {
      if (id === req.current) setFailed(true)
    }
  }, [ym])

  useEffect(() => {
    if (ISO_MONTH.test(ym)) void load()
    else req.current++ // mês apagado: descarta respostas pendentes
  }, [ym, load])

  async function exportDetail() {
    setExportError(false)
    try {
      if (!ISO_MONTH.test(ym)) return
      const rows = await api.monthlyDetail(`${ym}-01`)
      downloadCSV(`passos-balanco-detalhado-${ym}.csv`, detailCsv(rows))
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
      {valid ? <h3>{monthLabel(ym)}</h3> : <p className="hint">Escolha um mês.</p>}
      {failed && (
        <>
          <p className="error">{MSG_LOAD}</p>
          <button type="button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </>
      )}
      {valid && !failed && !b && <p className="loading">Carregando…</p>}
      {valid && b && (
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
