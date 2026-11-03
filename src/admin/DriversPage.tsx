import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { DriverPause } from '../lib/api'
import type { Car, Profile } from '../lib/types'
import { formatCpf, isValidCpf } from '../lib/cpf'
import { localDate } from '../lib/periods'
import PeriodSignal from '../components/PeriodSignal'
import type { Signal } from '../components/PeriodSignal'
import DriverDocuments from './DriverDocuments'
import { onlyDigits, parsePct } from './helpers'

const MSG_LOAD = 'Não foi possível carregar. Tente novamente.'
const MSG_PCT = 'Informe uma porcentagem entre 0 e 100'
const MSG_CPF = 'CPF inválido'
const TYPE_LABEL: Record<string, string> = {
  company_car: 'Carro da empresa',
  own_car: 'Carro próprio',
}
const SAVE_ERRORS: Record<string, string> = {
  INVALID_NAME: 'Informe o nome',
  INVALID_PHONE: 'Telefone inválido (DDD + número)',
  INVALID_PCT: 'Porcentagem inválida',
  INVALID_CAR: 'Carro indisponível para este motorista',
  INVALID_CPF: MSG_CPF,
  CPF_TAKEN: 'CPF já cadastrado',
}
const MSG_CREATE_FAILED = 'Não foi possível criar o motorista'
const MSG_UPDATE_FAILED = 'Não foi possível salvar o motorista'
const wantedOwnership = (t: string) => (t === 'company_car' ? 'company' : 'own')

const PAUSE_ERRORS: Record<string, string> = {
  OPEN_SHIFTS: 'Encerre o turno aberto antes de pausar',
  INVALID_DATE: 'A data da pausa não pode ser no futuro',
  ENTRIES_AFTER_PAUSE:
    'Há lançamentos ou Transfers depois da data da pausa. Reatribua ou exclua antes de pausar.',
}
const MSG_REFRESH = 'A situação do motorista mudou. Atualize a página.'
const RESUME_ERRORS: Record<string, string> = {
  INVALID_DATE: 'A data de retorno deve ser depois da pausa',
}
const errCode = (err: unknown) => (err as { code?: string }).code ?? ''

interface Access {
  name: string
  phone: string
  code: string
  pin: string
}

