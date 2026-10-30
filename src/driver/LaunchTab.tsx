import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { enqueue } from '../lib/offline/queue'
import { localDate } from '../lib/periods'
import { parseBRL } from '../lib/money'
import MoneyInput from '../components/MoneyInput'
import PhotoInput from '../components/PhotoInput'
import { useShift } from './useShift'

type Kind = 'uber' | 'blablacar' | 'fueling'

/** Número decimal pt-BR (aceita vírgula) > 0, ou null. */
function parsePositive(text: string): number | null {
  const n = parseBRL(text)
  return n !== null && n > 0 ? n : null
}

export default function LaunchTab() {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const ownCar = profile?.driver_type === 'own_car'
  const { loading, shift } = useShift(uid, !ownCar)
  const [kind, setKind] = useState<Kind>('uber')
  const [formKey, setFormKey] = useState(0)
  const [saved, setSaved] = useState(false)

  if (!uid || !profile) return null
  if (ownCar) {
    return (
      <section>
        <h2>Lançar</h2>
        <p className="panel">Seus lançamentos são feitos na aba Transfers.</p>
      </section>
    )
  }
  if (loading) return <p className="loading">Carregando...</p>

  const noShift = !shift
  // sem turno, só Abastecimento é possível
  const current: Kind = noShift && kind !== 'fueling' ? 'fueling' : kind

  function choose(k: Kind) {
    setKind(k)
    setSaved(false)
    setFormKey((n) => n + 1)
  }

  return (
    <section>
      <h2>Lançar</h2>
      <div className="seg">
        <button
          type="button"
          aria-pressed={current === 'uber'}
          disabled={noShift}
          onClick={() => choose('uber')}
        >
          Uber
        </button>
        <button
          type="button"
          aria-pressed={current === 'blablacar'}
          disabled={noShift}
          onClick={() => choose('blablacar')}
        >
          BlaBlaCar
        </button>
        <button type="button" aria-pressed={current === 'fueling'} onClick={() => choose('fueling')}>
          Abastecimento
        </button>
      </div>
      {noShift && <p className="hint">Inicie um turno para lançar corridas</p>}
      {saved && (
        <p className="ok" role="status">
          Lançamento salvo
        </p>
      )}
      {current === 'fueling' ? (
        <FuelingForm
          key={formKey}
          uid={uid}
          carId={profile.current_car_id}
          onSaved={() => {
            setSaved(true)
            setFormKey((n) => n + 1)
          }}
        />
      ) : (
        <RideForm
          key={formKey}
          uid={uid}
          platform={current}
          onSaved={() => {
            setSaved(true)
            setFormKey((n) => n + 1)
          }}
        />
      )}
    </section>
  )
}

function RideForm({
  uid,
  platform,
  onSaved,
}: {
  uid: string
  platform: 'uber' | 'blablacar'
  onSaved: () => void
}) {
  const [amount, setAmount] = useState<number | null>(null)
  const [km, setKm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    const kmN = parsePositive(km)
    if (kmN === null) return setError('Informe o km')
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_ride',
        ownerId: uid,
        payload: { id, driver_id: uid, platform, ride_date: localDate(), amount, km: kmN },
        photos: [],
      })
      onSaved()
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <MoneyInput label={platform === 'uber' ? 'Valor líquido' : 'Valor recebido'} onChange={setAmount} />
      <label className="field">
        Km
        <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="big" disabled={busy}>
        Salvar
      </button>
    </form>
  )
}

function FuelingForm({
  uid,
  carId,
  onSaved,
}: {
  uid: string
  carId: string | null
  onSaved: () => void
}) {
  const [amount, setAmount] = useState<number | null>(null)
  const [liters, setLiters] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!carId) return <p className="error">Nenhum carro vinculado. Fale com a empresa.</p>

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    const l = parsePositive(liters)
    if (l === null) return setError('Informe os litros')
    if (!photo) return setError('Adicione a foto do comprovante')
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_fueling',
        ownerId: uid,
        payload: { id, driver_id: uid, car_id: carId, fueled_on: localDate(), amount, liters: l },
        photos: [{ field: 'photo_path', photoId: crypto.randomUUID(), blob: photo }],
      })
      onSaved()
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <MoneyInput label="Valor" onChange={setAmount} />
      <label className="field">
        Litros
        <input inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
      </label>
      <PhotoInput label="Comprovante" onChange={setPhoto} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="big" disabled={busy}>
        Salvar
      </button>
    </form>
  )
}
