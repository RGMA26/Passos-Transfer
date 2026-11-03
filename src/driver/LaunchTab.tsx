import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../lib/api'
import type { Fuel } from '../lib/api'
import { useAuth } from '../lib/auth'
import { enqueue } from '../lib/offline/queue'
import { localDate } from '../lib/periods'
import { parseBRL, parseDecimal } from '../lib/money'
import { FUEL_LABEL, conflictText, fuelOptions, fuelUnit, round3, valuesConflict } from '../lib/fuel'
import { clearSharedFile, peekSharedFile } from '../lib/share'
import type { Car, Ride } from '../lib/types'
import MoneyInput from '../components/MoneyInput'
import ReceiptInput from '../components/ReceiptInput'
import PausedNotice from './PausedNotice'
import { useShift } from './useShift'

export type LaunchKind = 'uber' | 'blablacar' | 'fueling' | 'toll' | 'parking'
const KINDS: LaunchKind[] = ['uber', 'blablacar', 'fueling', 'toll', 'parking']
export const LAUNCH_LABEL: Record<LaunchKind, string> = {
  uber: 'Uber',
  blablacar: 'BlaBlaCar',
  fueling: 'Abastecimento',
  toll: 'Pedágio',
  parking: 'Estacionamento',
}
const MSG_SAVE = 'Não foi possível salvar. Tente de novo.'
const MSG_RECEIPT = 'Adicione o comprovante'
const MSG_NO_TRANSFER = 'Pedágio e estacionamento são lançados em um Transfer'
const OPEN_TRANSFER = ['assigned', 'in_progress', 'completed']

const isRide = (k: LaunchKind) => k === 'uber' || k === 'blablacar'

/** Número decimal pt-BR (aceita vírgula) > 0, ou null. */
function parsePositive(text: string): number | null {
  const n = parseBRL(text)
  return n !== null && n > 0 ? n : null
}

/** Decimal > 0 arredondado a 3 casas (como o banco grava quantidade e preço), ou null. */
function positiveDecimal(text: string): number | null {
  const n = parseDecimal(text)
  if (n === null) return null
  const r = round3(n)
  return r > 0 ? r : null
}

// Último carro visto, por id: o formulário de abastecimento funciona sem rede.
const carKey = (id: string) => `passos.car.${id}`

