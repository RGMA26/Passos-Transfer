import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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
const renderPage = (url = '/admin/conferencia') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ReviewPage />
    </MemoryRouter>,
  )

const transfer = (over: Partial<api.PendingTransfer> = {}): api.PendingTransfer => ({
  id: 't1',
  driver_name: 'Ana',
  client_name: 'Hotel Central',
  amount: 250,
  km: 40,
  estimated_km: 38,
  scheduled_at: '2026-10-29T15:00:00Z',
  origin: 'Rua A, 10 – Centro, Palmas/TO',
  destination: 'Av B, 20 – Plano, Palmas/TO',
  odometer_start: 1000,
  odometer_end: 1040,
  odometer_start_photo: 't1a.jpg',
  odometer_end_photo: 't1b.jpg',
  expenses: [{ id: 'e1', kind: 'toll', amount: 12.5, review_status: 'pending', photo_path: 'e1.jpg' }],
  ...over,
})
const full = (): api.PendingReview => ({
  fuelings: [
    {
      id: 'f1', driver_id: 'd1', driver_name: 'Maria', fueled_on: '2026-10-28', amount: 200,
      fuel: 'gasolina', quantity: 35, unit_price: 5.714, values_conflict: false, photo_path: 'f1.jpg',
    },
  ],
  shifts: [
    {
      id: 's1', driver_id: 'd1', driver_name: 'Maria', start_date: '2026-10-28',
      odometer_start: 1000, odometer_end: 1200,
      odometer_start_photo: 's1a.jpg', odometer_end_photo: 's1b.jpg', uber_earnings_photo: null,
      review_status: 'pending', reject_reason: null,
      totals: { uber: { amount: 150, km: 40 }, blablacar: { amount: 80, km: 70 }, transfer_km: 20 },
    },
  ],
  transfers: [transfer()],
})
const empty = (): api.PendingReview => ({ fuelings: [], shifts: [], transfers: [] })

beforeEach(() => {
  vi.clearAllMocks()
  m.listPendingReview.mockResolvedValue(full())
  m.listAlerts.mockResolvedValue([])
  m.signedPhotoUrl.mockImplementation(async (p) => `https://signed/${p}`)
  m.reviewItem.mockResolvedValue(undefined)
})

const section = (name: string) => screen.getByRole('region', { name })

