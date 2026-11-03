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
  estimateRoute: vi.fn(),
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
    ...over,
  }) as api.TransferRow
const drv = (id: string, name: string, active = true) => ({ id, name, active, role: 'driver' }) as Profile

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listTransfers.mockResolvedValue([
    t(),
    t({ id: 't2', client_name: 'Ana', transfer_status: 'completed', km: 42, estimated_km: 38.5 }),
    t({ id: 't4', client_name: 'Caio', transfer_status: 'in_progress' }),
    t({ id: 't3', client_name: 'Beto', transfer_status: 'checked' }),
  ])
  m.listDrivers.mockResolvedValue([drv('d1', 'Maria Souza'), drv('d2', 'João Lima'), drv('d3', 'Inativo', false)])
  m.estimateRoute.mockResolvedValue(12.3)
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
  it('mostra os status Atribuída / Concluída / Em andamento / Conferida, km estimado e km real', async () => {
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Atribuída')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Concluída')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Em andamento')).toBeInTheDocument()
    expect(within(rows[4]).getByText('Conferida')).toBeInTheDocument()
    expect(within(rows[2]).getByText('38,5')).toBeInTheDocument()
    expect(within(rows[2]).getByText('42')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Km estimado' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Km real' })).toBeInTheDocument()
  })

  it('filtra por Em andamento', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Em andamento' }))
    await waitFor(() => expect(m.listTransfers).toHaveBeenLastCalledWith({ status: 'in_progress' }))
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

  it('bloqueia salvar sem escolher outro motorista', async () => {
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Trocar motorista' }))
    await user.click(screen.getByRole('button', { name: 'Salvar motorista' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o motorista')
    expect(m.reassignTransfer).not.toHaveBeenCalled()
  })

  it('mostra o erro quando o transfer já não pode ser alterado', async () => {
    m.reassignTransfer.mockRejectedValue(new Error('Este transfer não pode mais ser alterado'))
    const user = userEvent.setup()
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    await user.click(screen.getByRole('button', { name: 'Trocar motorista' }))
    await user.selectOptions(screen.getByLabelText('Novo motorista'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Salvar motorista' }))
    expect(await screen.findByText('Este transfer não pode mais ser alterado')).toBeInTheDocument()
  })
})

const ADDR_ORIGIN = {
  street: 'Rua das Flores, 10',
  district: 'Centro',
  city: 'Palmas',
  state: 'TO',
  zip: null,
  ref: null,
}
const ADDR_DEST = { street: 'Av. JK, 200', district: 'Plano Diretor', city: 'Palmas', state: 'TO', zip: null, ref: null }

async function fillAddress(user: ReturnType<typeof userEvent.setup>, group: string, a: typeof ADDR_ORIGIN) {
  const g = within(screen.getByRole('group', { name: group }))
  await user.type(g.getByLabelText('Rua e número'), a.street)
  await user.type(g.getByLabelText('Bairro'), a.district)
  await user.type(g.getByLabelText('Cidade'), a.city)
  await user.type(g.getByLabelText('UF'), a.state)
}

async function fillBase(user: ReturnType<typeof userEvent.setup>, time = '14:30') {
  await user.type(screen.getByLabelText('Cliente'), ' Hotel Mar ')
  await user.type(screen.getByLabelText('Data'), '2026-11-02')
  await user.type(screen.getByLabelText('Horário'), time)
  await user.type(screen.getByLabelText('Valor contratado'), '300,50')
  await user.selectOptions(screen.getByLabelText('Motorista'), 'd2')
}

describe('novo transfer', () => {
  it('exige cliente, data/hora, valor, motorista e os endereços', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    expect(screen.getByText('Informe o cliente')).toBeInTheDocument()
    expect(screen.getByText('Informe data e horário')).toBeInTheDocument()
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    expect(screen.getByText('Escolha o motorista')).toBeInTheDocument()
    expect(screen.getByText('Preencha o endereço de origem')).toBeInTheDocument()
    expect(screen.getByText('Preencha o endereço de destino')).toBeInTheDocument()
    expect(m.createTransfer).not.toHaveBeenCalled()
  })

  it('mostra os campos de endereço de origem e destino; CEP e referência opcionais', async () => {
    await openForm()
    for (const name of ['Origem', 'Destino']) {
      const g = within(screen.getByRole('group', { name }))
      for (const l of ['Rua e número', 'Bairro', 'Cidade', 'UF', 'CEP (opcional)', 'Referência (opcional)']) {
        expect(g.getByLabelText(l)).toBeInTheDocument()
      }
    }
  })

  it('endereço sem cidade ainda é inválido (CEP e referência não contam)', async () => {
    const user = await openForm()
    await fillBase(user)
    await fillAddress(user, 'Destino', ADDR_DEST)
    const g = within(screen.getByRole('group', { name: 'Origem' }))
    await user.type(g.getByLabelText('Rua e número'), 'Rua X')
    await user.type(g.getByLabelText('CEP (opcional)'), '77000-000')
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    expect(screen.getByText('Preencha o endereço de origem')).toBeInTheDocument()
    expect(screen.queryByText('Preencha o endereço de destino')).toBeNull()
    expect(m.createTransfer).not.toHaveBeenCalled()
  })

  it('só lista motoristas ativos', async () => {
    await openForm()
    const sel = screen.getByLabelText('Motorista')
    expect(within(sel).queryByText('Inativo')).not.toBeInTheDocument()
    expect(within(sel).getByText('João Lima')).toBeInTheDocument()
  })

  it('calcula o km estimado e cria com os endereços', async () => {
    const user = await openForm()
    await fillBase(user)
    await fillAddress(user, 'Origem', ADDR_ORIGIN)
    await fillAddress(user, 'Destino', ADDR_DEST)
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    await waitFor(() => expect(m.createTransfer).toHaveBeenCalledTimes(1))
    expect(m.estimateRoute).toHaveBeenCalledWith(ADDR_ORIGIN, ADDR_DEST)
    expect(m.createTransfer).toHaveBeenCalledWith({
      driver_id: 'd2',
      client_name: 'Hotel Mar',
      scheduled_at: '2026-11-02T17:30:00.000Z',
      ride_date: '2026-11-02',
      origin: ADDR_ORIGIN,
      destination: ADDR_DEST,
      amount: 300.5,
      estimated_km: 12.3,
    })
    expect(screen.queryByText('Não foi possível calcular o km estimado')).toBeNull()
  })

  it('falha no cálculo: avisa e salva sem km estimado', async () => {
    m.estimateRoute.mockResolvedValue(null)
    const user = await openForm()
    await fillBase(user)
    await fillAddress(user, 'Origem', ADDR_ORIGIN)
    await fillAddress(user, 'Destino', ADDR_DEST)
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    await waitFor(() => expect(m.createTransfer).toHaveBeenCalledTimes(1))
    expect(m.createTransfer.mock.calls[0][0].estimated_km).toBeNull()
    expect(await screen.findByText('Não foi possível calcular o km estimado')).toBeInTheDocument()
  })

  it('23:30 mantém a data digitada', async () => {
    const user = await openForm()
    await fillBase(user, '23:30')
    await fillAddress(user, 'Origem', ADDR_ORIGIN)
    await fillAddress(user, 'Destino', ADDR_DEST)
    await user.click(screen.getByRole('button', { name: 'Criar transfer' }))
    await waitFor(() => expect(m.createTransfer).toHaveBeenCalledTimes(1))
    const arg = m.createTransfer.mock.calls[0][0]
    expect(arg.ride_date).toBe('2026-11-02')
    expect(arg.scheduled_at).toBe('2026-11-03T02:30:00.000Z')
  })
})