function useCar(carId: string | null): Car | null {
  const [car, setCar] = useState<Car | null>(() => {
    if (!carId) return null
    try {
      const raw = localStorage.getItem(carKey(carId))
      return raw ? (JSON.parse(raw) as Car) : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (!carId) return
    let alive = true
    api
      .getCar(carId)
      .then((c) => {
        if (!alive || !c) return
        setCar(c)
        try {
          localStorage.setItem(carKey(carId), JSON.stringify(c))
        } catch {
          /* armazenamento indisponível */
        }
      })
      .catch(() => {}) // offline: mantém o último salvo
    return () => {
      alive = false
    }
  }, [carId])
  return car
}

export default function LaunchTab() {
  const { session, profile } = useAuth()
  const uid = session?.user.id
  const ownCar = profile?.driver_type === 'own_car'
  const paused = !!profile?.paused
  const { loading, shift } = useShift(uid, !ownCar)
  const [params] = useSearchParams()
  const shared = params.get('compartilhado') === '1'
  const requested = KINDS.find((k) => k === params.get('tipo')) ?? null
  const [kind, setKind] = useState<LaunchKind | null>(requested)
  const [formKey, setFormKey] = useState(0)
  const [saved, setSaved] = useState(false)
  const [sharedFile, setSharedFile] = useState<File | null>(null)

  useEffect(() => {
    if (!shared) return
    let alive = true
    void peekSharedFile().then((f) => alive && setSharedFile(f))
    return () => {
      alive = false
    }
  }, [shared])

  if (!uid || !profile) return null
  if (!ownCar && loading) return <p className="loading">Carregando...</p>

  const noShift = !ownCar && !shift
  const available: LaunchKind[] = ownCar ? ['fueling', 'toll', 'parking'] : KINDS
  // sem turno, corrida só se pedida explicitamente (compartilhar); o padrão vira Abastecimento
  let current: LaunchKind = kind && available.includes(kind) ? kind : ownCar ? 'fueling' : 'uber'
  if (!kind && noShift && isRide(current)) current = 'fueling'

  function choose(k: LaunchKind) {
    setKind(k)
    setSaved(false)
    setFormKey((n) => n + 1)
  }

  async function onSaved() {
    setSaved(true)
    setFormKey((n) => n + 1)
    if (sharedFile) {
      setSharedFile(null)
      await clearSharedFile()
    }
  }

  const common = { uid, initialFile: sharedFile, onSaved: () => void onSaved() }
  let form = null
  if (paused) form = null
  else if (isRide(current)) {
    form = noShift ? null : <RideForm key={formKey} {...common} platform={current as 'uber' | 'blablacar'} />
  } else if (current === 'fueling') {
    form = <FuelingForm key={formKey} {...common} carId={profile.current_car_id} ownCar={ownCar} />
  } else {
    form = <ExpenseForm key={formKey} {...common} kind={current as 'toll' | 'parking'} />
  }

  return (
    <section>
      <h2>Lançar</h2>
      {paused && <PausedNotice />}
      <div className="seg">
        {available.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={current === k}
            disabled={paused || (isRide(k) && noShift)}
            onClick={() => choose(k)}
          >
            {LAUNCH_LABEL[k]}
          </button>
        ))}
      </div>
      {!paused && noShift && <p className="hint">Inicie um turno para lançar corridas</p>}
      {saved && (
        <p className="ok" role="status">
          Lançamento salvo
        </p>
      )}
      {form}
    </section>
  )
}

interface FormProps {
  uid: string
  initialFile: File | null
  onSaved: () => void
}

function RideForm({ uid, platform, initialFile, onSaved }: FormProps & { platform: 'uber' | 'blablacar' }) {
  const [amount, setAmount] = useState<number | null>(null)
  const [km, setKm] = useState('')
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    const kmN = parsePositive(km)
    if (kmN === null) return setError('Informe o km')
    if (!receipt) return setError(MSG_RECEIPT)
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_ride',
        ownerId: uid,
        payload: { id, driver_id: uid, platform, ride_date: localDate(), amount, km: kmN },
        photos: [{ field: 'receipt_path', photoId: crypto.randomUUID(), blob: receipt }],
      })
      onSaved()
    } catch {
      setError(MSG_SAVE)
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
      <ReceiptInput label="Comprovante" onChange={setReceipt} initialFile={initialFile} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="big" disabled={busy}>
        Salvar
      </button>
    </form>
  )
}