describe('fila', () => {
  it('lista abastecimentos, turnos e transfers com foto; não há seção de despesas avulsas', async () => {
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    expect(f.getByText(/Maria/)).toBeInTheDocument()
    const img = await f.findByRole('img', { name: 'Foto do abastecimento' })
    expect(img).toHaveAttribute('src', 'https://signed/f1.jpg')
    expect(img.closest('a')).toHaveAttribute('href', 'https://signed/f1.jpg')
    expect(img.closest('a')).toHaveAttribute('target', '_blank')
    expect(within(section('Turnos')).getByText(/1000/)).toBeInTheDocument()
    expect(within(section('Transfers concluídos')).getByText(/Hotel Central/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pedágios e estacionamentos' })).toBeNull()
  })

  it('unidade do abastecimento por combustível (L, m³, kWh)', async () => {
    const q = full()
    q.fuelings = [
      { ...q.fuelings[0], id: 'f1', fuel: 'gasolina', quantity: 35, amount: 200, unit_price: 5.714 },
      { ...q.fuelings[0], id: 'f2', fuel: 'gnv', quantity: 20, amount: 100, unit_price: 5 },
      { ...q.fuelings[0], id: 'f3', fuel: 'eletrico', quantity: 50, amount: 40, unit_price: 0.8 },
    ]
    m.listPendingReview.mockResolvedValue(q)
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    expect(f.getByText(/35 L/)).toBeInTheDocument()
    expect(f.getByText(/20 m³/)).toBeInTheDocument()
    expect(f.getByText(/50 kWh/)).toBeInTheDocument()
    expect(f.queryByText(/20 L/)).toBeNull()
  })

  it('abastecimento com valores conflitantes fica em laranja com a conta', async () => {
    const q = full()
    q.fuelings = [{ ...q.fuelings[0], quantity: 40, unit_price: 6.19, amount: 274.6, values_conflict: true }]
    m.listPendingReview.mockResolvedValue(q)
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    const label = f.getByText('🟠 Valores conflitantes')
    expect(label.closest('.review-item')).toHaveClass('conflict')
    expect(f.getByText(/40 L × R\$\s6,19 = R\$\s247,60 ≠ R\$\s274,60/)).toBeInTheDocument()
  })

  it('abastecimento sem conflito não mostra o aviso', async () => {
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    expect(f.queryByText('🟠 Valores conflitantes')).toBeNull()
  })

  it('estado vazio', async () => {
    m.listPendingReview.mockResolvedValue(empty())
    renderPage()
    expect(await screen.findByText('Nada para conferir.')).toBeInTheDocument()
  })

  it('Aprovar chama reviewItem com os quatro parâmetros e recarrega', async () => {
    const user = userEvent.setup()
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    m.listPendingReview.mockResolvedValue(empty())
    await user.click(f.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledWith('fueling', 'f1', true, null))
    expect(await screen.findByText('Nada para conferir.')).toBeInTheDocument()
  })

  it('Recusar sem motivo fica bloqueado', async () => {
    const user = userEvent.setup()
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    await user.click(f.getByRole('button', { name: 'Recusar' }))
    await user.click(f.getByRole('button', { name: 'Confirmar recusa' }))
    expect(f.getByText('Informe o motivo')).toBeInTheDocument()
    expect(m.reviewItem).not.toHaveBeenCalled()
  })

  it('Recusar com motivo envia o motivo', async () => {
    const user = userEvent.setup()
    renderPage()
    const t = within(await waitFor(() => section('Transfers concluídos')))
    await user.click(t.getByRole('button', { name: 'Recusar' }))
    await user.type(t.getByLabelText('Motivo'), '  km errado ')
    await user.click(t.getByRole('button', { name: 'Confirmar recusa' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledWith('transfer', 't1', false, 'km errado'))
  })

  it('PERIOD_CLOSED mostra mensagem amigável', async () => {
    m.reviewItem.mockRejectedValue(new Error('PERIOD_CLOSED'))
    const user = userEvent.setup()
    renderPage()
    const f = within(await waitFor(() => section('Abastecimentos')))
    await user.click(f.getByRole('button', { name: 'Aprovar' }))
    expect(await screen.findByText('Quinzena fechada: não é possível alterar')).toBeInTheDocument()
  })
})

describe('conferência única do transfer', () => {
  it('mostra odômetros, fotos, km real × estimado e as despesas com comprovante', async () => {
    renderPage()
    const t = within(await waitFor(() => section('Transfers concluídos')))
    expect(t.getByText(/1000 → 1040/)).toBeInTheDocument()
    expect(t.getByText(/Km real: 40 · Km estimado: 38/)).toBeInTheDocument()
    expect(t.getByText(/Rua A, 10 – Centro, Palmas\/TO/)).toBeInTheDocument()
    expect(await t.findByRole('img', { name: 'Foto do odômetro inicial' })).toHaveAttribute('src', 'https://signed/t1a.jpg')
    expect(await t.findByRole('img', { name: 'Foto do odômetro final' })).toHaveAttribute('src', 'https://signed/t1b.jpg')
    expect(t.getByText(/Pedágio · R\$\s12,50/)).toBeInTheDocument()
    expect(await t.findByRole('img', { name: 'Comprovante do pedágio' })).toHaveAttribute('src', 'https://signed/e1.jpg')
    expect(t.queryByText('Km acima do estimado')).toBeNull()
  })

  it('real acima de 20% do estimado mostra "Km acima do estimado" em laranja', async () => {
    const q = full()
    q.transfers = [transfer({ km: 46, estimated_km: 38 })]
    m.listPendingReview.mockResolvedValue(q)
    renderPage()
    const t = within(await waitFor(() => section('Transfers concluídos')))
    const warn = t.getByText('Km acima do estimado')
    expect(warn).toHaveClass('warn')
  })

  it('exatamente 20% acima não alerta; sem estimado não alerta', async () => {
    const q = full()
    q.transfers = [transfer({ id: 'ta', km: 45.6, estimated_km: 38 }), transfer({ id: 'tb', km: 90, estimated_km: null })]
    m.listPendingReview.mockResolvedValue(q)
    renderPage()
    await waitFor(() => section('Transfers concluídos'))
    expect(screen.queryByText('Km acima do estimado')).toBeNull()
  })

  it('PDF de comprovante vira link', async () => {
    const q = full()
    q.transfers = [
      transfer({ expenses: [{ id: 'e2', kind: 'parking', amount: 8, review_status: 'pending', photo_path: 'u/e2.pdf' }] }),
    ]
    m.listPendingReview.mockResolvedValue(q)
    renderPage()
    const t = within(await waitFor(() => section('Transfers concluídos')))
    const link = await t.findByRole('link', { name: /Comprovante do estacionamento \(PDF\)/ })
    expect(link).toHaveAttribute('href', 'https://signed/u/e2.pdf')
  })

  it('Aprovar é único: aprova o transfer (e as despesas) numa chamada', async () => {
    const user = userEvent.setup()
    renderPage()
    const t = within(await waitFor(() => section('Transfers concluídos')))
    expect(t.getAllByRole('button', { name: 'Aprovar' })).toHaveLength(1)
    expect(t.getAllByRole('button', { name: 'Recusar' })).toHaveLength(1)
    await user.click(t.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledTimes(1))
    expect(m.reviewItem).toHaveBeenCalledWith('transfer', 't1', true, null)
  })
})

describe('totais do turno', () => {
  it('mostra o que o motorista lançou ao lado do print da Uber', async () => {
    renderPage()
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
    renderPage()
    const s = within(await waitFor(() => section('Turnos')))
    expect(s.getByText('Recusado: Km errado')).toBeInTheDocument()
    await user.click(s.getByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(m.reviewItem).toHaveBeenCalledWith('shift', 's2', true, null))
  })
})

describe('odômetro do turno', () => {
  async function openEdit() {
    const user = userEvent.setup()
    renderPage()
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
    renderPage()
    const a = within(await screen.findByRole('region', { name: 'Alertas' }))
    expect(a.getByText(/km por fora acima de 20%/)).toBeInTheDocument()
    expect(a.getByText(/Maria/)).toBeInTheDocument()
    expect(a.getByText(/60 \/ 200 km/)).toBeInTheDocument()
    expect(a.getByText(/km lançado maior que o rodado/)).toBeInTheDocument()
    expect(a.getByText(/Turno aberto há mais de 24 h/)).toBeInTheDocument()
    expect(a.getByText(/28\/10\/2026/)).toBeInTheDocument()
  })
})

describe('âncoras #item-<id>', () => {
  it('cada item tem id item-<id> e o item do hash entra na tela', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderPage('/admin/conferencia#item-t1')
    await waitFor(() => expect(document.getElementById('item-f1')).not.toBeNull())
    expect(document.getElementById('item-t1')).not.toBeNull()
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect(scroll.mock.instances[0]).toBe(document.getElementById('item-t1'))
  })
})
