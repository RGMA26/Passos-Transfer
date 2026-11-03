import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import DashboardPage from './DashboardPage'
import * as api from '../lib/api'
import { formatBRL as rawBRL } from '../lib/money'

vi.mock('../lib/api', () => ({ periodSummary: vi.fn() }))
const m = vi.mocked(api)
const formatBRL = (n: number) => rawBRL(n).replace(/\s/g, ' ')

beforeEach(() => vi.clearAllMocks())

describe('DashboardPage', () => {
  it('mostra os números do período atual e o ranking de km por fora', async () => {
    m.periodSummary.mockResolvedValue({
      revenue: { uber: 1000, transfer: 500, blablacar: 200 },
      drivers_share: 900,
      company_share: 800,
      fuel_reimbursed: 150,
      fuel_discounted: 40,
      off_km_ranking: [{ driver_id: 'd1', name: 'Maria Souza', km_off: 77 }],
    })
    render(<DashboardPage />)
    expect(await screen.findByText('Faturamento')).toBeInTheDocument()
    expect(screen.getByText(formatBRL(1700))).toBeInTheDocument()
    expect(screen.getByText(`Uber: ${formatBRL(1000)}`)).toBeInTheDocument()
    const part = screen.getByText('Parte dos motoristas').parentElement!
    expect(within(part).getByText(formatBRL(900))).toBeInTheDocument()
    expect(screen.getByText('Maria Souza — 77 km')).toBeInTheDocument()
  })

  it('erro de carregamento', async () => {
    m.periodSummary.mockRejectedValue(new Error('x'))
    render(<DashboardPage />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
  })
})
