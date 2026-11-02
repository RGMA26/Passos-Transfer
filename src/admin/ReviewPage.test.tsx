import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReviewPage from './ReviewPage'
import * as api from '../lib/api'

vi.mock('../lib/api', () => ({
  listPendingReview: vi.fn(),
  listAlerts: vi.fn(),
  reviewItem: vi.fn(),
  signedPhotoUrl: vi.fn(),
  updateShiftOdometers: vi.fn(),
}))
const m = vi.mocked(api)

const full = (): api.PendingReview => ({
  fuelings: [
    { id: 'f1', driver_id: 'd1', driver_name: 'Maria', fueled_on: '2026-10-28', amount: 200, liters: 35, photo_path: 'f1.jpg' },
  ],
  expenses: [{ id: 'e1', ride_id: 'r1', driver_name: 'João', client_name: 'Hotel Sol', ride_date: '2026-10-27', kind: 'toll', amount: 12.5, photo_path: 'e1.jpg' }],
  shifts: [
    {
      id: 's1', driver_id: 'd1', driver_name: 'Maria', start_date: '2026-10-28',
      odometer_start: 1000, odometer_end: 1200,
      odometer_start_photo: 's1a.jpg', odometer_end_photo: 's1b.jpg', uber_earnings_photo: null,
      review_status: 'pending', reject_reason: null,
      totals: { uber: { amount: 150, km: 40 }, blablacar: { amount: 80, km: 70 }, transfer_km: 20 },
    },
  ],
  transfers: [
    { id: 't1', driver_name: 'Ana', client_name: 'Hotel Central', amount: 250, km: 40, scheduled_at: '2026-10-29T15:00:00Z' },
  ],
})
const empty = (): api.PendingReview => ({ fuelings: [], expenses: [], shifts: [], transfers: [] })

beforeEach(() => {
  vi.clearAllMocks()
  m.listPendingReview.mockResolvedValue(full())
  m.listAlerts.mockResolvedValue([])
  m.signedPhotoUrl.mockImplementation(async (p) => `https://signed/${p}`)
  m.reviewItem.mockResolvedValue(undefined)
})

const section = (name: string) => screen.getByRole('region', { name })

