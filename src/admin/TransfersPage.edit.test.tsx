import { describe, it, expect, vi, beforeEach } from 'vitest'
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
}))
const m = vi.mocked(api)

const ORIGIN = { street: 'Rua A, 1', district: 'Centro', city: 'Passos', state: 'MG', zip: '37900-000', ref: null }
const DEST = { street: 'Av. B, 2', district: 'Centro', city: 'Franca', state: 'SP', zip: null, ref: 'Portão azul' }

const t = (over: Partial<api.TransferRow> = {}): api.TransferRow =>
  ({
    id: 't1',
    platform: 'transfer',
    driver_id: 'd1',
    driver_name: 'Maria Souza',
    client_name: 'Hotel Central',
    scheduled_at: '2026-10-30T15:30:00Z',
    ride_date: '2026-10-30',
    amount: 250,
    km: null,
    estimated_km: 40,
    transfer_status: 'assigned',
    origin_street: ORIGIN.street,
    origin_district: ORIGIN.district,
    origin_city: ORIGIN.city,
    origin_state: ORIGIN.state,
    origin_zip: ORIGIN.zip,
    origin_ref: ORIGIN.ref,
    dest_street: DEST.street,
    dest_district: DEST.district,
    dest_city: DEST.city,
    dest_state: DEST.state,
    dest_zip: DEST.zip,
    dest_ref: DEST.ref,
    ...over,
  }) as api.TransferRow
const drv = (id: string, name: string) => ({ id, name, active: true, role: 'driver' }) as Profile

beforeEach(() => {
  vi.clearAllMocks()
  m.listTransfers.mockResolvedValue([
    t(),
    t({ id: 't2', client_name: 'Ana', transfer_status: 'in_progress' }),
    t({ id: 't3', client_name: 'Caio', transfer_status: 'completed', km: 42 }),
    t({ id: 't4', client_name: 'Beto', transfer_status: 'checked', km: 42 }),
  ])
  m.listDrivers.mockResolvedValue([drv('d1', 'Maria Souza'), drv('d2', 'João Lima')])
  m.estimateRoute.mockResolvedValue(55.5)
  m.updateTransfer.mockResolvedValue()
})

async function openEdit(client: string) {
  const user = userEvent.setup()
  render(<TransfersPage />)
  const row = within((await screen.findByText(client)).closest('tr')!)
  await user.click(row.getByRole('button', { name: 'Editar' }))
  const form = within(await screen.findByRole('form', { name: 'Editar transfer' }))
  return { user, form }
}

