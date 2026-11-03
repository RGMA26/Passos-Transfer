import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransfersPage from './TransfersPage'
import * as api from '../lib/api'
import type { Profile } from '../lib/types'

vi.mock('../lib/api', () => ({
  listTransfers: vi.fn(),
  listDrivers: vi.fn(),
  createTransfer: vi.fn(),
  updateTransfer: vi.fn(),
  reassignTransfer: vi.fn(),
  deleteTransfer: vi.fn(),
  estimateRoute: vi.fn(),
  unreviewItem: vi.fn(),
  fixTransferOdometer: vi.fn(),
}))
const m = vi.mocked(api)

const t = (over: Partial<api.TransferRow> = {}): api.TransferRow =>
  ({
    id: 't1',
    platform: 'transfer',
    driver_id: 'd1',
    driver_name: 'Maria Souza',
    client_name: 'Hotel Central',
    scheduled_at: '2026-10-30T15:30:00Z',
    amount: 250,
    km: null,
    estimated_km: null,
    transfer_status: 'assigned',
    odometer_start: null,
    odometer_end: null,
    ...over,
  }) as api.TransferRow
const drv = (id: string, name: string) => ({ id, name, active: true, role: 'driver' }) as Profile

const CONFIRM_UNDO = 'Desfazer a conferência deste item? Ele volta para a fila de conferência.'

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listTransfers.mockResolvedValue([
    t(),
    t({ id: 't2', client_name: 'Ana', transfer_status: 'completed', km: 9092500, odometer_start: 1010000, odometer_end: 10102500 }),
    t({ id: 't3', client_name: 'Beto', transfer_status: 'checked', km: 40, odometer_start: 1000, odometer_end: 1040 }),
    t({ id: 't4', client_name: 'Caio', transfer_status: 'in_progress', odometer_start: 2000 }),
  ])
  m.listDrivers.mockResolvedValue([drv('d1', 'Maria Souza')])
  m.unreviewItem.mockResolvedValue(undefined)
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('Desfazer conferência', () => {
  it('só aparece no Transfer conferido; confirma e chama unreview_item', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Beto')
    expect(within(row('Ana')).queryByRole('button', { name: 'Desfazer conferência' })).not.toBeInTheDocument()
    expect(within(row('Hotel Central')).queryByRole('button', { name: 'Desfazer conferência' })).not.toBeInTheDocument()
    await user.click(within(row('Beto')).getByRole('button', { name: 'Desfazer conferência' }))
    expect(confirmSpy).toHaveBeenCalledWith(CONFIRM_UNDO)
    await waitFor(() => expect(m.unreviewItem).toHaveBeenCalledWith('transfer', 't3'))
    await waitFor(() => expect(m.listTransfers).toHaveBeenCalledTimes(2))
  })

  it('cancelar a confirmação não desfaz', async () => {
    confirmSpy.mockReturnValue(false)
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Beto')
    await user.click(within(row('Beto')).getByRole('button', { name: 'Desfazer conferência' }))
    expect(m.unreviewItem).not.toHaveBeenCalled()
  })

  it('quinzena fechada mostra o aviso', async () => {
    m.unreviewItem.mockRejectedValue(Object.assign(new Error('PERIOD_CLOSED'), { code: 'P0001' }))
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Beto')
    await user.click(within(row('Beto')).getByRole('button', { name: 'Desfazer conferência' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Quinzena fechada: não é possível alterar')
  })
})