describe('fila', () => {
  it('lista abastecimentos, despesas, turnos e transfers com foto', async () => {
    render(<ReviewPage />)
    const f = within(await waitFor(() => section('Abastecimentos')))
    expect(f.getByText(/Maria/)).toBeInTheDocument()
    const img = await f.findByRole('img', { name: 'Foto do abastecimento' })
    expect(img).toHaveAttribute('src', 'https://signed/f1.jpg')
    expect(img.closest('a')).toHaveAttribute('href', 'https://signed/f1.jpg')
    expect(img.closest('a')).toHaveAttribute('target', '_blank')
    expect(within(section('Pedágios e estacionamentos')).getByText(/João/)).toBeInTheDocument()
    expect(within(section('Pedágios e estacionamentos')).getByText('Transfer: Hotel Sol (27/10)')).toBeInTheDocument()
    expect(within(section('Turnos')).getByText(/1000/)).toBeInTheDocument()
    expect(within(section('Transfers concluídos')).getByText(/Hotel Central/)).toBeInTheDocument()
  })

  it('estado vazio', async () => {
    m.listPendingReview.mockResolvedValue(empty())
    render(<ReviewPage />)
    expect(await screen.findByText('Nada para conferir.')).toBeInTheDocument()
  })

  it('Aprovar chama reviewItem com os quatro parâmetros e recarrega', async () => {
    const user = userEvent.setup()
    render(<ReviewPage />)
    const f = within(await waitFor(() => section('Abastecimentos')))
    m.listPendingReview.mockResolvedValue(empty())
    await user.click(f.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledWith('fueling', 'f1', true, null))
    expect(await screen.findByText('Nada para conferir.')).toBeInTheDocument()
  })

  it('Recusar sem motivo fica bloqueado', async () => {
    const user = userEvent.setup()
    render(<ReviewPage />)
    const f = within(await waitFor(() => section('Abastecimentos')))
    await user.click(f.getByRole('button', { name: 'Recusar' }))
    await user.click(f.getByRole('button', { name: 'Confirmar recusa' }))
    expect(f.getByText('Informe o motivo')).toBeInTheDocument()
    expect(m.reviewItem).not.toHaveBeenCalled()
  })

  it('Recusar com motivo envia o motivo', async () => {
    const user = userEvent.setup()
    render(<ReviewPage />)
    const t = within(await waitFor(() => section('Transfers concluídos')))
    await user.click(t.getByRole('button', { name: 'Recusar' }))
    await user.type(t.getByLabelText('Motivo'), '  km errado ')
    await user.click(t.getByRole('button', { name: 'Confirmar recusa' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledWith('transfer', 't1', false, 'km errado'))
  })

  it('PERIOD_CLOSED mostra mensagem amigável', async () => {
    m.reviewItem.mockRejectedValue(new Error('PERIOD_CLOSED'))
    const user = userEvent.setup()
    render(<ReviewPage />)
    const f = within(await waitFor(() => section('Abastecimentos')))
    await user.click(f.getByRole('button', { name: 'Aprovar' }))
    expect(await screen.findByText('Quinzena fechada: não é possível alterar')).toBeInTheDocument()
  })
})

describe('totais do turno', () => {
  it('mostra o que o motorista lançou ao lado do print da Uber', async () => {
    render(<ReviewPage />)
    const s = within(await waitFor(() => section('Turnos')))
    expect(s.getByText(/^Uber: R\$\s150,00 \(40 km\)$/)).toBeInTheDocument()
    expect(s.getByText(/^BlaBlaCar: R\$\s80,00 \(70 km\)$/)).toBeInTheDocument()
    expect(s.getByText('Transfers: 20 km')).toBeInTheDocument()
  })
})

describe('turno recusado', () => {
  it('aparece na fila com o motivo e pode ser aprovado depois da correção', async () => {
    const q = full()
    q.shifts = [{ ...q.shifts[0], id: 's2', review_status: 'rejected', reject_reason: 'Km errado' }]
    m.listPendingReview.mockResolvedValue(q)
    const user = userEvent.setup()
    render(<ReviewPage />)
    const s = within(await waitFor(() => section('Turnos')))
    expect(s.getByText('Recusado: Km errado')).toBeInTheDocument()
    await user.click(s.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledWith('shift', 's2', true, null))
  })
})

describe('odômetro do turno', () => {
  async function openEdit() {
    const user = userEvent.setup()
    render(<ReviewPage />)
    const s = within(await waitFor(() => section('Turnos')))
    await user.click(s.getByRole('button', { name: 'Corrigir odômetro' }))
    return { user, s }
  }

  it('corrige o odômetro antes de aprovar', async () => {
    const { user, s } = await openEdit()
    await user.clear(s.getByLabelText('Odômetro inicial'))
    await user.type(s.getByLabelText('Odômetro inicial'), '1010')
    await user.clear(s.getByLabelText('Odômetro final'))
    await user.type(s.getByLabelText('Odômetro final'), '1250')
    await user.click(s.getByRole('button', { name: 'Salvar odômetro' }))
    await waitFor(() => expect(m.updateShiftOdometers).toHaveBeenCalledWith('s1', 1010, 1250))
  })

  it('final menor que o inicial é bloqueado', async () => {
    const { user, s } = await openEdit()
    await user.clear(s.getByLabelText('Odômetro final'))
    await user.type(s.getByLabelText('Odômetro final'), '900')
    await user.click(s.getByRole('button', { name: 'Salvar odômetro' }))
    expect(s.getByText('O odômetro final não pode ser menor que o inicial')).toBeInTheDocument()
    expect(m.updateShiftOdometers).not.toHaveBeenCalled()
  })

  it('PERIOD_CLOSED ao salvar odômetro', async () => {
    m.updateShiftOdometers.mockRejectedValue(new Error('PERIOD_CLOSED'))
    const { user, s } = await openEdit()
    await user.click(s.getByRole('button', { name: 'Salvar odômetro' }))
    expect(await screen.findByText('Quinzena fechada: não é possível alterar')).toBeInTheDocument()
  })
})

describe('alertas', () => {
  it('renderiza os três tipos com o motorista', async () => {
    m.listAlerts.mockResolvedValue([
      { kind: 'HIGH_OFF_KM', driver_id: 'd1', driver_name: 'Maria', shift_id: 's1', detail: { km_off: 60, km_total: 200 } },
      { kind: 'NEGATIVE_OFF_KM', driver_id: 'd2', driver_name: 'João', shift_id: 's2', detail: { km_off: -10, km_total: 100 } },
      { kind: 'SHIFT_OPEN_24H', driver_id: 'd3', driver_name: 'Ana', shift_id: 's3', detail: { started_at: '2026-10-28T12:00:00Z' } },
    ])
    render(<ReviewPage />)
    const a = within(await screen.findByRole('region', { name: 'Alertas' }))
    expect(a.getByText(/km por fora acima de 20%/)).toBeInTheDocument()
    expect(a.getByText(/Maria/)).toBeInTheDocument()
    expect(a.getByText(/60 \/ 200 km/)).toBeInTheDocument()
    expect(a.getByText(/km lançado maior que o rodado/)).toBeInTheDocument()
    expect(a.getByText(/Turno aberto há mais de 24 h/)).toBeInTheDocument()
    expect(a.getByText(/28\/10\/2026/)).toBeInTheDocument()
  })
})
