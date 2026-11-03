import { useState } from 'react'
import * as api from '../lib/api'

const MSG_ODO = 'O odômetro final não pode ser menor que o inicial'
const ERRORS: Record<string, string> = {
  PERIOD_CLOSED: 'Quinzena fechada: não é possível alterar',
  NOT_CHANGEABLE: 'Conferido: desfaça a conferência antes de corrigir',
  ODOMETER_BELOW_START: MSG_ODO,
}

const parseInt0 = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : null)

/**
 * "Corrigir odômetro" de um Transfer (admin): em andamento só a leitura inicial; concluído as duas.
 * O servidor (admin_fix_transfer_odometer) recalcula o km e recusa Transfer conferido.
 */
export default function OdometerFix({
  id,
  start,
  end,
  withEnd,
  onDone,
}: {
  id: string
  start: number | null
  end: number | null
  withEnd: boolean
  onDone: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [s, setS] = useState(start == null ? '' : String(start))
  const [e, setE] = useState(end == null ? '' : String(end))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}>
        Corrigir odômetro
      </button>
    )
  }

  async function save() {
    const a = parseInt0(s)
    const b = withEnd ? parseInt0(e) : null
    if (a === null || (withEnd && b === null)) return setError('Informe as leituras (só números)')
    if (b !== null && b < a) return setError(MSG_ODO)
    setError('')
    setBusy(true)
    try {
      await api.fixTransferOdometer(id, a, b)
      setEditing(false)
      onDone()
    } catch (err) {
      setError(ERRORS[(err as Error)?.message] ?? 'Não foi possível salvar o odômetro')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-edit">
      <label className="field">
        Odômetro inicial
        <input inputMode="numeric" value={s} onChange={(ev) => setS(ev.target.value)} />
      </label>
      {withEnd && (
        <label className="field">
          Odômetro final
          <input inputMode="numeric" value={e} onChange={(ev) => setE(ev.target.value)} />
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void save()}>
        Salvar odômetro
      </button>
      <button type="button" className="link" onClick={() => { setEditing(false); setError('') }}>
        Cancelar
      </button>
    </div>
  )
}
