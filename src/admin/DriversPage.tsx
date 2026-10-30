import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { Car, Profile } from '../lib/types'
import { onlyDigits, parsePct } from './helpers'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_PCT = 'Informe uma porcentagem entre 0 e 100'
const TYPE_LABEL: Record<string, string> = {
  company_car: 'Carro da empresa',
  own_car: 'Carro próprio',
}
const CREATE_ERRORS: Record<string, string> = {
  INVALID_NAME: 'Informe o nome',
  INVALID_PHONE: 'Telefone inválido (DDD + número)',
  INVALID_PCT: 'Porcentagem inválida',
  INVALID_CAR: 'Carro indisponível para este motorista',
}
const MSG_CREATE_FAILED = 'Não foi possível criar o motorista'
const wantedOwnership = (t: string) => (t === 'company_car' ? 'company' : 'own')

interface Access {
  name: string
  phone: string
  code: string
  pin: string
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Profile[] | null>(null)
  const [cars, setCars] = useState<Car[]>([])
  const [failed, setFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [access, setAccess] = useState<Access | null>(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [d, c] = await Promise.all([api.listDrivers(), api.listCars()])
      setDrivers(d)
      setCars(c)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleActive(d: Profile) {
    if (d.active && !window.confirm(`Desativar ${d.name}? Ele não conseguirá mais entrar.`)) return
    setActionError('')
    try {
      await api.driverAccess(d.id, d.active ? 'deactivate' : 'reactivate')
      await load()
    } catch {
      setActionError('Não foi possível concluir a ação')
    }
  }

  async function resetPassword(d: Profile) {
    if (!window.confirm(`Gerar um novo PIN para ${d.name}?`)) return
    setActionError('')
    try {
      const r = await api.driverAccess(d.id, 'reset_password')
      if (r.temp_pin) {
        setAccess({ name: d.name ?? '', phone: d.phone ?? '', code: d.login_code ?? '', pin: r.temp_pin })
      }
    } catch {
      setActionError('Não foi possível gerar o PIN')
    }
  }

  if (failed) {
    return (
      <section>
        <h2>Motoristas</h2>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </section>
    )
  }
  if (!drivers) return <p className="loading">Carregando…</p>

  const carById = new Map(cars.map((c) => [c.id, c]))

  return (
    <section>
      <h2>Motoristas</h2>
      {access && <AccessPanel access={access} onClose={() => setAccess(null)} />}
      {actionError && <p className="error" role="alert">{actionError}</p>}
      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}>
          Novo motorista
        </button>
      )}
      {showForm && (
        <NewDriverForm
          cars={cars}
          onCancel={() => setShowForm(false)}
          onCreated={(a) => {
            setAccess(a)
            setShowForm(false)
            void load()
          }}
        />
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Telefone</th>
              <th>Tipo</th>
              <th>% Uber</th>
              <th>% Transfer</th>
              <th>Carro</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const c = d.current_car_id ? carById.get(d.current_car_id) : undefined
              return (
                <tr key={d.id}>
                  <td>{d.login_code}</td>
                  <td>{d.name}</td>
                  <td>{d.phone}</td>
                  <td>{TYPE_LABEL[d.driver_type ?? ''] ?? '—'}</td>
                  <td>{d.uber_pct ?? '—'}</td>
                  <td>{d.transfer_pct ?? '—'}</td>
                  <td>{c ? `${c.model} ${c.plate}` : '—'}</td>
                  <td>{d.active ? 'Ativo' : 'Inativo'}</td>
                  <td className="actions">
                    {editId === d.id ? (
                      <EditPcts
                        driver={d}
                        onDone={(changed) => {
                          setEditId(null)
                          if (changed) void load()
                        }}
                      />
                    ) : (
                      <>
                        <button type="button" onClick={() => setEditId(d.id)}>
                          Editar %
                        </button>
                        <button type="button" onClick={() => void resetPassword(d)}>
                          Resetar senha
                        </button>
                        <button type="button" onClick={() => void toggleActive(d)}>
                          {d.active ? 'Desativar' : 'Reativar'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {drivers.length === 0 && <p className="hint">Nenhum motorista cadastrado.</p>}
    </section>
  )
}

function whatsappLink(a: Access) {
  const first = a.name.trim().split(/\s+/)[0]
  const msg = `Olá, ${first}! Seu acesso ao app Passos Transfer:\nCódigo: ${a.code}\nPIN: ${a.pin}\nNo primeiro acesso você vai criar sua senha.`
  return `https://wa.me/55${onlyDigits(a.phone)}?text=${encodeURIComponent(msg)}`
}

function AccessPanel({ access, onClose }: { access: Access; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="panel" role="region" aria-label="Acesso do motorista">
      <strong>{access.name}</strong>
      <p>{`Código: ${access.code}`}</p>
      <p>{`PIN: ${access.pin}`}</p>
      <div className="seg">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(`Código: ${access.code}\nPIN: ${access.pin}`)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          Copiar
        </button>
        <a className="btn" href={whatsappLink(access)} target="_blank" rel="noreferrer">
          Enviar por WhatsApp
        </a>
      </div>
      {copied && <p className="ok">Copiado</p>}
      <button type="button" className="link" onClick={onClose}>
        Fechar
      </button>
    </div>
  )
}

function NewDriverForm({
  cars,
  onCancel,
  onCreated,
}: {
  cars: Car[]
  onCancel: () => void
  onCreated: (a: Access) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [type, setType] = useState<'company_car' | 'own_car'>('company_car')
  const [uber, setUber] = useState('')
  const [transfer, setTransfer] = useState('')
  const [carId, setCarId] = useState('')
  const [errors, setErrors] = useState<{ uber?: string; transfer?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const freeCars = cars.filter((c) => !c.current_driver_id && c.ownership === wantedOwnership(type))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const uberPct = type === 'company_car' ? parsePct(uber) : null
    const transferPct = parsePct(transfer)
    const errs: typeof errors = {}
    if (type === 'company_car' && uberPct === null) errs.uber = MSG_PCT
    if (transferPct === null) errs.transfer = MSG_PCT
    setErrors(errs)
    setError('')
    if (errs.uber || errs.transfer || transferPct === null) return
    setBusy(true)
    try {
      const r = await api.createDriver({
        name: name.trim(),
        phone,
        driver_type: type,
        ...(uberPct !== null ? { uber_pct: uberPct } : {}),
        transfer_pct: transferPct,
        ...(carId ? { car_id: carId } : {}),
      })
      onCreated({ name: name.trim(), phone, code: r.login_code, pin: r.temp_pin })
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      setError(CREATE_ERRORS[code] ?? MSG_CREATE_FAILED)
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>Novo motorista</strong>
      <label className="field">
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Telefone
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="field">
        Tipo
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as 'company_car' | 'own_car')
            setCarId('')
          }}
        >
          <option value="company_car">Carro da empresa</option>
          <option value="own_car">Carro próprio</option>
        </select>
      </label>
      {type === 'company_car' && (
        <>
          <label className="field">
            % Uber
            <input inputMode="decimal" value={uber} onChange={(e) => setUber(e.target.value)} />
          </label>
          {errors.uber && <p className="error">{errors.uber}</p>}
        </>
      )}
      <label className="field">
        % Transfer
        <input inputMode="decimal" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
      </label>
      {errors.transfer && <p className="error">{errors.transfer}</p>}
      <label className="field">
        Carro
        <select value={carId} onChange={(e) => setCarId(e.target.value)}>
          <option value="">Nenhum</option>
          {freeCars.map((c) => (
            <option key={c.id} value={c.id}>{`${c.model} ${c.plate}`}</option>
          ))}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Criar motorista
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  )
}

function EditPcts({ driver, onDone }: { driver: Profile; onDone: (changed: boolean) => void }) {
  const company = driver.driver_type === 'company_car'
  const fmt = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))
  const [uber, setUber] = useState(fmt(driver.uber_pct))
  const [transfer, setTransfer] = useState(fmt(driver.transfer_pct))
  const [error, setError] = useState('')

  async function save() {
    const u = company ? parsePct(uber) : null
    const t = parsePct(transfer)
    if ((company && u === null) || t === null) return setError(MSG_PCT)
    setError('')
    if (!window.confirm('Vale a partir de hoje para novas corridas. Confirmar?')) return
    try {
      await api.updateDriverPcts(driver.id, u, t)
      onDone(true)
    } catch {
      setError('Não foi possível salvar')
    }
  }

  return (
    <div className="inline-edit">
      {company && (
        <label className="field">
          Novo % Uber
          <input inputMode="decimal" value={uber} onChange={(e) => setUber(e.target.value)} />
        </label>
      )}
      <label className="field">
        Novo % Transfer
        <input inputMode="decimal" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" onClick={() => void save()}>
        Salvar %
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </div>
  )
}
