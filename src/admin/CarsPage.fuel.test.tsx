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
    fuels: ['gasolina', 'alcool'],
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

const FUEL_BOXES = ['Gasolina', 'Álcool', 'Diesel', 'GNV', 'Elétrico']

async function setFuels(user: ReturnType<typeof userEvent.setup>, wanted: string[]) {
  for (const name of FUEL_BOXES) {
    const box = screen.getByRole('checkbox', { name })
    if ((box as HTMLInputElement).checked !== wanted.includes(name)) await user.click(box)
  }
}

describe('combustíveis do carro (conjunto)', () => {
  it('cinco caixas, com a explicação; novo carro começa Flex (gasolina + álcool)', async () => {
    await openNew()
    const boxes = screen.getAllByRole('checkbox').map((b) => [b.closest('label')!.textContent, (b as HTMLInputElement).checked])
    expect(boxes).toEqual([
      ['Gasolina', true],
      ['Álcool', true],
      ['Diesel', false],
      ['GNV', false],
      ['Elétrico', false],
    ])
    expect(
      screen.getByText('Flex = Gasolina + Álcool; Híbrido = Gasolina + Elétrico; carro com kit GNV: marque também GNV'),
    ).toBeInTheDocument()
  })

  it.each([
    [['Gasolina', 'Álcool'], ['Consumo gasolina (km/l)', 'Consumo álcool (km/l)']],
    [['Gasolina', 'Álcool', 'GNV'], ['Consumo gasolina (km/l)', 'Consumo álcool (km/l)', 'Consumo GNV (km/m³)']],
    [['Gasolina', 'Elétrico'], ['Consumo gasolina (km/l)', 'Consumo elétrico (km/kWh)']],
    [['Diesel'], ['Consumo diesel (km/l)']],
    [['GNV'], ['Consumo GNV (km/m³)']],
  ])('%j mostra um consumo por combustível marcado', async (fuels, labels) => {
    const user = await openNew()
    await setFuels(user, fuels)
    const panel = within(screen.getByText('Novo carro').closest('form')!)
    const shown = panel.queryAllByLabelText(/^Consumo /).map((el) => el.closest('label')!.textContent)
    expect(shown).toEqual(labels)
  })

  it('flex com kit GNV: salva fuels e os consumos', async () => {
    const user = await openNew()
    await setFuels(user, ['Gasolina', 'Álcool', 'GNV'])
    await user.type(screen.getByLabelText('Consumo gasolina (km/l)'), '10,4')
    await user.type(screen.getByLabelText('Consumo álcool (km/l)'), '7')
    await user.type(screen.getByLabelText('Consumo GNV (km/m³)'), '13,5')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    await waitFor(() =>
      expect(m.createCar).toHaveBeenCalledWith({
        model: 'Onix',
        plate: 'XYZ1A23',
        fuels: ['gasolina', 'alcool', 'gnv'],
        km_per_l_gasolina: 10.4,
        km_per_l_alcool: 7,
        km_per_m3_gnv: 13.5,
        ownership: 'company',
      }),
    )
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('nenhum combustível marcado não salva', async () => {
    const user = await openNew()
    await setFuels(user, [])
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Marque ao menos um combustível')
    expect(m.createCar).not.toHaveBeenCalled()
  })

  it('combustível marcado sem consumo pergunta e, confirmado, salva com nulo', async () => {
    const user = await openNew()
    await setFuels(user, ['Gasolina', 'Elétrico'])
    await user.type(screen.getByLabelText('Consumo gasolina (km/l)'), '15')
    await user.click(screen.getByRole('button', { name: 'Criar carro' }))
    expect(confirmSpy).toHaveBeenCalledWith(NO_CONS)
    await waitFor(() =>
      expect(m.createCar).toHaveBeenCalledWith({
        model: 'Onix',
        plate: 'XYZ1A23',
        fuels: ['gasolina', 'eletrico'],
        km_per_l_gasolina: 15,
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

  it('lista mostra o rótulo do conjunto', async () => {
    m.listCars.mockResolvedValue([car({ fuels: ['gasolina', 'alcool', 'gnv'], fuel_type: null, km_per_m3_gnv: 13 })])
    render(<CarsPage />)
    const row = within((await screen.findByText('ABC1D23')).closest('tr')!)
    expect(row.getByText('Flex + GNV')).toBeInTheDocument()
    expect(row.getByText('12 km/l / 13 km/m³')).toBeInTheDocument()
  })

  it('edição: marca GNV num flex existente e salva', async () => {
    const user = userEvent.setup()
    render(<CarsPage />)
    await screen.findByText('ABC1D23')
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('checkbox', { name: 'Gasolina' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'GNV' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'GNV' }))
    await user.type(screen.getByLabelText('Consumo álcool (km/l)'), '8')
    await user.type(screen.getByLabelText('Consumo GNV (km/m³)'), '13')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(m.updateCar).toHaveBeenCalledWith('c1', {
        model: 'Corolla',
        fuels: ['gasolina', 'alcool', 'gnv'],
        km_per_l_gasolina: 12,
        km_per_l_alcool: 8,
        km_per_m3_gnv: 13,
      }),
    )
    expect(confirmSpy).not.toHaveBeenCalled()
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
        fuels: ['gasolina', 'alcool'],
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
