import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DriversPage from './DriversPage'
import * as api from '../lib/api'
import type { Car, Profile } from '../lib/types'

vi.mock('../lib/api', () => ({
  listDrivers: vi.fn(),
  listCars: vi.fn(),
  createDriver: vi.fn(),
  driverAccess: vi.fn(),
  updateDriver: vi.fn(),
  listDriverSignals: vi.fn(),
  listDriverPauses: vi.fn(),
}))
const m = vi.mocked(api)

const driver = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'd1',
    role: 'driver',
    login_code: 'PASSOS01',
    seq_number: 1,
    name: 'Maria Souza',
    phone: '(11) 98888-7777',
    driver_type: 'company_car',
    uber_pct: 40,
    transfer_pct: 70,
    current_car_id: 'c1',
    active: true,
    paused: false,
    cpf: '52998224725',
    must_change_password: false,
    ...over,
  }) as Profile
const car = (over: Partial<Car> = {}): Car =>
  ({
    id: 'c1',
    model: 'Corolla',
    plate: 'ABC1D23',
    fuel_type: 'flex',
    km_per_l_gasolina: 12,
    ownership: 'company',
    current_driver_id: 'd1',
    ...over,
  }) as Car

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listDrivers.mockResolvedValue([driver()])
  m.listDriverSignals.mockResolvedValue([])
  m.listCars.mockResolvedValue([
    car(),
    car({ id: 'c2', model: 'Livre', plate: 'FREE001', current_driver_id: null }),
    car({ id: 'c3', model: 'Proprio', plate: 'OWN0001', ownership: 'own', current_driver_id: null }),
  ])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

async function openForm() {
  const user = userEvent.setup()
  render(<DriversPage />)
  await screen.findByText('Maria Souza')
  await user.click(screen.getByRole('button', { name: 'Novo motorista' }))
  return user
}

describe('lista', () => {
  it('mostra código, tipo, porcentagens, carro e status', async () => {
    render(<DriversPage />)
    const row = (await screen.findByText('Maria Souza')).closest('tr')!
    const r = within(row)
    expect(r.getByText('PASSOS01')).toBeInTheDocument()
    expect(r.getByText('Carro da empresa')).toBeInTheDocument()
    expect(r.getByText('Corolla ABC1D23')).toBeInTheDocument()
    expect(r.getByText('Ativo')).toBeInTheDocument()
  })
})

