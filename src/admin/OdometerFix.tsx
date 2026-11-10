import { useState } from 'react'
import * as api from '../lib/api'
import OdometerField from '../components/OdometerField'
import { MSG_ODO_INVALID, checkReading, odometerTextError, parseOdometerText } from '../lib/odometer'

const MSG_ODO = 'O odômetro final não pode ser menor que o inicial'
const ERRORS: Record<string, string> = {
  PERIOD_CLOSED: 'Quinzena fechada: não é possível alterar',
  NOT_CHANGEABLE: 'Conferido: desfaça a conferência antes de corrigir',
  ODOMETER_BELOW_START: MSG_ODO,
  INVALID_ODOMETER: MSG_ODO_INVALID,
}

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
    const bad = odometerTextError(s) ?? (withEnd ? odometerTextError(e) : null)
    if (bad) return setError(bad)
    const a = parseOdometerText(s)
    const b = withEnd ? parseOdometerText(e) : null
    if (a === null || (withEnd && b === null)) return setError('Informe as leituras (só números)')
    if (b !== null && b < a) return setError(MSG_ODO)
    // Transfer com mais de 1.000 km: confirma antes de gravar
    const msg = b !== null ? checkReading(b, a) : null
    if (msg && !window.confirm(msg)) return
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
      <OdometerField label="Odômetro inicial" value={s} onChange={setS} />
      {withEnd && <OdometerField label="Odômetro final" value={e} onChange={setE} />}
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
