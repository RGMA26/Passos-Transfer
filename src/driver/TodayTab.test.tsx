import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TodayTab from './TodayTab'
import { makeProfile, photoFile } from './testUtils'
import * as api from '../lib/api'
import { enqueue, listOps } from '../lib/offline/queue'

let profile = makeProfile()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile }),
}))
vi.mock('../lib/api', () => ({
  getOpenShift: vi.fn(),
  getShiftRides: vi.fn(),
  getTodaySummary: vi.fn(),
  getCar: vi.fn(),
  endShift: vi.fn(),
}))
vi.mock('../lib/offline/queue', () => ({
  enqueue: vi.fn(async () => {}),
  listOps: vi.fn(async () => []),
  onQueueChange: vi.fn(() => () => {}),
}))
vi.mock('../components/PhotoInput', async () => ({
  default: (await import('./testUtils')).FakePhotoInput,
}))

const car = { id: 'c1', model: 'Corolla', plate: 'ABC1D23', consumption_km_l: 10 }
const openShift = {
  id: 's1',
  odometer_start: 1000,
  started_at: '2026-10-30T10:00:00Z',
  ended_at: null,
}
const summary = {
  byPlatform: { uber: 150, blablacar: 50, transfer: 0 },
  kmService: 80,
  fueled: 100,
}

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)
const mList = vi.mocked(listOps)

function ui() {
  return render(
    <MemoryRouter>
      <TodayTab />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  profile = makeProfile()
  mList.mockResolvedValue([])
  mApi.getOpenShift.mockResolvedValue(null)
  mApi.getShiftRides.mockResolvedValue([])
  mApi.getTodaySummary.mockResolvedValue(summary)
  mApi.getCar.mockResolvedValue(car as never)
})

describe('TodayTab', () => {
  it('carro da empresa sem turno mostra carro e Iniciar turno', async () => {
    ui()
    expect(await screen.findByRole('button', { name: 'Iniciar turno' })).toBeInTheDocument()
    expect(await screen.findByText('Corolla – ABC1D23')).toBeInTheDocument()
  })

  it('odômetro sem foto não envia', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1000')
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    expect(screen.getByText('Adicione a foto do odômetro')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('inicia turno enfileirando start_shift com dono e foto', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('start_shift')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toMatchObject({ car_id: 'c1', odometer: 1000 })
    expect(op.payload.id).toBe(op.id)
    expect(op.photos[0].field).toBe('photo')
  })

  it('sem carro vinculado mostra aviso e nenhum botão de iniciar', async () => {
    profile = makeProfile({ current_car_id: null })
    ui()
    expect(await screen.findByText('Nenhum carro vinculado. Fale com a empresa.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })

  it('com turno aberto mostra resumo e Encerrar turno', async () => {
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
    expect(await screen.findByText(/R\$\s*150,00/)).toBeInTheDocument()
  })

  it('start_shift pendente (offline) já mostra Encerrar turno', async () => {
    mList.mockResolvedValue([
      {
        id: 'o1',
        kind: 'start_shift',
        ownerId: 'u1',
        status: 'pending',
        createdAt: Date.now() * 1000,
        photos: [],
        payload: { id: 'sp', car_id: 'c1', odometer: 500 },
      },
    ])
    mApi.getOpenShift.mockRejectedValue(new TypeError('offline'))
    ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
  })

  it('abertura sem rede usa o último turno aberto visto no servidor', async () => {
    mApi.getOpenShift.mockResolvedValue({ ...openShift, driver_id: 'u1' } as never)
    const first = ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
    first.unmount()

    mApi.getOpenShift.mockRejectedValue(new TypeError('offline'))
    mApi.getTodaySummary.mockRejectedValue(new TypeError('offline'))
    ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
  })

  it('turno encerrado no servidor limpa o cache', async () => {
    localStorage.setItem('passos.openShift.u1', JSON.stringify({ ...openShift, driver_id: 'u1' }))
    mApi.getOpenShift.mockResolvedValue(null)
    ui()
    expect(await screen.findByRole('button', { name: 'Iniciar turno' })).toBeInTheDocument()
    expect(localStorage.getItem('passos.openShift.u1')).toBeNull()
  })

  it('odômetro final menor que o inicial é recusado', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '900')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(
      screen.getByText('O odômetro final não pode ser menor que o inicial'),
    ).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('com Uber no turno exige o print dos ganhos', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    mApi.getShiftRides.mockResolvedValue([{ id: 'r1', platform: 'uber' }] as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1100')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(screen.getByText('Adicione o print dos ganhos da Uber')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await u.upload(screen.getByLabelText('Print dos ganhos da Uber'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('end_shift')
    expect(op.payload).toMatchObject({ shift_id: 's1', odometer: 1100 })
    expect(op.photos.map((p) => p.field)).toEqual(['photo', 'uber_photo'])
  })

  it('Uber pendente na fila também exige o print', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    mList.mockResolvedValue([
      {
        id: 'o2',
        kind: 'insert_ride',
        ownerId: 'u1',
        status: 'pending',
        createdAt: Date.now() * 1000,
        photos: [],
        payload: { platform: 'uber', amount: 10, km: 5 },
      },
    ])
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1100')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(screen.getByText('Adicione o print dos ganhos da Uber')).toBeInTheDocument()
  })

  it('após encerrar mostra o resumo do servidor', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    mApi.endShift.mockResolvedValue({
      km_total: 120,
      km_service: 90,
      km_off: 30,
      off_discount_estimate: 25.5,
    })
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1120')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(await screen.findByText('Km total')).toBeInTheDocument()
    expect(screen.getByText('Km em serviço')).toBeInTheDocument()
    expect(screen.getByText('Km por fora')).toBeInTheDocument()
    expect(screen.getByText('Desconto da gasolina')).toBeInTheDocument()
    expect(screen.getByText(/R\$\s*25,50/)).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('end_shift ainda na fila mostra km total local e aviso', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1120')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    mList.mockResolvedValue([
      {
        id: 'o3',
        kind: 'end_shift',
        ownerId: 'u1',
        status: 'pending',
        createdAt: Date.now() * 1000,
        photos: [],
        payload: { shift_id: 's1', odometer: 1120 },
      },
    ])
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(
      await screen.findByText('Resumo completo quando o turno for enviado'),
    ).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(mApi.endShift).not.toHaveBeenCalled()
  })

  it('encerrar sem Uber enfileira uber_photo null', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1100')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.payload.uber_photo).toBeNull()
    expect('uber_photo' in op.payload).toBe(true)
  })

  it('dois toques rápidos em Iniciar turno enfileiram uma vez', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    const b = screen.getByRole('button', { name: 'Iniciar turno' })
    await u.dblClick(b)
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect(mEnqueue).toHaveBeenCalledTimes(1)
  })

  it('carro próprio vê Transfers pendentes e não vê turno', async () => {
    profile = makeProfile({ driver_type: 'own_car', current_car_id: null })
    ui()
    expect(await screen.findByText('Transfers pendentes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })
})
