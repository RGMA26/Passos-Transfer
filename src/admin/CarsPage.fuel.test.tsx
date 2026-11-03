import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CarsPage from './CarsPage'
import * as api from '../lib/api'
import type { Car } from '../lib/types'

vi.mock('../lib/api', () => ({
  listDrivers: vi.fn(),
  listCars: vi.fn(),
  createCar: vi.fn(),
  updateCar: vi.fn(),
  assignCar: vi.fn(),
  listCarExpenses: vi.fn(),
  createCarExpense: vi.fn(),
  updateCarExpense: vi.fn(),
  finishCarExpense: vi.fn(),
  deleteCarExpense: vi.fn(),
}))
const m = vi.mocked(api)

const car = (over: Partial<Car> = {}): Car =>
  ({
    id: 'c1',
    model: 'Corolla',
    plate: 'ABC1D23',
    fuel_type: 'flex',
    km_per_l_gasolina: 12,
    ownership: 'company',
    current_driver_id: null,
    ...over,
  }) as Car

const NO_CONS =
  'Tem certeza que quer cadastrar sem o consumo? Sem ele, a gasolina por km não pode ser calculada.'
let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listDrivers.mockResolvedValue([])
  m.listCars.mockResolvedValue([car()])
  m.createCar.mockResolvedValue()
  m.updateCar.mockResolvedValue()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

async function openNew() {
  const user = userEvent.setup()
  render(<CarsPage />)
  await screen.findByText('ABC1D23')
  await user.click(screen.getByRole('button', { name: 'Novo carro' }))
  await user.type(screen.getByLabelText('Modelo'), 'Onix')
  await user.type(screen.getByLabelText('Placa'), 'xyz1a23')
  return user
}

describe('combustível e consumo por tipo', () => {
  it.each([
    ['flex', ['Consumo gasolina (km/l)', 'Consumo álcool (km/l)']],
    ['hibrido', ['Consumo gasolina (km/l)', 'Consumo elétrico (km/kWh)']],
    ['eletrico', ['Consumo elétrico (km/kWh)']],
    ['gnv', ['Consumo GNV (km/m³)']],
    ['diesel', ['Consumo diesel (km/l)']],
    ['gasolina', ['Consumo gasolina (km/l)']],
    ['alcool', ['Consumo álcool (km/l)']],
  ])('%s mostra só os consumos aplicáveis', async (fuel, labels) => {
    const user = await openNew()
    await user.selectOptions(screen.getByLabelText('Combustível'), fuel)
    const panel = within(screen.getByText('Novo carro').closest('form')!)
    const shown = panel.queryAllByLabelText(/^Consumo /).map((el) => el.closest('label')!.textContent)
    expect(shown).toEqual(labels)
  })

  it('oferece os sete tipos', async () => {
    const user = await openNew()
    void user
    const opts = within(screen.getByLabelText('Combustível')).getAllByRole('option').map((o) => o.textContent)
    expect(opts).toEqual(['GNV', 'Diesel', 'Gasolina', 'Álcool', 'Flex', 'Elétrico', 'Híbrido'])
  })

  it('salva o tipo escolhido (não mais sempre flex)', async () => {
    const user = await openNew()
    await user.selectOptions(screen.getByLabelText('Combustível'), 'gnv')
    await user.type(screen.getByLabelText('Consumo GNV (km/m³)'), '13,5')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    await waitFor(() =>
      expect(m.createCar).toHaveBeenCalledWith({
        model: 'Onix',
        plate: 'XYZ1A23',
        fuel_type: 'gnv',
        km_per_m3_gnv: 13.5,
        ownership: 'company',
      }),
    )
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('sem consumo pergunta e, confirmado, salva com nulos', async () => {
    const user = await openNew()
    await user.selectOptions(screen.getByLabelText('Combustível'), 'hibrido')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(confirmSpy).toHaveBeenCalledWith(NO_CONS)
    await waitFor(() =>
      expect(m.createCar).toHaveBeenCalledWith({
        model: 'Onix',
        plate: 'XYZ1A23',
        fuel_type: 'hibrido',
        km_per_l_gasolina: null,
        km_per_kwh: null,
        ownership: 'company',
      }),
    )
  })

  it('sem consumo e recusado na pergunta não salva', async () => {
    confirmSpy.mockReturnValue(false)
    const user = await openNew()
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(confirmSpy).toHaveBeenCalledWith(NO_CONS)
    expect(m.createCar).not.toHaveBeenCalled()
  })

  it('edição troca o tipo, mostra os consumos do novo tipo e salva', async () => {
    const user = userEvent.setup()
    render(<CarsPage />)
    await screen.findByText('ABC1D23')
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.selectOptions(screen.getByLabelText('Combustível'), 'diesel')
    await user.type(screen.getByLabelText('Consumo diesel (km/l)'), '9')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(m.updateCar).toHaveBeenCalledWith('c1', { model: 'Corolla', fuel_type: 'diesel', km_per_l_diesel: 9 }),
    )
  })

  it('edição pode limpar o consumo (com a pergunta)', async () => {
    const user = userEvent.setup()
    render(<CarsPage />)
    await screen.findByText('ABC1D23')
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.clear(screen.getByLabelText('Consumo gasolina (km/l)'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(confirmSpy).toHaveBeenCalledWith(NO_CONS)
    await waitFor(() =>
      expect(m.updateCar).toHaveBeenCalledWith('c1', {
        model: 'Corolla',
        fuel_type: 'flex',
        km_per_l_gasolina: null,
        km_per_l_alcool: null,
      }),
    )
  })
})

describe('Gastos', () => {
  it('só carro da empresa tem o botão Gastos', async () => {
    m.listCars.mockResolvedValue([car(), car({ id: 'c2', plate: 'OWN0001', ownership: 'own' })])
    render(<CarsPage />)
    await screen.findByText('OWN0001')
    expect(within(screen.getByText('ABC1D23').closest('tr')!).getByRole('button', { name: 'Gastos' })).toBeInTheDocument()
    expect(within(screen.getByText('OWN0001').closest('tr')!).queryByRole('button', { name: 'Gastos' })).toBeNull()
  })
})