type Panel =
  | { kind: 'edit'; id: string }
  | { kind: 'pause'; id: string }
  | { kind: 'resume'; id: string }
  | { kind: 'ficha'; id: string }

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Profile[] | null>(null)
  const [cars, setCars] = useState<Car[]>([])
  const [signals, setSignals] = useState<Map<string, Signal>>(new Map())
  const [failed, setFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
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
      return
    }
    try {
      const rows = await api.listDriverSignals()
      setSignals(new Map(rows.map((r) => [r.driver_id, (r.signal as Signal) ?? null])))
    } catch {
      setSignals(new Map()) // os sinais são um extra: a lista continua útil sem eles
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

  async function remove(d: Profile) {
    if (!window.confirm(`Excluir ${d.name}? O código ${d.login_code} ficará livre para um novo motorista.`)) return
    setActionError('')
    try {
      await api.driverAccess(d.id, 'delete')
      await load()
    } catch (err) {
      setActionError(
        errCode(err) === 'HAS_ENTRIES'
          ? 'Este motorista tem lançamentos. Use Desativar.'
          : 'Não foi possível excluir o motorista',
      )
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
  const panelDriver = panel ? drivers.find((d) => d.id === panel.id) : undefined
  const closePanel = (changed: boolean) => {
    setPanel(null)
    if (changed) void load()
  }

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
        <DriverForm
          cars={cars}
          onCancel={() => setShowForm(false)}
          onSaved={(a) => {
            if (a) setAccess(a)
            setShowForm(false)
            void load()
          }}
        />
      )}
      {panel && panelDriver && panel.kind === 'edit' && (
        <DriverForm
          key={panelDriver.id}
          driver={panelDriver}
          cars={cars}
          onCancel={() => closePanel(false)}
          onSaved={() => closePanel(true)}
        />
      )}
      {panel && panelDriver && panel.kind === 'pause' && <PauseForm driver={panelDriver} onDone={closePanel} />}
      {panel && panelDriver && panel.kind === 'resume' && <ResumeForm driver={panelDriver} onDone={closePanel} />}
      {panel && panelDriver && panel.kind === 'ficha' && (
        <Ficha driver={panelDriver} onClose={() => closePanel(false)} />
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
                  <td>
                    {d.name} <PeriodSignal signal={signals.get(d.id)} paused={d.paused} />
                  </td>
                  <td>{d.phone}</td>
                  <td>{TYPE_LABEL[d.driver_type ?? ''] ?? '—'}</td>
                  <td>{d.uber_pct ?? '—'}</td>
                  <td>{d.transfer_pct ?? '—'}</td>
                  <td>{c ? `${c.model} ${c.plate}` : '—'}</td>
                  <td>{d.active ? 'Ativo' : 'Inativo'}</td>
                  <td className="actions">
                    <button type="button" onClick={() => setPanel({ kind: 'edit', id: d.id })}>
                      Editar
                    </button>
                    <button type="button" onClick={() => setPanel({ kind: 'ficha', id: d.id })}>
                      Ficha
                    </button>
                    {d.paused ? (
                      <button type="button" onClick={() => setPanel({ kind: 'resume', id: d.id })}>
                        Retomar
                      </button>
                    ) : (
                      d.active && (
                        <button type="button" onClick={() => setPanel({ kind: 'pause', id: d.id })}>
                          Pausar
                        </button>
                      )
                    )}
                    <button type="button" onClick={() => void resetPassword(d)}>
                      Resetar senha
                    </button>
                    <button type="button" onClick={() => void toggleActive(d)}>
                      {d.active ? 'Desativar' : 'Reativar'}
                    </button>
                    <button type="button" onClick={() => void remove(d)}>
                      Excluir motorista
                    </button>
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

const fmtPct = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))

/** Cadastro (sem `driver`) e edição completa (com `driver`) do motorista. */
function DriverForm({
  driver,
  cars,
  onCancel,
  onSaved,
}: {
  driver?: Profile
  cars: Car[]
  onCancel: () => void
  onSaved: (a?: Access) => void
}) {
  const [name, setName] = useState(driver?.name ?? '')
  const [phone, setPhone] = useState(driver?.phone ?? '')
  const [cpf, setCpf] = useState(driver?.cpf ? formatCpf(driver.cpf) : '')
  const [type, setType] = useState<'company_car' | 'own_car'>(
    (driver?.driver_type as 'company_car' | 'own_car' | null) ?? 'company_car',
  )
  const [uber, setUber] = useState(fmtPct(driver?.uber_pct ?? null))
  const [transfer, setTransfer] = useState(fmtPct(driver?.transfer_pct ?? null))
  const [carId, setCarId] = useState(driver?.current_car_id ?? '')
  const [errors, setErrors] = useState<{ uber?: string; transfer?: string; cpf?: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const freeCars = cars.filter(
    (c) =>
      (!c.current_driver_id || c.current_driver_id === driver?.id) && c.ownership === wantedOwnership(type),
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    const uberPct = type === 'company_car' ? parsePct(uber) : null
    const transferPct = parsePct(transfer)
    const errs: typeof errors = {}
    if (!isValidCpf(cpf.trim())) errs.cpf = MSG_CPF
    if (type === 'company_car' && uberPct === null) errs.uber = MSG_PCT
    if (transferPct === null) errs.transfer = MSG_PCT
    setErrors(errs)
    setError('')
    if (errs.cpf || errs.uber || errs.transfer || transferPct === null) return
    const cpfDigits = onlyDigits(cpf)
    if (
      driver &&
      type !== driver.driver_type &&
      !window.confirm('Mudar o tipo do motorista? Isso não altera lançamentos já feitos.')
    ) {
      return
    }
    if (
      driver &&
      (uberPct !== driver.uber_pct || transferPct !== driver.transfer_pct) &&
      !window.confirm('Vale a partir de hoje para novas corridas. Confirmar?')
    ) {
      return
    }
    setBusy(true)
    try {
      if (driver) {
        await api.updateDriver(driver.id, {
          name: name.trim(),
          phone,
          cpf: cpfDigits,
          driver_type: type,
          uber_pct: uberPct,
          transfer_pct: transferPct,
          car_id: carId || null,
        })
        onSaved()
      } else {
        const r = await api.createDriver({
          name: name.trim(),
          phone,
          cpf: cpfDigits,
          driver_type: type,
          ...(uberPct !== null ? { uber_pct: uberPct } : {}),
          transfer_pct: transferPct,
          ...(carId ? { car_id: carId } : {}),
        })
        onSaved({ name: name.trim(), phone, code: r.login_code, pin: r.temp_pin })
      }
    } catch (err) {
      setError(SAVE_ERRORS[errCode(err)] ?? (driver ? MSG_UPDATE_FAILED : MSG_CREATE_FAILED))
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>{driver ? `Editar ${driver.name}` : 'Novo motorista'}</strong>
      <label className="field">
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Telefone
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="field">
        CPF
        <input inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} />
      </label>
      {errors.cpf && <p className="error">{errors.cpf}</p>}
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
        {driver ? 'Salvar' : 'Criar motorista'}
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  )
}

function PauseForm({ driver, onDone }: { driver: Profile; onDone: (changed: boolean) => void }) {
  const [date, setDate] = useState(localDate())
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!date) return setError('Informe a data da pausa')
    setError('')
    setBusy(true)
    try {
      await api.pauseDriver(driver.id, date, reason.trim())
      onDone(true)
    } catch (err) {
      setError(PAUSE_ERRORS[errCode(err)] ?? MSG_REFRESH)
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>{`Pausar ${driver.name}`}</strong>
      <label className="field">
        Data da pausa
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        Motivo (opcional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Confirmar pausa
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </form>
  )
}

function ResumeForm({ driver, onDone }: { driver: Profile; onDone: (changed: boolean) => void }) {
  const [date, setDate] = useState(localDate())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!date) return setError('Informe a data de retorno')
    setError('')
    setBusy(true)
    try {
      await api.resumeDriver(driver.id, date)
      onDone(true)
    } catch (err) {
      setError(RESUME_ERRORS[errCode(err)] ?? MSG_REFRESH)
      setBusy(false)
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>{`Retomar ${driver.name}`}</strong>
      <label className="field">
        Data de retorno
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Confirmar retorno
      </button>
      <button type="button" className="link" onClick={() => onDone(false)}>
        Cancelar
      </button>
    </form>
  )
}

const fmtDay = (iso: string) => iso.split('-').reverse().join('/')

function Ficha({ driver, onClose }: { driver: Profile; onClose: () => void }) {
  const [tab, setTab] = useState<'pauses' | 'docs'>('pauses')
  return (
    <div className="panel" role="region" aria-label={`Ficha de ${driver.name}`}>
      <strong>{`Ficha de ${driver.name}`}</strong>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'pauses'} onClick={() => setTab('pauses')}>
          Pausas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'docs'} onClick={() => setTab('docs')}>
          Documentos
        </button>
      </div>
      {tab === 'pauses' ? <PauseHistory driverId={driver.id} /> : <DriverDocuments driverId={driver.id} />}
      <button type="button" className="link" onClick={onClose}>
        Fechar ficha
      </button>
    </div>
  )
}

function PauseHistory({ driverId }: { driverId: string }) {
  const [rows, setRows] = useState<DriverPause[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api
      .listDriverPauses(driverId)
      .then((r) => {
        if (live) setRows(r)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [driverId])
  if (failed) return <p className="error">Não foi possível carregar as pausas.</p>
  if (!rows) return <p className="loading">Carregando…</p>
  if (rows.length === 0) return <p className="hint">Nenhuma pausa registrada.</p>
  return (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id}>
          {`${fmtDay(r.paused_on)} – ${r.resumed_on ? fmtDay(r.resumed_on) : 'em andamento'}${r.reason ? ` · ${r.reason}` : ''}`}
        </li>
      ))}
    </ul>
  )
}
