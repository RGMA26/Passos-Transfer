import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import type { StatementRow } from '../lib/api'
import { useAuth } from '../lib/auth'
import { localDate } from '../lib/periods'
import type { StatementLines } from '../lib/types'
import StatementView from '../components/StatementView'
import type { RejectedLine } from '../components/StatementView'
import PausedNotice from './PausedNotice'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'

/** 'YYYY-MM-DD' -> 'dd/mm'. */
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Dias corridos de `from` até `to` ('YYYY-MM-DD'). */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

function daysLeftText(end: string, today: string): string {
  const n = daysBetween(today, end)
  if (n <= 0) return 'último dia'
  return n === 1 ? 'falta 1 dia' : `faltam ${n} dias`
}

interface Current {
  start: string
  end: string
  lines: StatementLines
  rejected: RejectedLine[]
}

export default function StatementTab() {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const [current, setCurrent] = useState<Current | null>(null)
  const [past, setPast] = useState<StatementRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!uid) return
    setFailed(false)
    try {
      const period = await api.getCurrentPeriod(uid, localDate())
      let cur: Current | null = null
      if (period) {
        const [lines, rejected] = await Promise.all([
          api.computeStatement(uid, period.id),
          api.listRejectedItems(uid, period.start_date, period.end_date),
        ])
        cur = { start: period.start_date, end: period.end_date, lines, rejected }
      }
      setCurrent(cur)
      setPast(await api.listMyStatements(uid))
      setLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  if (!uid || !profile) return null
  if (failed) {
    return (
      <section>
        <h2>Extrato</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!loaded) return <p className="loading">Carregando…</p>

  return (
    <section>
      <h2>Extrato</h2>
      {profile.paused && <PausedNotice />}
      <h3>
        {current
          ? `Quinzena ${dm(current.start)} – ${dm(current.end)} · ${daysLeftText(current.end, localDate())}`
          : 'Quinzena atual'}
      </h3>
      {current ? (
        <StatementView
          lines={current.lines}
          status="estimated"
          rejected={current.rejected}
          driverType={profile.driver_type}
        />
      ) : (
        <p className="hint">Nenhuma quinzena aberta.</p>
      )}
      <h3>Quinzenas anteriores</h3>
      {past.length === 0 && <p className="hint">Nenhum extrato fechado ainda.</p>}
      {past.map((s) => (
        <div key={s.id} className="panel">
          <button
            type="button"
            aria-expanded={openId === s.id}
            onClick={() => setOpenId(openId === s.id ? null : s.id)}
          >
            {`${dm(s.start_date)} – ${dm(s.end_date)}`}
          </button>
          {openId === s.id && (
            <StatementView
              lines={s.lines}
              status={s.paid_at ? 'paid' : 'closed'}
              paidAt={s.paid_at}
              method={s.payment_method}
              driverType={profile.driver_type}
            />
          )}
        </div>
      ))}
    </section>
  )
}
