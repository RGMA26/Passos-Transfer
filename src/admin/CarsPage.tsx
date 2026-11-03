import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { Car, Profile } from '../lib/types'
import type { CarConsumption, Fuel } from '../lib/api'
import { ALL_FUELS, FUEL_LABEL, carFuels, fuelsLabel, normalizeFuels } from '../lib/fuel'
import { parseDecimal } from './helpers'
import CarExpenses from './CarExpenses'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_CONSUMPTION = 'Informe um consumo maior que zero'
const wantedType = (o: string) => (o === 'company' ? 'company_car' : 'own_car')

function carErrorMessage(err: unknown): string {
  const code = (err as { code?: string }).code
  if (code === 'PLATE_TAKEN') return 'Placa já cadastrada'
  if (code === 'TYPE_MISMATCH') return 'Tipo do motorista não combina com o carro'
  return 'Não foi possível salvar'
}

const fmtNum = (n: number) => String(n).replace('.', ',')

const MSG_NO_CONSUMPTION =
  'Tem certeza que quer cadastrar sem o consumo? Sem ele, a gasolina por km não pode ser calculada.'

type ConsKey = keyof CarConsumption
const CONS_FIELDS: Record<ConsKey, { label: string; unit: string }> = {
  km_per_l_gasolina: { label: 'Consumo gasolina', unit: 'km/l' },
  km_per_l_alcool: { label: 'Consumo álcool', unit: 'km/l' },
  km_per_l_diesel: { label: 'Consumo diesel', unit: 'km/l' },
  km_per_m3_gnv: { label: 'Consumo GNV', unit: 'km/m³' },
  km_per_kwh: { label: 'Consumo elétrico', unit: 'km/kWh' },
}
/** Coluna de consumo de cada combustível (car_consumption no banco). */
const CONS_OF: Record<Fuel, ConsKey> = {
  gasolina: 'km_per_l_gasolina',
  alcool: 'km_per_l_alcool',
  diesel: 'km_per_l_diesel',
  gnv: 'km_per_m3_gnv',
  eletrico: 'km_per_kwh',
}
const consKeys = (fuels: Fuel[]) => normalizeFuels(fuels).map((f) => CONS_OF[f])
const FUELS_HELP = 'Flex = Gasolina + Álcool; Híbrido = Gasolina + Elétrico; carro com kit GNV: marque também GNV'
const MSG_NO_FUEL = 'Marque ao menos um combustível'
type ConsText = Partial<Record<ConsKey, string>>

const consTextOf = (car: Car): ConsText => {
  const out: ConsText = {}
  for (const k of Object.keys(CONS_FIELDS) as ConsKey[]) {
    const v = car[k]
    if (v != null) out[k] = fmtNum(Number(v))
  }
  return out
}

/** Consumos dos combustíveis marcados; null = algum valor inválido (<= 0 ou texto). */
function parseConsumption(fuels: Fuel[], text: ConsText): CarConsumption | null {
  const out: CarConsumption = {}
  for (const k of consKeys(fuels)) {
    const raw = (text[k] ?? '').trim()
    if (raw === '') {
      out[k] = null
      continue
    }
    const n = parseDecimal(raw)
    if (n === null || n <= 0) return null
    out[k] = n
  }
  return out
}

/** Algum combustível marcado ficou sem consumo (pede confirmação). */
const missingConsumption = (c: CarConsumption) => Object.values(c).some((v) => v == null)

function FuelFields({
  fuels,
  onFuels,
  text,
  onText,
}: {
  fuels: Fuel[]
  onFuels: (f: Fuel[]) => void
  text: ConsText
  onText: (t: ConsText) => void
}) {
  const toggle = (f: Fuel, on: boolean) =>
    onFuels(normalizeFuels(on ? [...fuels, f] : fuels.filter((x) => x !== f)))
  return (
    <>
      <fieldset className="field">
        <legend>Combustíveis</legend>
        {ALL_FUELS.map((f) => (
          <label key={f} className="check">
            <input type="checkbox" checked={fuels.includes(f)} onChange={(e) => toggle(f, e.target.checked)} />
            {FUEL_LABEL[f]}
          </label>
        ))}
        <p className="hint">{FUELS_HELP}</p>
      </fieldset>
      {consKeys(fuels).map((k) => (
        <label className="field" key={k}>
          {`${CONS_FIELDS[k].label} (${CONS_FIELDS[k].unit})`}
          <input
            inputMode="decimal"
            value={text[k] ?? ''}
            onChange={(e) => onText({ ...text, [k]: e.target.value })}
          />
        </label>
      ))}
    </>
  )
}

const consSummary = (c: Car) => {
  const parts = consKeys(carFuels(c))
    .filter((k) => c[k] != null)
    .map((k) => `${fmtNum(Number(c[k]))} ${CONS_FIELDS[k].unit}`)
  return parts.length ? parts.join(' / ') : '—'
}

