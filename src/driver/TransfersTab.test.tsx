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
vi.mock('../components/ReceiptInput', async () => ({
  default: (await import('./testUtils')).FakePhotoInput,
}))

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)
const mShift = vi.mocked(useShift)

const ride = (over = {}) => ({
  id: 'r1',
  client_name: 'Hotel Sol',
  scheduled_at: '2026-10-30T15:30:00Z',
  origin: null,
  destination: null,
  origin_street: 'Av. Aeroporto, 100',
  origin_district: 'Carianos',
  origin_city: 'Florianópolis',
  origin_state: 'SC',
  dest_street: 'Rua Central, 5',
  dest_district: 'Centro',
  dest_city: 'Florianópolis',
  dest_state: 'SC',
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

function shiftState(open: boolean, ops: unknown[] = []) {
  mShift.mockReturnValue({
    loading: false,
    ops: ops as never,
    shift: open ? { id: 's1', odometerStart: 1, startedAtMs: 0 } : null,
    serverRides: [],
    refresh: async () => {},
  })
}

const pendingOp = (kind: string, payload: Record<string, unknown>) => ({
  id: `o-${kind}`, kind, status: 'pending', payload, photos: [],
})

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
  it('lista card com endereço, km estimado e status', async () => {
    render(<TransfersTab />)
    expect(await screen.findByText(/Hotel Sol/)).toBeInTheDocument()
    expect(
      screen.getByText('Av. Aeroporto, 100, Carianos, Florianópolis/SC → Rua Central, 5, Centro, Florianópolis/SC'),
    ).toBeInTheDocument()
    expect(screen.getByText('Km estimado: 18,5')).toBeInTheDocument()
    expect(screen.getByText('Atribuída')).toBeInTheDocument()
    expect(screen.getByText(/Valor contratado/)).toBeInTheDocument()
  })

  it('atribuída: Iniciar pede odômetro e foto, sem campo de km', async () => {
    await open()
    expect(screen.queryByLabelText('Km')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar' }))
    expect(screen.getByText('Informe o odômetro')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Odômetro inicial'), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar' }))
    expect(screen.getByText('Adicione a foto do odômetro')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await userEvent.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('start_transfer')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toEqual({ ride_id: 'r1', odometer: 5000 })
    expect(op.photos.map((p) => p.field)).toEqual(['photo'])
  })

  it('carro da empresa sem turno não inicia', async () => {
    profile = makeProfile({ driver_type: 'company_car' })
    await open()
    expect(screen.getByText('Inicie um turno para iniciar o Transfer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeDisabled()
  })

  it('carro da empresa com turno aberto inicia', async () => {
    profile = makeProfile({ driver_type: 'company_car' })
    shiftState(true)
    await open()
    expect(screen.queryByText('Inicie um turno para iniciar o Transfer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeEnabled()
  })

  it('em andamento: Concluir com odômetro final e foto', async () => {
    mApi.listMyTransfers.mockResolvedValue([
      ride({ transfer_status: 'in_progress', odometer_start: 5000 }),
    ] as never)
    await open()
    expect(screen.getAllByText('Em andamento').length).toBeGreaterThan(0)
    expect(screen.getByText('Odômetro inicial: 5000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar' })).toBeNull()
    expect(screen.queryByLabelText('Km')).toBeNull()
    await userEvent.type(screen.getByLabelText('Odômetro final'), '4990')
    await userEvent.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(screen.getByText('O odômetro final não pode ser menor que o inicial')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByLabelText('Odômetro final'))
    await userEvent.type(screen.getByLabelText('Odômetro final'), '5042')
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('complete_transfer')
    expect(op.payload).toEqual({ ride_id: 'r1', odometer: 5042 })
    expect(op.photos.map((p) => p.field)).toEqual(['photo'])
  })

  it('iniciar ainda na fila já mostra Em andamento e Concluir', async () => {
    shiftState(false, [pendingOp('start_transfer', { ride_id: 'r1', odometer: 7000 })])
    await open()
    expect(screen.getAllByText('Em andamento').length).toBeGreaterThan(0)
    expect(screen.getByText('pendente de envio')).toBeInTheDocument()
    expect(screen.getByText('Odômetro inicial: 7000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument()
  })

  it('iniciar que falhou (ex.: conexão) volta a Iniciar e mostra o erro, mesmo com Concluir na fila', async () => {
    shiftState(false, [
      { ...pendingOp('start_transfer', { ride_id: 'r1', odometer: 7000 }), status: 'failed', error: 'Não enviado: falha de conexão ao enviar. Tente de novo.' },
      pendingOp('complete_transfer', { ride_id: 'r1', odometer: 7040 }),
    ])
    await open()
    expect(screen.getAllByText('Atribuída').length).toBeGreaterThan(0)
    expect(screen.getByText('Não enviado: falha de conexão ao enviar. Tente de novo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
    expect(screen.queryByText('Odômetro inicial: 7000')).toBeNull()
  })

  it('anexo de foto na fila não aparece como pendência do Transfer', async () => {
    mApi.listMyTransfers.mockResolvedValue([
      ride({ transfer_status: 'in_progress', odometer_start: 5000 }),
    ] as never)
    shiftState(false, [pendingOp('attach_photo', { target: 'transfer_start', id: 'r1' })])
    await open()
    expect(screen.queryByText('pendente de envio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument()
  })

  it('concluída: aguardando conferência, sem iniciar/concluir', async () => {
    mApi.listMyTransfers.mockResolvedValue([
      ride({ transfer_status: 'completed', odometer_start: 5000, odometer_end: 5042, km: 42 }),
    ] as never)
    await open()
    expect(screen.getAllByText('Aguardando conferência').length).toBeGreaterThan(0)
    expect(screen.getByText('Km: 42')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar' })).toBeNull()
    // despesas ainda podem ser lançadas até a conferência
    expect(screen.getByRole('button', { name: 'Adicionar pedágio' })).toBeInTheDocument()
  })

  it('concluir ainda na fila mostra aguardando conferência', async () => {
    mApi.listMyTransfers.mockResolvedValue([
      ride({ transfer_status: 'in_progress', odometer_start: 5000 }),
    ] as never)
    shiftState(false, [pendingOp('complete_transfer', { ride_id: 'r1', odometer: 5042 })])
    await open()
    expect(screen.getAllByText('Aguardando conferência').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
  })

  it('recusado mostra o motivo e volta a Concluir', async () => {
    mApi.listMyTransfers.mockResolvedValue([
      ride({ transfer_status: 'in_progress', odometer_start: 5000, reject_reason: 'Foto ilegível' }),
    ] as never)
    await open()
    expect(screen.getByText('Recusado: Foto ilegível')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument()
  })

  it('conferida não tem ações', async () => {
    mApi.listMyTransfers.mockResolvedValue([ride({ transfer_status: 'checked' })] as never)
    await open()
    expect(screen.getAllByText('Conferida').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar pedágio' })).toBeNull()
  })

  it('pausado: aviso e ações desabilitadas', async () => {
    profile = makeProfile({ driver_type: 'own_car', paused: true })
    await open()
    expect(screen.getByText('Seu cadastro está pausado. Fale com a empresa.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Adicionar pedágio' })).toBeNull()
  })

  it('despesa exige valor e comprovante', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar estacionamento' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar despesa' }))
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Valor'), '15,00')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar despesa' }))
    expect(screen.getByText('Adicione o comprovante')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('despesa válida enfileira insert_expense', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar pedágio' }))
    await userEvent.type(screen.getByLabelText('Valor'), '15,50')
    await userEvent.upload(screen.getByLabelText('Comprovante'), photoFile())
    await userEvent.click(screen.getByRole('button', { name: 'Salvar despesa' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('insert_expense')
    expect(op.payload).toMatchObject({ ride_id: 'r1', kind: 'toll', amount: 15.5 })
    expect(typeof op.payload.id).toBe('string')
    expect(op.photos[0].field).toBe('photo_path')
  })

  it('lista despesas com status', async () => {
    mApi.listExpenses.mockResolvedValue([
      { id: 'e1', ride_id: 'r1', kind: 'toll', amount: 10, review_status: 'pending', reject_reason: null },
    ] as never)
    await open()
    expect(await screen.findByText(/Pedágio/)).toBeInTheDocument()
  })

  it('erro de carregamento com tentar de novo', async () => {
    mApi.listMyTransfers.mockRejectedValueOnce(new Error('x'))
    render(<TransfersTab />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/Hotel Sol/)).toBeInTheDocument()
  })
})
