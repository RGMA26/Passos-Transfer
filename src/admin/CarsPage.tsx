import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { Car, Profile } from '../lib/types'
import { parseDecimal } from './helpers'

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

export default function CarsPage() {
  const [cars, setCars] = useState<Car[] | null>(null)
  const [drivers, setDrivers] = useState<Profile[]>([])
  const [failed, setFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [assignId, setAssignId] = useState<string | null>(null)

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
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Placa</th>
              <th>Consumo km/l</th>
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
                <td>{c.consumption_km_l}</td>
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
  const [consumption, setConsumption] = useState('')
  const [ownership, setOwnership] = useState<'company' | 'own'>('company')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!model.trim()) return setError('Informe o modelo')
    if (!plate.trim()) return setError('Informe a placa')
    const n = parseDecimal(consumption)
    if (n === null || n <= 0) return setError(MSG_CONSUMPTION)
    setError('')
    setBusy(true)
    try {
      await api.createCar({
        model: model.trim(),
        plate: plate.trim().toUpperCase(),
        consumption_km_l: n,
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
      <label className="field">
        Consumo km/l
        <input inputMode="decimal" value={consumption} onChange={(e) => setConsumption(e.target.value)} />
      </label>
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
  const [consumption, setConsumption] = useState(fmtNum(car.consumption_km_l))
  const [error, setError] = useState('')

  async function save() {
    if (!model.trim()) return setError('Informe o modelo')
    const n = parseDecimal(consumption)
    if (n === null || n <= 0) return setError(MSG_CONSUMPTION)
    setError('')
    try {
      await api.updateCar(car.id, { model: model.trim(), consumption_km_l: n })
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
      <label className="field">
        Novo consumo km/l
        <input inputMode="decimal" value={consumption} onChange={(e) => setConsumption(e.target.value)} />
      </label>
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