describe('novo motorista', () => {
  it('campos de porcentagem começam vazios e % Uber aparece para carro da empresa', async () => {
    await openForm()
    expect(screen.getByLabelText('% Transfer')).toHaveValue('')
    expect(screen.getByLabelText('% Uber')).toHaveValue('')
  })

  it('esconde % Uber para carro próprio', async () => {
    const user = await openForm()
    await user.selectOptions(screen.getByLabelText('Tipo'), 'own_car')
    expect(screen.queryByLabelText('% Uber')).not.toBeInTheDocument()
  })

  it('sem % Uber (carro da empresa) não envia', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Nome'), 'João Silva')
    await user.type(screen.getByLabelText('Telefone'), '11999998888')
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25')
    await user.type(screen.getByLabelText('% Transfer'), '70')
    await user.click(screen.getByRole('button', { name: 'Criar motorista' }))
    expect(await screen.findAllByText('Informe uma porcentagem entre 0 e 100')).toHaveLength(1)
    expect(m.createDriver).not.toHaveBeenCalled()
  })

  it('sem % Transfer não envia; 0 e 101 também não', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Nome'), 'João')
    await user.type(screen.getByLabelText('Telefone'), '11999998888')
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'own_car')
    await user.click(screen.getByRole('button', { name: 'Criar motorista' }))
    expect(await screen.findByText('Informe uma porcentagem entre 0 e 100')).toBeInTheDocument()
    for (const bad of ['0', '101']) {
      await user.clear(screen.getByLabelText('% Transfer'))
      await user.type(screen.getByLabelText('% Transfer'), bad)
      await user.click(screen.getByRole('button', { name: 'Criar motorista' }))
    }
    expect(m.createDriver).not.toHaveBeenCalled()
  })

  it('só oferece carros livres do tipo certo', async () => {
    await openForm()
    const sel = screen.getByLabelText('Carro')
    const opts = within(sel).getAllByRole('option').map((o) => o.textContent)
    expect(opts).toEqual(['Nenhum', 'Livre FREE001'])
  })

  it('cria, aceita vírgula, e mostra código, PIN e link do WhatsApp', async () => {
    m.createDriver.mockResolvedValue({ driver_id: 'n', login_code: 'PASSOS02', temp_pin: '123456' })
    const user = await openForm()
    await user.type(screen.getByLabelText('Nome'), 'João Silva')
    await user.type(screen.getByLabelText('Telefone'), '(11) 99999-8888')
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25')
    await user.type(screen.getByLabelText('% Uber'), '40,5')
    await user.type(screen.getByLabelText('% Transfer'), '70')
    await user.selectOptions(screen.getByLabelText('Carro'), 'c2')
    await user.click(screen.getByRole('button', { name: 'Criar motorista' }))

    expect(m.createDriver).toHaveBeenCalledWith({
      name: 'João Silva',
      phone: '(11) 99999-8888',
      cpf: '52998224725',
      driver_type: 'company_car',
      uber_pct: 40.5,
      transfer_pct: 70,
      car_id: 'c2',
    })
    expect(await screen.findByText('Código: PASSOS02')).toBeInTheDocument()
    expect(screen.getByText('PIN: 123456')).toBeInTheDocument()
    const msg =
      'Olá, João! Seu acesso ao app Passos Transfer:\nCódigo: PASSOS02\nPIN: 123456\nNo primeiro acesso você vai criar sua senha.'
    expect(screen.getByRole('link', { name: 'Enviar por WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/5511999998888?text=' + encodeURIComponent(msg),
    )
  })

  it('Copiar usa a área de transferência', async () => {
    m.createDriver.mockResolvedValue({ driver_id: 'n', login_code: 'PASSOS02', temp_pin: '123456' })
    const user = await openForm()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await user.type(screen.getByLabelText('Nome'), 'João')
    await user.type(screen.getByLabelText('Telefone'), '11999998888')
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'own_car')
    await user.type(screen.getByLabelText('% Transfer'), '60')
    await user.click(screen.getByRole('button', { name: 'Criar motorista' }))
    await user.click(await screen.findByRole('button', { name: 'Copiar' }))
    expect(write).toHaveBeenCalledWith('Código: PASSOS02\nPIN: 123456')
  })

  it.each([
    ['INVALID_NAME', 'Informe o nome'],
    ['INVALID_PHONE', 'Telefone inválido (DDD + número)'],
    ['INVALID_PCT', 'Porcentagem inválida'],
    ['INVALID_CAR', 'Carro indisponível para este motorista'],
    ['INVALID_CPF', 'CPF inválido'],
    ['CPF_TAKEN', 'CPF já cadastrado'],
    ['CREATE_FAILED', 'Não foi possível criar o motorista'],
  ])('erro %s vira mensagem', async (code, text) => {
    m.createDriver.mockRejectedValue(Object.assign(new Error(code), { code }))
    const user = await openForm()
    await user.type(screen.getByLabelText('Nome'), 'João')
    await user.type(screen.getByLabelText('Telefone'), '11999998888')
    await user.type(screen.getByLabelText('CPF'), '529.982.247-25')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'own_car')
    await user.type(screen.getByLabelText('% Transfer'), '60')
    await user.click(screen.getByRole('button', { name: 'Criar motorista' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})

describe('ações', () => {
  async function ready() {
    const user = userEvent.setup()
    render(<DriversPage />)
    await screen.findByText('Maria Souza')
    return user
  }

  it('Editar abre o formulário completo e salva via update-driver', async () => {
    m.updateDriver.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('CPF')).toHaveValue('529.982.247-25')
    const t = screen.getByLabelText('% Transfer')
    await user.clear(t)
    await user.type(t, '65,5')
    const n = screen.getByLabelText('Nome')
    await user.clear(n)
    await user.type(n, 'Maria S.')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(confirmSpy).toHaveBeenCalledWith('Vale a partir de hoje para novas corridas. Confirmar?')
    await waitFor(() =>
      expect(m.updateDriver).toHaveBeenCalledWith('d1', {
        name: 'Maria S.',
        phone: '(11) 98888-7777',
        cpf: '52998224725',
        driver_type: 'company_car',
        uber_pct: 40,
        transfer_pct: 65.5,
        car_id: 'c1',
      }),
    )
  })

  it('editar: o carro atual do motorista aparece entre as opções', async () => {
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    const opts = within(screen.getByLabelText('Carro')).getAllByRole('option').map((o) => o.textContent)
    expect(opts).toEqual(['Nenhum', 'Corolla ABC1D23', 'Livre FREE001'])
  })

  it('editar com CPF inválido não envia; CPF_TAKEN do servidor vira mensagem', async () => {
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('CPF'))
    await user.type(screen.getByLabelText('CPF'), '111.111.111-11')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('CPF inválido')).toBeInTheDocument()
    expect(m.updateDriver).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('CPF'))
    await user.type(screen.getByLabelText('CPF'), '52998224725')
    m.updateDriver.mockRejectedValue(Object.assign(new Error('x'), { code: 'CPF_TAKEN' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('CPF já cadastrado')
  })

  it('cancelar a confirmação das porcentagens não altera', async () => {
    confirmSpy.mockReturnValue(false)
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    const t = screen.getByLabelText('% Transfer')
    await user.clear(t)
    await user.type(t, '60')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(m.updateDriver).not.toHaveBeenCalled()
  })

  it('mudar o tipo pede confirmação e cancelar não altera', async () => {
    confirmSpy.mockReturnValue(false)
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.selectOptions(screen.getByLabelText('Tipo'), 'own_car')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(confirmSpy).toHaveBeenCalledWith('Mudar o tipo do motorista? Isso não altera lançamentos já feitos.')
    expect(m.updateDriver).not.toHaveBeenCalled()
  })

  it('editar sem mudar o tipo não pergunta sobre o tipo', async () => {
    m.updateDriver.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.updateDriver).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalledWith('Mudar o tipo do motorista? Isso não altera lançamentos já feitos.')
  })

  it('CPF inválido no cadastro não envia', async () => {
    const user = userEvent.setup()
    render(<DriversPage />)
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Novo motorista' }))
    await user.type(screen.getByLabelText('Nome'), 'João')
    await user.type(screen.getByLabelText('Telefone'), '11999998888')
    await user.type(screen.getByLabelText('CPF'), '123.456.789-00')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'own_car')
    await user.type(screen.getByLabelText('% Transfer'), '60')
    await user.click(screen.getByRole('button', { name: 'Criar motorista' }))
    expect(await screen.findByText('CPF inválido')).toBeInTheDocument()
    expect(m.createDriver).not.toHaveBeenCalled()
  })

  it('desativar pede confirmação', async () => {
    m.driverAccess.mockResolvedValue({})
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    expect(confirmSpy).toHaveBeenCalledWith('Desativar Maria Souza? Ele não conseguirá mais entrar.')
    await waitFor(() => expect(m.driverAccess).toHaveBeenCalledWith('d1', 'deactivate'))
  })

  it('desativar cancelado não chama o servidor', async () => {
    confirmSpy.mockReturnValue(false)
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    expect(m.driverAccess).not.toHaveBeenCalled()
  })

  it('excluir confirma avisando que o código fica livre e recarrega', async () => {
    m.driverAccess.mockResolvedValue({})
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Excluir motorista' }))
    expect(confirmSpy).toHaveBeenCalledWith('Excluir Maria Souza? O código PASSOS01 ficará livre para um novo motorista.')
    await waitFor(() => expect(m.driverAccess).toHaveBeenCalledWith('d1', 'delete'))
    await waitFor(() => expect(m.listDrivers).toHaveBeenCalledTimes(2))
  })

  it('excluir motorista com lançamentos mostra "Use Desativar"', async () => {
    m.driverAccess.mockRejectedValue(Object.assign(new Error('HAS_ENTRIES'), { code: 'HAS_ENTRIES' }))
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Excluir motorista' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Este motorista tem lançamentos. Use Desativar.')
  })

  it('excluir cancelado não chama o servidor', async () => {
    confirmSpy.mockReturnValue(false)
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Excluir motorista' }))
    expect(m.driverAccess).not.toHaveBeenCalled()
  })

  it('reativar não pede confirmação', async () => {
    m.listDrivers.mockResolvedValue([driver({ active: false })])
    m.driverAccess.mockResolvedValue({})
    const user = await ready()
    expect(screen.getByText('Inativo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reativar' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(m.driverAccess).toHaveBeenCalledWith('d1', 'reactivate'))
  })

  it('resetar senha confirma e mostra o novo PIN com WhatsApp', async () => {
    m.driverAccess.mockResolvedValue({ temp_pin: '999000' })
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Resetar senha' }))
    expect(confirmSpy).toHaveBeenCalledWith('Gerar um novo PIN para Maria Souza?')
    expect(await screen.findByText('PIN: 999000')).toBeInTheDocument()
    expect(screen.getByText('Código: PASSOS01')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Enviar por WhatsApp' }).getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\/5511988887777\?text=/,
    )
  })
})
