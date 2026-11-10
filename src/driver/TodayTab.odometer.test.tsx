import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TodayTab from './TodayTab'
import { makeProfile, photoFile } from './testUtils'
import * as api from '../lib/api'
import { enqueue, listOps } from '../lib/offline/queue'
import { rememberReading } from '../lib/odometer'

const profile = makeProfile()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile }),
}))
vi.mock('../lib/api', () => ({
  getOpenShift: vi.fn(),
  getShiftRides: vi.fn(),
  getTodaySummary: vi.fn(),
  getCar: vi.fn(),
  getLastCarReading: vi.fn(async () => null),
  endShift: vi.fn(),
  listTodayEntries: vi.fn(async () => []),
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
let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(listOps).mockResolvedValue([])
  mApi.getOpenShift.mockResolvedValue(null)
  mApi.getShiftRides.mockResolvedValue([])
  mApi.getTodaySummary.mockResolvedValue({ byPlatform: { uber: 0, blablacar: 0, transfer: 0 }, kmService: 0, fueled: 0 })
  mApi.getCar.mockResolvedValue({ id: 'c1', model: 'Polo', plate: 'POL1A23' } as never)
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => confirmSpy.mockRestore())

const ui = () =>
  render(
    <MemoryRouter>
      <TodayTab />
    </MemoryRouter>,
  )

describe('Iniciar turno: leitura conferida', () => {
  it('mostra a leitura formatada embaixo do campo', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '9102500')
    expect(screen.getByText('9.102.500 km')).toBeInTheDocument()
  })

  it('acima de 9.999.999: "Leitura inválida"', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '10102500')
    expect(screen.queryByText('10.102.500 km')).toBeNull()
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Leitura inválida')
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('ponto ou vírgula não é aceito', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '57.876')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Digite só números, sem ponto ou vírgula')
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('mais de 1.000 km acima da última leitura pede confirmação; cancelar mantém o formulário', async () => {
    rememberReading('u1', 57877)
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1010000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    expect(confirmSpy).toHaveBeenCalledWith('Confira a leitura: 1.010.000 km (952.123 km acima da última). Está certa?')
    expect(mEnqueue).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Odômetro')).toHaveValue('1010000')
    expect(screen.getByRole('button', { name: 'Iniciar turno' })).toBeEnabled()
  })

  it('confirmando, enfileira', async () => {
    rememberReading('u1', 57877)
    confirmSpy.mockReturnValue(true)
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '60000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect(mEnqueue.mock.calls[0][0].payload).toMatchObject({ odometer: 60000 })
  })

  it('leitura normal não pergunta', async () => {
    rememberReading('u1', 57877)
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '57900')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

describe('Encerrar turno: leitura conferida', () => {
  it('final mais de 1.000 km acima do inicial pede confirmação', async () => {
    mApi.getOpenShift.mockResolvedValue({
      id: 's1',
      driver_id: 'u1',
      odometer_start: 57876,
      started_at: '2026-10-30T10:00:00Z',
      ended_at: null,
    } as never)
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '9102500')
    expect(screen.getByText('9.102.500 km')).toBeInTheDocument()
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(confirmSpy).toHaveBeenCalledWith('Confira a leitura: 9.102.500 km (9.044.624 km acima da última). Está certa?')
    expect(mEnqueue).not.toHaveBeenCalled()
  })
})
