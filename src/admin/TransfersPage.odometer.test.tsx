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
    t({ id: 't2', client_name: 'Ana', transfer_status: 'completed', km: 8092500, odometer_start: 1010000, odometer_end: 9102500 }),
    t({ id: 't3', client_name: 'Beto', transfer_status: 'checked', km: 40, odometer_start: 1000, odometer_end: 1040 }),
    t({ id: 't4', client_name: 'Caio', transfer_status: 'in_progress', odometer_start: 2000 }),
  ])
  m.listDrivers.mockResolvedValue([drv('d1', 'Maria Souza')])
  m.unreviewItem.mockResolvedValue(undefined)
  m.fixTransferOdometer.mockResolvedValue(undefined)
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

describe('Corrigir odômetro', () => {
  it('aparece em andamento/concluído (não em conferido nem atribuído) e mostra as leituras', async () => {
    render(<TransfersPage />)
    await screen.findByText('Beto')
    expect(within(row('Ana')).getByRole('button', { name: 'Corrigir odômetro' })).toBeInTheDocument()
    expect(within(row('Caio')).getByRole('button', { name: 'Corrigir odômetro' })).toBeInTheDocument()
    expect(within(row('Beto')).queryByRole('button', { name: 'Corrigir odômetro' })).not.toBeInTheDocument()
    expect(within(row('Hotel Central')).queryByRole('button', { name: 'Corrigir odômetro' })).not.toBeInTheDocument()
    expect(within(row('Ana')).getByText('1.010.000 → 9.102.500')).toBeInTheDocument()
  })

  it('salva as leituras corrigidas e recarrega', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Ana')
    await user.click(within(row('Ana')).getByRole('button', { name: 'Corrigir odômetro' }))
    const r = within(row('Ana'))
    await user.clear(r.getByLabelText('Odômetro inicial'))
    await user.type(r.getByLabelText('Odômetro inicial'), '57876')
    await user.clear(r.getByLabelText('Odômetro final'))
    await user.type(r.getByLabelText('Odômetro final'), '57925')
    await user.click(r.getByRole('button', { name: 'Salvar odômetro' }))
    await waitFor(() => expect(m.fixTransferOdometer).toHaveBeenCalledWith('t2', 57876, 57925))
    await waitFor(() => expect(m.listTransfers).toHaveBeenCalledTimes(2))
  })

  it('final menor que o inicial é bloqueado', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Ana')
    await user.click(within(row('Ana')).getByRole('button', { name: 'Corrigir odômetro' }))
    const r = within(row('Ana'))
    await user.clear(r.getByLabelText('Odômetro final'))
    await user.type(r.getByLabelText('Odômetro final'), '5')
    await user.click(r.getByRole('button', { name: 'Salvar odômetro' }))
    expect(r.getByText('O odômetro final não pode ser menor que o inicial')).toBeInTheDocument()
    expect(m.fixTransferOdometer).not.toHaveBeenCalled()
  })

  it('em andamento: só a leitura inicial', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Caio')
    await user.click(within(row('Caio')).getByRole('button', { name: 'Corrigir odômetro' }))
    const r = within(row('Caio'))
    expect(r.queryByLabelText('Odômetro final')).not.toBeInTheDocument()
    await user.clear(r.getByLabelText('Odômetro inicial'))
    await user.type(r.getByLabelText('Odômetro inicial'), '1999')
    await user.click(r.getByRole('button', { name: 'Salvar odômetro' }))
    await waitFor(() => expect(m.fixTransferOdometer).toHaveBeenCalledWith('t4', 1999, null))
  })
})

describe('Corrigir odômetro: eco, teto e confirmação', () => {
  async function openFix() {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Ana')
    await user.click(within(row('Ana')).getByRole('button', { name: 'Corrigir odômetro' }))
    return { user, r: within(row('Ana')) }
  }

  it('mostra a leitura formatada embaixo dos campos', async () => {
    const { r } = await openFix()
    expect(r.getByText('1.010.000 km')).toBeInTheDocument()
    expect(r.getByText('9.102.500 km')).toBeInTheDocument()
  })

  it('Transfer com mais de 1.000 km pede confirmação; cancelar não salva', async () => {
    confirmSpy.mockReturnValue(false)
    const { user, r } = await openFix()
    await user.clear(r.getByLabelText('Odômetro inicial'))
    await user.type(r.getByLabelText('Odômetro inicial'), '57876')
    await user.clear(r.getByLabelText('Odômetro final'))
    await user.type(r.getByLabelText('Odômetro final'), '60000')
    await user.click(r.getByRole('button', { name: 'Salvar odômetro' }))
    expect(confirmSpy).toHaveBeenCalledWith('Confira a leitura: 60.000 km (2.124 km acima da última). Está certa?')
    expect(m.fixTransferOdometer).not.toHaveBeenCalled()
  })

  it('acima de 9.999.999: "Leitura inválida"', async () => {
    const { user, r } = await openFix()
    await user.clear(r.getByLabelText('Odômetro final'))
    await user.type(r.getByLabelText('Odômetro final'), '10102500')
    await user.click(r.getByRole('button', { name: 'Salvar odômetro' }))
    expect(r.getByRole('alert')).toHaveTextContent('Leitura inválida')
    expect(m.fixTransferOdometer).not.toHaveBeenCalled()
  })
})
