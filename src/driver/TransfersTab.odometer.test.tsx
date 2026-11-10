import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransfersTab from './TransfersTab'
import { makeProfile, photoFile } from './testUtils'
import * as api from '../lib/api'
import { enqueue } from '../lib/offline/queue'
import { useShift } from './useShift'

const profile = makeProfile()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile }),
}))
vi.mock('../lib/api', () => ({
  listMyTransfers: vi.fn(),
  listExpenses: vi.fn(),
}))
vi.mock('../lib/offline/queue', () => ({
  enqueue: vi.fn(async () => {}),
  listOps: vi.fn(async () => []),
  onQueueChange: vi.fn(() => () => {}),
}))
vi.mock('./useShift', () => ({ useShift: vi.fn() }))
vi.mock('../components/PhotoInput', async () => ({
  default: (await import('./testUtils')).FakePhotoInput,
}))
vi.mock('../components/ReceiptInput', async () => ({
  default: (await import('./testUtils')).FakePhotoInput,
}))

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)

const ride = (over = {}) => ({
  id: 'r1',
  client_name: 'Hotel Sol',
  scheduled_at: '2026-10-30T15:30:00Z',
  origin_street: 'Av. Aeroporto, 100',
  origin_district: 'Carianos',
  origin_city: 'Passos',
  origin_state: 'MG',
  dest_street: 'Rua Central, 5',
  dest_district: 'Centro',
  dest_city: 'Franca',
  dest_state: 'SP',
  amount: 200,
  km: null,
  estimated_km: 18.5,
  odometer_start: null,
  odometer_end: null,
  transfer_status: 'assigned',
  reject_reason: null,
  shift_id: null,
  ...over,
})

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mApi.listExpenses.mockResolvedValue([])
  vi.mocked(useShift).mockReturnValue({
    loading: false,
    ops: [],
    shift: { id: 's1', odometerStart: 57876, startedAtMs: 0 },
    serverRides: [],
    refresh: async () => {},
  })
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => confirmSpy.mockRestore())

async function fill(label: string, value: string, button: string) {
  const u = userEvent.setup()
  render(<TransfersTab />)
  await u.click(await screen.findByRole('button', { name: /Hotel Sol/ }))
  await u.type(screen.getByLabelText(label), value)
  await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
  await u.click(screen.getByRole('button', { name: button }))
}

describe('Transfer: leitura conferida', () => {
  it('iniciar 1.010.000 com turno em 57.876 pede confirmação; cancelar não envia', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride()] as never)
    await fill('Odômetro inicial', '1010000', 'Iniciar')
    expect(screen.getByText('1.010.000 km')).toBeInTheDocument()
    expect(confirmSpy).toHaveBeenCalledWith('Confira a leitura: 1.010.000 km (952.124 km acima da última). Está certa?')
    expect(mEnqueue).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Odômetro inicial')).toHaveValue('1010000')
  })

  it('concluir com mais de 1.000 km no Transfer pede confirmação (o caso de produção)', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride({ transfer_status: 'in_progress', odometer_start: 1010000 })] as never)
    await fill('Odômetro final', '9102500', 'Concluir')
    expect(confirmSpy).toHaveBeenCalledWith('Confira a leitura: 9.102.500 km (8.092.500 km acima da última). Está certa?')
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('confirmando, enfileira', async () => {
    confirmSpy.mockReturnValue(true)
    mApi.listMyTransfers.mockResolvedValue([ride({ transfer_status: 'in_progress', odometer_start: 57900 })] as never)
    await fill('Odômetro final', '59000', 'Concluir')
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect(mEnqueue.mock.calls[0][0].payload).toMatchObject({ ride_id: 'r1', odometer: 59000 })
  })

  it('leitura normal não pergunta', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride({ transfer_status: 'in_progress', odometer_start: 57900 })] as never)
    await fill('Odômetro final', '57950', 'Concluir')
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('acima de 9.999.999: "Leitura inválida"', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride({ transfer_status: 'in_progress', odometer_start: 1010000 })] as never)
    await fill('Odômetro final', '10102500', 'Concluir')
    expect(screen.getByRole('alert')).toHaveTextContent('Leitura inválida')
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('ponto não é aceito', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride()] as never)
    await fill('Odômetro inicial', '57.900', 'Iniciar')
    expect(screen.getByRole('alert')).toHaveTextContent('Digite só números, sem ponto ou vírgula')
    expect(mEnqueue).not.toHaveBeenCalled()
  })
})
