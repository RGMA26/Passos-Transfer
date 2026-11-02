import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CarsPage from './CarsPage'
import * as api from '../lib/api'
import type { Car, Profile } from '../lib/types'

vi.mock('../lib/api', () => ({
  listDrivers: vi.fn(),
  listCars: vi.fn(),
  createCar: vi.fn(),
  updateCar: vi.fn(),
  assignCar: vi.fn(),
}))
const m = vi.mocked(api)

const driver = (over: Partial<Profile>): Profile =>
  ({ id: 'd1', role: 'driver', name: 'Maria', driver_type: 'company_car', active: true, ...over }) as Profile
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

beforeEach(() => {
  vi.clearAllMocks()
  m.listDrivers.mockResolvedValue([
    driver({ id: 'd1', name: 'Maria' }),
    driver({ id: 'd2', name: 'Pedro', driver_type: 'company_car' }),
    driver({ id: 'd3', name: 'Zé Próprio', driver_type: 'own_car' }),
  ])
  m.listCars.mockResolvedValue([car()])
})

async function ready() {
  const user = userEvent.setup()
  render(<CarsPage />)
  await screen.findByText('ABC1D23')
  return user
}

describe('CarsPage', () => {
  it('lista modelo, placa, consumo, propriedade e motorista', async () => {
    await ready()
    const r = within(screen.getByText('ABC1D23').closest('tr')!)
    expect(r.getByText('Corolla')).toBeInTheDocument()
    expect(r.getByText('12')).toBeInTheDocument()
    expect(r.getByText('Empresa')).toBeInTheDocument()
    expect(r.getByText('Maria')).toBeInTheDocument()
  })

  it('cria carro com placa maiúscula e consumo com vírgula', async () => {
    m.createCar.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Novo carro' }))
    await user.type(screen.getByLabelText('Modelo'), 'Onix')
    await user.type(screen.getByLabelText('Placa'), 'abc1d24')
    await user.type(screen.getByLabelText('Consumo km/l'), '11,5')
    await user.selectOptions(screen.getByLabelText('Propriedade'), 'own')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(m.createCar).toHaveBeenCalledWith({
      model: 'Onix',
      plate: 'ABC1D24',
      fuel_type: 'flex',
      km_per_l_gasolina: 11.5,
      ownership: 'own',
    })
  })

  it('consumo zero ou vazio não envia', async () => {
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Novo carro' }))
    await user.type(screen.getByLabelText('Modelo'), 'Onix')
    await user.type(screen.getByLabelText('Placa'), 'abc1d24')
    await user.type(screen.getByLabelText('Consumo km/l'), '0')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(await screen.findByText('Informe um consumo maior que zero')).toBeInTheDocument()
    expect(m.createCar).not.toHaveBeenCalled()
  })

  it('placa duplicada mostra mensagem', async () => {
    m.createCar.mockRejectedValue(Object.assign(new Error('PLATE_TAKEN'), { code: 'PLATE_TAKEN' }))
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Novo carro' }))
    await user.type(screen.getByLabelText('Modelo'), 'Onix')
    await user.type(screen.getByLabelText('Placa'), 'abc1d23')
    await user.type(screen.getByLabelText('Consumo km/l'), '10')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Placa já cadastrada')
  })

  it('edita modelo e consumo', async () => {
    m.updateCar.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    const c = screen.getByLabelText('Novo consumo km/l')
    await user.clear(c)
    await user.type(c, '13,2')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(m.updateCar).toHaveBeenCalledWith('c1', { model: 'Corolla', km_per_l_gasolina: 13.2 }),
    )
  })

  it('vincular lista só motoristas do tipo certo, mais Nenhum', async () => {
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Vincular motorista' }))
    const opts = within(screen.getByLabelText('Motorista')).getAllByRole('option').map((o) => o.textContent)
    expect(opts).toEqual(['Nenhum', 'Maria', 'Pedro'])
  })

  it('vincula o motorista escolhido', async () => {
    m.assignCar.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Vincular motorista' }))
    await user.selectOptions(screen.getByLabelText('Motorista'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Confirmar vínculo' }))
    await waitFor(() => expect(m.assignCar).toHaveBeenCalledWith('c1', 'd2'))
  })

  it('Nenhum desvincula', async () => {
    m.assignCar.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Vincular motorista' }))
    await user.selectOptions(screen.getByLabelText('Motorista'), '')
    await user.click(screen.getByRole('button', { name: 'Confirmar vínculo' }))
    await waitFor(() => expect(m.assignCar).toHaveBeenCalledWith('c1', null))
  })

  it('tipo incompatível vindo do servidor mostra a mensagem', async () => {
    m.assignCar.mockRejectedValue(Object.assign(new Error('TYPE_MISMATCH'), { code: 'TYPE_MISMATCH' }))
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Vincular motorista' }))
    await user.selectOptions(screen.getByLabelText('Motorista'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Confirmar vínculo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tipo do motorista não combina com o carro')
  })
})
