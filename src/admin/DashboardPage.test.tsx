import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import * as api from '../lib/api'
import { balance } from './balanceFixture'
import { formatBRL as rawBRL } from '../lib/money'

vi.mock('../lib/api', () => ({ listPendencies: vi.fn(), monthlyBalance: vi.fn() }))
const m = vi.mocked(api)
const brl = (n: number) => rawBRL(n).replace(/\s/g, ' ')

const p = (o: Partial<api.Pendency>): api.Pendency => ({
  category: 'white', item_type: 'fueling', item_id: 'f1', driver_id: 'd1', driver_name: 'Maria Souza',
  label: 'x', occurred_on: '2026-11-02', ...o,
})

function Where() {
  const l = useLocation()
  return <p>{`at:${l.pathname}${l.search}${l.hash}`}</p>
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<DashboardPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  m.monthlyBalance.mockResolvedValue(balance())
  m.listPendencies.mockResolvedValue([
    p({ item_id: 'f1' }),
    p({ item_id: 'f2' }),
    p({ category: 'red', item_type: 'period', item_id: 'p1', driver_id: 'd9' }),
    p({ category: 'orange', item_id: 'f3' }),
  ])
})

describe('DashboardPage', () => {
  it('mostra bolinhas com contagem, cartões do mês e rankings', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /⚪ 2/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /🔴 1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /🟠 1/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /🟡 0/ })).toBeDisabled()
    expect(screen.getByText(brl(7500))).toBeInTheDocument()
    expect(screen.getByText('Maria Souza — 77 km')).toBeInTheDocument()
    expect(screen.getByText('ABC1D23 Corolla — 77 km')).toBeInTheDocument()
  })
  it('várias pendências abrem a lista da categoria', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /⚪ 2/ }))
    expect(await screen.findByText('at:/admin/pendencias?tipo=white')).toBeInTheDocument()
  })
  it('uma pendência de quinzena navega direto', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /🔴 1/ }))
    expect(await screen.findByText('at:/admin/quinzenas?motorista=d9')).toBeInTheDocument()
  })
  it('uma pendência de item navega para a âncora da conferência', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /🟠 1/ }))
    expect(await screen.findByText('at:/admin/conferencia#item-f3')).toBeInTheDocument()
  })
  it('erro de carregamento', async () => {
    m.listPendencies.mockRejectedValue(new Error('x'))
    renderPage()
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
  })
})

describe('DashboardPage: 📷', () => {
  it('pendência de foto vira bolinha 📷 que abre a conferência do item', async () => {
    m.listPendencies.mockResolvedValue([
      p({ category: 'photo', item_type: 'shift', item_id: 's7', label: 'Turno sem foto do odômetro (início)' }),
    ])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /📷 1/ }))
    expect(await screen.findByText('at:/admin/conferencia#item-s7')).toBeInTheDocument()
  })
})