describe('editar transfer', () => {
  it('Editar em atribuída, em andamento e concluída; nunca em conferida', async () => {
    render(<TransfersPage />)
    await screen.findByText('Hotel Central')
    for (const c of ['Hotel Central', 'Ana', 'Caio']) {
      expect(within(screen.getByText(c).closest('tr')!).getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    }
    expect(within(screen.getByText('Beto').closest('tr')!).queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('abre o formulário preenchido (horário de Brasília)', async () => {
    const { form } = await openEdit('Hotel Central')
    expect(form.getByLabelText('Cliente')).toHaveValue('Hotel Central')
    expect(form.getByLabelText('Data')).toHaveValue('2026-10-30')
    expect(form.getByLabelText('Horário')).toHaveValue('12:30')
    expect(form.getByLabelText('Valor contratado')).toHaveValue('250,00')
    const o = within(form.getByRole('group', { name: 'Origem' }))
    expect(o.getByLabelText('Rua e número')).toHaveValue('Rua A, 1')
    expect(o.getByLabelText('CEP (opcional)')).toHaveValue('37900-000')
    const d = within(form.getByRole('group', { name: 'Destino' }))
    expect(d.getByLabelText('Cidade')).toHaveValue('Franca')
    expect(d.getByLabelText('Referência (opcional)')).toHaveValue('Portão azul')
    expect(form.queryByLabelText('Motorista')).toBeNull()
  })

  it('atribuída: cliente, data/hora e valor sem mexer no endereço → não recalcula o km', async () => {
    const { user, form } = await openEdit('Hotel Central')
    await user.clear(form.getByLabelText('Cliente'))
    await user.type(form.getByLabelText('Cliente'), 'Hotel Novo')
    await user.clear(form.getByLabelText('Horário'))
    await user.type(form.getByLabelText('Horário'), '23:30')
    await user.clear(form.getByLabelText('Valor contratado'))
    await user.type(form.getByLabelText('Valor contratado'), '300')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.updateTransfer).toHaveBeenCalledTimes(1))
    expect(m.estimateRoute).not.toHaveBeenCalled()
    expect(m.updateTransfer).toHaveBeenCalledWith('t1', {
      client_name: 'Hotel Novo',
      scheduled_at: '2026-10-31T02:30:00.000Z',
      ride_date: '2026-10-30',
      amount: 300,
    })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Editar transfer' })).toBeNull())
    expect(m.listTransfers).toHaveBeenCalledTimes(2)
  })

  it('endereço alterado: recalcula o km e envia origem e destino', async () => {
    const { user, form } = await openEdit('Ana')
    const d = within(form.getByRole('group', { name: 'Destino' }))
    await user.clear(d.getByLabelText('Rua e número'))
    await user.type(d.getByLabelText('Rua e número'), 'Av. C, 3')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.updateTransfer).toHaveBeenCalledTimes(1))
    const newDest = { ...DEST, street: 'Av. C, 3' }
    expect(m.estimateRoute).toHaveBeenCalledWith(ORIGIN, newDest)
    expect(m.updateTransfer).toHaveBeenCalledWith('t2', { origin: ORIGIN, destination: newDest, estimated_km: 55.5 })
    expect(screen.queryByText('Não foi possível calcular o km estimado')).toBeNull()
  })

  it('recalcular falhou: km estimado nulo e aviso', async () => {
    m.estimateRoute.mockResolvedValue(null)
    const { user, form } = await openEdit('Hotel Central')
    const o = within(form.getByRole('group', { name: 'Origem' }))
    await user.clear(o.getByLabelText('Bairro'))
    await user.type(o.getByLabelText('Bairro'), 'Jardim')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.updateTransfer).toHaveBeenCalledTimes(1))
    expect(m.updateTransfer.mock.calls[0][1]).toMatchObject({ estimated_km: null })
    expect(await screen.findByText('Não foi possível calcular o km estimado')).toBeInTheDocument()
  })

  it('concluída: só valor e endereços (cliente e data/hora bloqueados)', async () => {
    const { user, form } = await openEdit('Caio')
    expect(form.getByText('Concluído: só o valor e os endereços podem ser alterados.')).toBeInTheDocument()
    expect(form.getByLabelText('Cliente')).toBeDisabled()
    expect(form.getByLabelText('Data')).toBeDisabled()
    expect(form.getByLabelText('Horário')).toBeDisabled()
    await user.clear(form.getByLabelText('Valor contratado'))
    await user.type(form.getByLabelText('Valor contratado'), '280,00')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.updateTransfer).toHaveBeenCalledWith('t3', { amount: 280 }))
  })

  it('valida como no cadastro (número da rua, valor)', async () => {
    const { user, form } = await openEdit('Hotel Central')
    const o = within(form.getByRole('group', { name: 'Origem' }))
    await user.clear(o.getByLabelText('Rua e número'))
    await user.type(o.getByLabelText('Rua e número'), 'Rua A')
    await user.clear(form.getByLabelText('Valor contratado'))
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    expect(form.getByText('Informe o número da rua')).toBeInTheDocument()
    expect(form.getByText('Informe um valor válido')).toBeInTheDocument()
    expect(m.updateTransfer).not.toHaveBeenCalled()
  })

  it('sem mudanças: fecha sem chamar o servidor', async () => {
    const { user, form } = await openEdit('Hotel Central')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Editar transfer' })).toBeNull())
    expect(m.updateTransfer).not.toHaveBeenCalled()
  })

  it.each([
    ['Quinzena fechada: não é possível alterar'],
    ['Este transfer não pode mais ser alterado'],
  ])('erro do servidor: %s', async (msg) => {
    m.updateTransfer.mockRejectedValue(new Error(msg))
    const { user, form } = await openEdit('Hotel Central')
    await user.clear(form.getByLabelText('Cliente'))
    await user.type(form.getByLabelText('Cliente'), 'X')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    expect(await form.findByRole('alert')).toHaveTextContent(msg)
  })

  it('erro desconhecido: mensagem genérica', async () => {
    m.updateTransfer.mockRejectedValue(new Error('boom'))
    const { user, form } = await openEdit('Hotel Central')
    await user.clear(form.getByLabelText('Cliente'))
    await user.type(form.getByLabelText('Cliente'), 'X')
    await user.click(form.getByRole('button', { name: 'Salvar alterações' }))
    expect(await form.findByRole('alert')).toHaveTextContent('Não foi possível salvar o transfer')
  })
})