export default function CarsPage() {
  const [cars, setCars] = useState<Car[] | null>(null)
  const [drivers, setDrivers] = useState<Profile[]>([])
  const [failed, setFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [assignId, setAssignId] = useState<string | null>(null)
  const [expensesId, setExpensesId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [c, d] = await Promise.all([api.listCars(), api.listDrivers()])
      setCars(c)
      setDrivers(d)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (failed) {
    return (
      <section>
        <h2>Carros</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!cars) return <p className="loading">Carregando…</p>

  const driverById = new Map(drivers.map((d) => [d.id, d]))
  const carById = new Map(cars.map((c) => [c.id, c]))

  return (
    <section>
      <h2>Carros</h2>
      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}>
          Novo carro
        </button>
      )}
      {showForm && (
        <NewCarForm
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false)
            void load()
          }}
        />
      )}
      {expensesId && carById.get(expensesId) && (
        <CarExpenses car={carById.get(expensesId)!} onClose={() => setExpensesId(null)} />
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Placa</th>
              <th>Combustível</th>
              <th>Consumo</th>
              <th>Propriedade</th>
              <th>Motorista</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {cars.map((c) => (
              <tr key={c.id}>
                <td>{c.model}</td>
                <td>{c.plate}</td>
                <td>{fuelsLabel(carFuels(c))}</td>
                <td>{consSummary(c)}</td>
                <td>{c.ownership === 'company' ? 'Empresa' : 'Próprio'}</td>
                <td>{(c.current_driver_id && driverById.get(c.current_driver_id)?.name) || '—'}</td>
                <td className="actions">
                  {editId === c.id ? (
                    <EditCar
                      car={c}
                      onDone={(changed) => {
                        setEditId(null)
                        if (changed) void load()
                      }}
                    />
                  ) : assignId === c.id ? (
                    <AssignCar
                      car={c}
                      drivers={drivers.filter((d) => d.active && d.driver_type === wantedType(c.ownership))}
                      onDone={(changed) => {
                        setAssignId(null)
                        if (changed) void load()
                      }}
                    />
                  ) : (
                    <>
                      <button type="button" onClick={() => setEditId(c.id)}>
                        Editar
                      </button>
                      <button type="button" onClick={() => setAssignId(c.id)}>
                        Vincular motorista
                      </button>
                      {c.ownership === 'company' && (
                        <button type="button" onClick={() => setExpensesId(c.id)}>
                          Gastos
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cars.length === 0 && <p className="hint">Nenhum carro cadastrado.</p>}
    </section>
  )
}

function NewCarForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [model, setModel] = useState('')
  const [plate, setPlate] = useState('')
  const [fuels, setFuels] = useState<Fuel[]>(['gasolina', 'alcool'])
  const [cons, setCons] = useState<ConsText>({})
  const [ownership, setOwnership] = useState<'company' | 'own'>('company')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!model.trim()) return setError('Informe o modelo')
    if (!plate.trim()) return setError('Informe a placa')
    if (fuels.length === 0) return setError(MSG_NO_FUEL)
    const parsed = parseConsumption(fuels, cons)
    if (!parsed) return setError(MSG_CONSUMPTION)
    setError('')
    if (missingConsumption(parsed) && !window.confirm(MSG_NO_CONSUMPTION)) return
    setBusy(true)
    try {
      await api.createCar({
        model: model.trim(),
        plate: plate.trim().toUpperCase(),
        fuels,
        ...parsed,
        ownership,
      })
      onCreated()
    } catch (err) {
      setError(carErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>Novo carro</strong>
      <label className="field">
        Modelo
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="field">
        Placa
        <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
      </label>
      <FuelFields fuels={fuels} onFuels={setFuels} text={cons} onText={setCons} />
      <label className="field">
        Propriedade
        <select value={ownership} onChange={(e) => setOwnership(e.target.value as 'company' | 'own')}>
          <option value="company">Empresa</option>
          <option value="own">Próprio</option>
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Criar carro
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  )
}

function EditCar({ car, onDone }: { car: Car; onDone: (changed: boolean) => void }) {
  const [model, setModel] = useState(car.model)
  const [fuels, setFuels] = useState<Fuel[]>(() => carFuels(car))
  const [cons, setCons] = useState<ConsText>(consTextOf(car))
  const [error, setError] = useState('')

  async function save() {
    if (!model.trim()) return setError('Informe o modelo')
    if (fuels.length === 0) return setError(MSG_NO_FUEL)
    const parsed = parseConsumption(fuels, cons)
    if (!parsed) return setError(MSG_CONSUMPTION)
    setError('')
    if (missingConsumption(parsed) && !window.confirm(MSG_NO_CONSUMPTION)) return
    try {
      await api.updateCar(car.id, { model: model.trim(), fuels, ...parsed })
      onDone(true)
    } catch (err) {
      setError(carErrorMessage(err))
    }
  }

  return (
    <div className="inline-edit">
      <label className="field">
        Novo modelo
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <FuelFields fuels={fuels} onFuels={setFuels} text={cons} onText={setCons} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" onClick={() => void save()}>
        Salvar
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </div>
  )
}

function AssignCar({
  car,
  drivers,
  onDone,
}: {
  car: Car
  drivers: Profile[]
  onDone: (changed: boolean) => void
}) {
  const [driverId, setDriverId] = useState(car.current_driver_id ?? '')
  const [error, setError] = useState('')

  async function save() {
    setError('')
    try {
      await api.assignCar(car.id, driverId || null)
      onDone(true)
    } catch (err) {
      setError(carErrorMessage(err))
    }
  }

  return (
    <div className="inline-edit">
      <label className="field">
        Motorista
        <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Nenhum</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" onClick={() => void save()}>
        Confirmar vínculo
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </div>
  )
}
