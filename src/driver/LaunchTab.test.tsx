import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LaunchTab from './LaunchTab'
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

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)
const mList = vi.mocked(listOps)

beforeEach(() => {
  vi.clearAllMocks()
  profile = makeProfile()
  mList.mockResolvedValue([])
  mApi.getOpenShift.mockResolvedValue({
    id: 's1',
    odometer_start: 1,
    started_at: '2026-10-30T10:00:00Z',
  } as never)
})

describe('LaunchTab', () => {
  it('carro próprio não vê Uber/BlaBlaCar e só tem a mensagem', async () => {
    profile = makeProfile({ driver_type: 'own_car', current_car_id: null })
    render(<LaunchTab />)
    expect(
      await screen.findByText('Seus lançamentos são feitos na aba Transfers.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Uber' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BlaBlaCar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abastecimento' })).not.toBeInTheDocument()
  })

  it('sem turno aberto Uber e BlaBlaCar ficam desabilitados', async () => {
    mApi.getOpenShift.mockResolvedValue(null)
    render(<LaunchTab />)
    expect(await screen.findByText('Inicie um turno para lançar corridas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uber' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'BlaBlaCar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abastecimento' })).toBeEnabled()
  })

  it('start_shift pendente habilita Uber', async () => {
    mApi.getOpenShift.mockRejectedValue(new TypeError('offline'))
    mList.mockResolvedValue([
      {
        id: 'o1',
        kind: 'start_shift',
        ownerId: 'u1',
        status: 'pending',
        createdAt: 1,
        photos: [],
        payload: { id: 'sp', odometer: 1 },
      },
    ])
    render(<LaunchTab />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uber' })).toBeEnabled())
  })

  it('lança Uber, valida e reseta o formulário', async () => {
    const u = userEvent.setup()
    render(<LaunchTab />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uber' })).toBeEnabled())
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Valor líquido'), '25,50')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe o km')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await u.type(screen.getByLabelText('Km'), '12')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('insert_ride')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toMatchObject({
      id: op.id,
      driver_id: 'u1',
      platform: 'uber',
      amount: 25.5,
      km: 12,
    })
    expect(await screen.findByText('Lançamento salvo')).toBeInTheDocument()
    expect(screen.getByLabelText('Valor líquido')).toHaveValue('')
  })

  it('BlaBlaCar usa "Valor recebido"', async () => {
    const u = userEvent.setup()
    render(<LaunchTab />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'BlaBlaCar' })).toBeEnabled())
    await u.click(screen.getByRole('button', { name: 'BlaBlaCar' }))
    await u.type(screen.getByLabelText('Valor recebido'), '40')
    await u.type(screen.getByLabelText('Km'), '30')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalled())
    expect(mEnqueue.mock.calls[0][0].payload.platform).toBe('blablacar')
  })

  it('abastecimento exige valor, litros e foto', async () => {
    const u = userEvent.setup()
    render(<LaunchTab />)
    await u.click(await screen.findByRole('button', { name: 'Abastecimento' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Valor'), '100')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe os litros')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Litros'), '20,5')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Adicione a foto do comprovante')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await u.upload(screen.getByLabelText('Comprovante'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('insert_fueling')
    expect(op.payload).toMatchObject({ car_id: 'c1', driver_id: 'u1', amount: 100, liters: 20.5 })
    expect(op.photos[0].field).toBe('photo_path')
  })
})
