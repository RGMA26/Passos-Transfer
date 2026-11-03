import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ReviewPage from './ReviewPage'
import * as api from '../lib/api'

vi.mock('../lib/api', () => ({
  listPendingReview: vi.fn(),
  listAlerts: vi.fn(),
  listReviewed: vi.fn(),
  reviewItem: vi.fn(),
  unreviewItem: vi.fn(),
  signedPhotoUrl: vi.fn(),
  updateShiftOdometers: vi.fn(),
  fixTransferOdometer: vi.fn(),
}))
const m = vi.mocked(api)

const CONFIRM_UNDO = 'Desfazer a conferência deste item? Ele volta para a fila de conferência.'

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listPendingReview.mockResolvedValue({ fuelings: [], shifts: [], transfers: [] })
  m.listAlerts.mockResolvedValue([])
  m.signedPhotoUrl.mockImplementation(async (p) => `https://signed/${p}`)
  m.listReviewed.mockResolvedValue([
    { kind: 'transfer', id: 't9', driver_name: 'Ana', date: '2026-10-28', text: 'Transfer · Hotel Central · 9.092.500 km', status: 'checked' },
    { kind: 'shift', id: 's9', driver_name: 'Ana', date: '2026-10-28', text: 'Turno · odômetro 57.876 → 57.877', status: 'approved' },
    { kind: 'fueling', id: 'f9', driver_name: 'Ana', date: '2026-10-27', text: 'Abastecimento · R$ 200,00', status: 'rejected' },
  ])
  m.unreviewItem.mockResolvedValue(undefined)
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/conferencia']}>
      <ReviewPage />
    </MemoryRouter>,
  )

describe('Conferidos recentemente', () => {
  it('lista os itens conferidos com "Desfazer conferência"', async () => {
    renderPage()
    const s = within(await screen.findByRole('region', { name: 'Conferidos recentemente' }))
    expect(s.getByText('Transfer · Hotel Central · 9.092.500 km')).toBeInTheDocument()
    expect(s.getByText('Turno · odômetro 57.876 → 57.877')).toBeInTheDocument()
    expect(s.getAllByRole('button', { name: 'Desfazer conferência' })).toHaveLength(3)
  })

  it('confirma, desfaz e recarrega a fila', async () => {
    const user = userEvent.setup()
    renderPage()
    const s = within(await screen.findByRole('region', { name: 'Conferidos recentemente' }))
    const item = s.getByText('Transfer · Hotel Central · 9.092.500 km').closest('li') as HTMLElement
    await user.click(within(item).getByRole('button', { name: 'Desfazer conferência' }))
    expect(confirmSpy).toHaveBeenCalledWith(CONFIRM_UNDO)
    await waitFor(() => expect(m.unreviewItem).toHaveBeenCalledWith('transfer', 't9'))
    await waitFor(() => expect(m.listPendingReview).toHaveBeenCalledTimes(2))
  })

  it('cancelar não desfaz; quinzena fechada mostra o aviso', async () => {
    const user = userEvent.setup()
    renderPage()
    const s = within(await screen.findByRole('region', { name: 'Conferidos recentemente' }))
    const item = s.getByText('Turno · odômetro 57.876 → 57.877').closest('li') as HTMLElement
    confirmSpy.mockReturnValue(false)
    await user.click(within(item).getByRole('button', { name: 'Desfazer conferência' }))
    expect(m.unreviewItem).not.toHaveBeenCalled()
    confirmSpy.mockReturnValue(true)
    m.unreviewItem.mockRejectedValue(new Error('PERIOD_CLOSED'))
    await user.click(within(item).getByRole('button', { name: 'Desfazer conferência' }))
    expect(await within(item).findByRole('alert')).toHaveTextContent('Quinzena fechada: não é possível alterar')
  })
})
