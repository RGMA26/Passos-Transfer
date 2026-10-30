import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import type { EndShiftResult, TodaySummary } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatBRL } from '../lib/money'
import { enqueue } from '../lib/offline/queue'
import { localDate } from '../lib/periods'
import type { Car } from '../lib/types'
import PhotoInput from '../components/PhotoInput'
import { useShift } from './useShift'
import type { ShiftState } from './useShift'

const MSG_ODO_LOWER = 'O odômetro final não pode ser menor que o inicial'

/** Inteiro >= 0, ou null. */
function parseOdometer(text: string): number | null {
  const t = text.trim()
  return /^\d+$/.test(t) ? Number(t) : null
}

interface Ended {
  shiftId: string
  start: number
  end: number
}

export default function TodayTab() {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const ownCar = profile?.driver_type === 'own_car'
  const { loading, ops, shift, serverRides, refresh } = useShift(uid, !ownCar)
  const [ended, setEnded] = useState<Ended | null>(null)

  if (!uid || !profile) return null
  if (ownCar) {
    return (
      <section>
        <h2>Hoje</h2>
        <div className="panel">
          <strong>Transfers pendentes</strong>
          <p className="hint">Veja e conclua suas corridas atribuídas.</p>
          <Link to="/m/transfers">Abrir Transfers</Link>
        </div>
      </section>
    )
  }
  if (ended) {
    return (
      <EndedSummary
        ended={ended}
        ops={ops}
        onDone={() => setEnded(null)}
      />
    )
  }
  if (loading) return <p className="loading">Carregando...</p>

  return (
    <section>
      <h2>Hoje</h2>
      {shift ? (
        <OpenShift
          uid={uid}
          shift={shift}
          hasServerUber={serverRides.some((r) => r.platform === 'uber')}
          ops={ops}
          onEnded={async (e) => {
            // relê a fila antes: com o end_shift ainda nela não se chama api.endShift
            await refresh()
            setEnded(e)
          }}
          onQueued={() => void refresh()}
        />
      ) : (
        <StartShift uid={uid} carId={profile.current_car_id} onQueued={refresh} />
      )}
    </section>
  )
}

function StartShift({
  uid,
  carId,
  onQueued,
}: {
  uid: string
  carId: string | null
  onQueued: () => Promise<void>
}) {
  const [car, setCar] = useState<Car | null>(null)
  const [odo, setOdo] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!carId) return
    let alive = true
    api.getCar(carId).then((c) => alive && setCar(c)).catch(() => {})
    return () => {
      alive = false
    }
  }, [carId])

  if (!carId) {
    return <p className="error">Nenhum carro vinculado. Fale com a empresa.</p>
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const odometer = parseOdometer(odo)
    if (odometer === null) return setError('Informe o odômetro')
    if (!photo) return setError('Adicione a foto do odômetro')
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'start_shift',
        ownerId: uid,
        payload: { id, car_id: carId, odometer },
        photos: [{ field: 'photo', photoId: crypto.randomUUID(), blob: photo }],
      })
      // busy fica true: o botão some quando o turno derivado aparece
      await onQueued()
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>Iniciar turno</strong>
      {car && <p>{`${car.model} – ${car.plate}`}</p>}
      <label className="field">
        Odômetro
        <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
      </label>
      <PhotoInput label="Foto do odômetro" onChange={setPhoto} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="big" disabled={busy}>
        Iniciar turno
      </button>
    </form>
  )
}