function FuelingForm({
  uid,
  carId,
  ownCar,
  initialFile,
  onSaved,
}: FormProps & { carId: string | null; ownCar: boolean }) {
  const car = useCar(carId)
  const options = useMemo(() => fuelOptions(car?.fuel_type), [car?.fuel_type])
  const [picked, setPicked] = useState<Fuel | null>(null)
  const fuel: Fuel = picked && options.includes(picked) ? picked : options[0]
  const unit = fuelUnit(fuel)
  const [amount, setAmount] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!carId) return <p className="error">Nenhum carro vinculado. Fale com a empresa.</p>

  async function save(force: boolean) {
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    const q = positiveDecimal(qty)
    if (q === null) return setError('Informe a quantidade')
    const p = positiveDecimal(price)
    if (p === null) return setError(`Informe o preço por ${unit}`)
    if (!receipt) return setError(MSG_RECEIPT)
    setError('')
    if (!force && valuesConflict(q, p, amount)) {
      setConflict(conflictText(q, p, amount, fuel))
      return
    }
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_fueling',
        ownerId: uid,
        payload: {
          id,
          driver_id: uid,
          car_id: carId,
          fueled_on: localDate(),
          fuel,
          amount,
          quantity: q,
          unit_price: p,
        },
        photos: [{ field: 'photo_path', photoId: crypto.randomUUID(), blob: receipt }],
      })
      onSaved()
    } catch {
      setError(MSG_SAVE)
      setBusy(false)
    }
  }

  // qualquer mudança nos números desfaz o aviso de conflito
  const edited = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setConflict(null)
  }

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault()
        void save(false)
      }}
      noValidate
    >
      {ownCar && <p className="hint">Usado para calcular a gasolina dos seus Transfers — não é reembolsado</p>}
      <label className="field">
        Combustível
        <select value={fuel} onChange={(e) => edited(setPicked)(e.target.value as Fuel)}>
          {options.map((f) => (
            <option key={f} value={f}>
              {FUEL_LABEL[f]}
            </option>
          ))}
        </select>
      </label>
      <MoneyInput label="Valor total" onChange={edited(setAmount)} />
      <label className="field">
        {`Quantidade (${unit})`}
        <input inputMode="decimal" value={qty} onChange={(e) => edited(setQty)(e.target.value)} />
      </label>
      <label className="field">
        {`Preço por ${unit}`}
        <input inputMode="decimal" value={price} onChange={(e) => edited(setPrice)(e.target.value)} />
      </label>
      <ReceiptInput label="Comprovante" onChange={setReceipt} initialFile={initialFile} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {conflict ? (
        <div className="warn" role="alert">
          <strong>Valores conflitantes, confira a nota</strong>
          <p>{conflict}</p>
          <button type="button" className="big" disabled={busy} onClick={() => void save(true)}>
            Salvar mesmo assim
          </button>
        </div>
      ) : (
        <button type="submit" className="big" disabled={busy}>
          Salvar
        </button>
      )}
    </form>
  )
}

const whenFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function ExpenseForm({ uid, kind, initialFile, onSaved }: FormProps & { kind: 'toll' | 'parking' }) {
  const [transfers, setTransfers] = useState<Ride[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [rideId, setRideId] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .listMyTransfers(uid)
      .then((list) => {
        if (!alive) return
        const open = list.filter((r) => OPEN_TRANSFER.includes(r.transfer_status ?? ''))
        setTransfers(open)
        if (open.length === 1) setRideId(open[0].id)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [uid])

  if (failed) return <p className="error">Não foi possível carregar seus Transfers. Tente novamente.</p>
  if (!transfers) return <p className="loading">Carregando…</p>
  if (transfers.length === 0) return <p className="panel hint">{MSG_NO_TRANSFER}</p>

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!rideId) return setError('Escolha o Transfer')
    if (amount === null || amount <= 0) return setError('Informe um valor válido')
    if (!receipt) return setError(MSG_RECEIPT)
    setError('')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await enqueue({
        id,
        kind: 'insert_expense',
        ownerId: uid,
        payload: { id, ride_id: rideId, kind, amount },
        photos: [{ field: 'photo_path', photoId: crypto.randomUUID(), blob: receipt }],
      })
      onSaved()
    } catch {
      setError(MSG_SAVE)
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <label className="field">
        Transfer
        <select value={rideId} onChange={(e) => setRideId(e.target.value)}>
          <option value="">Escolha…</option>
          {transfers.map((r) => (
            <option key={r.id} value={r.id}>
              {`${r.client_name ?? 'Transfer'}${r.scheduled_at ? ` – ${whenFmt.format(new Date(r.scheduled_at))}` : ''}`}
            </option>
          ))}
        </select>
      </label>
      <MoneyInput label="Valor" onChange={setAmount} />
      <ReceiptInput label="Comprovante" onChange={setReceipt} initialFile={initialFile} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="big" disabled={busy}>
        Salvar
      </button>
    </form>
  )
}
