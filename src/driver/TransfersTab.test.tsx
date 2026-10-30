import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransfersTab from './TransfersTab'
import { makeProfile, photoFile } from './testUtils'
import * as api from '../lib/api'
import { enqueue } from '../lib/offline/queue'
import { useShift } from './useShift'

let profile = makeProfile()
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

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)
const mShift = vi.mocked(useShift)

const ride = (over = {}) => ({
  id: 'r1',
  client_name: 'Hotel Sol',
  scheduled_at: '2026-10-30T15:30:00Z',
  origin: 'Aeroporto',
  destination: 'Centro',
  amount: 200,
  km: null,
  transfer_status: 'assigned',
  reject_reason: null,
  shift_id: null,
  ...over,
})

function shiftState(open: boolean, ops: unknown[] = []) {
  mShift.mockReturnValue({
    loading: false,
    ops: ops as never,
    shift: open ? { id: 's1', odometerStart: 1, startedAtMs: 0 } : null,
    serverRides: [],
    refresh: async () => {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  profile = makeProfile({ driver_type: 'own_car' })
  mApi.listMyTransfers.mockResolvedValue([ride()] as never)
  mApi.listExpenses.mockResolvedValue([])
  shiftState(false)
})

async function open() {
  render(<TransfersTab />)
  await userEvent.click(await screen.findByRole('button', { name: /Hotel Sol/ }))
}

describe('TransfersTab', () => {
  it('lista card com dados e status', async () => {
    render(<TransfersTab />)
    expect(await screen.findByText(/Hotel Sol/)).toBeInTheDocument()
    expect(screen.getByText('Aeroporto → Centro')).toBeInTheDocument()
    expect(screen.getByText('Atribuída')).toBeInTheDocument()
    expect(screen.getByText(/Valor contratado/)).toBeInTheDocument()
  })

  it('mostra motivo da recusa', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride({ reject_reason: 'Km errado' })] as never)
    render(<TransfersTab />)
    expect(await screen.findByText('Recusado: Km errado')).toBeInTheDocument()
  })

  it('Concluir exige km', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(screen.getByText('Informe o km')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('Concluir enfileira complete_transfer', async () => {
    await open()
    await userEvent.type(screen.getByLabelText('Km'), '42')
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('complete_transfer')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toEqual({ ride_id: 'r1', km: 42 })
    expect(op.photos).toEqual([])
  })

  it('despesa exige valor', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar pedágio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar despesa' }))
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('despesa exige foto', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar estacionamento' }))
    await userEvent.type(screen.getByLabelText('Valor'), '15,00')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar despesa' }))
    expect(screen.getByText('Adicione a foto do comprovante')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('despesa válida enfileira insert_expense', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar pedágio' }))
    await userEvent.type(screen.getByLabelText('Valor'), '15,50')
    await userEvent.upload(screen.getByLabelText('Foto do comprovante'), photoFile())
    await userEvent.click(screen.getByRole('button', { name: 'Salvar despesa' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('insert_expense')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toMatchObject({ ride_id: 'r1', kind: 'toll', amount: 15.5 })
    expect(typeof op.payload.id).toBe('string')
    expect(op.photos[0].field).toBe('photo_path')
  })

  it('lista despesas com status', async () => {
    mApi.listExpenses.mockResolvedValue([
      { id: 'e1', ride_id: 'r1', kind: 'toll', amount: 10, review_status: 'rejected', reject_reason: 'Ilegível' },
    ] as never)
    await open()
    expect(await screen.findByText(/Pedágio/)).toBeInTheDocument()
    expect(screen.getByText(/Ilegível/)).toBeInTheDocument()
  })

  it('carro da empresa sem turno bloqueia Concluir', async () => {
    profile = makeProfile({ driver_type: 'company_car' })
    shiftState(false)
    await open()
    expect(screen.getByText('Inicie um turno para concluir')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeDisabled()
  })

  it('carro da empresa com turno aberto permite concluir', async () => {
    profile = makeProfile({ driver_type: 'company_car' })
    shiftState(true)
    await open()
    expect(screen.queryByText('Inicie um turno para concluir')).toBeNull()
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeEnabled()
  })

  it('transfer conferida não tem ações', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride({ transfer_status: 'checked' })] as never)
    await open()
    expect(screen.getAllByText('Conferida').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar pedágio' })).toBeNull()
  })

  it('mostra pendente de envio', async () => {
    shiftState(false, [
      { id: 'o1', kind: 'complete_transfer', status: 'pending', payload: { ride_id: 'r1', km: 5 }, photos: [] },
    ])
    render(<TransfersTab />)
    expect(await screen.findByText('pendente de envio')).toBeInTheDocument()
  })

  it('erro de carregamento com tentar de novo', async () => {
    mApi.listMyTransfers.mockRejectedValueOnce(new Error('x'))
    render(<TransfersTab />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/Hotel Sol/)).toBeInTheDocument()
  })
})