function OpenShift({
  uid,
  shift,
  hasServerUber,
  ops,
  onEnded,
  onQueued,
}: {
  uid: string
  shift: ShiftState
  hasServerUber: boolean
  ops: ReturnType<typeof useShift>['ops']
  onEnded: (e: Ended) => Promise<void>
  onQueued: () => void
}) {
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [odo, setOdo] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [uberPhoto, setUberPhoto] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const today = localDate()
  useEffect(() => {
    let alive = true
    api.getTodaySummary(uid, today).then((s) => alive && setSummary(s)).catch(() => {})
    return () => {
      alive = false
    }
  }, [uid, today, ops])

  const needsUber = useMemo(
    () =>
      hasServerUber ||
      ops.some(
        (o) =>
          o.kind === 'insert_ride' &&
          o.payload.platform === 'uber' &&
          o.createdAt / 1000 >= shift.startedAtMs,
      ),
    [hasServerUber, ops, shift.startedAtMs],
  )

  // faturamento/abastecido do servidor + lançamentos ainda na fila (hoje)
  const totals = useMemo(() => {
    const t = {
      uber: summary?.byPlatform.uber ?? 0,
      blablacar: summary?.byPlatform.blablacar ?? 0,
      transfer: summary?.byPlatform.transfer ?? 0,
      km: summary?.kmService ?? 0,
      fueled: summary?.fueled ?? 0,
    }
    for (const o of ops) {
      if (o.status !== 'pending') continue
      if (o.kind === 'insert_ride') {
        const p = o.payload.platform
        if (p === 'uber' || p === 'blablacar' || p === 'transfer') {
          t[p] += Number(o.payload.amount) || 0
        }
        t.km += Number(o.payload.km) || 0
      } else if (o.kind === 'insert_fueling') {
        t.fueled += Number(o.payload.amount) || 0
      }
    }
    return t
  }, [summary, ops])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const odometer = parseOdometer(odo)
    if (odometer === null) return setError('Informe o odômetro final')
    if (odometer < shift.odometerStart) return setError(MSG_ODO_LOWER)
    if (!photo) return setError('Adicione a foto do odômetro final')
    if (needsUber && !uberPhoto) return setError('Adicione o print dos ganhos da Uber')
    setError('')
    setBusy(true)
    try {
      const photos = [{ field: 'photo', photoId: crypto.randomUUID(), blob: photo }]
      if (needsUber && uberPhoto) {
        photos.push({ field: 'uber_photo', photoId: crypto.randomUUID(), blob: uberPhoto })
      }
      await enqueue({
        id: crypto.randomUUID(),
        kind: 'end_shift',
        ownerId: uid,
        payload: { shift_id: shift.id, odometer, uber_photo: null },
        photos,
      })
      await onEnded({ shiftId: shift.id, start: shift.odometerStart, end: odometer })
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      onQueued()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="panel">
        <strong>Resumo do dia</strong>
        <span>Uber: {formatBRL(totals.uber)}</span>
        <span>BlaBlaCar: {formatBRL(totals.blablacar)}</span>
        <span>Transfers: {formatBRL(totals.transfer)}</span>
        <span>Km em serviço: {totals.km}</span>
        <span>Abastecido: {formatBRL(totals.fueled)}</span>
      </div>
      <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
        <strong>Encerrar turno</strong>
        <p className="hint">Odômetro inicial: {shift.odometerStart}</p>
        <label className="field">
          Odômetro final
          <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
        <PhotoInput label="Foto do odômetro final" onChange={setPhoto} />
        {needsUber && <PhotoInput label="Print dos ganhos da Uber" onChange={setUberPhoto} />}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="big" disabled={busy}>
          Encerrar turno
        </button>
      </form>
    </>
  )
}

function EndedSummary({
  ended,
  ops,
  onDone,
}: {
  ended: Ended
  ops: ReturnType<typeof useShift>['ops']
  onDone: () => void
}) {
  const queued = ops.some((o) => o.kind === 'end_shift' && o.payload.shift_id === ended.shiftId)
  const [result, setResult] = useState<EndShiftResult | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (queued) return
    let alive = true
    // idempotente: em turno já encerrado devolve o resumo guardado
    void (async () => {
      try {
        const r = await api.endShift({
          shift_id: ended.shiftId,
          odometer: ended.end,
          photo: '',
          uber_photo: null,
        })
        if (alive) setResult(r)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [queued, ended])

  return (
    <section>
      <h2>Turno encerrado</h2>
      <dl className="panel">
        {result ? (
          <>
            <dt>Km total</dt>
            <dd>{result.km_total}</dd>
            <dt>Km em serviço</dt>
            <dd>{result.km_service}</dd>
            <dt>Km por fora</dt>
            <dd>{result.km_off}</dd>
            <dt>Desconto da gasolina</dt>
            <dd>
              {result.off_discount_estimate == null
                ? 'a calcular'
                : formatBRL(result.off_discount_estimate)}
            </dd>
          </>
        ) : (
          <>
            <dt>Km total</dt>
            <dd>{ended.end - ended.start}</dd>
          </>
        )}
      </dl>
      {queued && <p className="hint">Resumo completo quando o turno for enviado</p>}
      {!queued && !result && !failed && <p className="hint">Carregando resumo...</p>}
      {failed && <p className="hint">Resumo completo quando o turno for enviado</p>}
      <button type="button" className="big" onClick={onDone}>
        Ok
      </button>
    </section>
  )
}
