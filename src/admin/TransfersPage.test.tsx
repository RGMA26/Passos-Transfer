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
  reassignTransfer: vi.fn(),
  deleteTransfer: vi.fn(),
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
    transfer_status: 'assigned',
    ...over,
  }) as api.TransferRow
const drv = (id: string, name: string, active = true) => ({ id, name, active, role: 'driver' }) as Profile

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listTransfers.mockResolvedValue([
    t(),
    t({ id: 't2', client_name: 'Ana', transfer_status: 'completed', km: 42 }),
    t({ id: 't3', client_name: 'Beto', transfer_status: 'checked' }),
  ])
  m.listDrivers.mockResolvedValue([drv('d1', 'Maria Souza'), drv('d2', 'João Lima'), drv('d3', 'Inativo', false)])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

async function openForm() {
  const user = userEvent.setup()
  render(<TransfersPage />)
  await screen.findByText('Hotel Central')
  await user.click(screen.getByRole('button', { name: 'Novo transfer' }))
  return user
}

describe('lista', () => {
  it('mostra os status Atribuída / Concluída / Conferida', async () => {
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Atribuída')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Concluída')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Conferida')).toBeInTheDocument()
    expect(within(rows[2]).getByText('42')).toBeInTheDocument()
  })

  it('filtra por status', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Concluída' }))
    await waitFor(() => expect(m.listTransfers).toHaveBeenLastCalledWith({ status: 'completed' }))
  })

  it('estado vazio', async () => {
    m.listTransfers.mockResolvedValue([])
    render(<TransfersPage />)
    expect(await screen.findByText('Nenhum transfer.')).toBeInTheDocument()
  })

  it('só transfer atribuído tem Trocar motorista e Excluir', async () => {
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    expect(screen.getAllByRole('button', { name: 'Excluir' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Trocar motorista' })).toHaveLength(1)
  })

  it('excluir pede confirmação e exclui', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(confirmSpy).toHaveBeenCalledWith('Excluir este transfer?')
    await waitFor(() => expect(m.deleteTransfer).toHaveBeenCalledWith('t1'))
  })

  it('não exclui se cancelar a confirmação', async () => {
    confirmSpy.mockReturnValue(false)
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(m.deleteTransfer).not.toHaveBeenCalled()
  })

  it('mostra o erro quando o transfer já não pode ser excluído', async () => {
    m.deleteTransfer.mockRejectedValue(new Error('Este transfer não pode mais ser excluído'))
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(await screen.findByText('Este transfer não pode mais ser excluído')).toBeInTheDocument()
  })

  it('troca o motorista', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Trocar motorista' }))
    await user.selectOptions(screen.getByLabelText('Novo motorista'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Salvar motorista' }))
    await waitFor(() => expect(m.reassignTransfer).toHaveBeenCalledWith('t1', 'd2'))
  })
})

describe('novo transfer', () => {
  it('exige cliente, data/hora, valor e motorista', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    expect(screen.getByText('Informe o cliente')).toBeInTheDocument()
    expect(screen.getByText('Informe data e horário')).toBeInTheDocument()
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    expect(screen.getByText('Escolha o motorista')).toBeInTheDocument()
    expect(m.createTransfer).not.toHaveBeenCalled()
  })

  it('só lista motoristas ativos', async () => {
    await openForm()
    const sel = screen.getByLabelText('Motorista')
    expect(within(sel).queryByText('Inativo')).not.toBeInTheDocument()
    expect(within(sel).getByText('João Lima')).toBeInTheDocument()
  })

  it('cria com todos os campos', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Cliente'), ' Hotel Mar ')
    await user.type(screen.getByLabelText('Data'), '2026-11-02')
    await user.type(screen.getByLabelText('Horário'), '14:30')
    await user.type(screen.getByLabelText('Destino (opcional)'), 'Aeroporto')
    await user.type(screen.getByLabelText('Valor contratado'), '300,50')
    await user.selectOptions(screen.getByLabelText('Motorista'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    await waitFor(() => expect(m.createTransfer).toHaveBeenCalledTimes(1))
    expect(m.createTransfer).toHaveBeenCalledWith({
      driver_id: 'd2',
      client_name: 'Hotel Mar',
      scheduled_at: '2026-11-02T17:30:00.000Z',
      ride_date: '2026-11-02',
      origin: null,
      destination: 'Aeroporto',
      amount: 300.5,
    })
  })
})
